import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { contour } from '../contour.js';
import { ValidationError } from '../errors.js';
import {
  attachLateBoundSignalRef,
  cloneSignalWithId,
} from '../internal/signal-ref.js';
import { resource } from '../resource.js';
import { Result } from '../result.js';
import { signal } from '../signal.js';
import { trail } from '../trail.js';
import { topo } from '../topo.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

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
) =>
  trail(id, {
    blaze: () => Result.ok({ y: 0 }),
    contours,
    crosses,
    input: z.object({ x: z.number() }),
    output: z.object({ y: z.number() }),
  });

const mockEvent = (id: string) =>
  signal(id, {
    payload: z.object({ payload: z.string() }),
  });

const mockSignalConsumer = (on: readonly ReturnType<typeof mockEvent>[]) =>
  trail('notify.users', {
    blaze: () => Result.ok({ ok: true }),
    input: z.object({ payload: z.string() }),
    on,
    output: z.object({ ok: z.boolean() }),
  });

const mockResource = (
  id: string,
  signals?: readonly ReturnType<typeof mockEvent>[]
) =>
  resource(id, {
    create: () => Result.ok({ id }),
    description: `${id} resource`,
    signals,
  });

// ---------------------------------------------------------------------------
// topo()
// ---------------------------------------------------------------------------

describe('topo', () => {
  describe('identity', () => {
    test('preserves object identity metadata', () => {
      const t = topo({
        description: 'Demo topo',
        name: 'my-app',
        version: '1.2.3',
      });

      expect(t.name).toBe('my-app');
      expect(t.version).toBe('1.2.3');
      expect(t.description).toBe('Demo topo');
    });
  });

  describe('trail collection', () => {
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
  });

  describe('resource and signal collection', () => {
    test('collects resources from modules', () => {
      const mod = { db: mockResource('db.main') };
      const t = topo('app', mod);

      expect(t.resources.size).toBe(1);
      expect(t.resources.get('db.main')).toBe(mod.db);
    });

    test('registers signals declared on resources into the topo graph', () => {
      const usersCreated = mockEvent('users.created');
      const t = topo('app', {
        db: mockResource('db.main', [usersCreated]),
      });

      expect(t.signals.size).toBe(1);
      expect(t.listSignals()).toContain(usersCreated);
    });

    test('resolves late-bound store signal refs from resource-scoped signals', () => {
      const authored = attachLateBoundSignalRef(mockEvent('users.created'), {
        kind: 'store-derived',
        token: 'users-created',
      });
      const consumer = mockSignalConsumer([authored]);
      const scoped = cloneSignalWithId(authored, 'identity:users.created');
      const t = topo('app', {
        consumer,
        identity: mockResource('identity', [scoped]),
      });

      expect(t.get('notify.users')?.on).toEqual(['identity:users.created']);
      expect(t.get('notify.users')?.activationSources).toEqual([
        { source: { id: 'identity:users.created', kind: 'signal' } },
      ]);
      expect(t.listSignals().map((s) => s.id)).toContain(
        'identity:users.created'
      );
    });

    test('keeps schedule and webhook activation sources inert during topo construction', () => {
      let cronRegistered = false;
      let routeRegistered = false;
      const scheduleSource = {
        id: 'schedule.nightly-close',
        input: { olderThanDays: 90 },
        kind: 'schedule' as const,
        register: () => {
          cronRegistered = true;
        },
      };
      const webhookSource = {
        id: 'webhook.stripe.payment',
        kind: 'webhook' as const,
        route: () => {
          routeRegistered = true;
        },
      };

      const app = topo('billing', {
        reconcile: trail('billing.reconcile', {
          blaze: () => Result.ok({ ok: true }),
          input: z.object({}),
          on: [scheduleSource, { source: webhookSource }],
          output: z.object({ ok: z.boolean() }),
        }),
      });

      expect(cronRegistered).toBe(false);
      expect(routeRegistered).toBe(false);
      expect(app.get('billing.reconcile')?.activationSources).toEqual([
        { source: scheduleSource },
        { source: webhookSource },
      ]);
    });

    test('preserves canonical scoped signal ids across multi-binding stores', () => {
      // Regression test: the same store definition bound under two resources
      // (identity + billing). A trail that registers under one resource and
      // another that registers under the other must resolve to the distinct
      // canonical scoped ids, not collide on a shared late-bound token.
      const authored = attachLateBoundSignalRef(mockEvent('users.created'), {
        kind: 'store-derived',
        token: 'users-created-multi',
      });
      const identityScoped = cloneSignalWithId(
        authored,
        'identity:users.created'
      );
      const billingScoped = cloneSignalWithId(
        authored,
        'billing:users.created'
      );

      const identityConsumer = trail('notify.identity-users', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [identityScoped],
        output: z.object({ ok: z.boolean() }),
      });
      const billingConsumer = trail('notify.billing-users', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [billingScoped],
        output: z.object({ ok: z.boolean() }),
      });

      const t = topo('app', {
        billing: mockResource('billing', [billingScoped]),
        billingConsumer,
        identity: mockResource('identity', [identityScoped]),
        identityConsumer,
      });

      expect(t.get('notify.identity-users')?.on).toEqual([
        'identity:users.created',
      ]);
      expect(t.get('notify.billing-users')?.on).toEqual([
        'billing:users.created',
      ]);
    });

    test('preserves canonical scoped signal ids when resource ids contain dots', () => {
      // Regression test: the canonical-scope predicate previously disallowed
      // dots inside the scope segment, which collapsed dotted resource ids
      // like `demo.store` and `other.store` back to their shared late-bound
      // token. With `:` prohibited inside resource ids, the scope is
      // unambiguously everything before the first `:`, so dotted scopes must
      // resolve to distinct canonical ids.
      const authored = attachLateBoundSignalRef(mockEvent('gists.created'), {
        kind: 'store-derived',
        token: 'gists-created-dotted',
      });
      const demoScoped = cloneSignalWithId(
        authored,
        'demo.store:gists.created'
      );
      const otherScoped = cloneSignalWithId(
        authored,
        'other.store:gists.created'
      );

      const demoConsumer = trail('notify.demo-gists', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [demoScoped],
        output: z.object({ ok: z.boolean() }),
      });
      const otherConsumer = trail('notify.other-gists', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [otherScoped],
        output: z.object({ ok: z.boolean() }),
      });

      const t = topo('app', {
        'demo.store': mockResource('demo.store', [demoScoped]),
        demoConsumer,
        'other.store': mockResource('other.store', [otherScoped]),
        otherConsumer,
      });

      expect(t.get('notify.demo-gists')?.on).toEqual([
        'demo.store:gists.created',
      ]);
      expect(t.get('notify.other-gists')?.on).toEqual([
        'other.store:gists.created',
      ]);
    });

    test('markerizes late-bound ids containing `:` but not in canonical scoped form', () => {
      // Guard regression: `normalizeSignalRef` previously passed any id
      // containing `:` through unchanged, which would let a non-canonical
      // late-bound id like `foo:bar` slip past markerization and then fail
      // to resolve during topo finalization. The strict predicate should
      // still rewrite such ids onto the late-bound marker path, while
      // leaving canonical `<scope>:<table>.<event>` ids alone.
      const nonCanonical = attachLateBoundSignalRef(mockEvent('foo:bar'), {
        kind: 'store-derived',
        token: 'non-canonical',
      });
      const nonCanonicalConsumer = trail('notify.non-canonical', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [nonCanonical],
        output: z.object({ ok: z.boolean() }),
      });
      expect(nonCanonicalConsumer.on).not.toEqual(['foo:bar']);

      const canonical = attachLateBoundSignalRef(mockEvent('users.created'), {
        kind: 'store-derived',
        token: 'canonical',
      });
      const scoped = cloneSignalWithId(canonical, 'identity:users.created');
      const canonicalConsumer = trail('notify.canonical', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [scoped],
        output: z.object({ ok: z.boolean() }),
      });
      expect(canonicalConsumer.on).toEqual(['identity:users.created']);
    });

    test('rejects ambiguous late-bound store signal refs', () => {
      const authored = attachLateBoundSignalRef(mockEvent('users.created'), {
        kind: 'store-derived',
        token: 'users-created',
      });
      const consumer = mockSignalConsumer([authored]);

      expect(() =>
        topo('app', {
          billing: mockResource('billing', [
            cloneSignalWithId(authored, 'billing:users.created'),
          ]),
          consumer,
          identity: mockResource('identity', [
            cloneSignalWithId(authored, 'identity:users.created'),
          ]),
        })
      ).toThrow(
        'Trail "notify.users" references late-bound signal "users.created" but it resolves to multiple bound resource signals'
      );
    });
  });

  describe('contour collection', () => {
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
