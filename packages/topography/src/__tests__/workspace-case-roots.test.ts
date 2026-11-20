import { topo } from '@ontrails/core';
import { readTrailsProjectIdentity } from '@ontrails/config';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveTopoGraph } from '../derive.js';
import { deriveTopoGraphHash } from '../hash.js';
import { writeTrailsLock } from '../io.js';
import { deriveConfiguredAppAliases } from '../workspace-configured-aliases.js';
import { deriveWorkspaceView } from '../workspace-view.js';

const probe = mkdtempSync(join(tmpdir(), 'trails-case-capability-'));
mkdirSync(join(probe, 'lowercase'));
const supportsCaseOnlyRoots = existsSync(join(probe, 'LOWERCASE'));
rmSync(probe, { force: true, recursive: true });

// These regressions require real case folding, not a mocked filesystem.
describe.skipIf(!supportsCaseOnlyRoots)(
  'case-only configured app roots',
  () => {
    let rootDir: string;
    beforeEach(async () => {
      rootDir = realpathSync(
        await mkdtemp(join(tmpdir(), 'trails-case-roots-'))
      );
      const graph = deriveTopoGraph(topo('demo', []));
      await writeTrailsLock(
        {
          scope: { app: 'demo' },
          summary: { entities: 0, resources: 0, signals: 0, trails: 0 },
          topoGraph: graph,
          topoGraphHash: deriveTopoGraphHash(graph),
          version: 5,
        },
        { dir: join(rootDir, 'apps/demo') }
      );
      await Bun.write(
        join(rootDir, 'apps/demo/src/app.ts'),
        'export default {};\n'
      );
      await Bun.write(
        join(rootDir, 'trails.config.json'),
        JSON.stringify({
          workspace: { apps: { demo: { root: 'Apps/demo' } } },
        })
      );
    });
    afterEach(async () => {
      await rm(rootDir, { force: true, recursive: true });
    });

    const project = () =>
      readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir });

    test('retains the physical mapping without inventing symlink entries', async () => {
      const aliases = deriveConfiguredAppAliases(await project());
      expect(aliases).toEqual([
        expect.objectContaining({
          aliasEntryPaths: new Set(),
          authoredRoot: 'Apps/demo',
          physicalAliasEntryPaths: new Set(),
          physicalRoot: 'apps/demo',
        }),
      ]);
    });

    test('keeps one owned lock and authored identity in the workspace view', async () => {
      const view = await deriveWorkspaceView({ identity: await project() });
      expect(view.evidence.unownedLocks).toEqual([]);
      expect(view.evidence.configuredCompleteness).toBe('complete');
      expect(view.content.apps).toEqual([
        expect.objectContaining({ id: 'demo', root: 'Apps/demo' }),
      ]);
      expect(view.workspaceViewHash).toMatch(/^[0-9a-f]{64}$/);
    });

    test.each([
      'apps/demo',
      'Apps/demo',
      'apps/demo/trails.lock',
      'Apps/demo/trails.lock',
    ])('preserves lock exclusion through %s', async (excluded) => {
      const view = await deriveWorkspaceView({
        identity: await project(),
        lockScope: { exclude: [excluded] },
      });
      expect(view.evidence.unownedLocks).toEqual([]);
      expect(view.content.apps).toEqual([]);
      expect(view.evidence.apps[0]?.status).toBe('unavailable');
      expect(view.workspaceViewHash).toBeNull();
    });

    test('does not cross a newly introduced nested Git boundary', async () => {
      const identity = await project();
      await mkdir(join(rootDir, 'apps/demo/.git'));
      const view = await deriveWorkspaceView({ identity });
      expect(view.content.apps).toEqual([]);
      expect(view.evidence.apps[0]?.status).toBe('unavailable');
      expect(view.workspaceViewHash).toBeNull();
    });
  }
);

test('does not turn an unsupported external alias hop into a physical-only mapping', async () => {
  const root = realpathSync(
    await mkdtemp(join(tmpdir(), 'trails-alias-guard-'))
  );
  const external = realpathSync(
    await mkdtemp(join(tmpdir(), 'trails-external-hop-'))
  );
  try {
    await mkdir(join(root, 'internal/demo'), { recursive: true });
    await mkdir(join(root, 'apps'));
    await symlink(join(root, 'internal/demo'), join(external, 'back'), 'dir');
    await symlink(join(external, 'back'), join(root, 'apps/demo'), 'dir');
    expect(
      deriveConfiguredAppAliases({
        apps: [
          {
            entry: 'src/app.ts',
            entryPath: join(root, 'apps/demo/src/app.ts'),
            entrySource: 'convention',
            id: 'demo',
            modulePath: 'apps/demo/src/app.ts',
            root: 'apps/demo',
            rootDir: join(root, 'apps/demo'),
          },
        ],
        configPath: join(root, 'trails.config.json'),
        rootDir: root,
        workspace: { apps: { demo: { root: 'apps/demo' } } },
      })
    ).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(external, { force: true, recursive: true });
  }
});
