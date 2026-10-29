import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../../../..');
const temporaryDirectories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'trails-bun-144-cli-'));
  temporaryDirectories.push(directory);
  return directory;
};

const subprocessEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        ![
          'BUN_OPTIONS',
          'FORCE_COLOR',
          'NODE_NO_WARNINGS',
          'NODE_OPTIONS',
          'NO_COLOR',
        ].includes(entry[0])
    )
  );

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Bun 1.4.4 CLI protocol qualification', () => {
  test('keeps a Node warning on stderr while Wayfinder emits plain JSON on stdout', () => {
    const fixture = temporaryDirectory();
    const warningPreload = join(fixture, 'warning-preload.ts');
    writeFileSync(
      warningPreload,
      `process.emitWarning('TRL-1433 warning sentinel', {
  code: 'TRL1433',
  type: 'Warning',
});\n`
    );

    const cli = Bun.spawnSync({
      cmd: [
        process.execPath,
        '--trace-warnings',
        '--preload',
        warningPreload,
        join(repoRoot, 'apps/trails/bin/trails.ts'),
        'wayfind',
        '--overview',
        '--root-dir',
        join(repoRoot, 'apps/trails'),
        '--json',
      ],
      cwd: repoRoot,
      env: subprocessEnvironment(),
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
    });
    const stdout = Buffer.from(cli.stdout).toString('utf8');
    const stderr = Buffer.from(cli.stderr).toString('utf8');

    expect(cli.exitCode).toBe(0);
    expect(stderr).toContain('TRL-1433 warning sentinel');
    expect(stdout).not.toContain('TRL-1433 warning sentinel');
    expect(stdout).not.toContain(String.fromCodePoint(27));

    const payload = JSON.parse(stdout) as {
      result: {
        counts: { trails: number };
        source: { kind: string; path: string };
      };
      source: string;
      view: string;
    };
    expect(payload).toMatchObject({
      result: {
        source: {
          kind: 'topoGraph',
          path: join(repoRoot, 'apps/trails/trails.lock'),
        },
      },
      source: 'locked',
      view: 'overview',
    });
    expect(payload.result.counts.trails).toBeGreaterThan(0);
  });
});
