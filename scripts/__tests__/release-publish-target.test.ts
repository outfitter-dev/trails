import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface ReleaseJob {
  if?: string;
  outputs?: Record<string, string>;
  steps: {
    name?: string;
    run?: string;
    uses?: string;
    with?: Record<string, string>;
  }[];
}

const workflow = Bun.YAML.parse(
  await Bun.file(
    new URL('../../.github/workflows/release.yml', import.meta.url)
  ).text()
) as { jobs: Record<string, ReleaseJob> };
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

const run = (cwd: string, args: string[], env = gitEnv) =>
  Bun.spawnSync(args, { cwd, env, stderr: 'pipe', stdout: 'pipe' });

const fixture = async (
  exercise: (root: string, output: string) => Promise<void>
) => {
  const temp = await mkdtemp(join(tmpdir(), 'trails-release-target-'));
  const root = join(temp, 'repo');
  try {
    await mkdir(join(root, 'apps/trails'), { recursive: true });
    expect(run(root, ['git', 'init', '--quiet']).exitCode).toBe(0);
    await exercise(root, join(temp, 'outputs'));
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
};

const commit = (root: string): string => {
  expect(run(root, ['git', 'add', '.']).exitCode).toBe(0);
  const result = run(root, [
    'git',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.name=Release Test',
    '-c',
    'user.email=release@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'test: fixture change',
  ]);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return run(root, ['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
};

const writeVersion = (root: string, version: string) =>
  writeFile(
    join(root, 'apps/trails/package.json'),
    `${JSON.stringify({ version }, null, 2)}\n`
  );

const targetScript = (): string => {
  const step = workflow.jobs['version']?.steps.find(
    (candidate) => candidate.name === 'Resolve prepared release commit'
  );
  expect(step?.run).toBeDefined();
  return step?.run ?? '';
};

test('publication selects the version commit after later repository-only merges', async () => {
  await fixture(async (root, output) => {
    await writeVersion(root, '0.2.4');
    commit(root);
    await writeVersion(root, '0.2.5');
    const release = commit(root);
    await writeFile(
      join(root, 'README.md'),
      'Later repository tooling change\n'
    );
    const latest = commit(root);
    const result = run(
      root,
      ['bash', '-eu', '-o', 'pipefail', '-c', targetScript()],
      {
        ...gitEnv,
        GITHUB_OUTPUT: output,
      }
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(await readFile(output, 'utf8')).toBe(`sha=${release}\n`);
    expect(
      run(root, ['git', 'rev-parse', 'HEAD']).stdout.toString().trim()
    ).toBe(latest);
  });
});

test('publication refuses an uncommitted version with no prepared release commit', async () => {
  await fixture(async (root, output) => {
    await writeVersion(root, '0.2.4');
    commit(root);
    await writeVersion(root, '0.2.5');
    const result = run(
      root,
      ['bash', '-eu', '-o', 'pipefail', '-c', targetScript()],
      {
        ...gitEnv,
        GITHUB_OUTPUT: output,
      }
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      'Could not resolve prepared release commit'
    );
    expect(await Bun.file(output).exists()).toBe(false);
  });
});

test('policy and npm jobs use the prepared commit while keeping main publication guards', () => {
  const policy = workflow.jobs['publish-policy'];
  expect(policy?.steps[0]?.with?.ref).toMatch(
    /^\$\{\{ needs\.version\.outputs\.release_sha \}\}$/
  );
  expect(policy?.outputs?.release_sha).toMatch(
    /^\$\{\{ steps\.policy\.outputs\.release_sha \}\}$/
  );
  for (const id of ['publish', 'publish-auto']) {
    const job = workflow.jobs[id];
    expect(job?.if).toContain("github.ref == 'refs/heads/main'");
    expect(job?.steps[0]?.with?.ref).toMatch(
      /^\$\{\{ needs\.publish-policy\.outputs\.release_sha \}\}$/
    );
  }
  expect(workflow.jobs['publish']?.if).toContain(
    "github.event_name == 'workflow_dispatch' && inputs.publish == true"
  );
});

test.each(['publish-policy', 'publish', 'publish-auto'])(
  '%s binds the operation to the checked-out release SHA',
  async (jobId) => {
    await fixture(async (root, output) => {
      await writeVersion(root, '0.2.5');
      const release = commit(root);
      const bin = join(root, 'bin');
      await mkdir(bin);
      const fakeBun = join(bin, 'bun');
      await writeFile(
        fakeBun,
        '#!/bin/sh\nprintf "POLICY_SHA=%s\\n" "$GITHUB_SHA"\n',
        { mode: 0o755 }
      );
      const script = workflow.jobs[jobId]?.steps.find(
        (step) =>
          step.name ===
          (jobId === 'publish-policy'
            ? 'Resolve publish policy'
            : 'Publish packages')
      )?.run;
      expect(script).toBeDefined();
      const result = run(
        root,
        ['bash', '-eu', '-o', 'pipefail', '-c', script ?? ''],
        {
          ...gitEnv,
          GITHUB_OUTPUT: output,
          GITHUB_SHA: 'later-dispatch-commit',
          PATH: `${bin}:${gitEnv.PATH ?? ''}`,
        }
      );
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(result.stdout.toString()).toContain(`POLICY_SHA=${release}`);
      if (jobId === 'publish-policy') {
        expect(await readFile(output, 'utf8')).toContain(
          `release_sha=${release}`
        );
      }
    });
  }
);
