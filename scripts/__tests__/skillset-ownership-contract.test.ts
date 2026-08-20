import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const repoRoot = join(import.meta.dir, '../..');

const readRepoFile = (path: string): Promise<string> =>
  readFile(join(repoRoot, path), 'utf8');

const readPriority = (command: string): number => {
  const match = /priority: (\d+)/.exec(command);
  if (!match?.[1]) {
    throw new Error('Expected pre-commit command priority');
  }
  return Number(match[1]);
};

const MANAGED_SKILLSET_PATHS = [
  '.skillset/skills/be-clark/references/warden-guide.md',
  '.claude/agents',
  '.claude/skills',
  '.agents/skills',
  '.codex/agents',
  'skillset.lock',
  'plugin/skills/trails/references/warden-guide.md',
] as const;

const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

const runGit = async (
  cwd: string,
  args: readonly string[]
): Promise<string> => {
  const process = Bun.spawn(['git', ...args], {
    cwd,
    env: gitEnv,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr);
  }
  return stdout;
};

const runShell = async (
  cwd: string,
  command: string,
  env: Record<string, string> = {}
): Promise<{ exitCode: number; stderr: string }> => {
  const process = Bun.spawn(['sh', '-c', command], {
    cwd,
    env: { ...gitEnv, ...env },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stderr };
};

describe('Skillset ownership contract', () => {
  test('keeps standalone Skillset as the normal writer and checker', async () => {
    const packageJson = JSON.parse(
      await readRepoFile('package.json')
    ) as Record<string, Record<string, string>>;

    expect(packageJson.scripts?.['skillset:sync']).toBe(
      'bun run warden:skills:sync && skillset build --yes --root .'
    );
    expect(packageJson.scripts?.['skillset:check']).toBe(
      'bun run warden:skills:check && skillset check --only outputs --root .'
    );
    expect(packageJson.scripts?.['skillset:ownership']).toBe(
      'bun test scripts/__tests__/skillset-ownership-contract.test.ts'
    );
  });

  test('keeps Warden source refresh ahead of standalone Skillset projection', async () => {
    const syncScript = await readRepoFile('scripts/sync-skill-warden-guide.ts');

    expect(syncScript).toContain(
      "'.skillset/skills/be-clark/references/warden-guide.md'"
    );
    expect(syncScript).not.toContain(
      "'.claude/skills/be-clark/references/warden-guide.md'"
    );
    expect(syncScript).not.toContain(
      "'.agents/skills/be-clark/references/warden-guide.md'"
    );
  });

  test('keeps Lewis orchestration on canonical Trails skills', async () => {
    const lewis = await readRepoFile('.skillset/skills/be-lewis/SKILL.md');

    expect(lewis).toContain('Invoke `trails-goal-loop`');
    expect(lewis).toContain('Invoke `trails-local-review`');
    expect(lewis).not.toContain('$goal-loop');
    expect(lewis).not.toContain('$local-review');

    for (const providerRoot of ['.claude/skills', '.agents/skills']) {
      const providerLewis = await readRepoFile(
        `${providerRoot}/be-lewis/SKILL.md`
      );
      expect(providerLewis).toContain('Invoke `trails-goal-loop`');
      expect(providerLewis).toContain('Invoke `trails-local-review`');
    }

    for (const skill of ['trails-goal-loop', 'trails-local-review']) {
      for (const skillRoot of [
        '.skillset/skills',
        '.claude/skills',
        '.agents/skills',
      ]) {
        const skillPath = join(repoRoot, skillRoot, skill, 'SKILL.md');
        expect(await readFile(skillPath, 'utf8')).toContain(`name: ${skill}`);
      }
    }
  });

  test('regenerates canonical and managed Skillset surfaces in pre-commit', async () => {
    const lefthook = await readRepoFile('lefthook.yml');
    const teamSkills = lefthook.slice(
      lefthook.indexOf('    team_skills:'),
      lefthook.indexOf('    markdownlint:')
    );

    expect(teamSkills).toContain('bun run skillset:sync && git add -- ');
    expect(teamSkills).toContain('git diff --quiet -- .skillset skillset.yaml');
    expect(teamSkills).toContain(
      'git ls-files --others --exclude-standard -- .skillset skillset.yaml'
    );
    for (const scope of [
      '.skillset/**',
      'skillset.yaml',
      'skillset.lock',
      '.claude/agents/**',
      '.claude/skills/**',
      '.agents/skills/**',
      '.codex/agents/**',
      'packages/warden/**',
      'scripts/sync-skill-warden-guide.ts',
      'plugin/skills/trails/references/warden-guide.md',
    ]) {
      expect(teamSkills).toContain(scope);
    }
    expect(teamSkills).not.toContain('scripts/codex/skillset.ts');
    expect(teamSkills).not.toContain('git add --all');
    expect(teamSkills).not.toContain('git add -A');
    for (const path of MANAGED_SKILLSET_PATHS) {
      expect(teamSkills).toContain(path);
    }
  });

  test('refuses to derive outputs from unstaged or untracked canonical inputs', async () => {
    const lefthook = await readRepoFile('lefthook.yml');
    const teamSkills = lefthook.slice(
      lefthook.indexOf('    team_skills:'),
      lefthook.indexOf('    markdownlint:')
    );
    const command = /^\s+run: (.+)$/m.exec(teamSkills)?.[1];
    expect(command).toBeDefined();

    for (const dirtyCanonical of ['tracked', 'untracked'] as const) {
      const rootDir = await mkdtemp(join(tmpdir(), 'trails-skillset-guard-'));
      const binDir = join(rootDir, 'bin');
      const stagedCanonical = 'skillset.yaml';
      const trackedCanonical = '.skillset/skills/example/SKILL.md';
      const untrackedCanonical = '.skillset/skills/new/SKILL.md';
      const managedOutput = '.claude/skills/example/SKILL.md';
      await mkdir(binDir, { recursive: true });
      for (const path of [stagedCanonical, trackedCanonical, managedOutput]) {
        await mkdir(join(rootDir, path, '..'), { recursive: true });
        await writeFile(join(rootDir, path), `baseline ${path}\n`);
      }
      const fakeBun = join(binDir, 'bun');
      await writeFile(
        fakeBun,
        `#!/bin/sh\nprintf 'regenerated output\\n' > '${managedOutput}'\n`
      );
      await chmod(fakeBun, 0o755);
      await runGit(rootDir, ['init', '--quiet']);
      await runGit(rootDir, [
        'add',
        '--',
        stagedCanonical,
        trackedCanonical,
        managedOutput,
      ]);
      await runGit(rootDir, [
        '-c',
        'user.name=Trails Test',
        '-c',
        'user.email=trails-test@example.invalid',
        'commit',
        '--quiet',
        '--message',
        'test: indexed baseline',
      ]);

      await writeFile(join(rootDir, stagedCanonical), 'staged canonical\n');
      await runGit(rootDir, ['add', '--', stagedCanonical]);
      const dirtyPath =
        dirtyCanonical === 'tracked' ? trackedCanonical : untrackedCanonical;
      await mkdir(join(rootDir, dirtyPath, '..'), { recursive: true });
      await writeFile(join(rootDir, dirtyPath), 'dirty canonical\n');

      const result = await runShell(rootDir, command ?? '', {
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        'Skillset canonical inputs have unstaged or untracked changes'
      );
      expect(await readFile(join(rootDir, managedOutput), 'utf8')).toBe(
        `baseline ${managedOutput}\n`
      );
      expect(await runGit(rootDir, ['diff', '--cached', '--name-only'])).toBe(
        `${stagedCanonical}\n`
      );
    }
  });

  test('stages created, modified, and deleted managed outputs without unrelated files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'trails-skillset-stage-'));
    await runGit(rootDir, ['init', '--quiet']);
    const modifiedPath = '.claude/skills/be-clark/SKILL.md';
    const deletedPath = '.agents/skills/skillset.lock';
    const createdPath = '.codex/agents/clark.toml';
    const canonicalGuide =
      '.skillset/skills/be-clark/references/warden-guide.md';
    const pluginGuide = 'plugin/skills/trails/references/warden-guide.md';
    const unrelatedPath = 'unrelated.txt';
    const baselineFiles = [
      '.claude/agents/baseline.md',
      '.claude/skills/be-clark/SKILL.md',
      '.agents/skills/skillset.lock',
      canonicalGuide,
      pluginGuide,
      'skillset.lock',
      unrelatedPath,
    ];
    for (const path of baselineFiles) {
      await mkdir(join(rootDir, path, '..'), { recursive: true });
      await writeFile(join(rootDir, path), `baseline ${path}\n`);
    }
    await runGit(rootDir, ['add', '--', ...baselineFiles]);
    await runGit(rootDir, [
      '-c',
      'user.name=Trails Test',
      '-c',
      'user.email=trails-test@example.invalid',
      'commit',
      '--quiet',
      '--message',
      'test: indexed baseline',
    ]);

    await writeFile(join(rootDir, modifiedPath), 'modified managed file\n');
    await rm(join(rootDir, deletedPath));
    await mkdir(join(rootDir, createdPath, '..'), { recursive: true });
    await writeFile(join(rootDir, createdPath), 'new managed file\n');
    await writeFile(
      join(rootDir, canonicalGuide),
      'modified canonical guide\n'
    );
    await writeFile(join(rootDir, pluginGuide), 'modified plugin guide\n');
    await writeFile(join(rootDir, unrelatedPath), 'modified unrelated file\n');

    await runGit(rootDir, ['add', '--', ...MANAGED_SKILLSET_PATHS]);
    const stagedFiles = await runGit(rootDir, [
      'diff',
      '--cached',
      '--name-status',
    ]);

    expect(stagedFiles.trim().split('\n').toSorted()).toEqual(
      [
        `A\t${createdPath}`,
        `D\t${deletedPath}`,
        `M\t${canonicalGuide}`,
        `M\t${modifiedPath}`,
        `M\t${pluginGuide}`,
      ].toSorted()
    );
    expect(await runGit(rootDir, ['status', '--short'])).toContain(
      ` M ${unrelatedPath}`
    );
  });

  test('runs mutating Markdownlint before Skillset builds projections and locks', async () => {
    const lefthook = await readRepoFile('lefthook.yml');
    const markdownlint = lefthook.slice(
      lefthook.indexOf('    markdownlint:'),
      lefthook.indexOf('\n\n# Pre-push')
    );
    const teamSkills = lefthook.slice(
      lefthook.indexOf('    team_skills:'),
      lefthook.indexOf('    markdownlint:')
    );
    expect(readPriority(markdownlint)).toBeLessThan(readPriority(teamSkills));
    expect(markdownlint).toContain("glob: '{*.md,**/*.md}'");
    expect(markdownlint).toContain('run: bun run mdlint:fix {staged_files}');
    expect(teamSkills).toContain('bun run skillset:sync && git add --');
  });

  test('runs check, ownership, and parity in every normal gate', async () => {
    const packageJson = JSON.parse(
      await readRepoFile('package.json')
    ) as Record<string, Record<string, string>>;
    const prePush = await readRepoFile('scripts/pre-push-checks.ts');
    const workflow = await readRepoFile('.github/workflows/ci.yml');
    const governance = workflow.slice(
      workflow.indexOf('  governance:'),
      workflow.indexOf('  changeset:')
    );

    for (const gate of [
      packageJson.scripts?.check ?? '',
      prePush,
      governance,
    ]) {
      const check = gate.indexOf('skillset:check');
      const ownership = gate.indexOf('skillset:ownership');
      const parity = gate.indexOf('skillset:parity');

      expect(check).toBeGreaterThan(-1);
      expect(ownership).toBeGreaterThan(check);
      expect(parity).toBeGreaterThan(ownership);
    }
  });
});
