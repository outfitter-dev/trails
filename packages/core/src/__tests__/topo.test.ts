import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { contour } from '../contour.js';
import { ValidationError } from '../errors.js';
import { resource } from '../resource.js';
import { Result } from '../result.js';
import { topo } from '../topo.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

// oxlint-disable-next-line require-await -- satisfies async interface without needing await
const noop = async () => Result.ok();

const mockContour = (name: string) =>
  contour(
    name,
    {
      id: z.string().uuid(),
      value: z.string(),
    },
    { identity: 'id' }
  );

const mockTrail = (
  id: string,
  crosses?: readonly string[],
  contours?: readonly ReturnType<typeof mockContour>[]
) => ({
  blaze: noop,
  contours: Object.freeze([...(contours ?? [])]),
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

const mockResource = (id: string) =>
  resource(id, {
    create: () => Result.ok({ id }),
    description: `${id} resource`,
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
        resource1: mockResource('s1'),
        trail1: mockTrail('t1'),
        trail2: mockTrail('t2', ['t1']),
      };
      const t = topo('app', mod);

      expect(t.trails.size).toBe(2);
      expect(t.signals.size).toBe(1);
      expect(t.resources.size).toBe(1);
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
      expect(t.resources.size).toBe(0);
    });

    test('trail with crossings registers correctly', () => {
      const mod = { t: mockTrail('trail-1', ['trail-2']) };
      const t = topo('app', mod);

      expect(t.trails.size).toBe(1);
      const registered = t.trails.get('trail-1');
      expect(registered?.crosses).toEqual(['trail-2']);
    });

    test('collects resources from modules', () => {
      const mod = { db: mockResource('db.main') };
      const t = topo('app', mod);

      expect(t.resources.size).toBe(1);
      expect(t.resources.get('db.main')).toBe(mod.db);
    });

    test('collects contours exported directly from modules', () => {
      const user = mockContour('user');
      const t = topo('app', { user });

      expect(t.contours.size).toBe(1);
      expect(t.getContour('user')).toBe(user);
    });

    test('registers contours declared on trails into the topo graph', () => {
      const user = mockContour('user');
      const t = topo('app', {
        createUser: mockTrail('user.create', [], [user]),
      });

      expect(t.contours.size).toBe(1);
      expect(t.getContour('user')).toBe(user);
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

    test('rejects duplicate resource IDs', () => {
      const mod1 = { a: mockResource('dup') };
      const mod2 = { b: mockResource('dup') };

      expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
      expect(() => topo('app', mod1, mod2)).toThrow(
        'Duplicate resource ID: "dup"'
      );
    });

    test('rejects duplicate contour names', () => {
      const mod1 = { a: mockContour('user') };
      const mod2 = { b: mockContour('user') };

      expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
      expect(() => topo('app', mod1, mod2)).toThrow(
        'Duplicate contour name: "user"'
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

  test('resourceCount returns number of resources', () => {
    const db = mockResource('db.main');
    const cache = mockResource('cache.main');
    const app = topo('test', { cache, db });
    expect(app.resourceCount).toBe(2);
  });

  test('contourCount returns number of contours', () => {
    const gist = mockContour('gist');
    const user = mockContour('user');
    const app = topo('test', { gist, user });
    expect(app.contourCount).toBe(2);
  });

  test('empty topo has zero count and empty ids', () => {
    const app = topo('empty');
    expect(app.count).toBe(0);
    expect(app.contourCount).toBe(0);
    expect(app.contourIds()).toEqual([]);
    expect(app.ids()).toEqual([]);
    expect(app.resourceCount).toBe(0);
    expect(app.resourceIds()).toEqual([]);
  });

  test('resourceIds() returns all resource IDs', () => {
    const db = mockResource('db.main');
    const cache = mockResource('cache.main');
    const app = topo('test', { cache, db });
    expect(app.resourceIds().toSorted()).toEqual(['cache.main', 'db.main']);
  });

  test('contourIds() returns all contour names', () => {
    const gist = mockContour('gist');
    const user = mockContour('user');
    const app = topo('test', { gist, user });
    expect(app.contourIds().toSorted()).toEqual(['gist', 'user']);
  });
});

// ---------------------------------------------------------------------------
// Topo
// ---------------------------------------------------------------------------

describe('Topo', () => {
  const mod = {
    e1: mockEvent('event-1'),
    p1: mockResource('resource-1'),
    t1: mockTrail('trail-1'),
    t2: mockTrail('trail-2'),
    t3: mockTrail('trail-3', ['trail-1']),
  };

  // Build once for the describe block
  const app = topo('app', mod);

  describe('get()', () => {
    test('retrieves contour by name', () => {
      const user = mockContour('user');
      const contourApp = topo('app', { user });

      expect(contourApp.getContour('user')).toBe(user);
    });

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
    test('returns true for known contour', () => {
      const user = mockContour('user');
      const contourApp = topo('app', { user });

      expect(contourApp.hasContour('user')).toBe(true);
    });

    test('returns true for known trail', () => {
      expect(app.has('trail-1')).toBe(true);
    });

    test('returns true for trail with crossings', () => {
      expect(app.has('trail-3')).toBe(true);
    });

    test('returns false for unknown ID', () => {
      expect(app.has('nope')).toBe(false);
    });

    test('returns false for unknown contour', () => {
      const contourApp = topo('app');

      expect(contourApp.hasContour('missing')).toBe(false);
    });

    test('returns false for event ID (signals are not trails)', () => {
      expect(app.has('event-1')).toBe(false);
    });
  });

  describe('getResource()', () => {
    test('retrieves resource by ID', () => {
      expect(app.getResource('resource-1')).toBe(mod.p1);
    });

    test('returns undefined for unknown resource ID', () => {
      expect(app.getResource('missing-resource')).toBeUndefined();
    });
  });

  describe('hasResource()', () => {
    test('returns true for known resource', () => {
      expect(app.hasResource('resource-1')).toBe(true);
    });

    test('returns false for unknown resource', () => {
      expect(app.hasResource('missing-resource')).toBe(false);
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

    test('listResources() returns all resources', () => {
      const items = app.listResources();
      expect(items).toHaveLength(1);
      expect(items).toContain(mod.p1);
    });

    test('listContours() returns all contours', () => {
      const gist = mockContour('gist');
      const user = mockContour('user');
      const contourApp = topo('app', { gist, user });

      expect(contourApp.listContours()).toEqual([gist, user]);
    });
  });
});
