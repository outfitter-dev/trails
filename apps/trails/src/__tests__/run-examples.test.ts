/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk/isErr */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ActionResultContext } from '@ontrails/cli';
import { NotFoundError, Result, executeTrail, trail } from '@ontrails/core';
import type { StructuredTrailExample } from '@ontrails/core';
import { z } from 'zod';

import { tryExamplesRunOutput } from '../run-examples.js';
import {
  RUN_EXAMPLES_LISTING_KIND,
  runExamplesTrail,
  structuredTrailExampleSchema,
} from '../trails/run-examples.js';
import type { RunExamplesListing } from '../trails/run-examples.js';

// ---------------------------------------------------------------------------
// Shared captured-IO helper
// ---------------------------------------------------------------------------

interface CapturedIO {
  readonly stdout: string[];
  readonly stderr: string[];
}

const withCapturedIO = async (
  fn: (io: CapturedIO) => Promise<void> | void
): Promise<CapturedIO> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: string) => {
    stdout.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    stderr.push(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn({ stderr, stdout });
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  return { stderr, stdout };
};

// ---------------------------------------------------------------------------
// tryExamplesRunOutput formatting tests (unit-level, in-memory ctx)
// ---------------------------------------------------------------------------

const stubRunTrail = trail('run.examples', {
  blaze: () => Result.ok(),
  description: 'stub run trail for examples-listing tests',
  input: z.object({ trailId: z.string() }),
  output: z.unknown(),
});

const stubOtherTrail = trail('other', {
  blaze: () => Result.ok(),
  description: 'stub non-run trail',
  input: z.object({}),
  output: z.unknown(),
});

const buildCtx = (
  trailObj: typeof stubRunTrail | typeof stubOtherTrail,
  flags: Record<string, unknown>,
  result: Result<unknown, Error>
): ActionResultContext => ({
  args: {},
  flags,
  input: {},
  result,
  topoName: 'trails',
  trail: trailObj as unknown as ActionResultContext['trail'],
});

const successExample: StructuredTrailExample = Object.freeze({
  description: 'happy path',
  input: { id: '' },
  kind: 'success',
  name: 'Run trail by ID',
  provenance: { source: 'trail.examples' as const },
});

test('structured trail example schema preserves future structured fields', () => {
  const parsed = structuredTrailExampleSchema.parse({
    input: { id: 'demo.alpha' },
    kind: 'success',
    name: 'Alpha happy',
    provenance: { source: 'trail.examples' },
    trace: { spanId: 'span-1' },
  });

  expect(parsed).toMatchObject({
    trace: { spanId: 'span-1' },
  });
});

const errorExample: StructuredTrailExample = Object.freeze({
  description: 'unknown id',
  error: 'NotFoundError',
  input: { id: '' },
  kind: 'error',
  name: 'Reject unknown trail ID',
  provenance: { source: 'trail.examples' as const },
});

const buildListing = (
  examples: readonly StructuredTrailExample[]
): RunExamplesListing => ({
  examples,
  kind: RUN_EXAMPLES_LISTING_KIND,
  trailId: 'run',
});

describe('tryExamplesRunOutput', () => {
  let originalTrailsJson: string | undefined;
  let originalTrailsJsonl: string | undefined;

  beforeEach(() => {
    originalTrailsJson = process.env['TRAILS_JSON'];
    originalTrailsJsonl = process.env['TRAILS_JSONL'];
    delete process.env.TRAILS_JSON;
    delete process.env.TRAILS_JSONL;
  });

  afterEach(() => {
    if (originalTrailsJson === undefined) {
      delete process.env.TRAILS_JSON;
    } else {
      process.env.TRAILS_JSON = originalTrailsJson;
    }
    if (originalTrailsJsonl === undefined) {
      delete process.env.TRAILS_JSONL;
    } else {
      process.env.TRAILS_JSONL = originalTrailsJsonl;
    }
  });

  test('returns false on the run trail because listings now come from run.examples', async () => {
    const ctx = buildCtx(
      trail('run', {
        blaze: () => Result.ok(),
        input: z.object({}),
        output: z.unknown(),
      }) as typeof stubRunTrail,
      {},
      Result.ok(buildListing([]))
    );
    const io = await withCapturedIO(() => {
      const handled = tryExamplesRunOutput(ctx);
      expect(handled).toBe(false);
    });
    expect(io.stdout.join('')).toBe('');
    expect(io.stderr.join('')).toBe('');
  });

  test('returns false on a non-run.examples trail', async () => {
    const ctx = buildCtx(
      stubOtherTrail,
      {},
      Result.ok(buildListing([successExample]))
    );
    const handled = tryExamplesRunOutput(ctx);
    expect(handled).toBe(false);
  });

  test('returns false when the outer Result is Err (defer to default handler)', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      {},
      Result.err(new NotFoundError('no such trail'))
    );
    const handled = tryExamplesRunOutput(ctx);
    expect(handled).toBe(false);
  });

  test('text mode formats a table-like listing with name + truncated input + outcome', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      {},
      Result.ok(buildListing([successExample, errorExample]))
    );
    const io = await withCapturedIO(() => {
      const handled = tryExamplesRunOutput(ctx);
      expect(handled).toBe(true);
    });
    const out = io.stdout.join('');
    expect(out).toContain('NAME');
    expect(out).toContain('INPUT');
    expect(out).toContain('OUTCOME');
    expect(out).toContain('Run trail by ID');
    expect(out).toContain('Reject unknown trail ID');
    expect(out).toContain('ok');
    expect(out).toContain('error: NotFoundError');
    // No raw envelope keys leak into text output.
    expect(out).not.toContain('"kind"');
    expect(out).not.toContain('"provenance"');
  });

  test('text mode prints "No examples defined" when the listing is empty', async () => {
    const ctx = buildCtx(stubRunTrail, {}, Result.ok(buildListing([])));
    const io = await withCapturedIO(() => {
      const handled = tryExamplesRunOutput(ctx);
      expect(handled).toBe(true);
    });
    expect(io.stdout.join('')).toBe('No examples defined\n');
  });

  test('json mode emits the structured examples array (no envelope)', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { json: true },
      Result.ok(buildListing([successExample, errorExample]))
    );
    const io = await withCapturedIO(() => {
      const handled = tryExamplesRunOutput(ctx);
      expect(handled).toBe(true);
    });
    const out = io.stdout.join('');
    const parsed: unknown = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    if (Array.isArray(parsed)) {
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toMatchObject({
        kind: 'success',
        name: 'Run trail by ID',
      });
      expect(parsed[1]).toMatchObject({
        error: 'NotFoundError',
        kind: 'error',
        name: 'Reject unknown trail ID',
      });
    }
  });

  test('json mode emits an empty array when the listing has no examples', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { json: true },
      Result.ok(buildListing([]))
    );
    const io = await withCapturedIO(() => {
      const handled = tryExamplesRunOutput(ctx);
      expect(handled).toBe(true);
    });
    expect(io.stdout.join('').trim()).toBe('[]');
  });

  test('jsonl mode emits one structured example per line', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { jsonl: true },
      Result.ok(buildListing([successExample, errorExample]))
    );
    const io = await withCapturedIO(() => {
      const handled = tryExamplesRunOutput(ctx);
      expect(handled).toBe(true);
    });
    const lines = io.stdout
      .join('')
      .split('\n')
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      kind: 'success',
      name: 'Run trail by ID',
    });
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({
      kind: 'error',
      name: 'Reject unknown trail ID',
    });
  });

  test('truncates very long input previews with an ellipsis', async () => {
    const longInput = { id: 'x'.repeat(200) };
    const longExample: StructuredTrailExample = Object.freeze({
      input: longInput,
      kind: 'success',
      name: 'Long input',
      provenance: { source: 'trail.examples' as const },
    });
    const ctx = buildCtx(
      stubRunTrail,
      {},
      Result.ok(buildListing([longExample]))
    );
    const io = await withCapturedIO(() => {
      const handled = tryExamplesRunOutput(ctx);
      expect(handled).toBe(true);
    });
    const out = io.stdout.join('');
    expect(out).toContain('…');
    // The full 200-char trailId must not appear in full.
    expect(out).not.toContain('x'.repeat(200));
  });
});

// ---------------------------------------------------------------------------
// run.examples blaze (workspace-fixture integration)
// ---------------------------------------------------------------------------

interface AppSpec {
  readonly name: string;
  readonly trailIds: readonly string[];
}

const writeFixture = (filePath: string, contents: string): void => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
};

const buildExampleFragment = (
  trailId: string,
  examples: readonly { name: string; description?: string; error?: string }[]
): string => {
  const json = JSON.stringify(
    examples.map((example) => ({
      ...(example.description === undefined
        ? {}
        : { description: example.description }),
      ...(example.error === undefined ? {} : { error: example.error }),
      input: { trailId },
      name: example.name,
    }))
  );
  return json;
};

const writeWorkspace = (
  workspaceRoot: string,
  apps: readonly (AppSpec & {
    readonly examplesByTrail?: Readonly<
      Record<
        string,
        readonly { name: string; description?: string; error?: string }[]
      >
    >;
  })[]
): void => {
  writeFixture(
    join(workspaceRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'run-examples-test-fixture',
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

    const trailsBody = spec.trailIds
      .map((trailId) => {
        const examples = spec.examplesByTrail?.[trailId] ?? [];
        const examplesLiteral = buildExampleFragment(trailId, examples);
        return `  ['${trailId}', { id: '${trailId}', kind: 'trail', examples: ${examplesLiteral} }]`;
      })
      .join(',\n');

    // Stub Topo shape: discovery layer reads `name` and `ids()`; the
    // `loadFreshAppLease` resolver checks `trails` (truthy); and the
    // run.examples trail calls `app.get(trailId)` and reads `examples` from the
    // resolved trail. Hand-rolled stub satisfies all three code paths without
    // pulling in `@ontrails/core`.
    writeFixture(
      join(appDir, 'src/app.ts'),
      [
        `const trailMap = new Map([`,
        trailsBody,
        `]);`,
        `export const app = {`,
        `  name: '${spec.name}',`,
        `  trails: trailMap,`,
        `  ids: () => Array.from(trailMap.keys()),`,
        `  get: (id) => trailMap.get(id),`,
        `};`,
        '',
      ].join('\n')
    );
  }
};

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `run-examples-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { force: true, recursive: true });
});

const expectOk = <T, E extends Error>(result: Result<T, E>): T => {
  if (result.isErr()) {
    throw new Error(`Expected Result.ok but got Err: ${result.error.message}`);
  }
  return result.value;
};

const expectErr = <T, E extends Error>(result: Result<T, E>): E => {
  if (result.isOk()) {
    throw new Error('Expected Result.err but got Ok');
  }
  return result.error;
};

describe('run.examples trail', () => {
  test('returns the structured examples listing without executing the trail', async () => {
    writeWorkspace(workspaceRoot, [
      {
        examplesByTrail: {
          'demo.alpha': [
            { description: 'happy path', name: 'Alpha happy' },
            {
              description: 'unknown id',
              error: 'NotFoundError',
              name: 'Alpha not found',
            },
          ],
        },
        name: 'app-a',
        trailIds: ['demo.alpha'],
      },
    ]);

    const result = await executeTrail(runExamplesTrail, {
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const value = expectOk(result) as RunExamplesListing;
    expect(value.kind).toBe(RUN_EXAMPLES_LISTING_KIND);
    expect(value.trailId).toBe('demo.alpha');
    expect(value.examples).toHaveLength(2);
    expect(value.examples[0]).toMatchObject({
      kind: 'success',
      name: 'Alpha happy',
    });
    expect(value.examples[1]).toMatchObject({
      error: 'NotFoundError',
      kind: 'error',
      name: 'Alpha not found',
    });
  });

  test('resolves ambiguous workspace trail through --app without module', async () => {
    writeWorkspace(workspaceRoot, [
      {
        examplesByTrail: {
          'shared.demo': [{ description: 'app a path', name: 'App A' }],
        },
        name: 'app-a',
        trailIds: ['shared.demo'],
      },
      {
        examplesByTrail: {
          'shared.demo': [{ description: 'app b path', name: 'App B' }],
        },
        name: 'app-b',
        trailIds: ['shared.demo'],
      },
    ]);

    const result = await executeTrail(runExamplesTrail, {
      app: 'app-b',
      id: 'shared.demo',
      rootDir: workspaceRoot,
    });

    const value = expectOk(result) as RunExamplesListing;
    expect(value.trailId).toBe('shared.demo');
    expect(value.examples.map((example) => example.name)).toEqual(['App B']);
  });

  test('returns an empty examples array when the resolved trail has no examples', async () => {
    writeWorkspace(workspaceRoot, [{ name: 'app-a', trailIds: ['demo.bare'] }]);

    const result = await executeTrail(runExamplesTrail, {
      id: 'demo.bare',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const value = expectOk(result) as RunExamplesListing;
    expect(value.kind).toBe(RUN_EXAMPLES_LISTING_KIND);
    expect(value.trailId).toBe('demo.bare');
    expect(value.examples).toEqual([]);
  });

  test('still surfaces NotFoundError from workspace-index resolution for an unknown trail id', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['only.alpha'] },
    ]);

    const result = await executeTrail(runExamplesTrail, {
      id: 'never.here',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toContain("Trail 'never.here' was not found");
  });
});
