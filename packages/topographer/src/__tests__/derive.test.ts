import { describe, test, expect } from 'bun:test';

import {
  ConflictError,
  DETOUR_MAX_ATTEMPTS_CAP,
  ValidationError,
  contour,
  signal,
  resource,
  Result,
  schedule,
  topo,
  trail,
} from '@ontrails/core';
import type { Layer, Topo, TopoIssue } from '@ontrails/core';
import { z } from 'zod';

import { deriveTopoGraph } from '../derive.js';
import { TOPO_GRAPH_SCHEMA_VERSION } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const topoFrom = (...modules: Record<string, unknown>[]): Topo =>
  topo('test-app', ...modules);

const noop = () => Result.ok(null as unknown);
const dbResource = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
  description: 'Primary database',
  health: () => Result.ok({ ok: true }),
});

const passThroughLayer = (name: string, input?: Layer['input']): Layer => ({
  ...(input === undefined ? {} : { input }),
  name,
  wrap: (_trail, implementation) => implementation,
});
const userContour = contour(
  'user',
  {
    id: z.string().uuid(),
    name: z.string(),
  },
  { identity: 'id' }
);
const gistContour = contour(
  'gist',
  {
    id: z.string().uuid(),
    ownerId: userContour.id(),
    title: z.string(),
  },
  { identity: 'id' }
);

const getFirstEntry = (map: ReturnType<typeof deriveTopoGraph>) => {
  const [entry] = map.entries;
  expect(entry).toBeDefined();
  if (!entry) {
    throw new Error('Expected topo graph entry');
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

const expectTopoGraphTopoIssue = (tp: Topo, rule: string) => {
  try {
    deriveTopoGraph(tp);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    const issues = (error as ValidationError).context?.['issues'] as
      | readonly TopoIssue[]
      | undefined;
    expect(issues).toContainEqual(expect.objectContaining({ rule }));
    return;
  }

  throw new Error(`Expected deriveTopoGraph to reject with ${rule}`);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveTopoGraph', () => {
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
      const map = deriveTopoGraph(tp);

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
      const map = deriveTopoGraph(tp);

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
        resources: [dbResource],
      });
      const map = deriveTopoGraph(topoFrom({ dbResource, t }));
      const entry = map.entries.find(
        (candidate) => candidate.id === 'entity.create'
      );

      expect(entry).toBeDefined();
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

    test('trail entries include topo and trail layer attachments', () => {
      const topoLayer = passThroughLayer(
        'topo.auth',
        z.object({ token: z.string() })
      );
      const trailLayer = passThroughLayer(
        'trail.retry',
        z.object({ attempts: z.number().int() })
      );
      const t = trail('entity.layered', {
        blaze: noop,
        input: z.object({}),
        layers: [trailLayer],
      });
      const map = deriveTopoGraph(
        topo('layered-app', { t }, { layers: [topoLayer] })
      );
      const entry = map.entries.find(
        (candidate) => candidate.id === 'entity.layered'
      );

      expect(entry?.layers).toEqual([
        expect.objectContaining({
          input: expect.objectContaining({
            properties: expect.objectContaining({
              token: { type: 'string' },
            }),
            type: 'object',
          }),
          name: 'topo.auth',
          scope: 'topo',
        }),
        expect.objectContaining({
          input: expect.objectContaining({
            properties: expect.objectContaining({
              attempts: { type: 'number' },
            }),
            type: 'object',
          }),
          name: 'trail.retry',
          scope: 'trail',
        }),
      ]);
    });

    test('trail entries include declared contours when present', () => {
      const t = trail('gist.create', {
        blaze: noop,
        contours: [gistContour, userContour],
        input: z.object({}),
      });
      const entry = deriveTopoGraph(topoFrom({ t })).entries.find(
        (candidate) => candidate.id === 'gist.create'
      );

      expect(entry?.contours).toEqual(['gist', 'user']);
    });

    test('trail without output schema has output undefined', () => {
      const t = trail('fire.forget', {
        blaze: noop,
        input: z.object({ msg: z.string() }),
      });
      const tp = topoFrom({ t });
      const map = deriveTopoGraph(tp);

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
      const map = deriveTopoGraph(tp);
      const crossesEntry = map.entries.find((e) => e.id === 'user.update');
      expect(crossesEntry).toBeDefined();

      expect(crossesEntry?.kind).toBe('trail');
      expect(crossesEntry?.cli?.path).toEqual(['user', 'update']);
      expect(crossesEntry?.crosses).toEqual(['user.get']);
    });

    test("signal entries are included with kind 'signal'", () => {
      const e = signal('user.created', {
        description: 'A user was created',
        examples: [{ userId: 'u-1' }],
        from: ['user.create'],
        payload: z.object({ userId: z.string() }),
      });
      const createUser = trail('user.create', {
        blaze: noop,
        input: z.object({}),
      });
      const entry = deriveTopoGraph(topoFrom({ createUser, e })).entries.find(
        (candidate) => candidate.id === 'user.created'
      );

      expect(entry).toBeDefined();
      expect(entry.kind).toBe('signal');
      expect(entry.id).toBe('user.created');
      expect(entry.description).toBe('A user was created');
      expect(entry.input).toBeDefined();
      expect(entry.exampleCount).toBe(1);
      expect(entry.from).toEqual(['user.create']);
      expect(entry.examples).toEqual([
        {
          kind: 'payload',
          payload: { userId: 'u-1' },
          provenance: { source: 'signal.examples' },
        },
      ]);
    });

    test('signal entries expose graph namespace metadata and edges', () => {
      const created = signal('user.created', {
        description: 'A user was created',
        examples: [{ userId: 'u-1' }],
        from: ['user.create'],
        meta: { owner: 'identity' },
        payload: z.object({ userId: z.string() }),
      });
      const producer = trail('user.create', {
        blaze: noop,
        fires: [created],
        input: z.object({}),
      });
      const consumer = trail('user.index', {
        blaze: noop,
        input: z.object({}),
        on: [created],
      });
      const entry = deriveTopoGraph(
        topoFrom({ consumer, created, producer })
      ).entries.find((candidate) => candidate.id === 'user.created');

      expect(entry).toMatchObject({
        consumers: ['user.index'],
        diagnostics: expect.objectContaining({
          codes: expect.arrayContaining(['signal.invalid']),
          strictMode: true,
        }),
        from: ['user.create'],
        governance: {
          consumers: 'trail.on',
          payload: 'signal.payload',
          producers: 'trail.fires',
        },
        meta: { owner: 'identity' },
        producers: ['user.create'],
      });
      expect(entry?.payload).toEqual(entry?.input);
    });

    test('activation sources expose a source catalog and activation graph', () => {
      const created = signal('user.created', {
        from: ['user.create'],
        payload: z.object({ userId: z.string() }),
      });
      const nightly = schedule('schedule.user.reindex', {
        cron: '0 2 * * *',
        input: { id: 'nightly' },
        meta: { owner: 'identity' },
        timezone: 'UTC',
      });
      const producer = trail('user.create', {
        blaze: noop,
        fires: [created],
        input: z.object({}),
      });
      const consumer = trail('user.index', {
        blaze: noop,
        input: z.object({}),
        on: [
          {
            source: created,
            where: (payload) => payload.userId.startsWith('u_'),
          },
        ],
      });
      const scheduled = trail('user.scheduled-index', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        on: [nightly],
      });

      const map = deriveTopoGraph(
        topoFrom({ consumer, created, producer, scheduled })
      );
      const consumerEntry = map.entries.find(
        (candidate) => candidate.id === 'user.index'
      );

      expect(map.activationSources).toMatchObject({
        'schedule:schedule.user.reindex': {
          cron: '0 2 * * *',
          id: 'schedule.user.reindex',
          input: { id: 'nightly' },
          key: 'schedule:schedule.user.reindex',
          kind: 'schedule',
          meta: { owner: 'identity' },
          timezone: 'UTC',
        },
        'signal:user.created': {
          id: 'user.created',
          key: 'signal:user.created',
          kind: 'signal',
        },
      });
      expect(map.activationGraph).toMatchObject({
        edgeCount: 2,
        sourceCount: 2,
        sourceKeys: ['schedule:schedule.user.reindex', 'signal:user.created'],
        trailIds: ['user.index', 'user.scheduled-index'],
      });
      expect(map.activationGraph.edges).toEqual([
        {
          hasWhere: false,
          sourceId: 'schedule.user.reindex',
          sourceKey: 'schedule:schedule.user.reindex',
          sourceKind: 'schedule',
          trailId: 'user.scheduled-index',
        },
        {
          hasWhere: true,
          sourceId: 'user.created',
          sourceKey: 'signal:user.created',
          sourceKind: 'signal',
          trailId: 'user.index',
          where: { predicate: true },
        },
      ]);
      expect(consumerEntry?.activationSources).toEqual([
        {
          source: {
            id: 'user.created',
            key: 'signal:user.created',
            kind: 'signal',
          },
          where: { predicate: true },
        },
      ]);
    });

    test('activation source projection records source payload and parse schemas', () => {
      const webhookSource = {
        id: 'webhook.user.upsert',
        kind: 'webhook' as const,
        parse: {
          output: z.object({
            email: z.string().optional(),
            userId: z.string(),
          }),
        },
        payload: z.object({ userId: z.string() }),
      };
      const receiver = trail('user.webhook.receive', {
        blaze: noop,
        input: z.object({ userId: z.string() }),
        on: [webhookSource],
      });

      const map = deriveTopoGraph(topoFrom({ receiver }));
      const source = map.activationSources['webhook:webhook.user.upsert'];

      expect(source).toMatchObject({
        hasParse: true,
        hasPayloadSchema: true,
        id: 'webhook.user.upsert',
        key: 'webhook:webhook.user.upsert',
        kind: 'webhook',
        parseOutputSchema: {
          properties: {
            userId: { type: 'string' },
          },
          type: 'object',
        },
        payloadSchema: {
          properties: {
            userId: { type: 'string' },
          },
          type: 'object',
        },
      });
    });

    test('resource entries are included with description and healthcheck metadata', () => {
      const map = deriveTopoGraph(topoFrom({ dbResource }));
      const entry = getFirstEntry(map);

      expect(entry.kind).toBe('resource');
      expect(entry.id).toBe('db.main');
      expect(entry.description).toBe('Primary database');
      expect(entry.healthcheck).toBe(true);
      expect(entry.surfaces).toEqual([]);
    });

    test('contour entries are included with schema and references', () => {
      const entry = deriveTopoGraph(
        topoFrom({ gistContour, userContour })
      ).entries.find((candidate) => candidate.id === 'gist');

      expect(entry).toBeDefined();
      expect(entry?.kind).toBe('contour');
      expect(entry?.identity).toBe('id');
      expect(entry?.references).toEqual([
        {
          contour: 'user',
          field: 'ownerId',
          identity: 'id',
        },
      ]);
      expectSchemaProperties(entry?.schema, {
        id: { type: 'string' },
        ownerId: { type: 'string' },
        title: { type: 'string' },
      });
    });
  });

  describe('meta', () => {
    test('safety markers are included when set', () => {
      const t = trail('safe.trail', {
        blaze: noop,
        dryRun: true,
        idempotent: true,
        input: z.object({}),
        intent: 'read',
      });
      const entry = getFirstEntry(deriveTopoGraph(topoFrom({ t })));

      expect(entry.intent).toBe('read');
      expect(entry.idempotent).toBe(true);
      expect(entry.dryRunCapable).toBe(true);
    });

    test('trail permit requirements are included when declared', () => {
      const scoped = trail('secure.write', {
        blaze: noop,
        input: z.object({}),
        permit: { scopes: ['write:entity', 'read:entity'] },
      });
      const publicTrail = trail('status.read', {
        blaze: noop,
        input: z.object({}),
        permit: 'public',
      });
      const { entries } = deriveTopoGraph(topoFrom({ publicTrail, scoped }));

      expect(
        entries.find((entry) => entry.id === 'secure.write')?.permit
      ).toEqual({ scopes: ['read:entity', 'write:entity'] });
      expect(entries.find((entry) => entry.id === 'status.read')?.permit).toBe(
        'public'
      );
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
      const map = deriveTopoGraph(tp);

      expect(map.entries[0]?.exampleCount).toBe(3);
    });

    test('trail entries preserve structured examples with provenance', () => {
      const profileUpdated = signal('profile.updated', {
        payload: z.object({ id: z.string() }),
      });
      const t = trail('with.examples', {
        blaze: noop,
        examples: [
          {
            description: 'Happy path',
            expected: { y: 2 },
            input: { x: 1 },
            name: 'basic',
            signals: [
              {
                payloadMatch: { id: 'u1' },
                signal: profileUpdated,
              },
            ],
          },
          {
            error: 'ValidationError',
            input: { x: -1 },
            name: 'negative',
          },
        ],
        input: z.object({ x: z.number() }),
        output: z.object({ y: z.number() }),
      });
      const entry = getFirstEntry(deriveTopoGraph(topoFrom({ t })));

      expect(entry.examples).toEqual([
        {
          description: 'Happy path',
          expected: { y: 2 },
          input: { x: 1 },
          kind: 'success',
          name: 'basic',
          provenance: { source: 'trail.examples' },
          signals: [
            {
              payloadMatch: { id: 'u1' },
              signalId: 'profile.updated',
            },
          ],
        },
        {
          error: 'ValidationError',
          input: { x: -1 },
          kind: 'error',
          name: 'negative',
          provenance: { source: 'trail.examples' },
        },
      ]);
    });

    test('omits structured examples that cannot be JSON serialized', () => {
      const t = trail('with.dynamic.examples', {
        blaze: noop,
        examples: [
          {
            input: { value: 1n },
            name: 'bigint input',
          },
        ],
        input: z.any(),
      });
      const map = deriveTopoGraph(topoFrom({ t }));
      const entry = getFirstEntry(map);

      expect(entry.exampleCount).toBe(1);
      expect(entry.examples).toBeUndefined();
      expect(() => JSON.stringify(map)).not.toThrow();
    });

    test('field overrides expose projection-local provenance', () => {
      const t = trail('with.field.overrides', {
        blaze: noop,
        fields: {
          name: { hint: 'Shown in prompts' },
          status: {
            label: 'State',
            options: [
              { hint: 'Ready for use', label: 'Active', value: 'active' },
            ],
          },
        },
        input: z.object({
          name: z.string(),
          status: z.enum(['active', 'inactive']),
        }),
      });
      const entry = getFirstEntry(deriveTopoGraph(topoFrom({ t })));

      expect(entry.fieldOverrides).toEqual([
        {
          field: 'name',
          overrides: ['hint'],
          provenance: { source: 'trail.fields' },
        },
        {
          field: 'status',
          overrides: ['label', 'options'],
          provenance: { source: 'trail.fields' },
        },
      ]);
    });

    test('detours are included with error class names', () => {
      const t = trail('with.detours', {
        blaze: noop,
        detours: [
          {
            maxAttempts: 100,
            on: ConflictError,
            /* oxlint-disable-next-line require-await -- test stub, no real async work */
            recover: async () => Result.ok(),
          },
        ],
        input: z.object({}),
      });
      const entry = getFirstEntry(deriveTopoGraph(topoFrom({ t })));

      expect(entry.detours).toEqual([
        { maxAttempts: DETOUR_MAX_ATTEMPTS_CAP, on: 'ConflictError' },
      ]);
    });

    test('detours preserve in-range maxAttempts values', () => {
      const t = trail('with.in-range.detour', {
        blaze: noop,
        detours: [
          {
            maxAttempts: 2,
            on: ConflictError,
            /* oxlint-disable-next-line require-await -- test stub, no real async work */
            recover: async () => Result.ok(),
          },
        ],
        input: z.object({}),
      });
      const entry = getFirstEntry(deriveTopoGraph(topoFrom({ t })));

      expect(entry.detours).toEqual([{ maxAttempts: 2, on: 'ConflictError' }]);
    });

    test('description is included when present', () => {
      const t = trail('described', {
        blaze: noop,
        description: 'A described trail',
        input: z.object({}),
      });
      const tp = topoFrom({ t });
      const map = deriveTopoGraph(tp);

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

      const map1 = deriveTopoGraph(tp);
      const map2 = deriveTopoGraph(tp);

      expect(map1.entries).toEqual(map2.entries);
      expect(map1.topoGraphSchemaVersion).toBe(map2.topoGraphSchemaVersion);
    });

    test('schema version is set to 1', () => {
      const t = trail('v.check', {
        blaze: noop,
        input: z.object({}),
      });
      const tp = topoFrom({ t });
      const map = deriveTopoGraph(tp);

      expect(map.topoGraphSchemaVersion).toBe(TOPO_GRAPH_SCHEMA_VERSION);
    });

    test('generatedAt is an ISO timestamp', () => {
      const t = trail('ts.check', {
        blaze: noop,
        input: z.object({}),
      });
      const tp = topoFrom({ t });
      const map = deriveTopoGraph(tp);

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

      expect(() => deriveTopoGraph(topoFrom({ exportTrail }))).toThrowError(
        /draft/i
      );
    });

    test('rejects producer references to missing signals', () => {
      const producer = trail('entity.produce', {
        blaze: noop,
        fires: ['entity.missing'],
        input: z.object({}),
      });

      expectTopoGraphTopoIssue(topoFrom({ producer }), 'signal-fire-exists');
    });

    test('rejects consumer references to missing signals', () => {
      const consumer = trail('entity.consume', {
        blaze: noop,
        input: z.object({}),
        on: ['entity.missing'],
      });

      expectTopoGraphTopoIssue(topoFrom({ consumer }), 'signal-on-exists');
    });
  });
});
