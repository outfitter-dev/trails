import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { deriveTopoGraphHash } from '../hash.js';
import { readTrailsLock } from '../io.js';
import type { TopoGraphForceEntry } from '../types.js';

const repoRoot = resolve(import.meta.dir, '../../../..');
const cli = join(repoRoot, 'apps/trails/bin/trails.ts');
let root: string;

const run = (args: readonly string[], cwd = root): string => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, ...args],
    cwd,
    env: { ...process.env, TRAILS_STATE_HOME: join(root, 'state') },
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 15_000,
  });
  if (!result.success) {
    throw new Error(`${result.stdout.toString()}\n${result.stderr.toString()}`);
  }
  return result.stdout.toString();
};

const compileOrValidate = (
  command: 'compile' | 'validate',
  selection: readonly string[]
): unknown =>
  JSON.parse(
    run([
      cli,
      command,
      ...selection,
      '--permit',
      JSON.stringify({ id: 'artifact-targeting-test', scopes: ['topo:write'] }),
      '--json',
    ])
  ) as unknown;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'trails-artifact-targeting-'));
  await mkdir(join(root, 'node_modules/@ontrails'), { recursive: true });
  for (const name of ['core', 'config', 'topography']) {
    await symlink(
      join(repoRoot, 'packages', name),
      join(root, 'node_modules/@ontrails', name)
    );
  }
  await symlink(
    join(repoRoot, 'node_modules/zod'),
    join(root, 'node_modules/zod')
  );
  await Bun.write(join(root, 'package.json'), '{"type":"module"}\n');
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const force = (
  id: string,
  change: TopoGraphForceEntry['change']
): TopoGraphForceEntry => ({
  acceptedAt: '2026-10-01T00:00:00.000Z',
  change,
  detail: 'Verified recovery fixture audit',
  id,
  kind: 'trail',
  reason: 'Preserve this exact historical record',
  severity: 'breaking',
  source: 'trails compile --force',
});

const prepareApp = async (
  appRoot: string,
  entry = 'src/app.ts',
  appId = 'alpha'
): Promise<void> => {
  await mkdir(join(appRoot, 'src'), { recursive: true });
  await Bun.write(
    join(appRoot, entry),
    `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';
const read = trail('${appId}.read', {
  input: z.object({}), output: z.object({ ok: z.boolean() }),
  implementation: () => Result.ok({ ok: true }),
});
export default topo('${appId}', { read });\n`
  );
};

type RecoveryMode = 'standalone' | 'workspace' | 'custom-config';

const prepareRecoveryCase = async (mode: RecoveryMode) => {
  const configured = mode !== 'standalone';
  const appRoot = configured ? join(root, 'apps/alpha') : root;
  const entry = mode === 'custom-config' ? 'src/alternate.ts' : 'src/app.ts';
  await prepareApp(appRoot, entry);
  const configPath =
    mode === 'custom-config' ? 'custom.config.json' : 'trails.config.json';
  if (configured) {
    await Bun.write(
      join(root, configPath),
      JSON.stringify({
        workspace: {
          apps: {
            alpha: { entry, root: 'apps/alpha' },
            ...(mode === 'workspace' ? { beta: { root: 'apps/beta' } } : {}),
          },
        },
      })
    );
  }
  const selection =
    mode === 'workspace'
      ? ['--root-dir', root, '--app', 'alpha']
      : ['--root-dir', appRoot, '--module', entry];
  if (mode === 'workspace') {
    await prepareApp(join(root, 'apps/beta'), 'src/app.ts', 'beta');
    compileOrValidate('compile', ['--root-dir', root, '--app', 'beta']);
  }
  const siblingPath = join(root, 'apps/beta/trails.lock');
  const siblingBefore =
    mode === 'workspace'
      ? await Bun.file(siblingPath).text()
      : 'sibling must remain untouched\n';
  if (mode !== 'workspace') {
    await Bun.write(siblingPath, siblingBefore);
  }
  return {
    appRoot,
    configPath,
    configured,
    entry,
    selection,
    siblingBefore,
    siblingPath,
  };
};

describe('explicit app-lock targeting', () => {
  test.each(['standalone', 'workspace', 'custom-config'] as const)(
    'documented recovery targets the %s app and preserves audit',
    async (mode) => {
      const {
        configured,
        appRoot,
        entry,
        configPath,
        selection,
        siblingPath,
        siblingBefore,
      } = await prepareRecoveryCase(mode);
      // App-root bootstrap is not proof that CLI selected the custom declaration.
      expect(compileOrValidate('compile', selection)).toMatchObject({
        lockPath: join(appRoot, 'trails.lock'),
      });
      if (mode === 'workspace') {
        expect(
          compileOrValidate('validate', ['--root-dir', root])
        ).toMatchObject({
          project: { configuredAppIds: ['alpha', 'beta'] },
          selectedExtent: 'workspace',
        });
      }
      const recovered = await readTrailsLock({ dir: appRoot });
      if (!recovered) {
        throw new Error('Initial compile did not write the selected app');
      }
      const candidate = {
        ...recovered,
        topoGraph: {
          ...recovered.topoGraph,
          entries: recovered.topoGraph.entries.map((graphEntry) => ({
            ...graphEntry,
            forces: [force(graphEntry.id, 'modified')],
          })),
          forces: [force('removed.read', 'removed')],
        },
      };
      const candidatePath = join(root, 'verified-candidate.json');
      await Bun.write(candidatePath, JSON.stringify(candidate));
      const rootSentinel = 'workspace root must remain untouched\n';
      if (mode === 'custom-config') {
        await Bun.write(join(root, 'trails.lock'), rootSentinel);
      }
      await Bun.write(
        join(appRoot, 'trails.lock'),
        '<<<<<<< preserved conflict\n'
      );
      const guide = await Bun.file(join(repoRoot, 'docs/topo-store.md')).text();
      const recipe = guide
        .split('### Programmatic lock recovery')[1]
        ?.match(/```typescript\n([\s\S]*?)\n```/)?.[1];
      if (!recipe) {
        throw new Error('Documented recovery example is missing');
      }
      const script = join(root, 'recover-lock.ts');
      await Bun.write(script, recipe);
      run([
        script,
        root,
        candidatePath,
        ...(configured ? ['alpha'] : []),
        ...(mode === 'custom-config' ? [configPath] : []),
      ]);
      const saved = await readTrailsLock({ dir: appRoot });
      expect(saved).toEqual({
        ...candidate,
        topoGraphHash: deriveTopoGraphHash(candidate.topoGraph),
      });
      expect(
        await Bun.file(join(appRoot, '.trails/trails.lock')).exists()
      ).toBe(false);
      // Custom-config selection proves programmatic targeting only; CLI has no flag.
      if (mode !== 'custom-config') {
        for (const command of ['compile', 'validate'] as const) {
          expect(compileOrValidate(command, selection)).toMatchObject({
            lockPath:
              command === 'compile'
                ? join(appRoot, 'trails.lock')
                : 'trails.lock',
            project: {
              appId: 'alpha',
              artifactPath: join(appRoot, 'trails.lock'),
              modulePath: entry,
              selectedExtent:
                mode === 'workspace' ? 'configured-app' : 'standalone-app',
            },
          });
        }
        const afterCompile = await readTrailsLock({ dir: appRoot });
        expect(afterCompile?.topoGraph.forces).toEqual(
          candidate.topoGraph.forces
        );
        expect(afterCompile?.topoGraph.entries[0]?.forces).toEqual(
          candidate.topoGraph.entries[0]?.forces
        );
      }
      expect(await Bun.file(siblingPath).text()).toBe(siblingBefore);
      if (mode === 'custom-config') {
        expect(await Bun.file(join(root, 'trails.lock')).text()).toBe(
          rootSentinel
        );
      } else if (mode === 'workspace') {
        expect(await Bun.file(join(root, 'trails.lock')).exists()).toBe(false);
      }
    },
    30_000
  );

  test('omitted dir keeps the legacy default while explicit reads keep the root lock', async () => {
    await prepareApp(root);
    compileOrValidate('compile', ['--root-dir', root]);
    const rootLock = await Bun.file(join(root, 'trails.lock')).text();
    run([
      '-e',
      `
      import { readTrailsLock, writeTrailsLock, readTopoGraph,
        writeTopoGraph, readLockManifest, writeLockManifest,
        LOCK_MANIFEST_SCHEMA_VERSION } from '@ontrails/topography';
      import { deepStrictEqual } from 'node:assert';
      const lock = await readTrailsLock({ dir: '.' });
      await writeTrailsLock(lock);
      deepStrictEqual(await readTrailsLock(), lock);
      deepStrictEqual(await readTopoGraph(), lock.topoGraph);
      const legacy = { dir: 'legacy-split' };
      await writeTopoGraph(lock.topoGraph, legacy);
      await writeLockManifest({ version: LOCK_MANIFEST_SCHEMA_VERSION,
        scope: lock.scope, summary: lock.summary,
        artifacts: [{ path: 'topo.lock', role: 'topo', sha256: lock.topoGraphHash }]
      }, legacy);
      deepStrictEqual(await readTopoGraph(legacy), lock.topoGraph);
      deepStrictEqual((await readLockManifest(legacy)).scope, lock.scope);
    `,
    ]);
    expect(await Bun.file(join(root, '.trails/trails.lock')).exists()).toBe(
      true
    );
    expect(await Bun.file(join(root, 'trails.lock')).text()).toBe(rootLock);
  }, 30_000);
});
