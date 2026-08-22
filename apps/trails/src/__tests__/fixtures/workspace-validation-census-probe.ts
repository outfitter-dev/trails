import { mock } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { DeriveWorkspaceViewOptions } from '@ontrails/topography';

const topography = await import('@ontrails/topography');
const { deriveWorkspaceView } = topography;
const calls: {
  readonly currentAppGraphHashIds: readonly string[];
  readonly selectedAppIds: readonly string[] | null;
}[] = [];

mock.module('@ontrails/topography', () => ({
  ...topography,
  deriveWorkspaceView: async (options: DeriveWorkspaceViewOptions) => {
    calls.push({
      currentAppGraphHashIds: Object.keys(
        options.currentAppGraphHashes ?? {}
      ).toSorted(),
      selectedAppIds: options.selectedAppIds ?? null,
    });
    return deriveWorkspaceView(options);
  },
}));

const { compileTrail } = await import('../../trails/compile.js');
const { validateTrail } = await import('../../trails/validate.js');

const appSource = (appId: string): string => `
import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const read = trail('${appId}.read', {
  implementation: () => Result.ok({ app: '${appId}' }),
  input: z.object({}),
  output: z.object({ app: z.literal('${appId}') }),
});

export default topo('${appId}', { read });
`;

const APP_IDS = ['a', 'b', 'c'] as const;
const appCount = Number.parseInt(process.argv[2] ?? '', 10);
if (
  !Number.isSafeInteger(appCount) ||
  appCount < 1 ||
  appCount > APP_IDS.length
) {
  throw new Error(`Expected an app-count from 1 through ${APP_IDS.length}.`);
}

const appIds = APP_IDS.slice(0, appCount);
const tempParent = resolve(import.meta.dir, '../../..', '.tmp-tests');
mkdirSync(tempParent, { recursive: true });
const root = mkdtempSync(join(tempParent, 'workspace-census-'));
const stateHome = mkdtempSync(join(tmpdir(), 'trails-state-'));
const originalStateHome = process.env.TRAILS_STATE_HOME;

try {
  for (const appId of appIds) {
    const appRoot = join(root, 'apps', appId);
    mkdirSync(join(appRoot, 'src'), { recursive: true });
    writeFileSync(join(appRoot, 'src', 'app.ts'), appSource(appId));
  }
  const apps = appIds
    .map((appId) => `${appId}: { root: 'apps/${appId}' }`)
    .join(', ');
  writeFileSync(
    join(root, 'trails.config.ts'),
    `export default { workspace: { apps: { ${apps} } } };\n`
  );
  const initialized = Bun.spawnSync({
    cmd: ['git', 'init', '--quiet', root],
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (!initialized.success) {
    throw new Error(Buffer.from(initialized.stderr).toString('utf8'));
  }

  process.env.TRAILS_STATE_HOME = stateHome;
  for (const app of appIds) {
    const compiled = await compileTrail.implementation({ app }, { cwd: root });
    if (compiled.isErr()) {
      throw compiled.error;
    }
  }

  calls.length = 0;
  const validated = await validateTrail.implementation({}, { cwd: root });
  process.stdout.write(
    `${JSON.stringify({ calls, isOk: validated.isOk() })}\n`
  );
} finally {
  if (originalStateHome === undefined) {
    delete process.env.TRAILS_STATE_HOME;
  } else {
    process.env.TRAILS_STATE_HOME = originalStateHome;
  }
  rmSync(root, { force: true, recursive: true });
  rmSync(stateHome, { force: true, recursive: true });
}
