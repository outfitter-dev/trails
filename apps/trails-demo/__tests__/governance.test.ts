/* oxlint-disable no-conditional-in-test -- if-guards used for TypeScript type narrowing after toBeDefined() */
/* oxlint-disable no-inline-comments -- comments clarify test intent */
/**
 * Integration tests proving the full governance loop works end-to-end.
 *
 * The "five things" that make Trails real:
 * 1. Trailhead map generation
 * 2. Deterministic hashing
 * 3. Breaking change detection
 * 4. Non-breaking change detection
 * 5. Topo validation
 */

import { describe, expect, test } from 'bun:test';

import { Result, trail, topo, validateTopo } from '@ontrails/core';
import {
  diffTrailheadMaps,
  generateTrailheadMap,
  hashTrailheadMap,
} from '@ontrails/schema';
import { z } from 'zod';

import { app } from '../src/app.js';
import * as entitySignals from '../src/signals/entity-signals.js';
import * as demoProvisions from '../src/resources/entity-store.js';
import * as notificationStoreResource from '../src/resources/notification-store.js';
import * as entity from '../src/trails/entity.js';
import * as kv from '../src/trails/kv.js';
import * as notify from '../src/trails/notify.js';
import * as onboard from '../src/trails/onboard.js';
import * as search from '../src/trails/search.js';

// ---------------------------------------------------------------------------
// 1. Trailhead map generation
// ---------------------------------------------------------------------------

describe('trailhead map generation', () => {
  const trailheadMap = generateTrailheadMap(app);

  test('contains all expected trail, event, and resource IDs', () => {
    const ids = trailheadMap.entries.map((e) => e.id);

    expect(ids).toContain('entity.show');
    expect(ids).toContain('entity.add');
    expect(ids).toContain('entity.delete');
    expect(ids).toContain('entity.list');
    expect(ids).toContain('search');
    expect(ids).toContain('entity.onboard');
    expect(ids).toContain('entity.updated');
    expect(ids).toContain('demo.upsert');
    expect(ids).toContain('demo.entity-store');
  });

  test('has exactly 11 entries (8 trails + 1 event + 2 resources)', () => {
    const ids = trailheadMap.entries.map((e) => e.id);

    expect(trailheadMap.entries).toHaveLength(11);
    expect(ids).toContain('entity.notify-updated');
    expect(ids).toContain('demo.notification-store');
  });

  test('entries are sorted alphabetically by id', () => {
    const ids = trailheadMap.entries.map((e) => e.id);
    const sorted = [...ids].toSorted();
    expect(ids).toEqual(sorted);
  });

  test('each entry has the expected fields', () => {
    for (const entry of trailheadMap.entries) {
      expect(entry.id).toBeString();
      expect(entry.kind).toBeOneOf(['trail', 'signal', 'resource']);
      expect(entry.exampleCount).toBeNumber();
      expect(Array.isArray(entry.trailheads)).toBe(true);
    }
  });

  test('trail entries include input schema', () => {
    const showEntry = trailheadMap.entries.find((e) => e.id === 'entity.show');
    expect(showEntry).toBeDefined();
    if (showEntry) {
      expect(showEntry.input).toBeDefined();
      expect(showEntry.kind).toBe('trail');
    }
  });

  test('safety markers are preserved', () => {
    const showEntry = trailheadMap.entries.find((e) => e.id === 'entity.show');
    const deleteEntry = trailheadMap.entries.find(
      (e) => e.id === 'entity.delete'
    );

    expect(showEntry?.intent).toBe('read');
    expect(deleteEntry?.intent).toBe('destroy');
  });

  test('route entries include crosses', () => {
    const onboardEntry = trailheadMap.entries.find(
      (e) => e.id === 'entity.onboard'
    );
    expect(onboardEntry).toBeDefined();
    if (onboardEntry) {
      expect(onboardEntry.kind).toBe('trail');
      expect(onboardEntry.crosses).toBeDefined();
      expect(onboardEntry.crosses).toContain('entity.add');
      expect(onboardEntry.crosses).toContain('search');
    }
  });

  test('event entries include payload schema as input', () => {
    const updatedEntry = trailheadMap.entries.find(
      (e) => e.id === 'entity.updated'
    );
    expect(updatedEntry).toBeDefined();
    if (updatedEntry) {
      expect(updatedEntry.kind).toBe('signal');
      expect(updatedEntry.input).toBeDefined();
    }
  });

  test('resource entries include their description', () => {
    const provisionEntry = trailheadMap.entries.find(
      (e) => e.id === 'demo.entity-store'
    );
    expect(provisionEntry).toBeDefined();
    if (provisionEntry) {
      expect(provisionEntry.kind).toBe('resource');
      expect(provisionEntry.description).toBe(
        'Drizzle-backed in-memory entity store used by the demo trails app.'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Deterministic hashing
// ---------------------------------------------------------------------------

describe('trailhead map hashing is deterministic', () => {
  test('identical topos produce identical hashes', () => {
    const map1 = generateTrailheadMap(app);
    const map2 = generateTrailheadMap(app);

    const hash1 = hashTrailheadMap(map1);
    const hash2 = hashTrailheadMap(map2);

    expect(hash1).toBe(hash2);
  });

  test('hash is a valid 64-character hex string', () => {
    const trailheadMap = generateTrailheadMap(app);
    const hash = hashTrailheadMap(trailheadMap);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('generatedAt timestamp does not affect hash', () => {
    const map1 = generateTrailheadMap(app);

    // Manually create a copy with a different generatedAt
    const map2 = {
      ...map1,
      generatedAt: '2099-12-31T23:59:59.999Z',
    };

    expect(hashTrailheadMap(map1)).toBe(hashTrailheadMap(map2));
  });
});

// ---------------------------------------------------------------------------
// 3. Breaking change detection
// ---------------------------------------------------------------------------

/** Standard entity output schema used by modified trails. */
const entityOutputSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  type: z.string(),
  updatedAt: z.string(),
});

/** Create a modified show trail with a specific input schema. */
const makeModifiedShow = (inputSchema: z.ZodType) =>
  trail('entity.show', {
    blaze: (input) => {
      const { name } = input as { name: string };
      return Result.ok({
        createdAt: '',
        id: '',
        name,
        tags: [] as string[],
        type: '',
        updatedAt: '',
      });
    },
    description: 'Show an entity by name',
    input: inputSchema,
    intent: 'read',
    output: entityOutputSchema,
    resources: [demoProvisions.entityStoreProvision],
  });

/** Diff the baseline app against a modified app. */
const diffAgainst = (...modules: Record<string, unknown>[]) => {
  const before = generateTrailheadMap(app);
  const modifiedApp = topo('demo-modified', ...modules);
  const after = generateTrailheadMap(modifiedApp);
  return diffTrailheadMaps(before, after);
};

describe('breaking change detection', () => {
  test('new required input field is detected as breaking', () => {
    const modifiedShow = makeModifiedShow(
      z.object({ name: z.string(), verbose: z.boolean() })
    );
    const diff = diffAgainst(
      { ...entity, show: modifiedShow },
      search,
      onboard,
      entitySignals,
      kv,
      notify,
      notificationStoreResource,
      demoProvisions
    );

    expect(diff.hasBreaking).toBe(true);
    expect(diff.breaking.length).toBeGreaterThan(0);

    const showDiff = diff.breaking.find((e) => e.id === 'entity.show');
    expect(showDiff).toBeDefined();
    if (showDiff) {
      expect(showDiff.severity).toBe('breaking');
      expect(showDiff.change).toBe('modified');
      expect(showDiff.details.some((d) => d.includes('verbose'))).toBe(true);
    }
  });

  test('removed trail is detected as breaking', () => {
    const diff = diffAgainst(
      entity,
      onboard,
      entitySignals,
      kv,
      notify,
      notificationStoreResource,
      demoProvisions
    );

    expect(diff.hasBreaking).toBe(true);
    const searchRemoved = diff.breaking.find((e) => e.id === 'search');
    expect(searchRemoved).toBeDefined();
    if (searchRemoved) {
      expect(searchRemoved.change).toBe('removed');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Non-breaking change detection
// ---------------------------------------------------------------------------

describe('non-breaking change detection', () => {
  test('added trail is detected as info severity', () => {
    const update = trail('entity.update', {
      blaze: (input) => Result.ok({ name: input.name, updated: true }),
      description: 'Update an existing entity',
      input: z.object({
        name: z.string(),
        tags: z.array(z.string()).optional(),
      }),
      output: z.object({ name: z.string(), updated: z.boolean() }),
    });

    const diff = diffAgainst(
      entity,
      search,
      onboard,
      entitySignals,
      kv,
      notify,
      notificationStoreResource,
      demoProvisions,
      { update }
    );
    expect(diff.hasBreaking).toBe(false);

    const addedEntry = diff.info.find((e) => e.id === 'entity.update');
    expect(addedEntry).toBeDefined();
    if (addedEntry) {
      expect(addedEntry.severity).toBe('info');
      expect(addedEntry.change).toBe('added');
    }
  });

  test('optional input field added is non-breaking', () => {
    const modifiedShow = makeModifiedShow(
      z.object({ name: z.string(), verbose: z.boolean().optional() })
    );
    const diff = diffAgainst(
      { ...entity, show: modifiedShow },
      search,
      onboard,
      entitySignals,
      kv,
      notify,
      notificationStoreResource,
      demoProvisions
    );
    expect(diff.hasBreaking).toBe(false);

    const showDiff = diff.info.find((e) => e.id === 'entity.show');
    expect(showDiff).toBeDefined();
    if (showDiff) {
      expect(showDiff.severity).toBe('info');
      expect(showDiff.details.some((d) => d.includes('verbose'))).toBe(true);
    }
  });

  test('no changes produces empty diff', () => {
    const map1 = generateTrailheadMap(app);
    const map2 = generateTrailheadMap(app);
    const diff = diffTrailheadMaps(map1, map2);

    expect(diff.hasBreaking).toBe(false);
    expect(diff.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Topo validation
// ---------------------------------------------------------------------------

describe('topo validation', () => {
  test('validateTopo passes for the demo app', () => {
    const result = validateTopo(app);
    expect(result.isOk()).toBe(true);
  });

  test('all trails in the topo have at least one example', () => {
    for (const [_id, t] of app.trails) {
      const trailDef = t as { examples?: readonly unknown[] };
      expect(trailDef.examples?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test('topo contains the expected number of trails with examples', () => {
    let exampleCount = 0;
    for (const [_id, t] of app.trails) {
      const trailDef = t as { examples?: readonly unknown[] };
      exampleCount += trailDef.examples?.length ?? 0;
    }
    // 5 trails x 2 examples each + 1 onboard trail x 1 example + 1 kv trail x 1 example + 1 notify trail x 1 example = 13
    expect(exampleCount).toBe(13);
  });
});
