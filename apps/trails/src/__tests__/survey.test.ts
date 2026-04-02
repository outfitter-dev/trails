import { describe, expect, test } from 'bun:test';

import { Result, service, topo, trail } from '@ontrails/core';
import {
  generateSurfaceMap,
  hashSurfaceMap,
  diffSurfaceMaps,
} from '@ontrails/schema';
import type { SurfaceMap } from '@ontrails/schema';
import { z } from 'zod';

import {
  generateBriefReport,
  generateSurveyList,
  generateTrailDetail,
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
  detours: {
    NotFoundError: ['search'],
  },
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
  services: [
    service('db.main', {
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

const [dbService] = helloTrail.services;
if (!dbService) {
  throw new Error('Expected helloTrail to declare db.main');
}

const app = topo('test-app', {
  bye: byeTrail,
  dbService,
  hello: helloTrail,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trails survey', () => {
  test('generateSurfaceMap includes all trails', () => {
    const surfaceMap = generateSurfaceMap(app);
    expect(surfaceMap.entries.length).toBe(3);
    const ids = surfaceMap.entries.map((e) => e.id);
    expect(ids).toContain('hello');
    expect(ids).toContain('bye');
    expect(ids).toContain('db.main');
  });

  test('surface map entries have expected fields', () => {
    const surfaceMap = generateSurfaceMap(app);
    const hello = surfaceMap.entries.find((e) => e.id === 'hello');
    expect(hello).toBeDefined();
    expect(hello?.kind).toBe('trail');
    expect(hello?.intent).toBe('read');
    expect(hello?.exampleCount).toBe(1);
    expect(hello?.services).toEqual(['db.main']);
  });

  test('JSON output is valid JSON', () => {
    const surfaceMap = generateSurfaceMap(app);
    const json = JSON.stringify(surfaceMap, null, 2);
    const parsed = JSON.parse(json) as SurfaceMap;
    expect(parsed.version).toBe('1.0');
    expect(parsed.entries.length).toBe(3);
  });

  test('hashSurfaceMap produces stable hash', () => {
    const surfaceMap = generateSurfaceMap(app);
    const hash1 = hashSurfaceMap(surfaceMap);
    const hash2 = hashSurfaceMap(surfaceMap);
    expect(hash1).toBe(hash2);
    // SHA-256 hex
    expect(hash1.length).toBe(64);
  });

  test('diffSurfaceMaps detects added trails', () => {
    const prev = generateSurfaceMap(topo('test', { hello: helloTrail }));
    const curr = generateSurfaceMap(app);
    const diff = diffSurfaceMaps(prev, curr);

    expect(diff.info.length).toBeGreaterThan(0);
    const addedBye = diff.info.find((e) => e.id === 'bye');
    expect(addedBye).toBeDefined();
    expect(addedBye?.change).toBe('added');
  });

  test('diffSurfaceMaps detects removed trails', () => {
    const prev = generateSurfaceMap(app);
    const curr = generateSurfaceMap(topo('test', { hello: helloTrail }));
    const diff = diffSurfaceMaps(prev, curr);

    expect(diff.hasBreaking).toBe(true);
    const removedBye = diff.breaking.find((e) => e.id === 'bye');
    expect(removedBye).toBeDefined();
    expect(removedBye?.change).toBe('removed');
  });

  test('diffSurfaceMaps returns empty for identical maps', () => {
    const map = generateSurfaceMap(app);
    const diff = diffSurfaceMaps(map, map);
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
    expect(report.events).toBe(0);
    expect(report.services).toBe(1);
  });

  test('detects features in use', () => {
    const report = generateBriefReport(app);
    expect(report.features.outputSchemas).toBe(true);
    expect(report.features.examples).toBe(true);
    expect(report.features.detours).toBe(true);
    expect(report.features.events).toBe(false);
    expect(report.features.services).toBe(true);
  });

  test('JSON output is valid', () => {
    const report = generateBriefReport(app);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json) as BriefReport;
    expect(parsed.name).toBe('test-app');
    expect(parsed.trails).toBe(2);
    expect(parsed.services).toBe(1);
  });

  test('empty app reports zero features', () => {
    const emptyApp = topo('empty', {});
    const report = generateBriefReport(emptyApp);
    expect(report.trails).toBe(0);
    expect(report.features.outputSchemas).toBe(false);
    expect(report.features.examples).toBe(false);
    expect(report.features.detours).toBe(false);
    expect(report.features.services).toBe(false);
  });
});

describe('trails survey detail', () => {
  test('trail detail includes declared services, follow, and intent', () => {
    const detail = generateTrailDetail(helloTrail);
    const parsed = structuredClone(detail) as TrailDetailReport;

    expect(parsed.follow).toEqual([]);
    expect(parsed.intent).toBe('read');
    expect(parsed.services).toEqual(['db.main']);
  });
});

describe('trails survey services section', () => {
  test('list output includes service lifetime and health status', () => {
    const report = generateSurveyList(app);
    const parsed = structuredClone(report) as SurveyListReport;
    const db = parsed.services.find((entry) => entry.id === 'db.main');

    expect(parsed.serviceCount).toBe(1);
    expect(db).toEqual({
      description: null,
      health: 'none',
      id: 'db.main',
      kind: 'service',
      lifetime: 'singleton',
      usedBy: ['hello'],
    });
  });
});
