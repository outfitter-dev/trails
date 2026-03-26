import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { ValidationError } from '../errors.js';
import { Result } from '../result.js';
import { topo } from '../topo.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

// oxlint-disable-next-line require-await -- satisfies async interface without needing await
const noop = async () => Result.ok();

const mockTrail = (id: string) => ({
  id,
  implementation: noop,
  input: z.object({ x: z.number() }),
  kind: 'trail' as const,
  output: z.object({ y: z.number() }),
});

const mockHike = (id: string) => ({
  follows: [] as readonly string[],
  id,
  implementation: noop,
  input: z.object({ q: z.string() }),
  kind: 'hike' as const,
  output: z.object({ r: z.string() }),
  path: `/${id}`,
});

const mockEvent = (id: string) => ({
  id,
  kind: 'event' as const,
  payload: z.object({ payload: z.string() }),
});

// ---------------------------------------------------------------------------
// topo()
// ---------------------------------------------------------------------------

describe('topo', () => {
  test('returns Topo with name', () => {
    const t = topo('my-app');
    expect(t.name).toBe('my-app');
  });

  test('collects trails from modules', () => {
    const mod = { myTrail: mockTrail('create-user') };
    const t = topo('app', mod);

    expect(t.trails.size).toBe(1);
    expect(t.trails.get('create-user')).toBe(mod.myTrail);
  });

  test('auto-scans exports by kind discriminant', () => {
    const mod = {
      event1: mockEvent('e1'),
      hike1: mockHike('r1'),
      trail1: mockTrail('t1'),
    };
    const t = topo('app', mod);

    expect(t.trails.size).toBe(1);
    expect(t.hikes.size).toBe(1);
    expect(t.events.size).toBe(1);
  });

  test('collects from multiple modules', () => {
    const mod1 = { a: mockTrail('t1') };
    const mod2 = { b: mockTrail('t2'), c: mockHike('r1') };
    const t = topo('app', mod1, mod2);

    expect(t.trails.size).toBe(2);
    expect(t.hikes.size).toBe(1);
  });

  test('non-trail exports are silently ignored', () => {
    const mod = {
      config: { port: 3000 },
      helper: () => 'not a trail',
      name: 'some-string',
      nothing: null,
      num: 42,
      trail1: mockTrail('t1'),
      undef: undefined,
    };
    const t = topo('app', mod);

    expect(t.trails.size).toBe(1);
    expect(t.hikes.size).toBe(0);
    expect(t.events.size).toBe(0);
  });

  test('rejects duplicate trail IDs', () => {
    const mod1 = { a: mockTrail('dup') };
    const mod2 = { b: mockTrail('dup') };

    expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
    expect(() => topo('app', mod1, mod2)).toThrow('Duplicate trail ID: "dup"');
  });

  test('rejects duplicate hike IDs', () => {
    const mod1 = { a: mockHike('dup') };
    const mod2 = { b: mockHike('dup') };

    expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
    expect(() => topo('app', mod1, mod2)).toThrow('Duplicate hike ID: "dup"');
  });

  test('rejects duplicate event IDs', () => {
    const mod1 = { a: mockEvent('dup') };
    const mod2 = { b: mockEvent('dup') };

    expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
    expect(() => topo('app', mod1, mod2)).toThrow('Duplicate event ID: "dup"');
  });
});

// ---------------------------------------------------------------------------
// Topo
// ---------------------------------------------------------------------------

describe('Topo', () => {
  const mod = {
    e1: mockEvent('event-1'),
    h1: mockHike('hike-1'),
    t1: mockTrail('trail-1'),
    t2: mockTrail('trail-2'),
  };

  // Build once for the describe block
  const app = topo('app', mod);

  describe('get()', () => {
    test('retrieves trail by ID', () => {
      expect(app.get('trail-1')).toBe(mod.t1);
    });

    test('retrieves hike by ID', () => {
      expect(app.get('hike-1')).toBe(mod.h1);
    });

    test('returns undefined for unknown ID', () => {
      expect(app.get('nope')).toBeUndefined();
    });
  });

  describe('has()', () => {
    test('returns true for known trail', () => {
      expect(app.has('trail-1')).toBe(true);
    });

    test('returns true for known hike', () => {
      expect(app.has('hike-1')).toBe(true);
    });

    test('returns false for unknown ID', () => {
      expect(app.has('nope')).toBe(false);
    });

    test('returns false for event ID (events are not trails/hikes)', () => {
      expect(app.has('event-1')).toBe(false);
    });
  });

  describe('listing', () => {
    test('list() returns all trails and hikes', () => {
      const items = app.list();
      expect(items).toHaveLength(3);
      expect(items).toContain(mod.t1);
      expect(items).toContain(mod.t2);
      expect(items).toContain(mod.h1);
    });

    test('listEvents() returns all events', () => {
      const items = app.listEvents();
      expect(items).toHaveLength(1);
      expect(items).toContain(mod.e1);
    });
  });
});
