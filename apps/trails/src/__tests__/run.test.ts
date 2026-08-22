/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk/isErr */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AmbiguousError,
  NotFoundError,
  ValidationError,
  executeTrail,
} from '@ontrails/core';
import type { Result } from '@ontrails/core';

import { resolveRunTargetProject, runTrail } from '../trails/run.js';

interface AppSpec {
  readonly name: string;
  readonly trailIds: readonly string[];
}

const writeFixture = (filePath: string, contents: string): void => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
};

const writeWorkspace = (
  workspaceRoot: string,
  apps: readonly AppSpec[]
): void => {
  writeFixture(
    join(workspaceRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'run-trail-test-fixture',
        private: true,
        type: 'module',
        workspaces: ['apps/*'],
      },
      null,
      2
    )}\n`
  );
  writeFixture(
    join(workspaceRoot, 'trails.config.json'),
    `${JSON.stringify(
      {
        workspace: {
          apps: Object.fromEntries(
            apps.map((app) => [app.name, { root: `apps/${app.name}` }])
          ),
        },
      },
      null,
      2
    )}\n`
  );

  for (const spec of apps) {
    const appDir = join(workspaceRoot, 'apps', spec.name);
    writeFixture(
      join(appDir, 'package.json'),
      `${JSON.stringify(
        {
          name: spec.name,
          private: true,
          trails: { module: 'src/app.ts' },
          type: 'module',
        },
        null,
        2
      )}\n`
    );
    const trails = spec.trailIds
      .map(
        (id, index) =>
          `const trail${index} = trail(${JSON.stringify(id)}, { implementation: () => Result.ok(null), intent: 'read' });`
      )
      .join('\n');
    writeFixture(
      join(appDir, 'src/app.ts'),
      [
        `import { Result, topo, trail } from '@ontrails/core';`,
        trails,
        `export const app = topo(${JSON.stringify(spec.name)}, [${spec.trailIds.map((_, index) => `trail${index}`).join(', ')}]);`,
        '',
      ].join('\n')
    );
  }
};

const writeExecutableWorkspace = (workspaceRoot: string): void => {
  writeFixture(
    join(workspaceRoot, 'package.json'),
    `${JSON.stringify(
      {
        dependencies: {
          '@ontrails/core': 'workspace:^',
          zod: 'catalog:',
        },
        name: 'run-trail-executable-fixture',
        private: true,
        type: 'module',
        workspaces: ['apps/*'],
      },
      null,
      2
    )}\n`
  );

  const appDir = join(workspaceRoot, 'apps', 'app-a');
  writeFixture(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'app-a',
        private: true,
        trails: { module: 'src/app.ts' },
        type: 'module',
      },
      null,
      2
    )}\n`
  );
  writeFixture(
    join(appDir, 'src/app.ts'),
    [
      `import { Result, topo, trail } from '@ontrails/core';`,
      `import { z } from 'zod';`,
      ``,
      `const add = trail('entity.add', {`,
      `  implementation: (input) => Result.ok({ name: input.name }),`,
      `  input: z.object({ name: z.string() }),`,
      `  intent: 'write',`,
      `  output: z.object({ name: z.string() }),`,
      `  permit: { scopes: ['entity:write'] },`,
      `});`,
      ``,
      `const currentRoot = trail('context.cwd', {`,
      `  implementation: (_input, ctx) => Result.ok(ctx.cwd),`,
      `  input: z.undefined(),`,
      `  intent: 'read',`,
      `  output: z.string(),`,
      `});`,
      ``,
      `export const app = topo('app-a', [add, currentRoot]);`,
      ``,
    ].join('\n')
  );
};

const expectErr = <T, E extends Error>(result: Result<T, E>): E => {
  if (result.isOk()) {
    throw new Error('Expected Result.err but got Result.ok');
  }
  return result.error;
};

const trailsRunPermit = {
  id: 'test-permit',
  scopes: ['trails:run'],
} as const;

const executeRunTrail = async (
  input: unknown,
  scopes: readonly string[] = trailsRunPermit.scopes
): Promise<Result<unknown, Error>> =>
  await executeTrail(runTrail, input, {
    ctx: { permit: { id: trailsRunPermit.id, scopes } },
  });

const workspaceTmpRoot = join(import.meta.dir, '../..', '.tmp-tests');

let workspaceRoot: string;

beforeEach(() => {
  mkdirSync(workspaceTmpRoot, { recursive: true });
  workspaceRoot = join(
    workspaceTmpRoot,
    `run-trail-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { force: true, recursive: true });
});

describe('runTrail collision resolution', () => {
  test('returns AmbiguousError when trail id is exposed by multiple apps and no --app is given', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id', 'a.only'] },
      { name: 'app-b', trailIds: ['shared.id', 'b.only'] },
    ]);

    const result = await executeRunTrail({
      id: 'shared.id',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(AmbiguousError);
    expect(error.message).toBe(
      "Trail ID 'shared.id' exists in apps: app-a, app-b. Re-run with --app <id>."
    );
    if (error instanceof AmbiguousError) {
      expect(error.context).toEqual({
        candidates: ['app-a', 'app-b'],
        trailId: 'shared.id',
      });
    }
  });

  test('returns NotFoundError when trail id is not present in any workspace app', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['a.only'] },
      { name: 'app-b', trailIds: ['b.only'] },
    ]);

    const result = await executeRunTrail({
      id: 'never.here',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toContain("Trail 'never.here' was not found");
  });

  test('includes the requested --app when an override cannot find the trail id', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['a.only'] },
      { name: 'app-b', trailIds: ['b.only'] },
    ]);

    const result = await executeRunTrail({
      app: 'app-a',
      id: 'never.here',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toContain("Trail 'never.here' was not found");
    expect(error.message).toContain("for app 'app-a'");
    if (error instanceof NotFoundError) {
      expect(error.context).toEqual({
        requestedApp: 'app-a',
        rootDir: workspaceRoot,
        trailId: 'never.here',
      });
    }
  });

  test('isolates an explicit app miss from an unavailable unrelated app', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['a.only'] },
      { name: 'app-b', trailIds: ['b.only'] },
    ]);
    writeFixture(
      join(workspaceRoot, 'apps/app-b/src/app.ts'),
      `throw new Error('BETA_BOOT_SENTINEL');\n`
    );

    const result = await executeRunTrail({
      app: 'app-a',
      id: 'never.here',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).not.toContain('BETA_BOOT_SENTINEL');
    expect(error.message).toContain('Ownership coaching is incomplete');
    if (error instanceof NotFoundError) {
      expect(error.context).toEqual({
        requestedApp: 'app-a',
        rootDir: workspaceRoot,
        trailId: 'never.here',
        unavailableAppIds: ['app-b'],
      });
    }
  });

  test('does not make definitive wrong-owner claims from an incomplete scan', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['a.only'] },
      { name: 'app-b', trailIds: ['target.id'] },
      { name: 'app-c', trailIds: ['c.only'] },
    ]);
    writeFixture(
      join(workspaceRoot, 'apps/app-c/src/app.ts'),
      `throw new Error('CHARLIE_BOOT_SENTINEL');\n`
    );

    const result = await executeRunTrail({
      app: 'app-a',
      id: 'target.id',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toContain('Ownership coaching is incomplete');
    expect(error.message).not.toContain("owned by 'app-b'");
    if (error instanceof NotFoundError) {
      expect(error.context).toMatchObject({
        requestedApp: 'app-a',
        unavailableAppIds: ['app-c'],
      });
    }
  });

  test('keeps workspace ownership discovery fail-closed when an app is unavailable', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['a.only'] },
      { name: 'app-b', trailIds: ['b.only'] },
    ]);
    writeFixture(
      join(workspaceRoot, 'apps/app-b/src/app.ts'),
      `throw new Error('BETA_BOOT_SENTINEL');\n`
    );

    const result = await executeRunTrail({
      id: 'never.here',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('BETA_BOOT_SENTINEL');
  });

  test('rejects an --app override that does not own the requested trail id with AmbiguousError', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id'] },
      { name: 'app-b', trailIds: ['shared.id'] },
      { name: 'app-c', trailIds: ['c.only'] },
    ]);

    const result = await executeRunTrail({
      app: 'app-c',
      id: 'shared.id',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(AmbiguousError);
    if (error instanceof AmbiguousError) {
      expect(error.context).toEqual({
        candidates: ['app-a', 'app-b'],
        trailId: 'shared.id',
      });
    }
  });

  test('rejects an --app override that does not own a sole-owner trail id with NotFoundError naming the actual owner', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['unique.id'] },
      { name: 'app-b', trailIds: ['b.only'] },
    ]);

    const result = await executeRunTrail({
      app: 'app-b',
      id: 'unique.id',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toContain("'unique.id'");
    expect(error.message).toContain("'app-a'");
    expect(error.message).toContain("'app-b'");
    if (error instanceof NotFoundError) {
      expect(error.context).toEqual({
        actualOwner: 'app-a',
        requestedApp: 'app-b',
        trailId: 'unique.id',
      });
    }
  });

  test('coaches a same-app module override that omits a trail from the default entry', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['a.only'] },
      { name: 'app-b', trailIds: ['b.only'] },
    ]);
    writeFixture(
      join(workspaceRoot, 'apps/app-a/src/alternate.ts'),
      [
        `import { topo } from '@ontrails/core';`,
        `export const app = topo('app-a', []);`,
        '',
      ].join('\n')
    );

    const result = await executeRunTrail({
      app: 'app-a',
      id: 'a.only',
      module: 'src/alternate.ts',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toContain("module 'src/alternate.ts'");
    expect(error.message).toContain("app 'app-a'");
    expect(error.message).toContain('default entry does expose it');
    expect(error.message).not.toContain("owned by 'app-a', not 'app-a'");
    if (error instanceof NotFoundError) {
      expect(error.context).toEqual({
        modulePath: 'src/alternate.ts',
        requestedApp: 'app-a',
        trailId: 'a.only',
      });
    }
  });

  test('preserves same-app module coaching when an unrelated app is unavailable', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['a.only'] },
      { name: 'app-b', trailIds: ['b.only'] },
    ]);
    writeFixture(
      join(workspaceRoot, 'apps/app-a/src/alternate.ts'),
      [
        `import { topo } from '@ontrails/core';`,
        `export const app = topo('app-a', []);`,
        '',
      ].join('\n')
    );
    writeFixture(
      join(workspaceRoot, 'apps/app-b/src/app.ts'),
      `throw new Error('BETA_BOOT_SENTINEL');\n`
    );

    const result = await executeRunTrail({
      app: 'app-a',
      id: 'a.only',
      module: 'src/alternate.ts',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toContain('default entry does expose it');
    expect(error.message).not.toContain('BETA_BOOT_SENTINEL');
  });

  test('resolves a colliding trail id through an owning --app override', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id'] },
      { name: 'app-b', trailIds: ['shared.id'] },
    ]);

    const result = await resolveRunTargetProject(
      { app: 'app-b', rootDir: workspaceRoot },
      'shared.id',
      { cwd: workspaceRoot }
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        modulePath: 'src/app.ts',
        rootDir: join(workspaceRoot, 'apps', 'app-b'),
      });
    }
  });

  test('preserves the configured app root for target resolution from nested CWD', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['a.only'] },
      { name: 'app-b', trailIds: ['b.only'] },
    ]);
    const initialized = Bun.spawnSync({
      cmd: ['git', 'init', '--quiet', workspaceRoot],
      stderr: 'pipe',
      stdout: 'pipe',
    });
    if (!initialized.success) {
      throw new Error(Buffer.from(initialized.stderr).toString('utf8'));
    }

    const result = await resolveRunTargetProject({}, 'b.only', {
      cwd: join(workspaceRoot, 'apps', 'app-b', 'src'),
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        modulePath: 'src/app.ts',
        rootDir: join(workspaceRoot, 'apps', 'app-b'),
      });
    }
  });

  test('isolates a nested-CWD app miss from an unavailable sibling app', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['a.only'] },
      { name: 'app-b', trailIds: ['b.only'] },
    ]);
    writeFixture(
      join(workspaceRoot, 'apps/app-b/src/app.ts'),
      `throw new Error('BETA_BOOT_SENTINEL');\n`
    );
    const initialized = Bun.spawnSync({
      cmd: ['git', 'init', '--quiet', workspaceRoot],
      stderr: 'pipe',
      stdout: 'pipe',
    });
    if (!initialized.success) {
      throw new Error(Buffer.from(initialized.stderr).toString('utf8'));
    }

    const result = await resolveRunTargetProject({}, 'never.here', {
      cwd: join(workspaceRoot, 'apps', 'app-a', 'src'),
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).not.toContain('BETA_BOOT_SENTINEL');
    if (error instanceof NotFoundError) {
      expect(error.context).toMatchObject({
        requestedApp: 'app-a',
        unavailableAppIds: ['app-b'],
      });
    }
  });

  test('executes a selected trail with the app root as inner CWD', async () => {
    writeExecutableWorkspace(workspaceRoot);
    writeFixture(
      join(workspaceRoot, 'trails.config.json'),
      `${JSON.stringify({ workspace: { apps: { 'app-a': { root: 'apps/app-a' } } } })}\n`
    );

    const result = await executeTrail(
      runTrail,
      { app: 'app-a', id: 'context.cwd', rootDir: workspaceRoot },
      { ctx: { permit: trailsRunPermit } }
    );

    if (result.isErr()) {
      throw result.error;
    }
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect((result.value as { value: unknown }).value).toBe(
        join(workspaceRoot, 'apps', 'app-a')
      );
    }
  });

  test('forwards the wrapper permit when executing the target trail', async () => {
    writeExecutableWorkspace(workspaceRoot);

    const result = await executeRunTrail(
      {
        id: 'entity.add',
        input: { name: 'Alpha' },
        module: 'apps/app-a/src/app.ts',
        rootDir: workspaceRoot,
      },
      ['trails:run', 'entity:write']
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        executedAppId: 'app-a',
        kind: 'inner-trail-result',
        project: { selectedExtent: 'standalone-app' },
        trailId: 'entity.add',
        value: { name: 'Alpha' },
      });
    }
  });

  test('maps direct input fields to the target trail payload', async () => {
    writeExecutableWorkspace(workspaceRoot);

    const result = await executeRunTrail(
      {
        id: 'entity.add',
        module: 'apps/app-a/src/app.ts',
        name: 'Alpha',
        rootDir: workspaceRoot,
      },
      ['trails:run', 'entity:write']
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        executedAppId: 'app-a',
        kind: 'inner-trail-result',
        project: { selectedExtent: 'standalone-app' },
        trailId: 'entity.add',
        value: { name: 'Alpha' },
      });
    }
  });

  test('rejects mixed direct input fields and explicit input wrapper', async () => {
    writeExecutableWorkspace(workspaceRoot);

    const result = await executeRunTrail(
      {
        id: 'entity.add',
        input: { name: 'Alpha' },
        module: 'apps/app-a/src/app.ts',
        name: 'Bravo',
        rootDir: workspaceRoot,
      },
      ['trails:run', 'entity:write']
    );

    const error = expectErr(result);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain(
      'both direct input fields and an explicit input wrapper'
    );
  });
});
