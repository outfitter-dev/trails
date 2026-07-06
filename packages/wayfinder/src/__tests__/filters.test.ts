import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  Result,
  resource,
  signal,
  surfaceOverlay,
  topo,
  trail,
} from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import type { TopoGraph, TopoGraphEntry } from '@ontrails/topographer';

import {
  createWayfinderEntityPredicate,
  createWayfinderFilterContext,
  createWayfinderGraphEntityPredicate,
  filterWayfinderEntityRefs,
  listWayfinderEntityRefs,
  wayfinderEntityFilterSchema,
} from '../index.js';

const db = resource('db.main', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const userCreated = signal('user.created', {
  payload: z.object({ id: z.string() }),
});

const userShow = trail('user.show', {
  blaze: () => Result.ok({ id: 'u1' }),
  examples: [{ expected: { id: 'u1' }, input: {}, name: 'Basic' }],
  input: z.object({}),
  intent: 'read',
  output: z.object({ id: z.string() }),
  resources: [db],
});

const userCreate = trail('user.create', {
  blaze: () => Result.ok({ id: 'u1' }),
  fires: [userCreated],
  input: z.object({ name: z.string() }),
  intent: 'write',
  output: z.object({ id: z.string() }),
  resources: [db],
});

const userAdminAudit = trail('user.admin.audit', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

const auditRebuild = trail('audit.rebuild', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'destroy',
  on: [userCreated],
  output: z.object({ ok: z.boolean() }),
});

const inviteCreate = trail('invite.create', {
  blaze: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  version: 2,
  versions: {
    1: {
      blaze: (input) => Result.ok({ greeting: `Hi, ${input.name}.` }),
      examples: [
        {
          expected: { greeting: 'Hello, Ada!' },
          input: { name: 'Ada' },
          name: 'Legacy greeting',
        },
      ],
      input: z.object({ name: z.string() }),
      output: z.object({ greeting: z.string() }),
      resources: [db],
      status: { state: 'deprecated', successor: 2 },
    },
  },
});

const withSurfaces = (topoGraph: TopoGraph): TopoGraph => ({
  ...topoGraph,
  entries: topoGraph.entries.map((entry): TopoGraphEntry => {
    if (entry.id === 'user.show') {
      return { ...entry, surfaces: ['mcp'] };
    }
    if (entry.id === 'user.create') {
      return { ...entry, surfaces: ['cli'] };
    }
    return entry;
  }),
});

const makeGraph = (): TopoGraph =>
  withSurfaces(
    deriveTopoGraph(
      topo('demo', {
        auditRebuild,
        db,
        inviteCreate,
        userAdminAudit,
        userCreate,
        userCreated,
        userShow,
      }),
      {
        overlays: [surfaceOverlay({ mcp: { users: ['user.*'] } })],
      }
    )
  );

const ids = (topoGraph: TopoGraph, filters = {}) =>
  filterWayfinderEntityRefs(topoGraph, filters).map((ref) => ref.id);

describe('wayfinder typed filters', () => {
  test('schema accepts typed filters without a query mini-language', () => {
    expect(
      wayfinderEntityFilterSchema.parse({
        exampleCoverage: true,
        idGlob: 'user.*',
        idPrefix: 'user.',
        intent: ['read', 'write'],
        kind: ['trail'],
        namespace: 'user',
        query: 'create',
        surface: 'mcp',
        trailhead: 'users',
        usesResource: 'db.main',
        usesSignal: 'user.created',
        versioned: false,
      })
    ).toEqual({
      exampleCoverage: true,
      idGlob: 'user.*',
      idPrefix: 'user.',
      intent: ['read', 'write'],
      kind: ['trail'],
      namespace: 'user',
      query: 'create',
      surface: 'mcp',
      trailhead: 'users',
      usesResource: 'db.main',
      usesSignal: 'user.created',
      versioned: false,
    });
  });

  test('lists graph, trailhead, surface, and version entity refs', () => {
    const refs = listWayfinderEntityRefs(makeGraph());

    expect(refs.map((ref) => `${ref.kind}:${ref.id}`)).toContain(
      'trailhead:users'
    );
    expect(refs.map((ref) => `${ref.kind}:${ref.id}`)).toContain('surface:mcp');
    expect(refs.map((ref) => `${ref.kind}:${ref.id}`)).toContain(
      'version:invite.create@1'
    );
  });

  test('filters by kind, id, prefix, and namespace', () => {
    const graph = makeGraph();

    expect(ids(graph, { kind: 'trail', namespace: 'user' })).toEqual([
      'user.admin.audit',
      'user.create',
      'user.show',
    ]);
    expect(ids(graph, { id: 'user.show' })).toEqual(['user.show']);
    expect(ids(graph, { idPrefix: 'audit.' })).toEqual(['audit.rebuild']);
    expect(ids(graph, { idGlob: 'user.*', kind: 'trail' })).toEqual([
      'user.create',
      'user.show',
    ]);
    expect(ids(graph, { idGlob: 'user.**', kind: 'trail' })).toEqual([
      'user.admin.audit',
      'user.create',
      'user.show',
    ]);
    expect(ids(graph, { idGlob: 'user.????', kind: 'trail' })).toEqual([
      'user.show',
    ]);
    expect(ids(graph, { kind: 'trail', query: 'show' })).toEqual(['user.show']);
  });

  test('filters trails by intent, versioning, and example coverage', () => {
    const graph = makeGraph();

    expect(ids(graph, { intent: 'destroy' })).toEqual(['audit.rebuild']);
    expect(ids(graph, { kind: 'trail', versioned: true })).toEqual([
      'invite.create',
    ]);
    expect(ids(graph, { exampleCoverage: true, kind: 'trail' })).toEqual([
      'user.show',
    ]);
  });

  test('filters by surface and trailhead membership', () => {
    const graph = makeGraph();

    expect(ids(graph, { kind: 'trail', surface: 'mcp' })).toEqual([
      'user.create',
      'user.show',
    ]);
    expect(ids(graph, { kind: 'trail', trailhead: 'users' })).toEqual([
      'user.create',
      'user.show',
    ]);
    expect(ids(graph, { kind: 'surface', surface: 'mcp' })).toEqual(['mcp']);
  });

  test('filters by resource and signal usage where substrate exists', () => {
    const graph = makeGraph();

    expect(ids(graph, { kind: 'trail', usesResource: 'db.main' })).toEqual([
      'user.create',
      'user.show',
    ]);
    expect(ids(graph, { kind: 'version', usesResource: 'db.main' })).toEqual([
      'invite.create@1',
    ]);
    expect(ids(graph, { kind: 'trail', usesSignal: 'user.created' })).toEqual([
      'audit.rebuild',
      'user.create',
    ]);
  });

  test('returns empty sets as findings instead of errors', () => {
    expect(
      filterWayfinderEntityRefs(makeGraph(), { idPrefix: 'missing.' })
    ).toEqual([]);
  });

  test('builds reusable predicates for future query trails', () => {
    const graph = makeGraph();
    const context = createWayfinderFilterContext(graph);
    const predicate = createWayfinderEntityPredicate(context, {
      kind: 'trail',
      surface: 'mcp',
    });
    const graphPredicate = createWayfinderGraphEntityPredicate(graph, {
      kind: 'trail',
      namespace: 'user',
    });

    expect(
      listWayfinderEntityRefs(graph)
        .filter(predicate)
        .map((ref) => ref.id)
    ).toEqual(['user.create', 'user.show']);
    expect(
      listWayfinderEntityRefs(graph)
        .filter(graphPredicate)
        .map((ref) => ref.id)
    ).toEqual(['user.admin.audit', 'user.create', 'user.show']);
  });
});
