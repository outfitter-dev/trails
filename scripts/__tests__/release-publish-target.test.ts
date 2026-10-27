import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface ReleaseJob {
  if?: string;
  outputs?: Record<string, string>;
  steps: {
    env?: Record<string, string>;
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
    await writeFile(join(root, 'package.json'), '{"private":true}\n');
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

test('policy uses the prepared commit and npm uses the workflow commit with main publication guards', () => {
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
    expect(job?.steps[0]?.with?.ref).toMatch(/^\$\{\{ github\.sha \}\}$/);
  }
  expect(workflow.jobs['publish']?.if).toContain(
    "github.event_name == 'workflow_dispatch' && inputs.publish == true"
  );
});

test.each(['publish-policy'])(
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

test.each(['publish', 'publish-auto'])(
  '%s preserves the workflow SHA for npm provenance',
  async (jobId) => {
    await fixture(async (root) => {
      const script = workflow.jobs[jobId]?.steps.find(
        (step) => step.name === 'Publish packages'
      )?.run;
      expect(script).toBe('bun run publish:packages -- --trusted-publishing');
      await writeVersion(root, '0.2.5');
      commit(root);
      await writeFile(join(root, 'README.md'), 'Repository-only change\n');
      const sha = commit(root);
      const bin = join(root, 'bin');
      await mkdir(bin);
      await writeFile(
        join(bin, 'bun'),
        '#!/bin/sh\nprintf "PROVENANCE_SHA=%s\\n" "$GITHUB_SHA"\n',
        { mode: 0o755 }
      );
      const result = run(
        root,
        ['bash', '-eu', '-o', 'pipefail', '-c', script ?? ''],
        {
          ...gitEnv,
          GITHUB_SHA: sha,
          PATH: `${bin}:${gitEnv.PATH ?? ''}`,
        }
      );
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(result.stdout.toString()).toBe(`PROVENANCE_SHA=${sha}\n`);
    });
  }
);

for (const jobId of ['publish', 'publish-auto']) {
  test.each([
    'repository-only',
    'workspace',
    'lockfile',
    'catalog',
    'release-channel',
    'wrong-sha',
    'non-ancestor',
  ])(`${jobId} verifies prepared source identity: %s`, async (change) => {
    const job = workflow.jobs[jobId];
    const step = job?.steps.find(
      (candidate) => candidate.name === 'Verify prepared release source'
    );
    expect(step?.env?.['PREPARED_RELEASE_SHA']).toMatch(
      /^\$\{\{ needs\.publish-policy\.outputs\.release_sha \}\}$/
    );
    expect(step?.run).toBeDefined();
    expect(
      job?.steps.findIndex(
        (candidate) => candidate.name === 'Verify prepared release source'
      )
    ).toBeLessThan(
      job?.steps.findIndex(
        (candidate) => candidate.name === 'Validate package before publish'
      ) ?? -1
    );
    await fixture(async (root) => {
      await writeVersion(root, '0.2.5');
      let prepared = commit(root);
      if (change === 'workspace') {
        await writeFile(
          join(root, 'apps/trails/source.ts'),
          'changed package content\n'
        );
      } else if (change === 'lockfile') {
        await writeFile(
          join(root, 'bun.lock'),
          'changed dependency resolution\n'
        );
      } else if (change === 'catalog') {
        await writeFile(
          join(root, 'package.json'),
          '{"private":true,"catalog":{"zod":"*"}}\n'
        );
      } else if (change === 'release-channel') {
        await mkdir(join(root, '.changeset'));
        await writeFile(
          join(root, '.changeset/pre.json'),
          '{"mode":"pre","tag":"next"}\n'
        );
      } else {
        await writeFile(join(root, 'README.md'), 'Repository-only change\n');
        await writeFile(
          join(root, 'package.json'),
          '{"private":true,"scripts":{"check":"true"}}\n'
        );
      }
      const sha = commit(root);
      if (change === 'non-ancestor') {
        expect(
          run(root, ['git', 'checkout', '--quiet', '--detach', prepared])
            .exitCode
        ).toBe(0);
        await writeFile(join(root, 'OTHER.md'), 'Divergent release\n');
        prepared = commit(root);
        expect(
          run(root, ['git', 'checkout', '--quiet', '--detach', sha]).exitCode
        ).toBe(0);
      }
      const result = run(
        root,
        ['bash', '-eu', '-o', 'pipefail', '-c', step?.run ?? ''],
        {
          ...gitEnv,
          GITHUB_SHA: change === 'wrong-sha' ? prepared : sha,
          PREPARED_RELEASE_SHA: prepared,
          RUNNER_TEMP: root,
        }
      );
      if (change === 'repository-only') {
        expect(result.exitCode, result.stderr.toString()).toBe(0);
      } else {
        expect(result.exitCode).not.toBe(0);
      }
    });
  });
}
