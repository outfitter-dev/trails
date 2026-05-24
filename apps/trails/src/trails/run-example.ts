/**
 * `run.example` trail -- run one named example and compare the result.
 */

import {
  NotFoundError,
  Result,
  TrailsError,
  deriveStructuredTrailExamples,
  run,
  trail,
} from '@ontrails/core';
import type { StructuredTrailExample, Topo } from '@ontrails/core';
import { z } from 'zod';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveRunModulePath } from './run.js';
import { resolveTrailRootDir } from './root-dir.js';
import { createIsolatedExampleInput } from './topo-support.js';

export const RUN_EXAMPLE_COMPARISON_KIND = 'example-comparison' as const;

export const runExampleComparisonSchema = z.object({
  actual: z.unknown(),
  diff: z.array(z.string()).readonly().optional(),
  exampleName: z.string(),
  expected: z.unknown(),
  input: z.unknown(),
  kind: z.literal(RUN_EXAMPLE_COMPARISON_KIND),
  match: z.boolean(),
  mode: z.union([
    z.literal('expected'),
    z.literal('expectedMatch'),
    z.literal('error'),
    z.literal('none'),
  ]),
  trailId: z.string(),
});

export type RunExampleComparison = z.infer<typeof runExampleComparisonSchema>;
export type RunExampleComparisonMode = RunExampleComparison['mode'];

interface ActualOutcomeOk {
  readonly outcome: 'ok';
  readonly value: unknown;
}

interface ActualOutcomeErr {
  readonly errorCategory?: string;
  readonly errorClassName: string;
  readonly errorMessage: string;
  readonly outcome: 'err';
}

type ActualOutcome = ActualOutcomeOk | ActualOutcomeErr;

const buildHappyExampleInput = (): {
  readonly exampleName: string;
  readonly id: string;
  readonly module: string;
  readonly rootDir: string;
} => ({
  ...createIsolatedExampleInput('run-example-happy'),
  exampleName: 'Brief capability report',
  id: 'survey.brief',
});

const projectActual = (result: Result<unknown, Error>): ActualOutcome => {
  if (result.isOk()) {
    return { outcome: 'ok', value: result.value };
  }
  const { error } = result;
  return {
    errorClassName: error.constructor.name,
    errorMessage: error.message,
    outcome: 'err',
    ...(error instanceof TrailsError ? { errorCategory: error.category } : {}),
  };
};

const formatLeaf = (value: unknown): string => {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? String(value) : encoded;
  } catch {
    return String(value);
  }
};

const formatPath = (segments: readonly string[]): string =>
  segments.length === 0 ? 'value' : `value.${segments.join('.')}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deepEqualWithDiff = (
  actual: unknown,
  expected: unknown,
  path: readonly string[],
  diffs: string[]
): boolean => {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      diffs.push(`${formatPath(path)}: expected array, got ${typeof actual}`);
      return false;
    }
    if (actual.length !== expected.length) {
      diffs.push(
        `${formatPath(path)}: array length ${actual.length} != ${expected.length}`
      );
      return false;
    }
    let ok = true;
    for (let i = 0; i < expected.length; i += 1) {
      if (
        !deepEqualWithDiff(actual[i], expected[i], [...path, `[${i}]`], diffs)
      ) {
        ok = false;
      }
    }
    return ok;
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      diffs.push(`${formatPath(path)}: expected object, got ${typeof actual}`);
      return false;
    }
    let ok = true;
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) {
        diffs.push(`${formatPath([...path, key])}: missing in actual`);
        ok = false;
        continue;
      }
      if (
        !deepEqualWithDiff(actual[key], expected[key], [...path, key], diffs)
      ) {
        ok = false;
      }
    }
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) {
        diffs.push(`${formatPath([...path, key])}: unexpected key in actual`);
        ok = false;
      }
    }
    return ok;
  }

  if (actual !== expected) {
    if (
      typeof actual === 'number' &&
      typeof expected === 'number' &&
      Number.isNaN(actual) &&
      Number.isNaN(expected)
    ) {
      return true;
    }
    diffs.push(
      `${formatPath(path)}: ${formatLeaf(actual)} != ${formatLeaf(expected)}`
    );
    return false;
  }
  return true;
};

const partialMatchWithDiff = (
  actual: unknown,
  expected: unknown,
  path: readonly string[],
  diffs: string[]
): boolean => {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      diffs.push(`${formatPath(path)}: expected array, got ${typeof actual}`);
      return false;
    }
    let ok = true;
    const consumed = new Set<number>();
    for (const [index, expectedEntry] of expected.entries()) {
      const matchIndex = actual.findIndex((candidate, candidateIndex) => {
        if (consumed.has(candidateIndex)) {
          return false;
        }
        const probe: string[] = [];
        return partialMatchWithDiff(candidate, expectedEntry, [], probe);
      });
      if (matchIndex === -1) {
        diffs.push(
          `${formatPath([...path, `[${index}]`])}: expected array to contain ${formatLeaf(expectedEntry)}`
        );
        ok = false;
        continue;
      }
      consumed.add(matchIndex);
    }
    return ok;
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      diffs.push(`${formatPath(path)}: expected object, got ${typeof actual}`);
      return false;
    }
    let ok = true;
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) {
        diffs.push(`${formatPath([...path, key])}: missing in actual`);
        ok = false;
        continue;
      }
      if (
        !partialMatchWithDiff(actual[key], expected[key], [...path, key], diffs)
      ) {
        ok = false;
      }
    }
    return ok;
  }

  if (actual !== expected) {
    diffs.push(
      `${formatPath(path)}: ${formatLeaf(actual)} != ${formatLeaf(expected)}`
    );
    return false;
  }
  return true;
};

const compareExpected = (
  result: Result<unknown, Error>,
  expected: unknown
): {
  readonly diff?: readonly string[] | undefined;
  readonly match: boolean;
} => {
  if (result.isErr()) {
    return {
      diff: [
        `value: expected Result.ok(...), got Result.err(${result.error.constructor.name}: ${result.error.message})`,
      ],
      match: false,
    };
  }
  const diffs: string[] = [];
  const match = deepEqualWithDiff(result.value, expected, [], diffs);
  return { diff: match ? undefined : diffs, match };
};

const compareExpectedMatch = (
  result: Result<unknown, Error>,
  expectedMatch: unknown
): {
  readonly diff?: readonly string[] | undefined;
  readonly match: boolean;
} => {
  if (result.isErr()) {
    return {
      diff: [
        `value: expected Result.ok(...), got Result.err(${result.error.constructor.name}: ${result.error.message})`,
      ],
      match: false,
    };
  }
  const diffs: string[] = [];
  const match = partialMatchWithDiff(result.value, expectedMatch, [], diffs);
  return { diff: match ? undefined : diffs, match };
};

const compareError = (
  result: Result<unknown, Error>,
  expectedErrorName: string
): {
  readonly diff?: readonly string[] | undefined;
  readonly match: boolean;
} => {
  if (result.isOk()) {
    return {
      diff: [
        `value: expected Result.err(${expectedErrorName}), got Result.ok(${formatLeaf(result.value)})`,
      ],
      match: false,
    };
  }
  const className = result.error.constructor.name;
  if (className === expectedErrorName) {
    return { diff: undefined, match: true };
  }
  return {
    diff: [
      `value: expected Result.err(${expectedErrorName}), got Result.err(${className}: ${result.error.message})`,
    ],
    match: false,
  };
};

const findExample = (
  app: Topo,
  trailId: string,
  exampleName: string
): Result<StructuredTrailExample, Error> => {
  const target = app.get(trailId);
  if (target === undefined) {
    return Result.err(
      new NotFoundError(
        `Trail '${trailId}' was not found in the resolved app.`,
        { context: { trailId } }
      )
    );
  }

  const structured = deriveStructuredTrailExamples(target.examples) ?? [];
  const match = structured.find((entry) => entry.name === exampleName);
  if (match !== undefined) {
    return Result.ok(match);
  }

  const available = structured.map((entry) => entry.name);
  const listing = available.length === 0 ? '<none>' : available.join(', ');
  return Result.err(
    new NotFoundError(
      `Example '${exampleName}' not found on trail '${trailId}'. Available: ${listing}.`,
      {
        context: {
          available,
          exampleName,
          trailId,
        },
      }
    )
  );
};

const determineMode = (
  example: StructuredTrailExample
): RunExampleComparisonMode => {
  if (example.error !== undefined) {
    return 'error';
  }
  if (example.expectedMatch !== undefined) {
    return 'expectedMatch';
  }
  if (example.expected !== undefined) {
    return 'expected';
  }
  return 'none';
};

const buildComparisonEnvelope = async (
  app: Topo,
  trailId: string,
  exampleName: string
): Promise<Result<RunExampleComparison, Error>> => {
  const exampleResult = findExample(app, trailId, exampleName);
  if (exampleResult.isErr()) {
    return Result.err(exampleResult.error);
  }
  const example = exampleResult.value;
  const mode = determineMode(example);
  const executed = await run(app, trailId, example.input);
  const actual = projectActual(executed);

  if (mode === 'error') {
    const expectedName = example.error ?? '';
    const { diff, match } = compareError(executed, expectedName);
    return Result.ok({
      actual,
      diff,
      exampleName,
      expected: { errorClassName: expectedName },
      input: example.input,
      kind: RUN_EXAMPLE_COMPARISON_KIND,
      match,
      mode,
      trailId,
    });
  }
  if (mode === 'expectedMatch') {
    const { diff, match } = compareExpectedMatch(
      executed,
      example.expectedMatch
    );
    return Result.ok({
      actual,
      diff,
      exampleName,
      expected: example.expectedMatch,
      input: example.input,
      kind: RUN_EXAMPLE_COMPARISON_KIND,
      match,
      mode,
      trailId,
    });
  }
  if (mode === 'none') {
    return Result.ok({
      actual,
      exampleName,
      expected: undefined,
      input: example.input,
      kind: RUN_EXAMPLE_COMPARISON_KIND,
      match: true,
      mode,
      trailId,
    });
  }

  const { diff, match } = compareExpected(executed, example.expected);
  return Result.ok({
    actual,
    diff,
    exampleName,
    expected: example.expected,
    input: example.input,
    kind: RUN_EXAMPLE_COMPARISON_KIND,
    match,
    mode,
    trailId,
  });
};

export const runExampleTrail = trail('run.example', {
  args: ['id', 'exampleName'],
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const rootDir = rootDirResult.value;
    const moduleResolution = await resolveRunModulePath(
      rootDir,
      input.module,
      input.id,
      input.app
    );
    if (moduleResolution.isErr()) {
      return moduleResolution;
    }

    const leaseResult = await tryLoadFreshAppLease(
      moduleResolution.value,
      rootDir
    );
    if (leaseResult.isErr()) {
      return leaseResult;
    }
    const lease = leaseResult.value;

    try {
      return await buildComparisonEnvelope(
        lease.app,
        input.id,
        input.exampleName
      );
    } finally {
      lease.release();
    }
  },
  description: 'Run a named example on a trail and compare actual vs expected',
  examples: [
    {
      description: 'Run a named example on a target trail',
      input: buildHappyExampleInput(),
      name: 'Run named example',
    },
  ],
  input: z.object({
    app: z
      .string()
      .optional()
      .describe(
        'Workspace app to resolve the trail ID against; required when the ID is exposed by more than one app'
      ),
    exampleName: z.string().describe('Name of the example to run'),
    id: z.string().describe('Trail ID whose example should run'),
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'write',
  output: runExampleComparisonSchema,
});
