import { describe, test, expect } from 'bun:test';

import { signal, resource, Result, topo, trail } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import { z } from 'zod';

import { generateTrailheadMap } from '../generate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const topoFrom = (...modules: Record<string, unknown>[]): Topo =>
  topo('test-app', ...modules);

const noop = () => Result.ok(null as unknown);
const dbProvision = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
  description: 'Primary database',
  health: () => Result.ok({ ok: true }),
});

const getFirstEntry = (map: ReturnType<typeof generateTrailheadMap>) => {
  const [entry] = map.entries;
  expect(entry).toBeDefined();
  if (!entry) {
    throw new Error('Expected trailhead map entry');
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

describe('generateTrailheadMap', () => {
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
      const map = generateTrailheadMap(tp);

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
      const map = generateTrailheadMap(tp);

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
        resources: [dbProvision],
      });
      const map = generateTrailheadMap(topoFrom({ t }));
      const entry = getFirstEntry(map);

      expect(entry.input).toBeDefined();
      expect(entry.output).toBeDefined();
      expect(entry.cli?.path).toEqual(['entity', 'create']);
      expectSchemaProperties(entry.input, {
        age: { type: 'number' },
        name: { type: 'string' },
      });
      expectSchemaProperties(entry.output, {
        id: { type: 'string' },
        name: { type: 'string' },
      });
      expect(entry.resources).toEqual(['db.main']);
    });

    test('trail without output schema has output undefined', () => {
      const t = trail('fire.forget', {
        blaze: noop,
        input: z.object({ msg: z.string() }),
      });
      const tp = topoFrom({ t });
      const map = generateTrailheadMap(tp);

      expect(map.entries[0]?.output).toBeUndefined();
    });

    test('trail entries include crosses array when non-empty', () => {
      const base = trail('user.get', {
        blaze: noop,
        input: z.object({ id: z.string() }),
      });
      const r = trail('user.update', {
        blaze: noop,
        crosses: ['user.get'],
        input: z.object({ id: z.string(), name: z.string() }),
      });
      const tp = topoFrom({ base, r });
      const map = generateTrailheadMap(tp);
      const crossesEntry = map.entries.find((e) => e.id === 'user.update');
      expect(crossesEntry).toBeDefined();

      expect(crossesEntry?.kind).toBe('trail');
      expect(crossesEntry?.cli?.path).toEqual(['user', 'update']);
      expect(crossesEntry?.crosses).toEqual(['user.get']);
    });

    test("event entries are included with kind 'signal'", () => {
      const e = signal('user.created', {
        description: 'A user was created',
        payload: z.object({ userId: z.string() }),
      });
      const entry = getFirstEntry(generateTrailheadMap(topoFrom({ e })));

      expect(entry.kind).toBe('signal');
      expect(entry.id).toBe('user.created');
      expect(entry.description).toBe('A user was created');
      expect(entry.input).toBeDefined();
    });

    test('resource entries are included with description and healthcheck metadata', () => {
      const map = generateTrailheadMap(topoFrom({ dbProvision }));
      const entry = getFirstEntry(map);

      expect(entry.kind).toBe('resource');
      expect(entry.id).toBe('db.main');
      expect(entry.description).toBe('Primary database');
      expect(entry.healthcheck).toBe(true);
      expect(entry.trailheads).toEqual([]);
    });
  });

  describe('meta', () => {
    test('safety markers are included when set', () => {
      const t = trail('safe.trail', {
        blaze: noop,
        idempotent: true,
        input: z.object({}),
        intent: 'read',
      });
      const entry = getFirstEntry(generateTrailheadMap(topoFrom({ t })));

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
      const map = generateTrailheadMap(tp);

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
      const entry = getFirstEntry(generateTrailheadMap(topoFrom({ t })));

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
      const map = generateTrailheadMap(tp);

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

      const map1 = generateTrailheadMap(tp);
      const map2 = generateTrailheadMap(tp);

      expect(map1.entries).toEqual(map2.entries);
      expect(map1.version).toBe(map2.version);
    });

    test('version is set to 1.0', () => {
      const t = trail('v.check', {
        blaze: noop,
        input: z.object({}),
      });
      const tp = topoFrom({ t });
      const map = generateTrailheadMap(tp);

      expect(map.version).toBe('1.0');
    });

    test('generatedAt is an ISO timestamp', () => {
      const t = trail('ts.check', {
        blaze: noop,
        input: z.object({}),
      });
      const tp = topoFrom({ t });
      const map = generateTrailheadMap(tp);

      expect(new Date(map.generatedAt).toISOString()).toBe(map.generatedAt);
    });
  });

  describe('established graph enforcement', () => {
    test('rejects draft-contaminated topologies', () => {
      const exportTrail = trail('entity.export', {
        blaze: noop,
        crosses: ['_draft.entity.prepare'],
        input: z.object({}),
      });

      expect(() =>
        generateTrailheadMap(topoFrom({ exportTrail }))
      ).toThrowError(/draft/i);
    });
  });
});
