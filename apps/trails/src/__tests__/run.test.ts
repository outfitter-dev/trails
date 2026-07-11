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

import { resolveRunModulePath, runTrail } from '../trails/run.js';

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
    // Stub Topo shape: only `ids()` and `name` are read by the discovery layer.
    writeFixture(
      join(appDir, 'src/app.ts'),
      [
        `const trailIds = ${JSON.stringify(spec.trailIds)};`,
        `export const app = {`,
        `  name: '${spec.name}',`,
        `  ids: () => trailIds,`,
        `};`,
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
      `export const app = topo('app-a', [add]);`,
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
      "Trail ID 'shared.id' exists in apps: app-a, app-b. Re-run with --app <name>."
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

  test('resolves a colliding trail id through an owning --app override', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id'] },
      { name: 'app-b', trailIds: ['shared.id'] },
    ]);

    const result = await resolveRunModulePath(
      workspaceRoot,
      undefined,
      'shared.id',
      'app-b'
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('apps/app-b/src/app.ts');
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
      expect(result.value).toEqual({
        kind: 'inner-trail-result',
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
      expect(result.value).toEqual({
        kind: 'inner-trail-result',
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
