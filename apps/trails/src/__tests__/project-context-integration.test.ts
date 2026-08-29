import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { Result } from '@ontrails/core';

import { compileTrail } from '../trails/compile.js';
import { validateTrail } from '../trails/validate.js';

const repoTempDir = (): string =>
  join(
    resolve(import.meta.dir, '../..'),
    '.tmp-tests',
    `project-context-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const appSource = (appId: string, trailId = `${appId}.read`): string => `
import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const read = trail('${trailId}', {
  implementation: () => Result.ok({ app: '${appId}' }),
  input: z.object({}),
  output: z.object({ app: z.literal('${appId}') }),
});

export default topo('${appId}', { read });
`;

const writeApp = (root: string, appId: string, trailId?: string): void => {
  const appRoot = join(root, 'apps', appId);
  mkdirSync(join(appRoot, 'src'), { recursive: true });
  writeFileSync(join(appRoot, 'src', 'app.ts'), appSource(appId, trailId));
};

const writeWorkspace = (root: string): void => {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'trails.config.ts'),
    `export default {
  workspace: {
    apps: {
      alpha: { root: 'apps/alpha' },
      beta: { root: 'apps/beta' },
    },
  },
};
`
  );
  writeApp(root, 'alpha');
  writeApp(root, 'beta');
  const initialized = Bun.spawnSync({
    cmd: ['git', 'init', '--quiet', root],
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (!initialized.success) {
    throw new Error(Buffer.from(initialized.stderr).toString('utf8'));
  }
};

let originalStateHome: string | undefined;
let root: string;
let stateHome: string;

beforeEach(() => {
  originalStateHome = process.env.TRAILS_STATE_HOME;
  root = repoTempDir();
  stateHome = repoTempDir();
  process.env.TRAILS_STATE_HOME = stateHome;
  writeWorkspace(root);
});

afterEach(() => {
  if (originalStateHome === undefined) {
    delete process.env.TRAILS_STATE_HOME;
  } else {
    process.env.TRAILS_STATE_HOME = originalStateHome;
  }
  rmSync(root, { force: true, recursive: true });
  rmSync(stateHome, { force: true, recursive: true });
});

describe('compile and validate project context', () => {
  test('bare compile and validate discover one nested standalone app module', async () => {
    rmSync(join(root, 'trails.config.ts'));
    rmSync(join(root, 'apps'), { force: true, recursive: true });
    writeApp(root, 'solo');

    const compiled = expectOk(
      await compileTrail.implementation({}, { cwd: root } as never)
    );
    const validated = expectOk(
      await validateTrail.implementation({}, { cwd: root } as never)
    );

    expect(compiled.project).toMatchObject({
      modulePath: 'apps/solo/src/app.ts',
      moduleSource: 'convention',
      selectedExtent: 'standalone-app',
    });
    expect(validated.project).toMatchObject({
      modulePath: 'apps/solo/src/app.ts',
      moduleSource: 'convention',
      selectedExtent: 'standalone-app',
    });
    expect(existsSync(join(root, 'trails.lock'))).toBe(true);
  });

  test('bare compile and validate keep a conventional nested app ahead of an ancestor config', async () => {
    writeFileSync(
      join(root, 'trails.config.ts'),
      'export default { warden: { format: "human" } };\n'
    );
    rmSync(join(root, 'apps'), { force: true, recursive: true });
    writeApp(root, 'standalone');
    const appRoot = join(root, 'apps', 'standalone');

    const compiled = expectOk(
      await compileTrail.implementation({}, { cwd: appRoot } as never)
    );
    const validated = expectOk(
      await validateTrail.implementation({}, { cwd: appRoot } as never)
    );

    expect(compiled.project).toMatchObject({
      appRoot: '.',
      modulePath: 'src/app.ts',
      moduleSource: 'convention',
      projectRoot: appRoot,
      selectedExtent: 'standalone-app',
    });
    expect(validated.project).toMatchObject({
      appRoot: '.',
      modulePath: 'src/app.ts',
      moduleSource: 'convention',
      projectRoot: appRoot,
      selectedExtent: 'standalone-app',
    });
    expect(existsSync(join(root, 'trails.lock'))).toBe(false);
    expect(existsSync(join(appRoot, 'trails.lock'))).toBe(true);
  });

  test.each(['src', 'src/trails'])(
    'bare compile and validate keep one standalone root from nested %s CWD',
    async (cwd) => {
      rmSync(join(root, 'trails.config.ts'));
      rmSync(join(root, 'apps'), { force: true, recursive: true });
      mkdirSync(join(root, 'src', 'trails'), { recursive: true });
      writeFileSync(join(root, 'src', 'app.ts'), appSource('solo'));

      const compiled = expectOk(
        await compileTrail.implementation({}, {
          cwd: join(root, cwd),
        } as never)
      );
      const validated = expectOk(
        await validateTrail.implementation({}, {
          cwd: join(root, cwd),
        } as never)
      );

      expect(compiled.project).toMatchObject({
        modulePath: 'src/app.ts',
        projectRoot: root,
        selectedExtent: 'standalone-app',
      });
      expect(validated.project).toMatchObject({
        modulePath: 'src/app.ts',
        projectRoot: root,
        selectedExtent: 'standalone-app',
      });
      expect(existsSync(join(root, 'trails.lock'))).toBe(true);
      expect(existsSync(join(root, 'src', 'trails.lock'))).toBe(false);
    }
  );

  test('bare compile and validate keep a custom module app-local ahead of an ancestor config', async () => {
    writeFileSync(
      join(root, 'trails.config.ts'),
      'export default { warden: { format: "human" } };\n'
    );
    rmSync(join(root, 'apps'), { force: true, recursive: true });
    const appRoot = join(root, 'apps', 'custom');
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(join(appRoot, 'topo.ts'), appSource('custom'));

    const input = { module: './topo.ts' } as const;
    const compiled = expectOk(
      await compileTrail.implementation(input, { cwd: appRoot } as never)
    );
    const validated = expectOk(
      await validateTrail.implementation(input, { cwd: appRoot } as never)
    );

    expect(compiled.project).toMatchObject({
      appRoot: '.',
      modulePath: './topo.ts',
      moduleSource: 'module',
      projectRoot: appRoot,
      selectedExtent: 'standalone-app',
    });
    expect(validated.project).toMatchObject({
      appRoot: '.',
      modulePath: './topo.ts',
      moduleSource: 'module',
      projectRoot: appRoot,
      selectedExtent: 'standalone-app',
    });
    expect(existsSync(join(root, 'trails.lock'))).toBe(false);
    expect(existsSync(join(appRoot, 'trails.lock'))).toBe(true);
  });

  test('workspace-root compile requires one app and never fans out', async () => {
    const result = await compileTrail.implementation({}, {
      cwd: root,
    } as never);

    expect(result.isErr()).toBe(true);
    expect(result.error?.context).toMatchObject({
      configuredAppIds: ['alpha', 'beta'],
      reason: 'compile-needs-app',
    });
    expect(existsSync(join(root, 'trails.lock'))).toBe(false);
    expect(existsSync(join(root, 'apps', 'alpha', 'trails.lock'))).toBe(false);
    expect(existsSync(join(root, 'apps', 'beta', 'trails.lock'))).toBe(false);
  });

  test('explicit app compile writes only its app lock with project provenance', async () => {
    const compiled = expectOk(
      await compileTrail.implementation({ app: 'alpha' }, {
        cwd: root,
      } as never)
    );

    expect(compiled.project).toMatchObject({
      appId: 'alpha',
      appRoot: 'apps/alpha',
      completeness: 'complete',
      configuredAppIds: ['alpha', 'beta'],
      modulePath: 'src/app.ts',
      moduleSource: 'convention',
      projectRoot: root,
      selectedExtent: 'configured-app',
      selectionProvenance: 'app',
    });
    expect(existsSync(join(root, 'apps', 'alpha', 'trails.lock'))).toBe(true);
    expect(existsSync(join(root, 'apps', 'beta', 'trails.lock'))).toBe(false);
    expect(existsSync(join(root, 'trails.lock'))).toBe(false);
    expect(compileTrail.output.safeParse(compiled).success).toBe(true);
  });

  test('app-root CWD selects that app without --app', async () => {
    const compiled = expectOk(
      await compileTrail.implementation({}, {
        cwd: join(root, 'apps', 'beta'),
      } as never)
    );

    expect(compiled.project).toMatchObject({
      appId: 'beta',
      selectedExtent: 'configured-app',
      selectionProvenance: 'cwd',
    });
    expect(existsSync(join(root, 'apps', 'beta', 'trails.lock'))).toBe(true);
  });

  test('an explicit workspace boundary preserves nested-CWD compile and validate selection', async () => {
    const cwd = join(root, 'apps', 'alpha');
    const compiled = expectOk(
      await compileTrail.implementation({ rootDir: root }, { cwd } as never)
    );
    const validated = expectOk(
      await validateTrail.implementation({ rootDir: root }, { cwd } as never)
    );

    expect(compiled.project).toMatchObject({
      appId: 'alpha',
      selectedExtent: 'configured-app',
      selectionProvenance: 'cwd',
    });
    expect(validated).toMatchObject({
      project: {
        appId: 'alpha',
        selectedExtent: 'configured-app',
        selectionProvenance: 'cwd',
      },
      selectedExtent: 'configured-app',
      stale: false,
    });
    expect(existsSync(join(root, 'apps', 'alpha', 'trails.lock'))).toBe(true);
    expect(existsSync(join(root, 'trails.lock'))).toBe(false);
  });

  test('explicit-root aliasing preserves one-app compile and validate selection', async () => {
    const alias = `${root}-alias`;
    symlinkSync(root, alias, 'dir');

    try {
      const cwd = join(root, 'apps', 'alpha');
      const compiled = expectOk(
        await compileTrail.implementation({ rootDir: alias }, { cwd } as never)
      );
      const validated = expectOk(
        await validateTrail.implementation({ rootDir: alias }, { cwd } as never)
      );

      expect(compiled.project).toMatchObject({
        appId: 'alpha',
        selectedExtent: 'configured-app',
        selectionProvenance: 'cwd',
      });
      expect(validated).toMatchObject({
        project: {
          appId: 'alpha',
          selectedExtent: 'configured-app',
          selectionProvenance: 'cwd',
        },
        selectedExtent: 'configured-app',
      });
      expect(existsSync(join(root, 'apps', 'alpha', 'trails.lock'))).toBe(true);
      expect(existsSync(join(root, 'apps', 'beta', 'trails.lock'))).toBe(false);
      expect(existsSync(join(root, 'trails.lock'))).toBe(false);
    } finally {
      rmSync(alias, { force: true });
    }
  });

  test('selected app validate ignores an unrelated missing lock', async () => {
    expectOk(
      await compileTrail.implementation({ app: 'alpha' }, {
        cwd: root,
      } as never)
    );

    const validated = expectOk(
      await validateTrail.implementation({ app: 'alpha' }, {
        cwd: root,
      } as never)
    );

    expect(validated.project).toMatchObject({
      appId: 'alpha',
      completeness: 'complete',
      selectedExtent: 'configured-app',
    });
    expect(validateTrail.output.safeParse(validated).success).toBe(true);
    expect(
      validateTrail.output.safeParse({
        ...validated,
        selectedExtent: 'standalone-app',
      }).success
    ).toBe(false);
  });

  test('selected app validate rejects a lock scoped to another app', async () => {
    expectOk(
      await compileTrail.implementation({ app: 'alpha' }, {
        cwd: root,
      } as never)
    );
    const lockPath = join(root, 'apps', 'alpha', 'trails.lock');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      scope: { app: string };
    };
    lock.scope.app = 'beta';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const result = await validateTrail.implementation({ app: 'alpha' }, {
      cwd: root,
    } as never);

    expect(result.isErr()).toBe(true);
    expect(result.error?.context).toMatchObject({
      actualAppId: 'beta',
      expectedAppId: 'alpha',
      reason: 'invalid-binding',
    });
  });

  test('selected app validate rejects invalid matched lock evidence', async () => {
    expectOk(
      await compileTrail.implementation({ app: 'alpha' }, {
        cwd: root,
      } as never)
    );
    const lockPath = join(root, 'apps', 'alpha', 'trails.lock');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      summary: { trails: number };
    };
    lock.summary.trails += 1;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const result = await validateTrail.implementation({ app: 'alpha' }, {
      cwd: root,
    } as never);

    expect(result.isErr()).toBe(true);
    expect(result.error?.context).toMatchObject({
      expectedAppId: 'alpha',
      reason: 'invalid-binding',
      status: 'invalid',
    });
  });

  test('workspace validate fails closed while one configured lock is missing', async () => {
    expectOk(
      await compileTrail.implementation({ app: 'alpha' }, {
        cwd: root,
      } as never)
    );

    const result = await validateTrail.implementation({}, {
      cwd: root,
    } as never);

    expect(result.isErr()).toBe(true);
    expect(result.error?.context).toMatchObject({
      appId: 'beta',
      configuredAppIds: ['alpha', 'beta'],
      reason: 'workspace-incomplete',
    });
  });

  test('workspace validate proves every app live and returns a complete view', async () => {
    expectOk(
      await compileTrail.implementation({ app: 'alpha' }, {
        cwd: root,
      } as never)
    );
    expectOk(
      await compileTrail.implementation({ app: 'beta' }, { cwd: root } as never)
    );

    const validated = expectOk(
      await validateTrail.implementation({}, { cwd: root } as never)
    );

    expect(validated).toMatchObject({
      project: {
        completeness: 'complete',
        configuredAppIds: ['alpha', 'beta'],
        selectedExtent: 'workspace',
        selectionProvenance: 'cwd',
      },
      stale: false,
    });
    expect(validated.apps.map((app) => app.appId)).toEqual(['alpha', 'beta']);
    expect(validated.workspaceViewHash).toHaveLength(64);
    expect(validateTrail.output.safeParse(validated).success).toBe(true);
  });

  test.each([
    ['workspace', {}],
    ['selected app', { app: 'alpha' }],
  ])(
    'validate rejects a forbidden root aggregate for %s',
    async (_label, input) => {
      expectOk(
        await compileTrail.implementation({ app: 'alpha' }, {
          cwd: root,
        } as never)
      );
      expectOk(
        await compileTrail.implementation({ app: 'beta' }, {
          cwd: root,
        } as never)
      );
      writeFileSync(
        join(root, 'trails.lock'),
        readFileSync(join(root, 'apps', 'alpha', 'trails.lock'), 'utf8')
      );

      const result = await validateTrail.implementation(input, {
        cwd: root,
      } as never);

      expect(result.isErr()).toBe(true);
      expect(result.error?.context).toMatchObject({
        reason:
          input.app === undefined ? 'workspace-incomplete' : 'invalid-binding',
        unownedLocks: [
          expect.objectContaining({ kind: 'forbidden-workspace-aggregate' }),
        ],
      });
    }
  );

  test('workspace validate names the stale app after a live graph edit', async () => {
    expectOk(
      await compileTrail.implementation({ app: 'alpha' }, {
        cwd: root,
      } as never)
    );
    expectOk(
      await compileTrail.implementation({ app: 'beta' }, { cwd: root } as never)
    );
    writeApp(root, 'beta', 'beta.changed');

    const result = await validateTrail.implementation({}, {
      cwd: root,
    } as never);

    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toContain('Workspace app "beta"');
    expect(result.error?.context).toMatchObject({
      appId: 'beta',
      reason: 'workspace-incomplete',
    });
  });

  test('module refinement cannot load a topo with another configured identity', async () => {
    writeFileSync(
      join(root, 'apps', 'alpha', 'src', 'other.ts'),
      appSource('beta', 'beta.other')
    );

    const result = await compileTrail.implementation(
      { app: 'alpha', module: 'src/other.ts' },
      { cwd: root } as never
    );

    expect(result.isErr()).toBe(true);
    expect(result.error?.context).toMatchObject({
      actualAppId: 'beta',
      expectedAppId: 'alpha',
      reason: 'invalid-binding',
    });
    expect(existsSync(join(root, 'apps', 'alpha', 'trails.lock'))).toBe(false);
  });

  test('workspace output records saved app graph ownership without root aggregate state', async () => {
    expectOk(
      await compileTrail.implementation({ app: 'alpha' }, {
        cwd: root,
      } as never)
    );
    expectOk(
      await compileTrail.implementation({ app: 'beta' }, { cwd: root } as never)
    );
    const validated = expectOk(
      await validateTrail.implementation({}, { cwd: root } as never)
    );

    const alphaLock = JSON.parse(
      readFileSync(join(root, 'apps', 'alpha', 'trails.lock'), 'utf8')
    ) as { readonly scope: { readonly app: string } };
    const betaLock = JSON.parse(
      readFileSync(join(root, 'apps', 'beta', 'trails.lock'), 'utf8')
    ) as { readonly scope: { readonly app: string } };
    expect(alphaLock.scope.app).toBe('alpha');
    expect(betaLock.scope.app).toBe('beta');
    expect(validated.project.apps.map((app) => app.appId)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(existsSync(join(root, 'trails.lock'))).toBe(false);
  });
});
