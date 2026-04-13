import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { ConflictError, Result, resource, topo, trail } from '@ontrails/core';
import {
  generateTrailheadMap,
  hashTrailheadMap,
  diffTrailheadMaps,
} from '@ontrails/schema';
import type { TrailheadMap } from '@ontrails/schema';
import { z } from 'zod';

import {
  generateBriefReport,
  generateSurveyList,
  generateTrailDetail,
  surveyTrail,
} from '../trails/survey.js';
import type {
  BriefReport,
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

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const writeSurveyAppFixture = (dir: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
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

export const app = topo('survey-fixture', { dbMain, hello });
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
  test('generateTrailheadMap includes all trails', () => {
    const trailheadMap = generateTrailheadMap(app);
    expect(trailheadMap.entries.length).toBe(3);
    const ids = trailheadMap.entries.map((e) => e.id);
    expect(ids).toContain('hello');
    expect(ids).toContain('bye');
    expect(ids).toContain('db.main');
  });

  test('trailhead map entries have expected fields', () => {
    const trailheadMap = generateTrailheadMap(app);
    const hello = trailheadMap.entries.find((e) => e.id === 'hello');
    expect(hello).toBeDefined();
    expect(hello?.cli?.path).toEqual(['hello']);
    expect(hello?.kind).toBe('trail');
    expect(hello?.intent).toBe('read');
    expect(hello?.exampleCount).toBe(1);
    expect(hello?.resources).toEqual(['db.main']);
  });

  test('JSON output is valid JSON', () => {
    const trailheadMap = generateTrailheadMap(app);
    const json = JSON.stringify(trailheadMap, null, 2);
    const parsed = JSON.parse(json) as TrailheadMap;
    expect(parsed.version).toBe('1.0');
    expect(parsed.entries.length).toBe(3);
  });

  test('hashTrailheadMap produces stable hash', () => {
    const trailheadMap = generateTrailheadMap(app);
    const hash1 = hashTrailheadMap(trailheadMap);
    const hash2 = hashTrailheadMap(trailheadMap);
    expect(hash1).toBe(hash2);
    // SHA-256 hex
    expect(hash1.length).toBe(64);
  });

  test('diffTrailheadMaps detects added trails', () => {
    const prev = generateTrailheadMap(topo('test', { hello: helloTrail }));
    const curr = generateTrailheadMap(app);
    const diff = diffTrailheadMaps(prev, curr);

    expect(diff.info.length).toBeGreaterThan(0);
    const addedBye = diff.info.find((e) => e.id === 'bye');
    expect(addedBye).toBeDefined();
    expect(addedBye?.change).toBe('added');
  });

  test('diffTrailheadMaps detects removed trails', () => {
    const prev = generateTrailheadMap(app);
    const curr = generateTrailheadMap(topo('test', { hello: helloTrail }));
    const diff = diffTrailheadMaps(prev, curr);

    expect(diff.hasBreaking).toBe(true);
    const removedBye = diff.breaking.find((e) => e.id === 'bye');
    expect(removedBye).toBeDefined();
    expect(removedBye?.change).toBe('removed');
  });

  test('diffTrailheadMaps returns empty for identical maps', () => {
    const trailheadMap = generateTrailheadMap(app);
    const diff = diffTrailheadMaps(trailheadMap, trailheadMap);
    expect(diff.entries.length).toBe(0);
    expect(diff.hasBreaking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Brief mode (formerly scout)
// ---------------------------------------------------------------------------

describe('trails survey --brief', () => {
  test('produces a valid capability report', () => {
    const report = generateBriefReport(app);
    expect(report.name).toBe('test-app');
    expect(report.contractVersion).toBe('2026-03');
  });

  test('report includes correct trail count', () => {
    const report = generateBriefReport(app);
    expect(report.trails).toBe(2);
    expect(report.signals).toBe(0);
    expect(report.resources).toBe(1);
  });

  test('detects features in use', () => {
    const report = generateBriefReport(app);
    expect(report.features.outputSchemas).toBe(true);
    expect(report.features.examples).toBe(true);
    expect(report.features.detours).toBe(true);
    expect(report.features.signals).toBe(false);
    expect(report.features.resources).toBe(true);
  });

  test('JSON output is valid', () => {
    const report = generateBriefReport(app);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json) as BriefReport;
    expect(parsed.name).toBe('test-app');
    expect(parsed.trails).toBe(2);
    expect(parsed.resources).toBe(1);
  });

  test('empty app reports zero features', () => {
    const emptyApp = topo('empty', {});
    const report = generateBriefReport(emptyApp);
    expect(report.trails).toBe(0);
    expect(report.features.outputSchemas).toBe(false);
    expect(report.features.examples).toBe(false);
    expect(report.features.detours).toBe(false);
    expect(report.features.resources).toBe(false);
  });
});

describe('trails survey detail', () => {
  test('trail detail includes declared resources, crossings, and intent', () => {
    const detail = generateTrailDetail(helloTrail);
    const parsed = structuredClone(detail) as TrailDetailReport;

    expect(parsed.crosses).toEqual([]);
    expect(parsed.intent).toBe('read');
    expect(parsed.resources).toEqual(['db.main']);
  });
});

describe('trails survey resources section', () => {
  test('list output includes resource lifetime and health status', () => {
    const report = generateSurveyList(app);
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
      };

      expect(generated.hash).toHaveLength(64);
      expect(existsSync(join(dir, '.trails', '_trailhead.json'))).toBe(true);
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
