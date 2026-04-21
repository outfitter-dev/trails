/**
 * Tests for `incomplete-accessor-for-standard-op`.
 *
 * Builds in-memory topos with synthetic CRUD-pattern trails and resources
 * whose mock factories return accessors with controlled method shapes.
 * Asserts the rule emits diagnostics matching the severity matrix from
 * TRL-269 without depending on `@ontrails/store`.
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { runTopoAwareWardenTrails, runWardenTrails } from '../trails/run.js';

import { resource, Result, topo, trail } from '@ontrails/core';
import type {
  AnyResource,
  AnyTrail,
  Resource,
  TrailSpec,
} from '@ontrails/core';

import { incompleteAccessorForStandardOp } from '../rules/incomplete-accessor-for-standard-op.js';

type Accessor = Readonly<Record<string, (...args: unknown[]) => unknown>>;
type Connection = Readonly<Record<string, Accessor>>;

const buildResource = (
  id: string,
  contourName: string,
  accessor: Accessor
): Resource<Connection> => {
  const connection: Connection = { [contourName]: accessor };
  return resource<Connection>(id, {
    create: () => Result.ok(connection),
    mock: () => connection,
  });
};

const crudInputSchema = z.object({});
const crudOutputSchema = z.object({ ok: z.boolean() });
type CrudInput = z.infer<typeof crudInputSchema>;
type CrudOutput = z.infer<typeof crudOutputSchema>;

const baseCrudSpec = (
  resourceValue: Resource<Connection>
): TrailSpec<CrudInput, CrudOutput> => ({
  blaze: () => Result.ok({ ok: true }),
  description: 'synthetic crud trail',
  input: crudInputSchema,
  output: crudOutputSchema,
  resources: [resourceValue],
});

const buildCrudTrail = (
  trailId: string,
  resourceValue: Resource<Connection>
): AnyTrail =>
  trail<CrudInput, CrudOutput>(trailId, {
    ...baseCrudSpec(resourceValue),
    pattern: 'crud',
  });

const buildTrailWithoutPattern = (
  trailId: string,
  resourceValue: Resource<Connection>
): AnyTrail =>
  trail<CrudInput, CrudOutput>(trailId, baseCrudSpec(resourceValue));

const collectUniqueResources = (
  trails: readonly AnyTrail[]
): readonly AnyResource[] => {
  const resources: AnyResource[] = [];
  for (const t of trails) {
    for (const r of t.resources ?? []) {
      if (!resources.includes(r)) {
        resources.push(r);
      }
    }
  }
  return resources;
};

const buildModuleExports = (
  trails: readonly AnyTrail[],
  resources: readonly AnyResource[]
): Record<string, unknown> => {
  const moduleExports: Record<string, unknown> = {};
  for (const [i, t] of trails.entries()) {
    moduleExports[`trail_${i}`] = t;
  }
  for (const [i, r] of resources.entries()) {
    moduleExports[`resource_${i}`] = r;
  }
  return moduleExports;
};

const runRule = async (trails: readonly AnyTrail[]) => {
  const resources = collectUniqueResources(trails);
  const moduleExports = buildModuleExports(trails, resources);
  const t = topo('test-topo', moduleExports);
  return await incompleteAccessorForStandardOp.checkTopo(t);
};

const noop = (): undefined => undefined;
const resolveAsync = async <T>(value: T): Promise<T> =>
  await Promise.resolve(value);

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `warden-trl269-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const buildMisconfiguredTopo = () => {
  const r = buildResource('store.note', 'note', { upsert: noop });
  const t = buildCrudTrail('note.create', r);
  return topo('registry-test-topo', { resource_0: r, trail_0: t });
};

describe('incomplete-accessor-for-standard-op', () => {
  describe('preferred-method presence', () => {
    test('create op with `insert` — no diagnostic', async () => {
      const r = buildResource('store.note', 'note', { insert: noop });
      const t = buildCrudTrail('note.create', r);
      expect(await runRule([t])).toEqual([]);
    });
  });

  describe('fallback semantics', () => {
    test('create op with only `upsert` — warn (fallback available)', async () => {
      const r = buildResource('store.note', 'note', { upsert: noop });
      const t = buildCrudTrail('note.create', r);
      const diagnostics = await runRule([t]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.rule).toBe('incomplete-accessor-for-standard-op');
      expect(diagnostics[0]?.message).toContain('note.create');
      expect(diagnostics[0]?.message).toContain('upsert');
      expect(diagnostics[0]?.message).toContain('insert');
    });

    test('read op missing `get` — error (no fallback)', async () => {
      const r = buildResource('store.note', 'note', { list: noop });
      const t = buildCrudTrail('note.read', r);
      const diagnostics = await runRule([t]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('get');
    });

    test('create op missing both `insert` and `upsert` — error', async () => {
      const r = buildResource('store.note', 'note', { list: noop });
      const t = buildCrudTrail('note.create', r);
      const diagnostics = await runRule([t]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('insert');
      expect(diagnostics[0]?.message).toContain('upsert');
    });

    test('list op missing `list` — error', async () => {
      const r = buildResource('store.note', 'note', { get: noop });
      const t = buildCrudTrail('note.list', r);
      const diagnostics = await runRule([t]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('list');
    });
  });

  describe('silent cases', () => {
    test('trail without pattern=crud is silent', async () => {
      const r = buildResource('store.note', 'note', {});
      const t = buildTrailWithoutPattern('note.create', r);
      expect(await runRule([t])).toEqual([]);
    });

    test('pattern=crud but non-standard op name is silent', async () => {
      const r = buildResource('store.note', 'note', {});
      const t = buildCrudTrail('note.archive', r);
      expect(await runRule([t])).toEqual([]);
    });
  });

  describe('other operations', () => {
    test('update op with only `upsert` — warn', async () => {
      const r = buildResource('store.note', 'note', { upsert: noop });
      const t = buildCrudTrail('note.update', r);
      const diagnostics = await runRule([t]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('warn');
    });

    test('update op missing both `update` and `upsert` — error', async () => {
      const r = buildResource('store.note', 'note', { get: noop });
      const t = buildCrudTrail('note.update', r);
      const diagnostics = await runRule([t]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('update');
      expect(diagnostics[0]?.message).toContain('upsert');
    });

    test('delete op missing `remove` — error', async () => {
      const r = buildResource('store.note', 'note', { get: noop });
      const t = buildCrudTrail('note.delete', r);
      const diagnostics = await runRule([t]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('remove');
    });
  });

  describe('introspection safety', () => {
    test('class-based accessors with prototype methods are inspected', async () => {
      class NoteAccessor {
        insert(): undefined {
          Object.getPrototypeOf(this);
          return undefined;
        }
      }

      const connection = { note: new NoteAccessor() };
      const r = resource<typeof connection>('store.note', {
        create: () => Result.ok(connection),
        mock: () => connection,
      });
      const t = buildCrudTrail('note.create', r);

      expect(await runRule([t])).toEqual([]);
    });

    test('resource without mock is skipped (no false positives)', async () => {
      const emptyConnection: Connection = { note: {} };
      const r = resource<Connection>('store.note', {
        create: () => Result.ok(emptyConnection),
      });
      const t = buildCrudTrail('note.create', r);
      expect(await runRule([t])).toEqual([]);
    });

    test('resource whose mock throws is skipped', async () => {
      const emptyConnection: Connection = { note: {} };
      const r = resource<Connection>('store.note', {
        create: () => Result.ok(emptyConnection),
        mock: () => {
          throw new Error('boom');
        },
      });
      const t = buildCrudTrail('note.create', r);
      expect(await runRule([t])).toEqual([]);
    });

    test('resource whose mock resolves asynchronously is still inspected', async () => {
      const connection: Connection = { note: { upsert: noop } };
      const r = resource<Connection>('store.note', {
        create: () => Result.ok(connection),
        mock: () => resolveAsync(connection),
      });
      const t = buildCrudTrail('note.create', r);
      const diagnostics = await runRule([t]);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain('falls back to "upsert"');
    });

    test('resource mock connections are disposed after inspection', async () => {
      const connection: Connection = { note: { upsert: noop } };
      let disposed = 0;
      const r = resource<Connection>('store.note', {
        create: () => Result.ok(connection),
        dispose: () => {
          disposed += 1;
        },
        mock: () => connection,
      });
      const t = buildCrudTrail('note.create', r);

      const diagnostics = await runRule([t]);

      expect(diagnostics).toHaveLength(1);
      expect(disposed).toBe(1);
    });
  });

  describe('registry wiring', () => {
    test('runWarden dispatches the rule from wardenTopoRules without extras', async () => {
      const dir = makeTempDir();
      try {
        const report = await runWarden({
          lintOnly: true,
          rootDir: dir,
          topo: buildMisconfiguredTopo(),
        });
        const emitted = report.diagnostics.filter(
          (d) => d.rule === 'incomplete-accessor-for-standard-op'
        );
        expect(emitted).toHaveLength(1);
        expect(emitted[0]?.severity).toBe('warn');
        expect(emitted[0]?.message).toContain('note.create');
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    });

    test('runTopoAwareWardenTrails dispatches the exported topo-aware trail once per topo', async () => {
      const diagnostics = await runTopoAwareWardenTrails(
        buildMisconfiguredTopo()
      );
      const emitted = diagnostics.filter(
        (d) => d.rule === 'incomplete-accessor-for-standard-op'
      );

      expect(emitted).toHaveLength(1);
      expect(emitted[0]?.severity).toBe('warn');
      expect(emitted[0]?.message).toContain('note.create');
    });

    test('runWardenTrails remains file-scoped and skips topo-aware diagnostics', async () => {
      const diagnostics = await runWardenTrails('noop.ts', 'export {}');
      const emitted = diagnostics.filter(
        (d) => d.rule === 'incomplete-accessor-for-standard-op'
      );

      expect(emitted).toEqual([]);
    });
  });
});
