import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { ValidationError } from '../errors.js';
import { provision } from '../provision.js';
import { Result } from '../result.js';
import { topo } from '../topo.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

// oxlint-disable-next-line require-await -- satisfies async interface without needing await
const noop = async () => Result.ok();

const mockTrail = (id: string, crosses?: readonly string[]) => ({
  blaze: noop,
  crosses: Object.freeze([...(crosses ?? [])]),
  id,
  input: z.object({ x: z.number() }),
  kind: 'trail' as const,
  output: z.object({ y: z.number() }),
});

const mockEvent = (id: string) => ({
  id,
  kind: 'signal' as const,
  payload: z.object({ payload: z.string() }),
});

const mockProvision = (id: string) =>
  provision(id, {
    create: () => Result.ok({ id }),
    description: `${id} provision`,
  });

// ---------------------------------------------------------------------------
// topo()
// ---------------------------------------------------------------------------

describe('topo', () => {
  describe('collection', () => {
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
        provision1: mockProvision('s1'),
        trail1: mockTrail('t1'),
        trail2: mockTrail('t2', ['t1']),
      };
      const t = topo('app', mod);

      expect(t.trails.size).toBe(2);
      expect(t.signals.size).toBe(1);
      expect(t.provisions.size).toBe(1);
    });

    test('collects from multiple modules', () => {
      const mod1 = { a: mockTrail('t1') };
      const mod2 = { b: mockTrail('t2'), c: mockTrail('t3', ['t1']) };
      const t = topo('app', mod1, mod2);

      expect(t.trails.size).toBe(3);
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
      expect(t.signals.size).toBe(0);
      expect(t.provisions.size).toBe(0);
    });

    test('trail with crossings registers correctly', () => {
      const mod = { t: mockTrail('trail-1', ['trail-2']) };
      const t = topo('app', mod);

      expect(t.trails.size).toBe(1);
      const registered = t.trails.get('trail-1');
      expect(registered?.crosses).toEqual(['trail-2']);
    });

    test('collects provisions from modules', () => {
      const mod = { db: mockProvision('db.main') };
      const t = topo('app', mod);

      expect(t.provisions.size).toBe(1);
      expect(t.provisions.get('db.main')).toBe(mod.db);
    });
  });

  describe('duplicate rejection', () => {
    test('rejects duplicate trail IDs', () => {
      const mod1 = { a: mockTrail('dup') };
      const mod2 = { b: mockTrail('dup') };

      expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
      expect(() => topo('app', mod1, mod2)).toThrow(
        'Duplicate trail ID: "dup"'
      );
    });

    test('rejects duplicate event IDs', () => {
      const mod1 = { a: mockEvent('dup') };
      const mod2 = { b: mockEvent('dup') };

      expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
      expect(() => topo('app', mod1, mod2)).toThrow(
        'Duplicate signal ID: "dup"'
      );
    });

    test('rejects duplicate provision IDs', () => {
      const mod1 = { a: mockProvision('dup') };
      const mod2 = { b: mockProvision('dup') };

      expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
      expect(() => topo('app', mod1, mod2)).toThrow(
        'Duplicate provision ID: "dup"'
      );
    });
  });
});

// ---------------------------------------------------------------------------
// topo accessors
// ---------------------------------------------------------------------------

describe('topo accessors', () => {
  test('ids() returns all trail IDs', () => {
    const a = mockTrail('alpha');
    const b = mockTrail('beta');
    const app = topo('test', { a, b });
    expect(app.ids().toSorted()).toEqual(['alpha', 'beta']);
  });

  test('count returns number of trails', () => {
    const a = mockTrail('alpha');
    const app = topo('test', { a });
    expect(app.count).toBe(1);
  });

  test('provisionCount returns number of provisions', () => {
    const db = mockProvision('db.main');
    const cache = mockProvision('cache.main');
    const app = topo('test', { cache, db });
    expect(app.provisionCount).toBe(2);
  });

  test('empty topo has zero count and empty ids', () => {
    const app = topo('empty');
    expect(app.count).toBe(0);
    expect(app.ids()).toEqual([]);
    expect(app.provisionCount).toBe(0);
    expect(app.provisionIds()).toEqual([]);
  });

  test('provisionIds() returns all provision IDs', () => {
    const db = mockProvision('db.main');
    const cache = mockProvision('cache.main');
    const app = topo('test', { cache, db });
    expect(app.provisionIds().toSorted()).toEqual(['cache.main', 'db.main']);
  });
});

// ---------------------------------------------------------------------------
// Topo
// ---------------------------------------------------------------------------

describe('Topo', () => {
  const mod = {
    e1: mockEvent('event-1'),
    p1: mockProvision('provision-1'),
    t1: mockTrail('trail-1'),
    t2: mockTrail('trail-2'),
    t3: mockTrail('trail-3', ['trail-1']),
  };

  // Build once for the describe block
  const app = topo('app', mod);

  describe('get()', () => {
    test('retrieves trail by ID', () => {
      expect(app.get('trail-1')).toBe(mod.t1);
    });

    test('retrieves trail with crossings by ID', () => {
      expect(app.get('trail-3')).toBe(mod.t3);
    });

    test('returns undefined for unknown ID', () => {
      expect(app.get('nope')).toBeUndefined();
    });
  });

  describe('has()', () => {
    test('returns true for known trail', () => {
      expect(app.has('trail-1')).toBe(true);
    });

    test('returns true for trail with crossings', () => {
      expect(app.has('trail-3')).toBe(true);
    });

    test('returns false for unknown ID', () => {
      expect(app.has('nope')).toBe(false);
    });

    test('returns false for event ID (signals are not trails)', () => {
      expect(app.has('event-1')).toBe(false);
    });
  });

  describe('getProvision()', () => {
    test('retrieves provision by ID', () => {
      expect(app.getProvision('provision-1')).toBe(mod.p1);
    });

    test('returns undefined for unknown provision ID', () => {
      expect(app.getProvision('missing-provision')).toBeUndefined();
    });
  });

  describe('hasProvision()', () => {
    test('returns true for known provision', () => {
      expect(app.hasProvision('provision-1')).toBe(true);
    });

    test('returns false for unknown provision', () => {
      expect(app.hasProvision('missing-provision')).toBe(false);
    });
  });

  describe('listing', () => {
    test('list() returns all trails (with and without crossings)', () => {
      const items = app.list();
      expect(items).toHaveLength(3);
      expect(items).toContain(mod.t1);
      expect(items).toContain(mod.t2);
      expect(items).toContain(mod.t3);
    });

    test('listEvents() returns all signals', () => {
      const items = app.listSignals();
      expect(items).toHaveLength(1);
      expect(items).toContain(mod.e1);
    });

    test('listProvisions() returns all provisions', () => {
      const items = app.listProvisions();
      expect(items).toHaveLength(1);
      expect(items).toContain(mod.p1);
    });
  });
});
