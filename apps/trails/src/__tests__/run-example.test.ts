/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk/isErr */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { ActionResultContext } from '@ontrails/cli';
import {
  NotFoundError,
  Result,
  ValidationError,
  executeTrail,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { tryExampleRunOutput } from '../run-example.js';
import {
  RUN_EXAMPLE_COMPARISON_KIND,
  runExampleTrail,
} from '../trails/run-example.js';
import type { RunExampleComparison } from '../trails/run-example.js';

// ---------------------------------------------------------------------------
// Captured-IO helper
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
// Stub trails for unit-level helper tests
// ---------------------------------------------------------------------------

const stubRunTrail = trail('run.example', {
  description: 'stub run trail for example-comparison tests',
  implementation: () => Result.ok(),
  input: z.object({ trailId: z.string() }),
  output: z.unknown(),
});

const stubOtherTrail = trail('other', {
  description: 'stub non-run trail',
  implementation: () => Result.ok(),
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

const buildEnvelope = (
  overrides: Partial<RunExampleComparison>
): RunExampleComparison => ({
  actual: { outcome: 'ok', value: { name: 'Alpha' } },
  exampleName: 'Run trail by ID',
  expected: { name: 'Alpha' },
  input: { id: 'demo.alpha' },
  kind: RUN_EXAMPLE_COMPARISON_KIND,
  match: true,
  mode: 'expected',
  trailId: 'demo.alpha',
  ...overrides,
});

const trailsRunPermit = {
  id: 'test-permit',
  scopes: ['trails:run'],
} as const;

const executeRunExampleTrail = async (
  input: unknown,
  scopes: readonly string[] = trailsRunPermit.scopes
): Promise<Result<unknown, Error>> =>
  await executeTrail(runExampleTrail, input, {
    ctx: { permit: { id: trailsRunPermit.id, scopes } },
  });

// ---------------------------------------------------------------------------
// tryExampleRunOutput unit tests
// ---------------------------------------------------------------------------

describe('tryExampleRunOutput', () => {
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

  test('returns false on the base run trail', async () => {
    const ctx = buildCtx(
      trail('run', {
        implementation: () => Result.ok(),
        input: z.object({}),
        output: z.unknown(),
      }) as typeof stubRunTrail,
      {},
      Result.ok(buildEnvelope({}))
    );
    const io = await withCapturedIO(() => {
      const handled = tryExampleRunOutput(ctx);
      expect(handled).toBe(false);
    });
    expect(io.stdout.join('')).toBe('');
    expect(io.stderr.join('')).toBe('');
  });

  test('returns false on a non-run.example trail', async () => {
    const ctx = buildCtx(stubOtherTrail, {}, Result.ok(buildEnvelope({})));
    const handled = tryExampleRunOutput(ctx);
    expect(handled).toBe(false);
  });

  test('returns false when the outer Result is Err (defer to default handler)', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      {},
      Result.err(new NotFoundError('no such trail'))
    );
    const handled = tryExampleRunOutput(ctx);
    expect(handled).toBe(false);
  });

  test('text mode prints OK summary on match without throwing', async () => {
    const ctx = buildCtx(stubRunTrail, {}, Result.ok(buildEnvelope({})));
    const io = await withCapturedIO(() => {
      const handled = tryExampleRunOutput(ctx);
      expect(handled).toBe(true);
    });
    const out = io.stdout.join('');
    expect(out).toContain('OK');
    expect(out).toContain('demo.alpha');
    expect(out).toContain('Run trail by ID');
    expect(io.stderr.join('')).toBe('');
  });

  test('text mode throws ValidationError on mismatch and writes diff to stderr', async () => {
    const envelope = buildEnvelope({
      actual: { outcome: 'ok', value: { name: 'Beta' } },
      diff: ['value.name: "Beta" != "Alpha"'],
      match: false,
    });
    const ctx = buildCtx(stubRunTrail, {}, Result.ok(envelope));
    let thrown: unknown;
    const io = await withCapturedIO(() => {
      try {
        tryExampleRunOutput(ctx);
      } catch (error) {
        thrown = error;
      }
    });
    expect(thrown).toBeInstanceOf(ValidationError);
    const err = thrown;
    if (err instanceof ValidationError) {
      expect(err.message).toContain('did not match');
    }
    const stderr = io.stderr.join('');
    expect(stderr).toContain('MISMATCH');
    expect(stderr).toContain('value.name');
  });

  test('json mode emits the full envelope on match', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { exampleName: 'happy', json: true },
      Result.ok(buildEnvelope({}))
    );
    const io = await withCapturedIO(() => {
      const handled = tryExampleRunOutput(ctx);
      expect(handled).toBe(true);
    });
    const parsed: unknown = JSON.parse(io.stdout.join(''));
    expect(parsed).toMatchObject({
      exampleName: 'Run trail by ID',
      kind: RUN_EXAMPLE_COMPARISON_KIND,
      match: true,
      mode: 'expected',
      trailId: 'demo.alpha',
    });
  });

  test('json mode emits envelope and throws ValidationError on mismatch', async () => {
    const envelope = buildEnvelope({
      actual: { outcome: 'ok', value: { name: 'Beta' } },
      diff: ['value.name: "Beta" != "Alpha"'],
      match: false,
    });
    const ctx = buildCtx(
      stubRunTrail,
      { exampleName: 'happy', json: true },
      Result.ok(envelope)
    );
    let thrown: unknown;
    const io = await withCapturedIO(() => {
      try {
        tryExampleRunOutput(ctx);
      } catch (error) {
        thrown = error;
      }
    });
    expect(thrown).toBeInstanceOf(ValidationError);
    const parsed: unknown = JSON.parse(io.stdout.join(''));
    expect(parsed).toMatchObject({ match: false });
  });
});

// ---------------------------------------------------------------------------
// run.example implementation integration tests (workspace-fixture)
// ---------------------------------------------------------------------------

interface ExampleSpec {
  readonly name: string;
  readonly description?: string;
  readonly error?: string;
  readonly expected?: unknown;
  readonly expectedMatch?: unknown;
  readonly returnValue?: unknown;
  readonly returnError?: { class: string; message: string };
}

interface WorkspaceFixtureOptions {
  readonly permitScopes?: readonly string[] | undefined;
}

const writeFixture = (filePath: string, contents: string): void => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
};

/**
 * Build a stub Topo whose trails have:
 * - examples on disk (so run.example can look them up)
 * - implementation functions that return either a fixed value (returnValue) or a
 *   fixed error (returnError) keyed by example.name. The implementation inspects
 *   `input.__exampleName` to choose; the example fixtures embed that key
 *   into their input so dispatch is deterministic.
 */
const writeWorkspace = (
  workspaceRoot: string,
  trailId: string,
  examples: readonly ExampleSpec[],
  appName = 'app-a',
  options: WorkspaceFixtureOptions = {}
): void => {
  writeFixture(
    join(workspaceRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'run-example-test-fixture',
        private: true,
        type: 'module',
        workspaces: ['apps/*'],
      },
      null,
      2
    )}\n`
  );

  const appDir = join(workspaceRoot, 'apps', appName);
  writeFixture(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: appName,
        private: true,
        trails: { module: 'src/app.ts' },
        type: 'module',
      },
      null,
      2
    )}\n`
  );

  // Build the per-example dispatch table and the examples literal. The
  // examples on the trail definition mirror the structured-trail-example
  // shape (`expected` / `expectedMatch` / `error`), and each example's
  // input embeds `__exampleName` so the implementation can dispatch deterministically
  // via the in-memory `dispatch` map.
  const buildExampleFragment = (ex: ExampleSpec): string => {
    const baseFragments: readonly string[] = [
      `name: ${JSON.stringify(ex.name)}`,
      `input: { __exampleName: ${JSON.stringify(ex.name)}, trailId: ${JSON.stringify(trailId)} }`,
    ];
    const optionalFragments: readonly (string | null)[] = [
      ex.description === undefined
        ? null
        : `description: ${JSON.stringify(ex.description)}`,
      ex.expected === undefined
        ? null
        : `expected: ${JSON.stringify(ex.expected)}`,
      ex.expectedMatch === undefined
        ? null
        : `expectedMatch: ${JSON.stringify(ex.expectedMatch)}`,
      ex.error === undefined ? null : `error: ${JSON.stringify(ex.error)}`,
    ];
    const fragments = [
      ...baseFragments,
      ...optionalFragments.filter((entry): entry is string => entry !== null),
    ];
    return `    { ${fragments.join(', ')} }`;
  };

  const examplesArrayLiteral = `[\n${examples
    .map(buildExampleFragment)
    .join(',\n')}\n  ]`;

  const dispatchEntries = examples
    .map((ex) => {
      if (ex.returnError !== undefined) {
        return `  [${JSON.stringify(ex.name)}, { kind: 'err', className: ${JSON.stringify(ex.returnError.class)}, message: ${JSON.stringify(ex.returnError.message)} }]`;
      }
      return `  [${JSON.stringify(ex.name)}, { kind: 'ok', value: ${JSON.stringify(ex.returnValue)} }]`;
    })
    .join(',\n');
  const permitLine =
    options.permitScopes === undefined
      ? null
      : `  permit: { scopes: ${JSON.stringify(options.permitScopes)} },`;
  const trailFragments = [
    `  description: 'fixture trail for run-example tests',`,
    `  input: z.object({ __exampleName: z.string(), trailId: z.string() }),`,
    `  output: z.unknown(),`,
    permitLine,
    `  examples: ${examplesArrayLiteral},`,
    `  implementation: (input) => {`,
    `    const config = dispatch.get(input.__exampleName);`,
    `    if (!config) {`,
    `      return Result.ok(undefined);`,
    `    }`,
    `    if (config.kind === 'err') {`,
    `      const Ctor = errorClasses[config.className] ?? NotFoundError;`,
    `      return Result.err(new Ctor(config.message));`,
    `    }`,
    `    return Result.ok(config.value);`,
    `  },`,
  ].filter((line): line is string => line !== null);

  // The fixture imports `@ontrails/core` at the workspace level so the trail
  // is a real `trail()` definition with all required fields (detours,
  // contours, etc.). This lets `executeTrail` run end-to-end without
  // hand-rolling every internal field on a stub object.
  writeFixture(
    join(appDir, 'src/app.ts'),
    [
      `import {`,
      `  ConflictError,`,
      `  NotFoundError,`,
      `  Result,`,
      `  ValidationError,`,
      `  topo,`,
      `  trail,`,
      `} from '@ontrails/core';`,
      `import { z } from 'zod';`,
      '',
      `const errorClasses = {`,
      `  NotFoundError,`,
      `  ValidationError,`,
      `  ConflictError,`,
      `};`,
      '',
      `const dispatch = new Map([`,
      dispatchEntries,
      `]);`,
      '',
      `const targetTrail = trail(${JSON.stringify(trailId)}, {`,
      ...trailFragments,
      `});`,
      '',
      `export const app = topo(${JSON.stringify(appName)}, [targetTrail]);`,
      '',
    ].join('\n')
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
    `run-example-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
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

describe('run.example trail', () => {
  test('expected-mode match returns envelope with match=true and no diff', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        expected: { name: 'Alpha' },
        name: 'happy',
        returnValue: { name: 'Alpha' },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'happy',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.kind).toBe(RUN_EXAMPLE_COMPARISON_KIND);
    expect(envelope.mode).toBe('expected');
    expect(envelope.match).toBe(true);
    expect(envelope.diff).toBeUndefined();
    expect(envelope.trailId).toBe('demo.alpha');
    expect(envelope.exampleName).toBe('happy');
  });

  test('expected-mode mismatch returns envelope with match=false and a diff', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        expected: { name: 'Alpha' },
        name: 'wrong',
        returnValue: { name: 'Beta' },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'wrong',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.match).toBe(false);
    expect(envelope.mode).toBe('expected');
    expect(envelope.diff).toBeDefined();
    expect(envelope.diff?.length ?? 0).toBeGreaterThan(0);
    const diffText = (envelope.diff ?? []).join(' ');
    expect(diffText).toContain('name');
  });

  test('input-only example runs in no-assertion mode', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        name: 'smoke',
        returnValue: { name: 'Alpha' },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'smoke',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.mode).toBe('none');
    expect(envelope.match).toBe(true);
    expect(envelope.diff).toBeUndefined();
    expect(envelope.actual).toEqual({
      outcome: 'ok',
      value: { name: 'Alpha' },
    });
  });

  test('forwards the wrapper permit when running a protected input-only example', async () => {
    writeWorkspace(
      workspaceRoot,
      'demo.alpha',
      [
        {
          name: 'protected-smoke',
          returnValue: { name: 'Alpha' },
        },
      ],
      'app-a',
      { permitScopes: ['entity:write'] }
    );

    const result = await executeRunExampleTrail(
      {
        exampleName: 'protected-smoke',
        id: 'demo.alpha',
        module: 'apps/app-a/src/app.ts',
        rootDir: workspaceRoot,
      },
      ['trails:run', 'entity:write']
    );

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.mode).toBe('none');
    expect(envelope.match).toBe(true);
    expect(envelope.actual).toEqual({
      outcome: 'ok',
      value: { name: 'Alpha' },
    });
  });

  test('expectedMatch-mode partial match passes when extras are present', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        expectedMatch: { name: 'Alpha' },
        name: 'partial',
        returnValue: { extra: 'extra-value', name: 'Alpha' },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'partial',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.mode).toBe('expectedMatch');
    expect(envelope.match).toBe(true);
  });

  test('expectedMatch-mode mismatch returns diff for missing expected key', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        expectedMatch: { name: 'Alpha' },
        name: 'partial-mismatch',
        returnValue: { other: 'thing' },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'partial-mismatch',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.match).toBe(false);
    expect(envelope.mode).toBe('expectedMatch');
    const diffText = (envelope.diff ?? []).join(' ');
    expect(diffText).toContain('missing in actual');
  });

  test('expectedMatch-mode array subset matches order-independent (mirrors testExamples)', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        expectedMatch: { items: [{ id: 'b' }] },
        name: 'array-subset',
        returnValue: { items: [{ id: 'a' }, { id: 'b' }] },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'array-subset',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.match).toBe(true);
    expect(envelope.mode).toBe('expectedMatch');
  });

  test('expectedMatch-mode duplicate elements require distinct actual entries', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        expectedMatch: { items: ['a', 'a'] },
        name: 'duplicates',
        returnValue: { items: ['a'] },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'duplicates',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.match).toBe(false);
    expect(envelope.mode).toBe('expectedMatch');
  });

  test('error-mode envelope includes errorCategory when actual is a TrailsError', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        error: 'NotFoundError',
        name: 'not-found-error',
        returnError: { class: 'NotFoundError', message: 'missing' },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'not-found-error',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.match).toBe(true);
    expect(envelope.mode).toBe('error');
    expect(envelope.actual).toMatchObject({
      errorCategory: 'not_found',
      errorClassName: 'NotFoundError',
      outcome: 'err',
    });
  });

  test('error-mode match when actual is Err with the expected class name', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        error: 'NotFoundError',
        name: 'rejects-unknown',
        returnError: { class: 'NotFoundError', message: 'not found' },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'rejects-unknown',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.mode).toBe('error');
    expect(envelope.match).toBe(true);
  });

  test('error-mode mismatch when actual is Err of different class', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        error: 'NotFoundError',
        name: 'rejects-with-wrong-class',
        returnError: { class: 'ConflictError', message: 'conflict' },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'rejects-with-wrong-class',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.match).toBe(false);
    expect(envelope.mode).toBe('error');
  });

  test('error-mode mismatch when actual is Ok but example expected an error', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        error: 'NotFoundError',
        name: 'expects-error-but-ok',
        returnValue: { ok: true },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'expects-error-but-ok',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.match).toBe(false);
  });

  test('unknown example name returns NotFoundError listing available examples', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        expected: { name: 'Alpha' },
        name: 'happy',
        returnValue: { name: 'Alpha' },
      },
      {
        expected: { name: 'Beta' },
        name: 'other',
        returnValue: { name: 'Beta' },
      },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'does-not-exist',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toContain("Example 'does-not-exist' not found");
    expect(error.message).toContain('happy');
    expect(error.message).toContain('other');
  });

  test('unknown trail id returns NotFoundError', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      { expected: 1, name: 'happy', returnValue: 1 },
    ]);

    const result = await executeRunExampleTrail({
      exampleName: 'happy',
      id: 'never.here',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(NotFoundError);
  });

  test('resolves trail through workspace --app override and runs the example', async () => {
    writeWorkspace(workspaceRoot, 'demo.alpha', [
      {
        expected: { name: 'Alpha' },
        name: 'happy',
        returnValue: { name: 'Alpha' },
      },
    ]);

    const result = await executeRunExampleTrail({
      app: 'app-a',
      exampleName: 'happy',
      id: 'demo.alpha',
      module: 'apps/app-a/src/app.ts',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.kind).toBe(RUN_EXAMPLE_COMPARISON_KIND);
    expect(envelope.match).toBe(true);
  });

  test('resolves ambiguous workspace trail through --app without module', async () => {
    writeWorkspace(
      workspaceRoot,
      'shared.demo',
      [
        {
          expected: { owner: 'app-a' },
          name: 'happy',
          returnValue: { owner: 'app-a' },
        },
      ],
      'app-a'
    );
    writeWorkspace(
      workspaceRoot,
      'shared.demo',
      [
        {
          expected: { owner: 'app-b' },
          name: 'happy',
          returnValue: { owner: 'app-b' },
        },
      ],
      'app-b'
    );

    const result = await executeRunExampleTrail({
      app: 'app-b',
      exampleName: 'happy',
      id: 'shared.demo',
      rootDir: workspaceRoot,
    });

    const envelope = expectOk(result) as RunExampleComparison;
    expect(envelope.match).toBe(true);
    expect(envelope.actual).toMatchObject({
      outcome: 'ok',
      value: { owner: 'app-b' },
    });
  });
});
