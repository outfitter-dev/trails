/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { executeTrail, RecoverableCompletionError } from '@ontrails/core';

import { renderTrailExampleCompletions } from '../completions.js';
import { completionsCompleteTrail } from '../trails/completions-complete.js';

// ---------------------------------------------------------------------------
// Fixture helpers
//
// Mirrors the workspace-fixture pattern from `run-example.test.ts`: a real
// `topo()` + `trail()` import from `@ontrails/core` so the trail definition
// has live `examples` arrays the completion handler can read via
// `app.get(trailId).examples`.
// ---------------------------------------------------------------------------

interface ExampleSpec {
  readonly name: string;
  readonly expected?: unknown;
}

const writeFixture = (filePath: string, contents: string): void => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
};

const buildExampleLiteral = (ex: ExampleSpec): string => {
  const fragments: string[] = [`name: ${JSON.stringify(ex.name)}`, 'input: {}'];
  if (ex.expected !== undefined) {
    fragments.push(`expected: ${JSON.stringify(ex.expected)}`);
  }
  return `    { ${fragments.join(', ')} }`;
};

const writeWorkspace = (
  workspaceRoot: string,
  trailId: string,
  examples: readonly ExampleSpec[]
): void => {
  writeFixture(
    join(workspaceRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'completions-example-test-fixture',
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

  const examplesArrayLiteral =
    examples.length === 0
      ? '[]'
      : `[\n${examples.map(buildExampleLiteral).join(',\n')}\n  ]`;

  writeFixture(
    join(appDir, 'src/app.ts'),
    [
      `import { Result, topo, trail } from '@ontrails/core';`,
      `import { z } from 'zod';`,
      '',
      `const targetTrail = trail(${JSON.stringify(trailId)}, {`,
      `  description: 'fixture trail for completions-example tests',`,
      `  input: z.object({}).passthrough(),`,
      `  output: z.unknown(),`,
      `  examples: ${examplesArrayLiteral},`,
      `  blaze: () => Result.ok({}),`,
      `});`,
      '',
      `export const app = topo('app-a', [targetTrail]);`,
      '',
    ].join('\n')
  );
};

const writeBrokenWorkspace = (workspaceRoot: string): void => {
  writeFixture(
    join(workspaceRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'completions-example-test-fixture',
        private: true,
        type: 'module',
        workspaces: ['apps/*'],
      },
      null,
      2
    )}\n`
  );

  const appDir = join(workspaceRoot, 'apps', 'broken-app');
  writeFixture(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'broken-app',
        private: true,
        trails: { module: 'src/missing.ts' },
        type: 'module',
      },
      null,
      2
    )}\n`
  );

  writeFixture(
    join(workspaceRoot, '.trails', 'topo.lock'),
    `${JSON.stringify(
      {
        activationGraph: {
          edgeCount: 0,
          edges: [],
          sourceCount: 0,
          sourceKeys: [],
          trailIds: [],
        },
        activationSources: {},
        entries: [],
        generatedAt: '2026-05-11T12:00:00.000Z',
        topoGraphSchemaVersion: 1,
        workspace: {
          trails: {
            'demo.alpha': {
              appName: 'broken-app',
              modulePath: 'apps/broken-app/src/missing.ts',
              trailId: 'demo.alpha',
            },
          },
        },
      },
      null,
      2
    )}\n`
  );
};

// Use `.tmp-tests` under the trails app so node_modules resolution from the
// fixture climbs up to the workspace's node_modules (system tmpdir would
// break package resolution for `@ontrails/core` and `zod`).
const workspaceTmpRoot = resolve(import.meta.dir, '../..', '.tmp-tests');

let workspaceRoot: string;

beforeEach(() => {
  mkdirSync(workspaceTmpRoot, { recursive: true });
  workspaceRoot = join(
    workspaceTmpRoot,
    `completions-example-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { force: true, recursive: true });
});

const expectSuggestions = async (args: readonly string[]): Promise<string> => {
  const result = await executeTrail(completionsCompleteTrail, {
    args,
    rootDir: workspaceRoot,
  });
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    throw new Error('expected Ok');
  }
  return result.value;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('completionsCompleteTrail run example value position', () => {
  test('helper returns a recoverable error when the app cannot load', async () => {
    writeBrokenWorkspace(workspaceRoot);

    const result = await renderTrailExampleCompletions(
      workspaceRoot,
      'demo.alpha',
      ''
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(RecoverableCompletionError);
    }
  });

  test('internal completion suppresses recoverable load errors', async () => {
    writeBrokenWorkspace(workspaceRoot);

    const suggestions = await expectSuggestions([
      'run',
      'example',
      'demo.alpha',
      '',
    ]);

    expect(suggestions).toBe('');
  });

  test('empty prefix returns all example names sorted', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      { expected: { ok: true }, name: 'Book search' },
      { expected: { ok: true }, name: 'Account list' },
      { expected: { ok: true }, name: 'Book detail' },
    ]);

    const suggestions = await expectSuggestions([
      'run',
      'example',
      'demo.alpha',
      '',
    ]);

    expect(suggestions).toBe('Account list\nBook detail\nBook search');
  });

  test('non-empty prefix filters to matching example names', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      { expected: { ok: true }, name: 'Book search' },
      { expected: { ok: true }, name: 'Account list' },
      { expected: { ok: true }, name: 'Book detail' },
    ]);

    const suggestions = await expectSuggestions([
      'run',
      'example',
      'demo.alpha',
      'Book',
    ]);

    expect(suggestions).toBe('Book detail\nBook search');
  });

  test('trail with no examples returns an empty list', async () => {
    writeWorkspace(workspaceRoot, 'demo.empty', []);

    const suggestions = await expectSuggestions([
      'run',
      'example',
      'demo.empty',
      '',
    ]);

    expect(suggestions).toBe('');
  });

  test('unknown trail id returns an empty list', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      { expected: { ok: true }, name: 'Book search' },
    ]);

    const suggestions = await expectSuggestions([
      'run',
      'example',
      'does.not.exist',
      '',
    ]);

    expect(suggestions).toBe('');
  });

  test('non-example flag after a trail id returns no stale trail-id suggestions', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      { expected: { ok: true }, name: 'Book search' },
    ]);

    const suggestions = await expectSuggestions([
      'run',
      'demo.alpha',
      '--quiet',
      '',
    ]);

    expect(suggestions).toBe('');
  });
});
