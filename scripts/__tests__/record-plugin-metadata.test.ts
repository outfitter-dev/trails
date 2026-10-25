import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { recordPluginMetadata } from '../record-plugin-metadata.js';

const REASON = 'Framework target metadata only; plugin behavior is unchanged.';
const SKILL_SCOPE = 'plugin.trails.skill:trails';
const PLUGIN_SCOPE = 'plugin:trails';
const repoRoot = join(import.meta.dir, '../..');
const recorderPath = join(repoRoot, 'scripts/record-plugin-metadata.ts');
const cliEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
);

const runCommand = async (
  cwd: string,
  args: readonly string[],
  binDir = join(repoRoot, 'node_modules/.bin')
) => {
  const child = Bun.spawn([...args], {
    cwd,
    env: {
      ...cliEnv,
      PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
};

const spawnRecorder = (
  cwd: string,
  binDir = join(repoRoot, 'node_modules/.bin')
) => runCommand(cwd, [process.execPath, recorderPath], binDir);

const changeFiles = async (root: string) => {
  const directory = join(root, '.skillset/changes');
  const files: Record<string, string> = {};
  for await (const path of new Bun.Glob('**/*').scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    files[path] = await readFile(join(directory, path), 'utf8');
  }
  return files;
};

const withWorkspace = async (exercise: (root: string) => Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), 'trails-metadata-evidence-'));
  try {
    const clone = await runCommand(root, [
      'git',
      'clone',
      '--quiet',
      '--shared',
      repoRoot,
      root,
    ]);
    expect(clone, clone.stderr).toMatchObject({ exitCode: 0 });
    const baseline = await runCommand(root, [
      'git',
      'update-ref',
      'refs/heads/main',
      'HEAD',
    ]);
    expect(baseline, baseline.stderr).toMatchObject({ exitCode: 0 });
    await rm(join(root, '.skillset/changes'), { force: true, recursive: true });
    await exercise(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const entry = (id: string, scope: string) => ({
  bump: 'none',
  id,
  ignored: false,
  reason: REASON,
  scopes: [scope],
  status: 'pending',
});

const recorder = (entries: unknown[]) => {
  const calls: string[][] = [];
  return {
    calls,
    run: (args: readonly string[]): Promise<string> => {
      calls.push([...args]);
      return Promise.resolve(JSON.stringify({ data: { entries }, ok: true }));
    },
  };
};

const refresh = (id: string) => [
  'change',
  'refresh',
  `@${id}`,
  '--yes',
  '--root',
  '.',
];

const add = (scope: string) => [
  'change',
  'add',
  '--scope',
  scope,
  '--bump',
  'none',
  '--reason',
  REASON,
  '--root',
  '.',
];

describe('plugin metadata evidence', () => {
  test('adds metadata records when neither scope has pending metadata evidence', async () => {
    const { calls, run } = recorder([]);
    await recordPluginMetadata(run);
    expect(calls).toEqual([
      ['change', 'list', '--root', '.', '--json'],
      add(SKILL_SCOPE),
      add(PLUGIN_SCOPE),
    ]);
  });

  test('refreshes all prior metadata records instead of adding duplicates', async () => {
    const { calls, run } = recorder([
      entry('old-skill', SKILL_SCOPE),
      entry('new-skill', SKILL_SCOPE),
      entry('old-plugin', PLUGIN_SCOPE),
      entry('new-plugin', PLUGIN_SCOPE),
    ]);
    await recordPluginMetadata(run);
    expect(calls.slice(1)).toEqual([
      refresh('old-skill'),
      refresh('new-skill'),
      refresh('old-plugin'),
      refresh('new-plugin'),
    ]);
  });

  test('adds only the missing scope', async () => {
    const { calls, run } = recorder([entry('skill', SKILL_SCOPE)]);
    await recordPluginMetadata(run);
    expect(calls.slice(1)).toEqual([refresh('skill'), add(PLUGIN_SCOPE)]);
  });

  test('does not refresh unrelated, behavioral, ignored, applied, or multi-scope changes', async () => {
    const { calls, run } = recorder([
      entry('other', 'agent:maintainer'),
      { ...entry('behavior', SKILL_SCOPE), reason: 'Plugin behavior changed.' },
      { ...entry('patch', SKILL_SCOPE), bump: 'patch' },
      { ...entry('ignored', SKILL_SCOPE), ignored: true },
      { ...entry('applied', PLUGIN_SCOPE), status: 'history' },
      { ...entry('multi', SKILL_SCOPE), scopes: [SKILL_SCOPE, PLUGIN_SCOPE] },
    ]);
    await recordPluginMetadata(run);
    expect(calls.slice(1)).toEqual([add(SKILL_SCOPE), add(PLUGIN_SCOPE)]);
  });

  test('accepts supported CLI bump/status domains while preserving excluded records', async () => {
    const entries = [];
    for (const bump of ['major', 'minor', 'none', 'patch']) {
      for (const status of ['pending', 'history']) {
        for (const ignored of [false, true]) {
          entries.push({
            ...entry(`${bump}-${status}-${ignored}`, PLUGIN_SCOPE),
            bump,
            ignored,
            status,
          });
        }
      }
    }
    entries.push(entry('skill', SKILL_SCOPE));
    const { calls, run } = recorder(entries);
    await recordPluginMetadata(run);
    expect(calls).toEqual([
      ['change', 'list', '--root', '.', '--json'],
      refresh('skill'),
      refresh('none-pending-false'),
    ]);
  });

  test('preserves entries with omitted bumps emitted by pending/history views', async () => {
    const withoutBump = { ...entry('pending', PLUGIN_SCOPE), bump: undefined };
    const { calls, run } = recorder([
      withoutBump,
      { ...withoutBump, id: 'history', status: 'history' },
      { ...withoutBump, id: 'ignored', ignored: true },
      entry('skill', SKILL_SCOPE),
    ]);
    await recordPluginMetadata(run);
    expect(calls).toEqual([
      ['change', 'list', '--root', '.', '--json'],
      refresh('skill'),
      add(PLUGIN_SCOPE),
    ]);
  });

  for (const invalid of [{ bump: 'not-a-bump' }, { status: 'not-a-status' }]) {
    test(`fails closed on unsupported ${Object.keys(invalid)[0]} before any mutation`, async () => {
      const { calls, run } = recorder([
        entry('valid', SKILL_SCOPE),
        { ...entry('invalid', PLUGIN_SCOPE), ...invalid },
      ]);
      await expect(recordPluginMetadata(run)).rejects.toThrow();
      expect(calls).toEqual([['change', 'list', '--root', '.', '--json']]);
    });
  }

  test('fails closed on an invalid list response before mutating evidence', async () => {
    const calls: string[][] = [];
    await expect(
      recordPluginMetadata((args) => {
        calls.push([...args]);
        return Promise.resolve('{"ok":false}');
      })
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  test('stops on refresh failure before adding or refreshing another scope', async () => {
    const { calls, run } = recorder([entry('skill', SKILL_SCOPE)]);
    await expect(
      recordPluginMetadata((args) => {
        if (args[1] === 'refresh') {
          return Promise.reject(new Error('refresh failed'));
        }
        return run(args);
      })
    ).rejects.toThrow('refresh failed');
    expect(calls).toHaveLength(1);
  });

  for (const failure of [
    'json',
    'schema',
    'unknown-bump',
    'unknown-status',
    'list',
    'add',
    'refresh',
  ] as const) {
    test(`CLI entry point stops after ${failure} failure`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'trails-metadata-failure-'));
      try {
        const callsPath = join(root, 'calls.jsonl');
        const cliPath = join(root, 'skillset');
        const entries =
          failure === 'refresh' ? [entry('prior', SKILL_SCOPE)] : [];
        if (failure === 'unknown-bump' || failure === 'unknown-status') {
          entries.push(entry('valid', SKILL_SCOPE), {
            ...entry('invalid', PLUGIN_SCOPE),
            ...(failure === 'unknown-bump'
              ? { bump: 'not-a-bump' }
              : { status: 'not-a-status' }),
          });
        }
        const list =
          failure === 'json'
            ? 'not JSON'
            : JSON.stringify(
                failure === 'schema'
                  ? { data: {}, ok: true }
                  : { data: { entries }, ok: true }
              );
        await writeFile(
          cliPath,
          `#!/usr/bin/env bun
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');
if (args[1] === 'list') {
  if (${JSON.stringify(failure)} === 'list') process.exit(17);
  process.stdout.write(${JSON.stringify(list)});
} else if (${JSON.stringify(failure.startsWith('unknown-'))}) {
  process.exit(0);
} else {
  console.error('injected CLI mutation failure');
  process.exit(17);
}
`
        );
        await chmod(cliPath, 0o755);
        const result = await spawnRecorder(root, root);
        expect(result.exitCode).not.toBe(0);
        const callsSource = await readFile(callsPath, 'utf8');
        const calls = callsSource
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(calls).toEqual([
          ['change', 'list', '--root', '.', '--json'],
          ...(failure === 'add' ? [add(SKILL_SCOPE)] : []),
          ...(failure === 'refresh' ? [refresh('prior')] : []),
        ]);
        if (failure === 'list' || failure === 'add' || failure === 'refresh') {
          expect(result.stderr).toContain('failed (17)');
        }
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    });
  }

  test('real pinned CLI refreshes stale metadata append-only and is byte-idempotent', async () => {
    await withWorkspace(async (root) => {
      const seed = await spawnRecorder(root);
      expect(seed, seed.stderr).toMatchObject({ exitCode: 0 });
      const unrelated = await runCommand(root, [
        'skillset',
        'change',
        'add',
        '--scope',
        PLUGIN_SCOPE,
        '--bump',
        'patch',
        '--reason',
        'Behavioral change: preserve this evidence.',
        '--root',
        '.',
      ]);
      expect(unrelated, unrelated.stderr).toMatchObject({ exitCode: 0 });
      const skillPath = join(
        root,
        '.skillset/plugins/trails/skills/trails/SKILL.md'
      );
      const source = await readFile(skillPath, 'utf8');
      await writeFile(
        skillPath,
        source.replace(/ {2}trails: .+/, '  trails: 0.0.0-fixture')
      );
      const before = await changeFiles(root);
      const first = await spawnRecorder(
        root,
        join(repoRoot, 'node_modules/.bin')
      );
      expect(first, first.stderr).toMatchObject({ exitCode: 0 });
      const after = await changeFiles(root);
      expect(Object.keys(after).toSorted()).toEqual(
        Object.keys(before).toSorted()
      );
      for (const [path, content] of Object.entries(before)) {
        if (path !== 'ledger.jsonl') {
          expect(after[path]).toBe(content);
        }
      }
      const prefix = before['ledger.jsonl'] ?? '';
      const ledger = after['ledger.jsonl'] ?? '';
      expect(ledger.startsWith(prefix)).toBe(true);
      const events = ledger
        .slice(prefix.length)
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events.map((event) => event.type)).toEqual([
        'change.covered',
        'change.covered',
      ]);
      const metadataIds = Object.entries(before)
        .filter(
          ([path, content]) =>
            path.endsWith('.md') && content.startsWith(REASON)
        )
        .map(([path]) => path.slice(0, -3));
      expect(events.map((event) => event.payload.reasonId).toSorted()).toEqual(
        metadataIds.toSorted()
      );
      const second = await spawnRecorder(
        root,
        join(repoRoot, 'node_modules/.bin')
      );
      expect(second, second.stderr).toMatchObject({ exitCode: 0 });
      expect(await changeFiles(root)).toEqual(after);
    });
  }, 30_000);

  test('real pinned CLI adds missing metadata scopes without duplicate records on repeat', async () => {
    await withWorkspace(async (root) => {
      const first = await spawnRecorder(
        root,
        join(repoRoot, 'node_modules/.bin')
      );
      expect(first, first.stderr).toMatchObject({ exitCode: 0 });
      const after = await changeFiles(root);
      const records = Object.keys(after).filter((path) => path.endsWith('.md'));
      expect(records).toHaveLength(2);
      expect(records.map((path) => after[path]).toSorted()).toEqual(
        [
          `${REASON}\n\nBump: none\nScope: ${SKILL_SCOPE}\n`,
          `${REASON}\n\nBump: none\nScope: ${PLUGIN_SCOPE}\n`,
        ].toSorted()
      );
      const second = await spawnRecorder(
        root,
        join(repoRoot, 'node_modules/.bin')
      );
      expect(second, second.stderr).toMatchObject({ exitCode: 0 });
      expect(await changeFiles(root)).toEqual(after);
    });
  }, 30_000);
});
