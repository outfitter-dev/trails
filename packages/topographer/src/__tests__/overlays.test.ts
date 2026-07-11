import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Result,
  ValidationError,
  openWriteTrailsDb,
  surfaceOverlay,
  surfaceOverlayBindingsSchema,
  topo,
  trail,
} from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import { z } from 'zod';

import {
  createStoredTopoSnapshot,
  getStoredTopoExport,
} from '../backend-support.js';
import { deriveTopoGraph } from '../derive.js';
import { deriveTopoGraphHash } from '../hash.js';
import { collectTopoGraphOverlays } from '../overlays.js';
import {
  TRAILS_LOCK_SCHEMA_VERSION,
  topoGraphSchema,
  trailsLockSchema,
} from '../types.js';
import type {
  TopoGraph,
  TopoGraphOverlayRegistration,
  TrailsLock,
} from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noop = () => Result.ok({ ok: true });

const buildApp = (): Topo =>
  topo('overlays-app', {
    entityAdd: trail('entity.add', {
      implementation: noop,
      input: z.object({ name: z.string() }),
      output: z.object({ ok: z.boolean() }),
    }),
  });

/** Insert keys in deliberately unsorted order to prove canonicalization. */
const unsortedWorker = (): Record<string, unknown> =>
  Object.fromEntries([
    ['routes', ['b-route', 'a-route']],
    ['name', 'edge'],
  ]);

const cloudflareOverlay: TopoGraphOverlayRegistration = {
  derive: () => ({
    workers: [unsortedWorker()],
  }),
  namespace: 'cloudflare',
  schema: z.object({
    workers: z.array(
      z.object({ name: z.string(), routes: z.array(z.string()) })
    ),
  }),
};

const zetaOverlay: TopoGraphOverlayRegistration = {
  derive: (tp) => ({ trailCount: tp.trails.size }),
  namespace: 'zeta.family',
  schema: z.object({ trailCount: z.number().int() }),
};

const graphWithoutGeneratedAt = (
  graph: ReturnType<typeof deriveTopoGraph>
): TopoGraph => {
  const { generatedAt: _unused, ...rest } = graph;
  return rest;
};

const lockFor = (graph: TopoGraph): TrailsLock =>
  trailsLockSchema.parse({
    scope: { app: 'overlays-app' },
    summary: { contours: 0, resources: 0, signals: 0, trails: 1 },
    topoGraph: graph,
    topoGraphHash: deriveTopoGraphHash(graph),
    version: TRAILS_LOCK_SCHEMA_VERSION,
  });

const captureValidationError = (attempt: () => unknown): ValidationError => {
  try {
    attempt();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error('Expected a ValidationError');
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('topo graph overlays', () => {
  describe('back-compat', () => {
    test('deriveTopoGraph without registrations omits the overlays key', () => {
      const graph = deriveTopoGraph(buildApp());
      expect(Object.hasOwn(graph, 'overlays')).toBe(false);
    });

    test('collectTopoGraphOverlays returns undefined for missing or empty registrations', () => {
      const app = buildApp();
      // oxlint-disable-next-line no-useless-undefined -- exercising the explicit-undefined registrations path
      expect(collectTopoGraphOverlays(app, undefined)).toBeUndefined();
      expect(collectTopoGraphOverlays(app, [])).toBeUndefined();
    });

    test('a serialized graph without overlays still parses via topoGraphSchema and trailsLockSchema', () => {
      const graph = graphWithoutGeneratedAt(deriveTopoGraph(buildApp()));
      const graphBytes = JSON.stringify(graph);

      const graphResult = topoGraphSchema.safeParse(JSON.parse(graphBytes));
      expect(graphResult.success).toBe(true);

      const lockBytes = JSON.stringify(lockFor(graph));
      const lockResult = trailsLockSchema.safeParse(JSON.parse(lockBytes));
      expect(lockResult.success).toBe(true);
    });
  });

  describe('registration', () => {
    test('embeds schema-parsed, deep-key-sorted facts under the namespace', () => {
      const graph = deriveTopoGraph(buildApp(), {
        overlays: [cloudflareOverlay],
      });

      expect(graph.overlays).toEqual({
        cloudflare: {
          workers: [{ name: 'edge', routes: ['b-route', 'a-route'] }],
        },
      });
      // Deep key-sort: object keys serialize sorted, array order is preserved.
      expect(JSON.stringify(graph.overlays?.['cloudflare'])).toBe(
        '{"workers":[{"name":"edge","routes":["b-route","a-route"]}]}'
      );
    });

    test('assembles namespaces sorted lexicographically regardless of registration order', () => {
      const graph = deriveTopoGraph(buildApp(), {
        overlays: [zetaOverlay, cloudflareOverlay],
      });

      expect(Object.keys(graph.overlays ?? {})).toEqual([
        'cloudflare',
        'zeta.family',
      ]);
      expect(graph.overlays?.['zeta.family']).toEqual({ trailCount: 1 });
    });
  });

  describe('surfaces namespace', () => {
    test('embeds a surfaceOverlay()\'s bindings under "surfaces"', () => {
      const overlays = collectTopoGraphOverlays(buildApp(), [
        cloudflareOverlay,
        surfaceOverlay({
          cli: { add: 'entity.add' },
          mcp: { entities: ['entity.*'] },
        }),
      ]);

      expect(overlays?.['surfaces']).toEqual({
        cli: { add: 'entity.add' },
        mcp: { entities: ['entity.*'] },
      });
      // Existing adapter namespaces are unaffected by the surfaces gate.
      expect(overlays?.['cloudflare']).toEqual({
        workers: [{ name: 'edge', routes: ['b-route', 'a-route'] }],
      });
    });

    test('throws for a "surfaces" registration without app-authored provenance', () => {
      const error = captureValidationError(() =>
        collectTopoGraphOverlays(buildApp(), [
          {
            derive: () => ({ cli: { add: 'entity.add' } }),
            namespace: 'surfaces',
            schema: surfaceOverlayBindingsSchema,
          },
        ])
      );
      expect(error.message).toContain('surfaces');
      expect(error.message).toContain('surfaceOverlay()');
      expect(error.message).toContain('trails compile');
    });

    test('throws for an explicit adapter-derived "surfaces" registration', () => {
      const error = captureValidationError(() =>
        collectTopoGraphOverlays(buildApp(), [
          {
            derive: () => ({ cli: { add: 'entity.add' } }),
            namespace: 'surfaces',
            provenance: 'adapter-derived',
            schema: surfaceOverlayBindingsSchema,
          },
        ])
      );
      expect(error.message).toContain('surfaceOverlay()');
    });
  });

  describe('determinism', () => {
    test('consecutive derivations produce equal hashes', () => {
      const first = deriveTopoGraph(buildApp(), {
        overlays: [cloudflareOverlay],
      });
      const second = deriveTopoGraph(buildApp(), {
        overlays: [cloudflareOverlay],
      });
      expect(deriveTopoGraphHash(first)).toBe(deriveTopoGraphHash(second));
    });

    test('the canonical hash covers overlays', () => {
      const without = deriveTopoGraph(buildApp());
      const withOverlays = deriveTopoGraph(buildApp(), {
        overlays: [cloudflareOverlay],
      });
      expect(deriveTopoGraphHash(withOverlays)).not.toBe(
        deriveTopoGraphHash(without)
      );
    });

    test('the hash is stable across a JSON round-trip', () => {
      const graph = deriveTopoGraph(buildApp(), {
        overlays: [cloudflareOverlay],
      });
      const graphBytes = JSON.stringify(graph);
      const roundTripped = JSON.parse(graphBytes) as TopoGraph;
      expect(deriveTopoGraphHash(roundTripped)).toBe(
        deriveTopoGraphHash(graph)
      );
    });
  });

  describe('tolerant reader', () => {
    test('an unregistered namespace round-trips byte-preserved and hash-stable through trailsLockSchema', () => {
      const graphWithUnknown: TopoGraph = {
        ...graphWithoutGeneratedAt(deriveTopoGraph(buildApp())),
        overlays: { 'future.family': { anything: [1, 2, 3] } },
      };

      // Parse once to obtain canonical bytes in zod's shape order, then
      // assert parse(stringify(parse(x))) is byte-stable.
      const first = lockFor(graphWithUnknown);
      const canonicalBytes = JSON.stringify(first);
      const second = trailsLockSchema.parse(JSON.parse(canonicalBytes));

      expect(JSON.stringify(second)).toBe(canonicalBytes);
      expect(second.topoGraph.overlays).toEqual({
        'future.family': { anything: [1, 2, 3] },
      });
      expect(deriveTopoGraphHash(second.topoGraph as TopoGraph)).toBe(
        deriveTopoGraphHash(graphWithUnknown)
      );
    });
  });

  describe('failure modes', () => {
    test('a namespace outside the dotted-kebab grammar throws with compile guidance', () => {
      const error = captureValidationError(() =>
        deriveTopoGraph(buildApp(), {
          overlays: [{ ...cloudflareOverlay, namespace: 'Bad.Namespace' }],
        })
      );
      expect(error.message).toContain('Bad.Namespace');
      expect(error.message).toContain('trails compile');
      expect(error.message).not.toMatch(/lock/i);
    });

    test('duplicate namespaces throw with compile guidance', () => {
      const error = captureValidationError(() =>
        deriveTopoGraph(buildApp(), {
          overlays: [cloudflareOverlay, cloudflareOverlay],
        })
      );
      expect(error.message).toContain('Duplicate overlay namespace');
      expect(error.message).toContain('"cloudflare"');
      expect(error.message).toContain('trails compile');
      expect(error.message).not.toMatch(/lock/i);
    });

    test('derive output that fails the registered schema throws with the issue summary', () => {
      const error = captureValidationError(() =>
        deriveTopoGraph(buildApp(), {
          overlays: [
            {
              derive: () => ({ trailCount: 'not-a-number' }),
              namespace: 'zeta.family',
              schema: z.object({ trailCount: z.number() }),
            },
          ],
        })
      );
      expect(error.message).toContain('zeta.family');
      expect(error.message).toContain('trailCount');
      expect(error.message).toContain('trails compile');
      expect(error.message).not.toMatch(/lock/i);
    });

    test('non-JSON-serializable derive output throws with compile guidance', () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      const error = captureValidationError(() =>
        deriveTopoGraph(buildApp(), {
          overlays: [
            {
              derive: () => circular,
              namespace: 'circular-ns',
              schema: z.unknown(),
            },
          ],
        })
      );
      expect(error.message).toContain('circular-ns');
      expect(error.message).toContain('trails compile');
      expect(error.message).not.toMatch(/lock/i);
    });
  });

  describe('store parity', () => {
    let tmpRoot: string | undefined;
    let testStateHome: string | undefined;
    let originalTrailsStateHome: string | undefined;

    beforeEach(() => {
      originalTrailsStateHome = process.env['TRAILS_STATE_HOME'];
      testStateHome = mkdtempSync(join(tmpdir(), 'overlays-store-state-'));
      process.env['TRAILS_STATE_HOME'] = testStateHome;
    });

    afterEach(() => {
      if (originalTrailsStateHome === undefined) {
        delete process.env['TRAILS_STATE_HOME'];
      } else {
        process.env['TRAILS_STATE_HOME'] = originalTrailsStateHome;
      }
      if (tmpRoot) {
        rmSync(tmpRoot, { force: true, recursive: true });
        tmpRoot = undefined;
      }
      if (testStateHome) {
        rmSync(testStateHome, { force: true, recursive: true });
        testStateHome = undefined;
      }
    });

    test('the stored export embeds the same overlays and hash as a fresh derivation', () => {
      tmpRoot = mkdtempSync(join(tmpdir(), 'overlays-store-'));
      const db = openWriteTrailsDb({ rootDir: tmpRoot });
      try {
        const created = createStoredTopoSnapshot(db, buildApp(), {
          createdAt: '2026-07-05T00:00:00.000Z',
          overlays: [zetaOverlay, cloudflareOverlay],
        });
        if (created.isErr()) {
          throw created.error;
        }

        const stored = getStoredTopoExport(db, created.value.id);
        if (stored === undefined) {
          throw new Error('Expected a stored topo export');
        }

        const storedGraph = JSON.parse(stored.topoGraphJson) as TopoGraph;
        const derived = deriveTopoGraph(buildApp(), {
          overlays: [zetaOverlay, cloudflareOverlay],
        });

        expect(storedGraph.overlays).toEqual({
          cloudflare: {
            workers: [{ name: 'edge', routes: ['b-route', 'a-route'] }],
          },
          'zeta.family': { trailCount: 1 },
        });
        expect(storedGraph.overlays).toEqual(derived.overlays ?? {});
        expect(stored.topoGraphHash).toBe(deriveTopoGraphHash(storedGraph));
        expect(stored.topoGraphHash).toBe(deriveTopoGraphHash(derived));
      } finally {
        db.close();
      }
    });
  });
});
