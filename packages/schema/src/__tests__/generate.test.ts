import { describe, test, expect } from 'bun:test';

import { event, Result, service, topo, trail } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import { z } from 'zod';

import { generateSurfaceMap } from '../generate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const topoFrom = (...modules: Record<string, unknown>[]): Topo =>
  topo('test-app', ...modules);

const noop = () => Result.ok(null as unknown);
const dbService = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
  description: 'Primary database',
  health: () => Result.ok({ ok: true }),
});

const getFirstEntry = (map: ReturnType<typeof generateSurfaceMap>) => {
  const [entry] = map.entries;
  expect(entry).toBeDefined();
  if (!entry) {
    throw new Error('Expected surface map entry');
  }
  return entry;
};

const expectSchemaProperties = (
  schema: unknown,
  properties: Record<string, unknown>
) => {
  expect(schema).toEqual(
    expect.objectContaining({
      properties: expect.objectContaining(properties),
      type: 'object',
    })
  );
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateSurfaceMap', () => {
  describe('entries', () => {
    test('produces entries for all trails in the topo', () => {
      const a = trail('a.create', {
        blaze: noop,
        input: z.object({ name: z.string() }),
      });
      const b = trail('b.list', {
        blaze: noop,
        input: z.object({}),
      });
      const tp = topoFrom({ a, b });
      const map = generateSurfaceMap(tp);

      expect(map.entries).toHaveLength(2);
      expect(map.entries.map((e) => e.id)).toEqual(['a.create', 'b.list']);
    });

    test('entries are sorted alphabetically by id', () => {
      const z2 = trail('z.trail', {
        blaze: noop,
        input: z.object({}),
      });
      const a2 = trail('a.trail', {
        blaze: noop,
        input: z.object({}),
      });
      const m2 = trail('m.trail', {
        blaze: noop,
        input: z.object({}),
      });
      const tp = topoFrom({ a2, m2, z2 });
      const map = generateSurfaceMap(tp);

      expect(map.entries.map((e) => e.id)).toEqual([
        'a.trail',
        'm.trail',
        'z.trail',
      ]);
    });

    test('trail with input/output schemas produces valid JSON Schema entries', () => {
      const t = trail('entity.create', {
        blaze: noop,
        input: z.object({ age: z.number(), name: z.string() }),
        output: z.object({ id: z.string(), name: z.string() }),
        services: [dbService],
      });
      const map = generateSurfaceMap(topoFrom({ t }));
      const entry = getFirstEntry(map);

      expect(entry.input).toBeDefined();
      expect(entry.output).toBeDefined();
      expectSchemaProperties(entry.input, {
        age: { type: 'number' },
        name: { type: 'string' },
      });
      expectSchemaProperties(entry.output, {
        id: { type: 'string' },
        name: { type: 'string' },
      });
      expect(entry.services).toEqual(['db.main']);
    });

    test('trail without output schema has output undefined', () => {
      const t = trail('fire.forget', {
        blaze: noop,
        input: z.object({ msg: z.string() }),
      });
      const tp = topoFrom({ t });
      const map = generateSurfaceMap(tp);

      expect(map.entries[0]?.output).toBeUndefined();
    });

    test('trail entries include follow array when non-empty', () => {
      const base = trail('user.get', {
        blaze: noop,
        input: z.object({ id: z.string() }),
      });
      const r = trail('user.update', {
        blaze: noop,
        follow: ['user.get'],
        input: z.object({ id: z.string(), name: z.string() }),
      });
      const tp = topoFrom({ base, r });
      const map = generateSurfaceMap(tp);
      const followEntry = map.entries.find((e) => e.id === 'user.update');
      expect(followEntry).toBeDefined();

      expect(followEntry?.kind).toBe('trail');
      expect(followEntry?.follow).toEqual(['user.get']);
    });

    test("event entries are included with kind 'event'", () => {
      const e = event('user.created', {
        description: 'A user was created',
        payload: z.object({ userId: z.string() }),
      });
      const entry = getFirstEntry(generateSurfaceMap(topoFrom({ e })));

      expect(entry.kind).toBe('event');
      expect(entry.id).toBe('user.created');
      expect(entry.description).toBe('A user was created');
      expect(entry.input).toBeDefined();
    });

    test('service entries are included with description and healthcheck metadata', () => {
      const map = generateSurfaceMap(topoFrom({ dbService }));
      const entry = getFirstEntry(map);

      expect(entry.kind).toBe('service');
      expect(entry.id).toBe('db.main');
      expect(entry.description).toBe('Primary database');
      expect(entry.healthcheck).toBe(true);
      expect(entry.surfaces).toEqual([]);
    });
  });

  describe('metadata', () => {
    test('safety markers are included when set', () => {
      const t = trail('safe.trail', {
        blaze: noop,
        idempotent: true,
        input: z.object({}),
        intent: 'read',
      });
      const entry = getFirstEntry(generateSurfaceMap(topoFrom({ t })));

      expect(entry.intent).toBe('read');
      expect(entry.idempotent).toBe(true);
    });

    test('exampleCount reflects the number of examples', () => {
      const t = trail('with.examples', {
        blaze: noop,
        examples: [
          { expected: { y: 2 }, input: { x: 1 }, name: 'basic' },
          { expected: { y: 0 }, input: { x: 0 }, name: 'zero' },
          { expected: { y: -2 }, input: { x: -1 }, name: 'negative' },
        ],
        input: z.object({ x: z.number() }),
        output: z.object({ y: z.number() }),
      });
      const tp = topoFrom({ t });
      const map = generateSurfaceMap(tp);

      expect(map.entries[0]?.exampleCount).toBe(3);
    });

    test('detours are included and sorted', () => {
      const t = trail('with.detours', {
        blaze: noop,
        detours: {
          onError: ['notify.admin', 'log.error'],
          onSuccess: ['cache.invalidate'],
        },
        input: z.object({}),
      });
      const entry = getFirstEntry(generateSurfaceMap(topoFrom({ t })));

      expect(entry.detours).toEqual({
        onError: ['log.error', 'notify.admin'],
        onSuccess: ['cache.invalidate'],
      });
    });

    test('description is included when present', () => {
      const t = trail('described', {
        blaze: noop,
        description: 'A described trail',
        input: z.object({}),
      });
      const tp = topoFrom({ t });
      const map = generateSurfaceMap(tp);

      expect(map.entries[0]?.description).toBe('A described trail');
    });
  });

  describe('stability', () => {
    test('determinism: same topo produces identical output', () => {
      const t = trail('stable', {
        blaze: noop,
        description: 'Stable trail',
        input: z.object({ a: z.string(), b: z.number() }),
        intent: 'read',
        output: z.object({ c: z.boolean() }),
      });
      const tp = topoFrom({ t });

      const map1 = generateSurfaceMap(tp);
      const map2 = generateSurfaceMap(tp);

      expect(map1.entries).toEqual(map2.entries);
      expect(map1.version).toBe(map2.version);
    });

    test('version is set to 1.0', () => {
      const t = trail('v.check', {
        blaze: noop,
        input: z.object({}),
      });
      const tp = topoFrom({ t });
      const map = generateSurfaceMap(tp);

      expect(map.version).toBe('1.0');
    });

    test('generatedAt is an ISO timestamp', () => {
      const t = trail('ts.check', {
        blaze: noop,
        input: z.object({}),
      });
      const tp = topoFrom({ t });
      const map = generateSurfaceMap(tp);

      expect(new Date(map.generatedAt).toISOString()).toBe(map.generatedAt);
    });
  });
});
