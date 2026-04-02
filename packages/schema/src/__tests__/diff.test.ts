import { describe, test, expect } from 'bun:test';

import { diffTrailheadMaps } from '../diff.js';
import type { TrailheadMap, TrailheadMapEntry } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const entry = (
  overrides: Partial<TrailheadMapEntry> & { id: string }
): TrailheadMapEntry => ({
  exampleCount: 0,
  kind: 'trail',
  trailheads: [],
  ...overrides,
});

const trailheadMap = (entries: TrailheadMapEntry[]): TrailheadMap => ({
  entries,
  generatedAt: new Date().toISOString(),
  version: '1.0',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('diffTrailheadMaps', () => {
  describe('top-level changes', () => {
    test('empty diff for identical maps', () => {
      const e = entry({ id: 'user.create' });
      const result = diffTrailheadMaps(trailheadMap([e]), trailheadMap([e]));

      expect(result.entries).toHaveLength(0);
      expect(result.hasBreaking).toBe(false);
    });

    test('added trail detected as info', () => {
      const prev = trailheadMap([]);
      const curr = trailheadMap([entry({ id: 'user.create' })]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.change).toBe('added');
      expect(result.entries[0]?.severity).toBe('info');
      expect(result.info).toHaveLength(1);
    });

    test('added provision detected as info', () => {
      const prev = trailheadMap([]);
      const curr = trailheadMap([entry({ id: 'db.main', kind: 'provision' })]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.entries[0]?.details).toContain('Provision "db.main" added');
      expect(result.info).toHaveLength(1);
    });

    test('removed trail detected as breaking', () => {
      const prev = trailheadMap([entry({ id: 'user.delete' })]);
      const curr = trailheadMap([]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.change).toBe('removed');
      expect(result.entries[0]?.severity).toBe('breaking');
      expect(result.hasBreaking).toBe(true);
    });

    test('removed provision detected as breaking', () => {
      const prev = trailheadMap([entry({ id: 'db.main', kind: 'provision' })]);
      const curr = trailheadMap([]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.entries[0]?.details).toContain(
        'Provision "db.main" removed'
      );
      expect(result.hasBreaking).toBe(true);
    });

    test('DiffResult.hasBreaking is true when any breaking entries exist', () => {
      const prev = trailheadMap([entry({ id: 'user.delete' })]);
      const curr = trailheadMap([]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(result.breaking.length).toBeGreaterThan(0);
    });
  });

  describe('schema changes', () => {
    test('required input field added classified as breaking', () => {
      const prev = trailheadMap([
        entry({
          id: 'user.create',
          input: {
            properties: { name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        }),
      ]);
      const curr = trailheadMap([
        entry({
          id: 'user.create',
          input: {
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
            },
            required: ['name', 'type'],
            type: 'object',
          },
        }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(result.breaking).toHaveLength(1);
      const [breakingEntry] = result.breaking;
      expect(breakingEntry).toBeDefined();
      expect(
        breakingEntry?.details.some((d) =>
          d.includes('Required input field "type" added')
        )
      ).toBe(true);
    });

    test('optional input field added classified as info', () => {
      const prev = trailheadMap([
        entry({
          id: 'user.create',
          input: {
            properties: { name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        }),
      ]);
      const curr = trailheadMap([
        entry({
          id: 'user.create',
          input: {
            properties: {
              filter: { type: 'string' },
              name: { type: 'string' },
            },
            required: ['name'],
            type: 'object',
          },
        }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.info).toHaveLength(1);
      const [infoEntry] = result.info;
      expect(infoEntry).toBeDefined();
      expect(
        infoEntry?.details.some((d) =>
          d.includes('Optional input field "filter" added')
        )
      ).toBe(true);
    });

    test('output field removed classified as breaking', () => {
      const prev = trailheadMap([
        entry({
          id: 'user.get',
          output: {
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
            type: 'object',
          },
        }),
      ]);
      const curr = trailheadMap([
        entry({
          id: 'user.get',
          output: {
            properties: {
              id: { type: 'string' },
            },
            type: 'object',
          },
        }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(
        result.breaking[0]?.details.some((d) =>
          d.includes('Output field "name" removed')
        )
      ).toBe(true);
    });

    test('output field type changed classified as breaking', () => {
      const prev = trailheadMap([
        entry({
          id: 'user.get',
          output: {
            properties: { count: { type: 'number' } },
            type: 'object',
          },
        }),
      ]);
      const curr = trailheadMap([
        entry({
          id: 'user.get',
          output: {
            properties: { count: { type: 'string' } },
            type: 'object',
          },
        }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(
        result.breaking[0]?.details.some((d) =>
          d.includes('Output field "count" type changed: number -> string')
        )
      ).toBe(true);
    });
  });

  describe('meta and trailheads', () => {
    test('trailhead removed classified as breaking', () => {
      const prev = trailheadMap([
        entry({ id: 'user.list', trailheads: ['cli', 'mcp'] }),
      ]);
      const curr = trailheadMap([
        entry({ id: 'user.list', trailheads: ['mcp'] }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(
        result.breaking[0]?.details.some((d) =>
          d.includes('Trailhead "cli" removed')
        )
      ).toBe(true);
    });

    test('safety marker changed classified as warning', () => {
      const prev = trailheadMap([entry({ id: 'data.wipe', intent: 'read' })]);
      const curr = trailheadMap([
        entry({ id: 'data.wipe', intent: 'destroy' }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.warnings).toHaveLength(1);
      expect(
        result.warnings[0]?.details.some((d) => d.includes('intent changed'))
      ).toBe(true);
    });

    test('description change classified as info', () => {
      const prev = trailheadMap([
        entry({ description: 'Get a user', id: 'user.get' }),
      ]);
      const curr = trailheadMap([
        entry({ description: 'Fetch a user by ID', id: 'user.get' }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.info).toHaveLength(1);
      expect(
        result.info[0]?.details.some((d) => d.includes('Description updated'))
      ).toBe(true);
    });

    test('deprecation added classified as warning', () => {
      const prev = trailheadMap([entry({ id: 'entity.list' })]);
      const curr = trailheadMap([
        entry({
          deprecated: true,
          id: 'entity.list',
          replacedBy: 'entity.show',
        }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.warnings).toHaveLength(1);
      expect(
        result.warnings[0]?.details.some((d) =>
          d.includes('Deprecated (replaced by entity.show)')
        )
      ).toBe(true);
    });

    test('crosses changed produces warning', () => {
      const prev = trailheadMap([
        entry({
          crosses: ['user.get', 'user.lookup'],
          id: 'user.update',
          kind: 'trail',
        }),
      ]);
      const curr = trailheadMap([
        entry({
          crosses: ['user.get', 'user.search'],
          id: 'user.update',
          kind: 'trail',
        }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.warnings).toHaveLength(1);
      const crossesDetail = result.warnings[0]?.details.find((d) =>
        d.includes('Crosses changed')
      );
      expect(crossesDetail).toBeDefined();
      expect(crossesDetail).toContain('search');
      expect(crossesDetail).toContain('lookup');
    });

    test('declared provisions changed produces warning', () => {
      const prev = trailheadMap([
        entry({
          id: 'user.update',
          provisions: ['db.main', 'search.index'],
        }),
      ]);
      const curr = trailheadMap([
        entry({
          id: 'user.update',
          provisions: ['db.main', 'cache.main'],
        }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.warnings).toHaveLength(1);
      const provisionDetail = result.warnings[0]?.details.find((detail) =>
        detail.includes('Provisions changed')
      );
      expect(provisionDetail).toBeDefined();
      expect(provisionDetail).toContain('cache.main');
      expect(provisionDetail).toContain('search.index');
    });
  });

  describe('severity partitioning', () => {
    test('DiffResult partitions correctly into breaking, warnings, info', () => {
      const prev = trailheadMap([
        entry({
          description: 'old',
          id: 'a.trail',
          intent: 'read',
          output: {
            properties: { removed: { type: 'string' } },
            type: 'object',
          },
        }),
      ]);
      const curr = trailheadMap([
        entry({
          description: 'new',
          id: 'a.trail',
          intent: 'destroy',
          output: {
            properties: {},
            type: 'object',
          },
        }),
        entry({ id: 'b.trail' }),
      ]);
      const result = diffTrailheadMaps(prev, curr);

      expect(result.entries.length).toBeGreaterThanOrEqual(2);

      const modifiedEntry = result.entries.find((e) => e.id === 'a.trail');
      expect(modifiedEntry?.severity).toBe('breaking');

      const addedEntry = result.entries.find((e) => e.id === 'b.trail');
      expect(addedEntry?.severity).toBe('info');
    });
  });
});
