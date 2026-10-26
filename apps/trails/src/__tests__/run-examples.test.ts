/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk/isErr */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ActionResultContext } from '@ontrails/cli';
import {
  NotFoundError,
  Result,
  ValidationError,
  executeTrail,
  trail,
} from '@ontrails/core';
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
  description: 'stub run trail for examples-listing tests',
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
  executedAppId: 'app-a',
  kind: RUN_EXAMPLES_LISTING_KIND,
  project: {
    app: {
      appRoot: '.',
      artifactPath: '/project/trails.lock',
      configured: false,
      modulePath: 'src/app.ts',
      moduleSource: 'convention',
    },
    configuredAppIds: [],
    projectRoot: '/project',
    selectedExtent: 'standalone-app',
    selectionProvenance: 'root-dir',
  },
  trailId: 'run',
});

const renderExamples = async (
  examples: readonly StructuredTrailExample[]
): Promise<string> => {
  const ctx = buildCtx(stubRunTrail, {}, Result.ok(buildListing(examples)));
  const io = await withCapturedIO(() => {
    expect(tryExamplesRunOutput(ctx)).toBe(true);
  });
  return io.stdout.join('');
};

const renderPreview = async (input?: unknown): Promise<string> => {
  const table = await renderExamples([
    { ...successExample, input, name: 'Row' },
  ]);
  const row = table.split('\n')[1] ?? '';
  return row.slice(6, -4).trimEnd();
};

const stringFallback = (value: string): unknown => ({
  toJSON: () => {
    throw new Error('Not JSON serializable');
  },
  toString: () => value,
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
        implementation: () => Result.ok(),
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

  test('json mode emits examples with selected project provenance', async () => {
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
    expect(parsed).toMatchObject({
      examples: [
        { kind: 'success', name: 'Run trail by ID' },
        {
          error: 'NotFoundError',
          kind: 'error',
          name: 'Reject unknown trail ID',
        },
      ],
      project: {
        projectRoot: '/project',
        selectedExtent: 'standalone-app',
      },
    });
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
    expect(JSON.parse(io.stdout.join(''))).toMatchObject({ examples: [] });
  });

  test('jsonl mode emits one provenance-bearing listing', async () => {
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
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      examples: [
        { kind: 'success', name: 'Run trail by ID' },
        { kind: 'error', name: 'Reject unknown trail ID' },
      ],
      project: { selectedExtent: 'standalone-app' },
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

  describe('terminal-cell formatting', () => {
    test('preserves the ordinary ASCII table bytes', async () => {
      expect(await renderExamples([successExample, errorExample])).toBe(
        'NAME                     INPUT      OUTCOME\n' +
          'Run trail by ID          {"id":""}  ok\n' +
          'Reject unknown trail ID  {"id":""}  error: NotFoundError\n'
      );
      expect(await renderPreview({ id: 'x'.repeat(200) })).toBe(
        `{"id":"${'x'.repeat(52)}…`
      );
    });

    test.each([0, 59, 60, 61])(
      'preserves ASCII preview bytes at length %i',
      async (length) => {
        const input = 'x'.repeat(length);
        expect(await renderPreview(stringFallback(input))).toBe(
          length <= 60 ? input : `${'x'.repeat(59)}…`
        );
      }
    );

    test.each([
      ['emoji', '😀'],
      ['ZWJ emoji', '👩‍👩‍👧‍👦'],
      ['combining marks', 'e\u0301'],
      ['CJK', '漢字'],
      ['zero-width characters', 'a\u200Bb\u200Dc'],
      ['ANSI color', '\u001B[31mred\u001B[0m'],
    ])('aligns %s names and inputs by display cells', async (_, value) => {
      const table = await renderExamples([
        { ...successExample, input: value, name: value },
        { ...successExample, input: 'x', name: 'ordinary' },
      ]);
      const lines = table.trimEnd().split('\n');
      const nameWidth = Math.max(8, Bun.stringWidth(value));
      const inputWidth = Math.max(5, Bun.stringWidth(JSON.stringify(value)));
      const inputOffsets = lines
        .slice(1)
        .map((line) => Bun.stringWidth(line.slice(0, line.indexOf('"'))));
      const outcomeOffsets = lines.map((line, index) =>
        Bun.stringWidth(
          line.slice(0, line.lastIndexOf(index === 0 ? 'OUTCOME' : 'ok'))
        )
      );
      expect(inputOffsets).toEqual([nameWidth + 2, nameWidth + 2]);
      expect(outcomeOffsets).toEqual(
        Array.from({ length: 3 }, () => nameWidth + inputWidth + 4)
      );
      expect(table).toContain(value);
    });

    test.each(['😀', '👩‍👩‍👧‍👦', 'e\u0301', '漢'])(
      'truncates repeated %s only at intact display boundaries',
      async (value) => {
        const preview = await renderPreview(value.repeat(100));
        const graphemes = [
          ...new Intl.Segmenter().segment(preview.slice(1, -1)),
        ].map(({ segment }) => segment);
        expect(preview.startsWith('"')).toBe(true);
        expect(preview.endsWith('…')).toBe(true);
        expect(Bun.stringWidth(preview)).toBeLessThanOrEqual(60);
        expect(preview.isWellFormed()).toBe(true);
        expect(graphemes.length).toBeGreaterThan(0);
        expect(graphemes.every((grapheme) => grapheme === value)).toBe(true);
      }
    );

    test('keeps combining previews that already fit without an ellipsis', async () => {
      const input = 'e\u0301'.repeat(40);
      expect(await renderPreview(input)).toBe(JSON.stringify(input));
    });

    test('keeps empty, zero-width and ANSI-only previews intact', async () => {
      for (const input of ['', '\u200B'.repeat(100), '\u001B[31m\u001B[0m']) {
        expect(await renderPreview(stringFallback(input))).toBe(input);
      }
      expect(await renderPreview()).toBe('');
    });

    test.each(['漢', '👩‍👩‍👧‍👦'])(
      'reserves the ellipsis cell at wide %s boundaries',
      async (value) => {
        const preview = await renderPreview(stringFallback(value.repeat(100)));
        expect(preview).toBe(`${value.repeat(29)}…`);
        expect(Bun.stringWidth(preview)).toBe(59);
        expect(preview.isWellFormed()).toBe(true);
      }
    );

    test('preserves styles and closes ANSI sequences before the next column', async () => {
      const preview = await renderPreview(
        stringFallback(`\u001B[1m\u001B[31m${'漢'.repeat(100)}\u001B[0m`)
      );
      expect(Bun.stripANSI(preview)).toBe(`${'漢'.repeat(29)}…`);
      expect(preview).toStartWith('\u001B[1m\u001B[31m');
      expect(preview).toEndWith('…\u001B[39m\u001B[22m');
      expect(Bun.stripANSI(preview)).not.toContain('\u001B');
      expect(Bun.stringWidth(preview)).toBe(59);
    });

    test('does not cut an ANSI escape or an emoji surrogate pair', async () => {
      const emojiPreview = await renderPreview(`${'x'.repeat(57)}😀tail`);
      expect(emojiPreview.isWellFormed()).toBe(true);
      const preview = await renderPreview(
        stringFallback(`\u001B[31m${'x'.repeat(200)}\u001B[0m`)
      );
      expect(Bun.stripANSI(preview)).toBe(`${'x'.repeat(59)}…`);
      expect(preview).toEndWith('\u001B[39m');
    });

    test('keeps a complete color escape where code-unit truncation would split it', async () => {
      const preview = await renderPreview(
        stringFallback(
          `${'x'.repeat(57)}\u001B[38;2;120;80;10m${'😀'.repeat(20)}\u001B[0m`
        )
      );
      expect(Bun.stripANSI(preview)).toBe(`${'x'.repeat(57)}😀…`);
      expect(Bun.stripANSI(preview)).not.toContain('\u001B');
      expect(preview).toContain('\u001B[38;2;120;80;10m');
      expect(preview).toEndWith('\u001B[39m');
      expect(Bun.stringWidth(preview)).toBe(60);
    });

    test.each(['json', 'jsonl'])(
      'retains full Unicode/ANSI authored values in %s output',
      async (mode) => {
        const example = {
          ...successExample,
          input: 'e\u0301'.repeat(100),
          name: '\u001B[31m漢字👩‍👩‍👧‍👦\u001B[0m',
        };
        const ctx = buildCtx(
          stubRunTrail,
          { [mode]: true },
          Result.ok(buildListing([example]))
        );
        const io = await withCapturedIO(() =>
          expect(tryExamplesRunOutput(ctx)).toBe(true)
        );
        expect(JSON.parse(io.stdout.join(''))).toMatchObject({
          examples: [example],
        });
      }
    );

    test.each([0, 1, 4, 20, 80])(
      'keeps stable output at terminal width %i',
      async (columns) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          process.stdout,
          'columns'
        );
        Object.defineProperty(process.stdout, 'columns', {
          configurable: true,
          value: columns,
        });
        try {
          expect(await renderExamples([successExample, errorExample])).toBe(
            'NAME                     INPUT      OUTCOME\n' +
              'Run trail by ID          {"id":""}  ok\n' +
              'Reject unknown trail ID  {"id":""}  error: NotFoundError\n'
          );
          expect(
            Bun.stringWidth(await renderPreview('漢'.repeat(100)))
          ).toBeLessThanOrEqual(60);
        } finally {
          if (descriptor === undefined) {
            Reflect.deleteProperty(process.stdout, 'columns');
          } else {
            Object.defineProperty(process.stdout, 'columns', descriptor);
          }
        }
      }
    );
  });
});

// ---------------------------------------------------------------------------
// run.examples implementation (workspace-fixture integration)
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
  if (apps.length > 1) {
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
  }

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
  test('discovers a sole nested standalone app without --module', async () => {
    writeWorkspace(workspaceRoot, [
      {
        examplesByTrail: {
          'demo.alpha': [{ description: 'happy path', name: 'Alpha happy' }],
        },
        name: 'app-a',
        trailIds: ['demo.alpha'],
      },
    ]);

    const result = await executeTrail(runExamplesTrail, {
      id: 'demo.alpha',
      rootDir: workspaceRoot,
    });

    const value = expectOk(result) as RunExamplesListing;
    expect(value.trailId).toBe('demo.alpha');
    expect(value.examples.map((example) => example.name)).toEqual([
      'Alpha happy',
    ]);
    expect(value.executedAppId).toBe('app-a');
    expect(value.project).toMatchObject({
      projectRoot: workspaceRoot,
      selectedExtent: 'standalone-app',
      selectionProvenance: 'root-dir',
    });
  });

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
    expect(value.executedAppId).toBe('app-b');
    expect(value.project).toMatchObject({
      app: { appId: 'app-b', appRoot: 'apps/app-b' },
      projectRoot: workspaceRoot,
      selectedExtent: 'configured-app',
      selectionProvenance: 'app',
    });
  });

  test('lists configured examples without reading the selected saved lock', async () => {
    writeWorkspace(workspaceRoot, [
      {
        examplesByTrail: {
          'demo.alpha': [{ name: 'Alpha happy' }],
        },
        name: 'app-a',
        trailIds: ['demo.alpha'],
      },
    ]);
    writeFixture(
      join(workspaceRoot, 'trails.config.json'),
      `${JSON.stringify({ workspace: { apps: { 'app-a': { root: 'apps/app-a' } } } }, null, 2)}\n`
    );
    mkdirSync(join(workspaceRoot, 'apps/app-a/trails.lock'));

    const result = await executeTrail(runExamplesTrail, {
      app: 'app-a',
      id: 'demo.alpha',
      rootDir: workspaceRoot,
    });

    const value = expectOk(result) as RunExamplesListing;
    expect(value.examples.map((example) => example.name)).toEqual([
      'Alpha happy',
    ]);
    expect(value.project).toMatchObject({
      app: { appId: 'app-a' },
      selectedExtent: 'configured-app',
    });
  });

  test('preserves configured selection from a nested CWD without root-dir', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['alpha.only'] },
      {
        examplesByTrail: {
          'beta.only': [{ name: 'Beta example' }],
        },
        name: 'app-b',
        trailIds: ['beta.only'],
      },
    ]);

    const result = await executeTrail(
      runExamplesTrail,
      { id: 'beta.only' },
      { ctx: { cwd: join(workspaceRoot, 'apps', 'app-b', 'src') } }
    );

    const value = expectOk(result) as RunExamplesListing;
    expect(value.examples.map((example) => example.name)).toEqual([
      'Beta example',
    ]);
  });

  test('revalidates configured app identity on the listing lease', async () => {
    writeWorkspace(workspaceRoot, [
      {
        examplesByTrail: { 'demo.reload': [{ name: 'Reload' }] },
        name: 'app-a',
        trailIds: ['demo.reload'],
      },
    ]);
    writeFixture(
      join(workspaceRoot, 'trails.config.json'),
      `${JSON.stringify({ workspace: { apps: { 'app-a': { root: 'apps/app-a' } } } }, null, 2)}\n`
    );
    const modulePath = join(workspaceRoot, 'apps/app-a/src/app.ts');
    const counterKey = `run-examples-binding-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    writeFileSync(
      modulePath,
      readFileSync(modulePath, 'utf8').replace(
        "  name: 'app-a',",
        `  name: ((globalThis[${JSON.stringify(counterKey)}] = ((globalThis[${JSON.stringify(counterKey)}] ?? 0) + 1)) === 1 ? 'app-a' : 'other'),`
      )
    );

    const result = await executeTrail(runExamplesTrail, {
      app: 'app-a',
      id: 'demo.reload',
      rootDir: workspaceRoot,
    });

    const error = expectErr(result);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Configured app "app-a"');
    expect(error.message).toContain('loaded topo "other"');
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
