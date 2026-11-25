import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { deriveTopoGraphHash, readTrailsLock } from '@ontrails/topography';

import { runWarden } from '../cli.js';
import type { WardenReport } from '../cli.js';
import { resolveWardenTopoTargets } from '../command.js';

const trailsBin = resolve(
  import.meta.dir,
  '../../../../apps/trails/bin/trails.ts'
);
const wardenBin = resolve(import.meta.dir, '../../bin/warden.ts');
const coreModule = import.meta.resolve('@ontrails/core');
const zodModule = import.meta.resolve('zod');

const appSource = (id: string, restricted = false, changed = false): string => `
import { Result, topo, trail } from ${JSON.stringify(coreModule)};
import { z } from ${JSON.stringify(zodModule)};
const hello = trail('${id}', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({${changed ? 'name: z.string()' : ''}}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
  permit: ${restricted ? "{ scopes: ['hello:read'] }" : "'public'"},
});
export const app = topo('audit', { hello });
`;

const run = (cwd: string, bin: string, args: readonly string[]) => {
  const child = Bun.spawnSync({
    cmd: [process.execPath, bin, ...args],
    cwd,
    env: { ...process.env, TRAILS_STATE_HOME: join(cwd, '.trails-state') },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {
    code: child.exitCode,
    stderr: child.stderr.toString(),
    stdout: child.stdout.toString(),
  };
};

const compile = (root: string, configured: boolean, force = false): void => {
  const result = run(root, trailsBin, [
    'compile',
    '--permit',
    JSON.stringify({
      actors: [],
      id: 'warden-force-audit-test',
      scopes: ['topo:write'],
    }),
    '--root-dir',
    root,
    ...(configured ? ['--app', 'audit'] : []),
    ...(force ? ['--force'] : []),
  ]);
  expect(result).toMatchObject({ code: 0 });
};

const warden = (root: string, configured: boolean) => {
  const appRoot = configured ? join(root, 'apps', 'audit') : root;
  const result = run(root, wardenBin, [
    '--root-dir',
    appRoot,
    '--depth',
    'all',
    '--lock',
    'cached',
    '--no-lock-mutation',
    '--format',
    'json',
  ]);
  return { ...result, report: JSON.parse(result.stdout) as WardenReport };
};

describe('compile force audit followed by Warden (TRL-1380)', () => {
  for (const configured of [false, true]) {
    test(`${configured ? 'configured app' : 'standalone'} retains both force audits without false drift`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'warden-force-audit-'));
      const appRoot = configured ? join(root, 'apps', 'audit') : root;
      const appPath = join(appRoot, 'src', 'app.ts');
      try {
        mkdirSync(join(appRoot, 'src'), { recursive: true });
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({ type: 'module' })
        );
        if (configured) {
          writeFileSync(
            join(root, 'trails.config.ts'),
            `export default {
  workspace: { apps: { audit: { root: 'apps/audit' } } },
};`
          );
        }
        writeFileSync(appPath, appSource('hello.old'));
        compile(root, configured);
        expect(warden(root, configured)).toMatchObject({
          code: 0,
          report: { drift: { stale: false } },
        });

        writeFileSync(appPath, appSource('hello.current'));
        compile(root, configured, true);
        const removed = await readTrailsLock({ dir: appRoot });
        expect(removed?.topoGraph.forces).toContainEqual(
          expect.objectContaining({ change: 'removed', id: 'hello.old' })
        );
        expect(warden(root, configured)).toMatchObject({
          code: 0,
          report: { drift: { stale: false } },
        });
        compile(root, configured);
        expect(await readTrailsLock({ dir: appRoot })).toEqual(removed);
        expect(warden(root, configured)).toMatchObject({
          code: 0,
          report: { drift: { stale: false } },
        });

        writeFileSync(appPath, appSource('hello.current', true));
        compile(root, configured, true);
        const modified = await readTrailsLock({ dir: appRoot });
        if (modified === null) {
          throw new Error('Expected a compiled trails.lock');
        }
        expect(
          modified?.topoGraph.entries.find(
            (entry) => entry.id === 'hello.current'
          )?.forces
        ).toContainEqual(
          expect.objectContaining({ change: 'modified', id: 'hello.current' })
        );
        compile(root, configured);
        expect(await readTrailsLock({ dir: appRoot })).toEqual(modified);
        const before = readFileSync(join(appRoot, 'trails.lock'), 'utf8');
        const fresh = warden(root, configured);
        expect(fresh).toMatchObject({
          code: 0,
          report: { drift: { stale: false } },
        });
        expect(fresh.report.drift?.committedHash).not.toBeNull();
        const resolved = await resolveWardenTopoTargets({
          rootDir: root,
          strict: true,
          ...(configured ? { apps: ['audit'] } : {}),
        });
        expect(resolved.diagnostics).toEqual([]);
        const governed = await runWarden({
          depth: 'all',
          failOn: 'warning',
          noLockMutation: true,
          rootDir: root,
          topos: resolved.topos.map((target) => ({
            ...target,
            graph: modified.topoGraph,
            requireCommittedLock: true,
            rootDir: appRoot,
          })),
        });
        expect(governed.diagnostics).toContainEqual(
          expect.objectContaining({ rule: 'pending-force', severity: 'warn' })
        );
        expect(governed).toMatchObject({
          drift: { stale: false },
          passed: false,
        });
        expect(readFileSync(join(appRoot, 'trails.lock'), 'utf8')).toBe(before);
        expect(modified.topoGraphHash).toBe(
          deriveTopoGraphHash(modified.topoGraph)
        );

        writeFileSync(appPath, appSource('hello.current', true, true));
        expect(warden(root, configured)).toMatchObject({
          code: 1,
          report: { drift: { stale: true } },
        });
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }, 30_000);
  }
});
