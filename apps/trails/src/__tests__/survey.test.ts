import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import {
  ConflictError,
  Result,
  resource,
  signal,
  topo,
  trail,
} from '@ontrails/core';
import {
  deriveSurfaceMap,
  deriveSurfaceMapHash,
  deriveSurfaceMapDiff,
  writeSurfaceMap,
} from '@ontrails/schema';
import type { SurfaceMap } from '@ontrails/schema';
import { z } from 'zod';

import {
  deriveBriefReport,
  deriveSignalDetail,
  deriveSurveyList,
  deriveTrailDetail,
  surveyResourceTrail,
  surveySignalTrail,
  surveyTrail,
  surveyTrailDetailTrail,
} from '../trails/survey.js';
import { loadApp } from '../trails/load-app.js';
import type {
  BriefReport,
  SignalDetailReport,
  SurveyListReport,
  TrailDetailReport,
} from '../trails/survey.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const helloTrail = trail('hello', {
  blaze: (input) => {
    const name = input.name ?? 'world';
    return Result.ok({ message: `Hello, ${name}!` });
  },
  description: 'Say hello',
  detours: [
    {
      on: ConflictError,
      /* oxlint-disable-next-line require-await -- test stub */
      recover: async () => Result.ok({ message: 'recovered' }),
    },
  ],
  examples: [
    {
      expected: { message: 'Hello, world!' },
      input: {},
      name: 'Default greeting',
    },
  ],
  input: z.object({ name: z.string().optional() }),
  intent: 'read',
  output: z.object({ message: z.string() }),
  resources: [
    resource('db.main', {
      create: () => Result.ok({ source: 'factory' }),
    }),
  ],
});

const byeTrail = trail('bye', {
  blaze: (input) => Result.ok({ message: `Goodbye, ${input.name}!` }),
  description: 'Say goodbye',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
});

const [dbResource] = helloTrail.resources;
if (!dbResource) {
  throw new Error('Expected helloTrail to declare db.main');
}

const app = topo('test-app', {
  bye: byeTrail,
  dbResource,
  hello: helloTrail,
});

const helloGreeted = signal('hello.greeted', {
  description: 'A greeting was produced',
  examples: [{ name: 'Ada' }],
  from: ['signal.producer'],
  payload: z.object({ name: z.string() }),
});

const signalProducer = trail('signal.producer', {
  blaze: (input) => Result.ok({ name: input.name }),
  fires: [helloGreeted],
  input: z.object({ name: z.string() }),
  output: z.object({ name: z.string() }),
});

const signalConsumer = trail('signal.consumer', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  on: [helloGreeted],
  output: z.object({ ok: z.boolean() }),
});

const signalApp = topo('signal-app', {
  helloGreeted,
  signalConsumer,
  signalProducer,
});

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const writeSurveyAppFixture = (
  dir: string,
  options?: { withBye?: boolean }
) => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  const byeSource = options?.withBye
    ? `
const bye = trail('bye', {
  blaze: async (input) => Result.ok({ message: \`Bye, \${input.name ?? 'world'}!\` }),
  input: z.object({ name: z.string().optional() }),
  intent: 'read',
  output: z.object({ message: z.string() }),
});
`
    : '';
  const topoMembers = options?.withBye
    ? '{ bye, dbMain, hello }'
    : '{ dbMain, hello }';
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, resource, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  blaze: async (input) => Result.ok({ message: \`Hello, \${input.name ?? 'world'}!\` }),
  input: z.object({ name: z.string().optional() }),
  intent: 'read',
  output: z.object({ message: z.string() }),
  resources: [
    resource('db.main', {
      create: () => Result.ok({ source: 'factory' }),
    }),
  ],
});

const [dbMain] = hello.resources;
if (!dbMain) {
  throw new Error('expected hello to declare db.main');
}

${byeSource}

export const app = topo('survey-fixture', ${topoMembers});
`
  );
};

const writeMultiMatchAppFixture = (dir: string) => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, resource, signal, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const sharedResource = resource('shared', {
  create: () => Result.ok({ source: 'factory' }),
});

const sharedSignal = signal('shared', {
  payload: z.object({ ok: z.boolean() }),
});

const sharedTrail = trail('shared', {
  blaze: async () => Result.ok({ ok: true }),
  fires: [sharedSignal],
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
  resources: [sharedResource],
});

export const app = topo('multi-match-fixture', {
  sharedResource,
  sharedSignal,
  sharedTrail,
});
`
  );
};

const repoTempDir = (): string =>
  join(
    resolve(import.meta.dir, '../..'),
    '.tmp-tests',
    `trails-survey-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trails survey', () => {
  test('deriveSurfaceMap includes all trails', () => {
    const surfaceMap = deriveSurfaceMap(app);
    expect(surfaceMap.entries.length).toBe(3);
    const ids = surfaceMap.entries.map((e) => e.id);
    expect(ids).toContain('hello');
    expect(ids).toContain('bye');
    expect(ids).toContain('db.main');
  });

  test('surface map entries have expected fields', () => {
    const surfaceMap = deriveSurfaceMap(app);
    const hello = surfaceMap.entries.find((e) => e.id === 'hello');
    expect(hello).toBeDefined();
    expect(hello?.cli?.path).toEqual(['hello']);
    expect(hello?.kind).toBe('trail');
    expect(hello?.intent).toBe('read');
    expect(hello?.exampleCount).toBe(1);
    expect(hello?.resources).toEqual(['db.main']);
  });

  test('JSON output is valid JSON', () => {
    const surfaceMap = deriveSurfaceMap(app);
    const json = JSON.stringify(surfaceMap, null, 2);
    const parsed = JSON.parse(json) as SurfaceMap;
    expect(parsed.version).toBe('1.0');
    expect(parsed.entries.length).toBe(3);
  });

  test('deriveSurfaceMapHash produces stable hash', () => {
    const surfaceMap = deriveSurfaceMap(app);
    const hash1 = deriveSurfaceMapHash(surfaceMap);
    const hash2 = deriveSurfaceMapHash(surfaceMap);
    expect(hash1).toBe(hash2);
    // SHA-256 hex
    expect(hash1.length).toBe(64);
  });

  test('deriveSurfaceMapDiff detects added trails', () => {
    const prev = deriveSurfaceMap(topo('test', { hello: helloTrail }));
    const curr = deriveSurfaceMap(app);
    const diff = deriveSurfaceMapDiff(prev, curr);

    expect(diff.info.length).toBeGreaterThan(0);
    const addedBye = diff.info.find((e) => e.id === 'bye');
    expect(addedBye).toBeDefined();
    expect(addedBye?.change).toBe('added');
  });

  test('deriveSurfaceMapDiff detects removed trails', () => {
    const prev = deriveSurfaceMap(app);
    const curr = deriveSurfaceMap(topo('test', { hello: helloTrail }));
    const diff = deriveSurfaceMapDiff(prev, curr);

    expect(diff.hasBreaking).toBe(true);
    const removedBye = diff.breaking.find((e) => e.id === 'bye');
    expect(removedBye).toBeDefined();
    expect(removedBye?.change).toBe('removed');
  });

  test('deriveSurfaceMapDiff returns empty for identical maps', () => {
    const surfaceMap = deriveSurfaceMap(app);
    const diff = deriveSurfaceMapDiff(surfaceMap, surfaceMap);
    expect(diff.entries.length).toBe(0);
    expect(diff.hasBreaking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Brief mode (formerly scout)
// ---------------------------------------------------------------------------

describe('trails survey --brief', () => {
  test('produces a valid capability report', () => {
    const report = deriveBriefReport(app);
    expect(report.name).toBe('test-app');
    expect(report.contractVersion).toBe('2026-03');
  });

  test('report includes correct trail count', () => {
    const report = deriveBriefReport(app);
    expect(report.trails).toBe(2);
    expect(report.signals).toBe(0);
    expect(report.resources).toBe(1);
  });

  test('detects features in use', () => {
    const report = deriveBriefReport(app);
    expect(report.features.outputSchemas).toBe(true);
    expect(report.features.examples).toBe(true);
    expect(report.features.detours).toBe(true);
    expect(report.features.signals).toBe(false);
    expect(report.features.resources).toBe(true);
  });

  test('JSON output is valid', () => {
    const report = deriveBriefReport(app);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json) as BriefReport;
    expect(parsed.name).toBe('test-app');
    expect(parsed.trails).toBe(2);
    expect(parsed.resources).toBe(1);
  });

  test('empty app reports zero features', () => {
    const emptyApp = topo('empty', {});
    const report = deriveBriefReport(emptyApp);
    expect(report.trails).toBe(0);
    expect(report.features.outputSchemas).toBe(false);
    expect(report.features.examples).toBe(false);
    expect(report.features.detours).toBe(false);
    expect(report.features.resources).toBe(false);
  });
});

describe('trails survey detail', () => {
  test('trail detail includes declared resources, crossings, and intent', () => {
    const detail = deriveTrailDetail(helloTrail);
    const parsed = structuredClone(detail) as TrailDetailReport;

    expect(parsed.crosses).toEqual([]);
    expect(parsed.intent).toBe('read');
    expect(parsed.resources).toEqual(['db.main']);
  });
});

describe('trails survey lookup', () => {
  test('isolated survey examples keep their rootDir through input validation', () => {
    const overviewExample = surveyTrail.examples?.find(
      (example) => example.name === 'Overview'
    );
    const detailExample = surveyTrailDetailTrail.examples?.find(
      (example) => example.name === 'Trail detail'
    );
    const overviewInput = overviewExample?.input as
      | { readonly module?: string; readonly rootDir?: string }
      | undefined;
    const detailInput = detailExample?.input as
      | { readonly module?: string; readonly rootDir?: string }
      | undefined;

    expect(overviewInput?.rootDir).toBeDefined();
    expect(detailInput?.rootDir).toBeDefined();

    const parsedOverview = surveyTrail.input.safeParse(overviewInput);
    const parsedDetail = surveyTrailDetailTrail.input.safeParse(detailInput);

    expect(parsedOverview.success).toBe(true);
    expect(parsedDetail.success).toBe(true);
    if (parsedOverview.success && parsedDetail.success) {
      expect(parsedOverview.data.rootDir).toBe(overviewInput?.rootDir);
      expect(parsedDetail.data.rootDir).toBe(detailInput?.rootDir);
    }
  });

  test('bare survey returns the overview shape', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const overview = expectOk(
        await surveyTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );

      expect(overview).toMatchObject({
        count: 1,
        mode: 'overview',
        resourceCount: 1,
        signalCount: 0,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('id lookup returns all matching entity kinds', async () => {
    const dir = repoTempDir();

    try {
      writeMultiMatchAppFixture(dir);

      const lookup = expectOk(
        await surveyTrail.blaze({ id: 'shared', module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly matches: readonly {
          readonly detail: { readonly id: string };
          readonly kind: string;
        }[];
        readonly mode: 'lookup';
      };

      expect(lookup.mode).toBe('lookup');
      expect(lookup.matches.map((match) => match.kind)).toEqual([
        'trail',
        'resource',
        'signal',
      ]);
      expect(
        lookup.matches.every((match) => match.detail.id === 'shared')
      ).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('id lookup returns an empty match list when nothing matches', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const lookup = expectOk(
        await surveyTrail.blaze({ id: 'missing', module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly matches: readonly unknown[];
        readonly mode: 'lookup';
      };

      expect(lookup).toEqual({ matches: [], mode: 'lookup' });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('typed survey accessors return one kind or NotFound', async () => {
    const dir = repoTempDir();

    try {
      writeMultiMatchAppFixture(dir);

      const trailDetail = expectOk(
        await surveyTrailDetailTrail.blaze(
          { id: 'shared', module: './src/app.ts' },
          { cwd: dir } as never
        )
      );
      expect(trailDetail.kind).toBe('trail');

      const resourceDetail = expectOk(
        await surveyResourceTrail.blaze(
          { id: 'shared', module: './src/app.ts' },
          { cwd: dir } as never
        )
      );
      expect(resourceDetail.kind).toBe('resource');

      const signalDetail = expectOk(
        await surveySignalTrail.blaze(
          { id: 'shared', module: './src/app.ts' },
          { cwd: dir } as never
        )
      );
      expect(signalDetail.kind).toBe('signal');

      const missing = await surveyTrailDetailTrail.blaze(
        { id: 'missing', module: './src/app.ts' },
        { cwd: dir } as never
      );
      expect(missing.isErr()).toBe(true);
      expect(missing.error.message).toBe('Trail not found: missing');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('trails survey resources section', () => {
  test('list output includes resource lifetime and health status', () => {
    const report = deriveSurveyList(app);
    const parsed = structuredClone(report) as SurveyListReport;
    const db = parsed.resources.find((entry) => entry.id === 'db.main');

    expect(parsed.resourceCount).toBe(1);
    expect(db).toEqual({
      description: null,
      health: 'none',
      id: 'db.main',
      kind: 'resource',
      lifetime: 'singleton',
      usedBy: ['hello'],
    });
  });
});

describe('trails survey signals section', () => {
  test('list output includes signal examples and graph relations', () => {
    const report = deriveSurveyList(signalApp);
    const parsed = structuredClone(report) as SurveyListReport;
    const entry = parsed.signals.find(
      (signalEntry) => signalEntry.id === 'hello.greeted'
    );

    expect(parsed.signalCount).toBe(1);
    expect(entry).toEqual({
      consumers: ['signal.consumer'],
      description: 'A greeting was produced',
      examples: 1,
      from: ['signal.producer'],
      id: 'hello.greeted',
      kind: 'signal',
      payloadSchema: true,
      producers: ['signal.producer'],
    });
  });

  test('signal detail includes payload schema, examples, and relations', () => {
    const detail = deriveSignalDetail(signalApp, 'hello.greeted');
    const parsed = structuredClone(detail) as SignalDetailReport;

    expect(parsed).toMatchObject({
      consumers: ['signal.consumer'],
      description: 'A greeting was produced',
      examples: [{ name: 'Ada' }],
      from: ['signal.producer'],
      id: 'hello.greeted',
      kind: 'signal',
      producers: ['signal.producer'],
    });
    expect(parsed.payload).toMatchObject({
      properties: { name: { type: 'string' } },
      type: 'object',
    });
  });
});

describe('trails survey generate', () => {
  test('delegates to topo export and writes a structured lock', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const generated = expectOk(
        await surveyTrail.blaze({ generate: true, module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly hash: string;
        readonly lockPath: string;
        readonly mapPath: string;
        readonly mode: 'generate';
      };

      expect(generated.mode).toBe('generate');
      expect(generated.hash).toHaveLength(64);
      expect(existsSync(join(dir, '.trails', '_surface.json'))).toBe(true);
      expect(existsSync(join(dir, '.trails', 'trails.lock'))).toBe(true);
      expect(
        JSON.parse(readFileSync(join(dir, '.trails', 'trails.lock'), 'utf8'))
      ).toMatchObject({
        hash: generated.hash,
        version: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('trails survey diffSaved', () => {
  test('returns an error when no saved surface map exists yet', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const result = await surveyTrail.blaze(
        { diffSaved: true, module: './src/app.ts' },
        { cwd: dir } as never
      );

      expect(result.isErr()).toBe(true);
      expect(result.error.message).toContain('Run `trails topo export` first');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('diffs against the saved local surface map', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeSurfaceMap(deriveSurfaceMap(baselineApp), {
        dir: join(dir, '.trails'),
      });

      writeSurveyAppFixture(dir, { withBye: true });

      const result = await surveyTrail.blaze(
        { diffSaved: true, module: './src/app.ts' },
        { cwd: dir } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value).toMatchObject({
        hasBreaking: false,
        info: [
          expect.objectContaining({
            change: 'added',
            id: 'bye',
          }),
        ],
        mode: 'diff',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('trails survey output schema', () => {
  test('uses mode as the public discriminant', () => {
    expect(
      surveyTrail.output.safeParse({
        ...deriveSurveyList(app),
        mode: 'overview',
      }).success
    ).toBe(true);
    expect(
      surveyTrail.output.safeParse({
        ...deriveBriefReport(app),
        mode: 'brief',
      }).success
    ).toBe(true);
    expect(
      surveyTrail.output.safeParse({
        matches: [
          { detail: deriveTrailDetail(helloTrail), kind: 'trail' },
          {
            detail: {
              description: null,
              health: 'none',
              id: 'db.main',
              kind: 'resource',
              lifetime: 'singleton',
              usedBy: ['hello'],
            },
            kind: 'resource',
          },
          {
            detail: deriveSignalDetail(signalApp, 'hello.greeted'),
            kind: 'signal',
          },
        ],
        mode: 'lookup',
      }).success
    ).toBe(true);
    expect(
      surveyTrail.output.safeParse({
        breaking: [],
        hasBreaking: false,
        info: [],
        mode: 'diff',
        warnings: [],
      }).success
    ).toBe(true);
    expect(
      surveyTrail.output.safeParse({
        hash: 'a'.repeat(64),
        lockPath: '.trails/trails.lock',
        mapPath: '.trails/_surface.json',
        mode: 'generate',
      }).success
    ).toBe(true);
    expect(
      surveyTrailDetailTrail.output.safeParse(deriveTrailDetail(helloTrail))
        .success
    ).toBe(true);
    expect(
      surveyResourceTrail.output.safeParse({
        description: null,
        health: 'none',
        id: 'db.main',
        kind: 'resource',
        lifetime: 'singleton',
        usedBy: ['hello'],
      }).success
    ).toBe(true);
    expect(
      surveySignalTrail.output.safeParse(
        deriveSignalDetail(signalApp, 'hello.greeted')
      ).success
    ).toBe(true);
  });
});
