/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk/isErr */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AmbiguousError, NotFoundError, executeTrail } from '@ontrails/core';
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

const expectErr = <T, E extends Error>(result: Result<T, E>): E => {
  if (result.isOk()) {
    throw new Error('Expected Result.err but got Result.ok');
  }
  return result.error;
};

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
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

    const result = await executeTrail(runTrail, {
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

    const result = await executeTrail(runTrail, {
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

    const result = await executeTrail(runTrail, {
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

    const result = await executeTrail(runTrail, {
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

    const result = await executeTrail(runTrail, {
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
});
