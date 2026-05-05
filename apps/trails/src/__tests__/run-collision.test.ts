/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk/isErr */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ActionResultContext } from '@ontrails/cli';
import {
  AmbiguousError,
  Result,
  ValidationError,
  executeTrail,
} from '@ontrails/core';

import { app } from '../app.js';
import { tryRecoverFromRunCollision } from '../run-collision.js';
import { runTrail } from '../trails/run.js';

interface AppSpec {
  readonly name: string;
  readonly trailIds: readonly string[];
}

const writeFile = (filePath: string, contents: string): void => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
};

const writeWorkspace = (root: string, apps: readonly AppSpec[]): void => {
  writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'run-collision-test-fixture',
        private: true,
        type: 'module',
        workspaces: ['apps/*'],
      },
      null,
      2
    )}\n`
  );
  for (const spec of apps) {
    const appDir = join(root, 'apps', spec.name);
    writeFile(
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
    writeFile(
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

const buildAmbiguousContext = async (
  workspaceRoot: string
): Promise<ActionResultContext> => {
  const result = await executeTrail(runTrail, {
    id: 'shared.id',
    rootDir: workspaceRoot,
  });
  return {
    args: { id: 'shared.id' },
    flags: {},
    input: { id: 'shared.id', rootDir: workspaceRoot },
    result,
    topoName: 'trails',
    trail: runTrail as unknown as ActionResultContext['trail'],
  };
};

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `run-collision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { force: true, recursive: true });
});

describe('tryRecoverFromRunCollision', () => {
  test('returns undefined when stdin is not a TTY (non-interactive surface)', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id'] },
      { name: 'app-b', trailIds: ['shared.id'] },
    ]);

    const ctx = await buildAmbiguousContext(workspaceRoot);
    expect(ctx.result.isErr()).toBe(true);

    const recovered = await tryRecoverFromRunCollision(ctx, {
      graph: app,
      isTTY: () => false,
    });

    expect(recovered).toBeUndefined();
  });

  test('prompts when TTY and re-executes the trail with the chosen app, surfacing inner errors verbatim', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id'] },
      { name: 'app-b', trailIds: ['shared.id'] },
    ]);

    const ctx = await buildAmbiguousContext(workspaceRoot);
    let promptedCandidates: readonly string[] = [];
    let promptedTrailId = '';

    const recovered = await tryRecoverFromRunCollision(ctx, {
      graph: app,
      isTTY: () => true,
      promptForApp: async (candidates, trailId) => {
        promptedCandidates = candidates;
        promptedTrailId = trailId;
        return await Promise.resolve('app-a');
      },
    });

    expect(promptedCandidates).toEqual(['app-a', 'app-b']);
    expect(promptedTrailId).toBe('shared.id');
    expect(recovered).toBeDefined();

    // The fixture apps export stub topos that lack the `trails` field, so the
    // load-app boundary surfaces a ValidationError. That is the *correct*
    // post-recovery outcome here: the prompt produced a single-owner
    // resolution, then real loading kicked in. The collision is no longer
    // surfaced as Ambiguous.
    if (recovered !== undefined && recovered.isErr()) {
      expect(recovered.error).toBeInstanceOf(ValidationError);
      expect(recovered.error).not.toBeInstanceOf(AmbiguousError);
    }
  });

  test('returns undefined when the user cancels the prompt', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id'] },
      { name: 'app-b', trailIds: ['shared.id'] },
    ]);

    const ctx = await buildAmbiguousContext(workspaceRoot);

    const recovered = await tryRecoverFromRunCollision(ctx, {
      graph: app,
      isTTY: () => true,
      promptForApp: async () => await Promise.resolve(),
    });

    expect(recovered).toBeUndefined();
  });

  test('does not prompt again when the user already supplied an app override', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id'] },
      { name: 'app-b', trailIds: ['shared.id'] },
      { name: 'app-c', trailIds: ['c.only'] },
    ]);

    const input = {
      app: 'app-c',
      id: 'shared.id',
      rootDir: workspaceRoot,
    };
    const result = await executeTrail(runTrail, input);
    let prompted = false;

    const recovered = await tryRecoverFromRunCollision(
      {
        args: { id: 'shared.id' },
        flags: { app: 'app-c' },
        input,
        result,
        topoName: 'trails',
        trail: runTrail as unknown as ActionResultContext['trail'],
      },
      {
        graph: app,
        isTTY: () => true,
        promptForApp: async () => {
          prompted = true;
          return 'app-a';
        },
      }
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AmbiguousError);
    }
    expect(recovered).toBeUndefined();
    expect(prompted).toBe(false);
  });

  test('returns undefined for non-collision errors (no recovery attempted)', async () => {
    const ctx: ActionResultContext = {
      args: { id: 'unknown.trail' },
      flags: {},
      input: { id: 'unknown.trail', rootDir: workspaceRoot },
      result: Result.err(new ValidationError('boom')),
      topoName: 'trails',
      trail: runTrail as unknown as ActionResultContext['trail'],
    };

    const recovered = await tryRecoverFromRunCollision(ctx, {
      graph: app,
      isTTY: () => true,
      promptForApp: async () => await Promise.resolve('app-a'),
    });

    expect(recovered).toBeUndefined();
  });
});
