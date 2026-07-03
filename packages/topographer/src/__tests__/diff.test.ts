import { describe, test, expect } from 'bun:test';

import { deriveTopoGraphDiff } from '../diff.js';
import { TOPO_GRAPH_SCHEMA_VERSION } from '../types.js';
import type { TopoGraph, TopoGraphEntry } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const entry = (
  overrides: Partial<TopoGraphEntry> & { id: string }
): TopoGraphEntry => ({
  exampleCount: 0,
  kind: 'trail',
  surfaces: [],
  ...overrides,
});

const topoGraph = (entries: TopoGraphEntry[]): TopoGraph => ({
  activationGraph: {
    edgeCount: 0,
    edges: [],
    sourceCount: 0,
    sourceKeys: [],
    trailIds: [],
  },
  activationSources: {},
  entries,
  generatedAt: new Date().toISOString(),
  topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveTopoGraphDiff', () => {
  describe('top-level changes', () => {
    test('empty diff for identical maps', () => {
      const e = entry({ id: 'user.create' });
      const result = deriveTopoGraphDiff(topoGraph([e]), topoGraph([e]));

      expect(result.entries).toHaveLength(0);
      expect(result.hasBreaking).toBe(false);
    });

    test('added trail detected as info', () => {
      const prev = topoGraph([]);
      const curr = topoGraph([entry({ id: 'user.create' })]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.change).toBe('added');
      expect(result.entries[0]?.severity).toBe('info');
      expect(result.info).toHaveLength(1);
    });

    test('added resource detected as info', () => {
      const prev = topoGraph([]);
      const curr = topoGraph([entry({ id: 'db.main', kind: 'resource' })]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.entries[0]?.details).toContain('Resource "db.main" added');
      expect(result.info).toHaveLength(1);
    });

    test('added contour detected as info', () => {
      const prev = topoGraph([]);
      const curr = topoGraph([entry({ id: 'user', kind: 'contour' })]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.entries[0]?.details).toContain('Contour "user" added');
      expect(result.info).toHaveLength(1);
    });

    test('removed trail detected as breaking', () => {
      const prev = topoGraph([entry({ id: 'user.delete' })]);
      const curr = topoGraph([]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.change).toBe('removed');
      expect(result.entries[0]?.severity).toBe('breaking');
      expect(result.hasBreaking).toBe(true);
    });

    test('removed resource detected as breaking', () => {
      const prev = topoGraph([entry({ id: 'db.main', kind: 'resource' })]);
      const curr = topoGraph([]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.entries[0]?.details).toContain(
        'Resource "db.main" removed'
      );
      expect(result.hasBreaking).toBe(true);
    });

    test('DiffResult.hasBreaking is true when any breaking entries exist', () => {
      const prev = topoGraph([entry({ id: 'user.delete' })]);
      const curr = topoGraph([]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(result.breaking.length).toBeGreaterThan(0);
    });
  });

  describe('schema changes', () => {
    test('required input field added classified as breaking', () => {
      const prev = topoGraph([
        entry({
          id: 'user.create',
          input: {
            properties: { name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        }),
      ]);
      const curr = topoGraph([
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
      const result = deriveTopoGraphDiff(prev, curr);

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
      const prev = topoGraph([
        entry({
          id: 'user.create',
          input: {
            properties: { name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        }),
      ]);
      const curr = topoGraph([
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
      const result = deriveTopoGraphDiff(prev, curr);

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
      const prev = topoGraph([
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
      const curr = topoGraph([
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
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(
        result.breaking[0]?.details.some((d) =>
          d.includes('Output field "name" removed')
        )
      ).toBe(true);
    });

    test('output field type changed classified as breaking', () => {
      const prev = topoGraph([
        entry({
          id: 'user.get',
          output: {
            properties: { count: { type: 'number' } },
            type: 'object',
          },
        }),
      ]);
      const curr = topoGraph([
        entry({
          id: 'user.get',
          output: {
            properties: { count: { type: 'string' } },
            type: 'object',
          },
        }),
      ]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(
        result.breaking[0]?.details.some((d) =>
          d.includes('Output field "count" type changed: number -> string')
        )
      ).toBe(true);
    });
  });

  describe('meta and surfaces', () => {
    test('surface removed classified as breaking', () => {
      const prev = topoGraph([
        entry({ id: 'user.list', surfaces: ['cli', 'mcp'] }),
      ]);
      const curr = topoGraph([entry({ id: 'user.list', surfaces: ['mcp'] })]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(
        result.breaking[0]?.details.some((d) =>
          d.includes('Surface "cli" removed')
        )
      ).toBe(true);
    });

    test('CLI path change is classified as breaking', () => {
      const prev = topoGraph([
        entry({ cli: { path: ['topo', 'pin'] }, id: 'topo.pin' }),
      ]);
      const curr = topoGraph([
        entry({ cli: { path: ['topo', 'save'] }, id: 'topo.pin' }),
      ]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(
        result.breaking[0]?.details.some((detail) =>
          detail.includes('CLI path changed: topo pin -> topo save')
        )
      ).toBe(true);
    });

    test('safety marker changes partition by severity', () => {
      const prev = topoGraph([
        entry({ id: 'data.wipe', intent: 'read' }),
        entry({ id: 'data.preview' }),
        entry({ id: 'data.secure', permit: 'public' }),
      ]);
      const curr = topoGraph([
        entry({ id: 'data.wipe', intent: 'destroy' }),
        entry({ dryRunCapable: true, id: 'data.preview' }),
        entry({
          id: 'data.secure',
          permit: { scopes: ['data:write'] },
        }),
      ]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.warnings).toHaveLength(2);
      expect(result.breaking).toHaveLength(1);
      expect(
        result.warnings.some((warning) =>
          warning.details.some((detail) => detail.includes('intent changed'))
        )
      ).toBe(true);
      expect(
        result.warnings.some((warning) =>
          warning.details.some((detail) =>
            detail.includes('dryRunCapable changed')
          )
        )
      ).toBe(true);
      expect(
        result.breaking.some((breaking) =>
          breaking.details.some((detail) => detail.includes('permit changed'))
        )
      ).toBe(true);
    });

    test('adding permit scopes is classified as breaking', () => {
      const prev = topoGraph([
        entry({
          id: 'data.secure',
          permit: { scopes: ['data:read'] },
        }),
      ]);
      const curr = topoGraph([
        entry({
          id: 'data.secure',
          permit: { scopes: ['data:read', 'data:write'] },
        }),
      ]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(result.breaking[0]?.details).toContain(
        'permit changed: {"scopes":["data:read"]} -> {"scopes":["data:read","data:write"]}'
      );
    });

    test('permit scope order does not produce a warning', () => {
      const prev = topoGraph([
        entry({
          id: 'data.secure',
          permit: { scopes: ['data:write', 'data:read'] },
        }),
      ]);
      const curr = topoGraph([
        entry({
          id: 'data.secure',
          permit: { scopes: ['data:read', 'data:write'] },
        }),
      ]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.warnings).toHaveLength(0);
      expect(result.hasBreaking).toBe(false);
    });

    test('description change classified as info', () => {
      const prev = topoGraph([
        entry({ description: 'Get a user', id: 'user.get' }),
      ]);
      const curr = topoGraph([
        entry({ description: 'Fetch a user by ID', id: 'user.get' }),
      ]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.info).toHaveLength(1);
      expect(
        result.info[0]?.details.some((d) => d.includes('Description updated'))
      ).toBe(true);
    });

    test('deprecation added classified as warning', () => {
      const prev = topoGraph([entry({ id: 'entity.list' })]);
      const curr = topoGraph([
        entry({
          deprecated: true,
          id: 'entity.list',
          replacedBy: 'entity.show',
        }),
      ]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.warnings).toHaveLength(1);
      expect(
        result.warnings[0]?.details.some((d) =>
          d.includes('Deprecated (replaced by entity.show)')
        )
      ).toBe(true);
    });

    test('composes changed produces warning', () => {
      const prev = topoGraph([
        entry({
          composes: ['user.get', 'user.lookup'],
          id: 'user.update',
          kind: 'trail',
        }),
      ]);
      const curr = topoGraph([
        entry({
          composes: ['user.get', 'user.search'],
          id: 'user.update',
          kind: 'trail',
        }),
      ]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.warnings).toHaveLength(1);
      const composesDetail = result.warnings[0]?.details.find((d) =>
        d.includes('Composes changed')
      );
      expect(composesDetail).toBeDefined();
      expect(composesDetail).toContain('search');
      expect(composesDetail).toContain('lookup');
    });

    test('declared resources changed produces warning', () => {
      const prev = topoGraph([
        entry({
          id: 'user.update',
          resources: ['db.main', 'search.index'],
        }),
      ]);
      const curr = topoGraph([
        entry({
          id: 'user.update',
          resources: ['db.main', 'cache.main'],
        }),
      ]);
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.warnings).toHaveLength(1);
      const resourceDetail = result.warnings[0]?.details.find((detail) =>
        detail.includes('Resources changed')
      );
      expect(resourceDetail).toBeDefined();
      expect(resourceDetail).toContain('cache.main');
      expect(resourceDetail).toContain('search.index');
    });

    test('new live version entries without examples produce a warning', () => {
      const versionContract = {
        input: { properties: {}, type: 'object' },
        kind: 'revision' as const,
        marker: 'abcd000000000000',
        output: { properties: {}, type: 'object' },
      };
      const prev = topoGraph([
        entry({
          id: 'versioned.trail',
          version: 2,
          versions: {},
        }),
      ]);
      const curr = topoGraph([
        entry({
          id: 'versioned.trail',
          version: 3,
          versions: {
            2: {
              ...versionContract,
              exampleCount: 0,
              status: { note: 'Use the current version.', state: 'deprecated' },
            },
          },
        }),
      ]);

      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.details).toContain(
        'Live version 2 added without examples'
      );
    });

    test('version-entry example count changes are informational', () => {
      const versionContract = {
        input: { properties: {}, type: 'object' },
        kind: 'revision' as const,
        marker: 'abcd000000000000',
        output: { properties: {}, type: 'object' },
      };
      const prev = topoGraph([
        entry({
          id: 'versioned.trail',
          versions: {
            1: { ...versionContract, exampleCount: 1 },
          },
        }),
      ]);
      const curr = topoGraph([
        entry({
          id: 'versioned.trail',
          versions: {
            1: { ...versionContract, exampleCount: 2 },
          },
        }),
      ]);

      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.info[0]?.details).toContain(
        'Live version 1 examples: 1 -> 2'
      );
    });

    test('version markers, support removals, and archived status are visible', () => {
      const versionContract = {
        input: { properties: {}, type: 'object' },
        kind: 'revision' as const,
        output: { properties: {}, type: 'object' },
      };
      const prev = topoGraph([
        entry({
          id: 'versioned.trail',
          marker: 'aaaa000000000000',
          supports: [1, 2, 3],
          version: 3,
          versions: {
            1: {
              ...versionContract,
              exampleCount: 1,
              marker: 'bbbb000000000000',
            },
            2: {
              ...versionContract,
              exampleCount: 1,
              marker: 'cccc000000000000',
            },
          },
        }),
      ]);
      const curr = topoGraph([
        entry({
          id: 'versioned.trail',
          marker: 'dddd000000000000',
          supports: [2, 3],
          version: 3,
          versions: {
            1: {
              ...versionContract,
              exampleCount: 1,
              marker: 'eeee000000000000',
              status: { state: 'archived' },
            },
            2: {
              ...versionContract,
              exampleCount: 1,
              marker: 'cccc000000000000',
            },
          },
        }),
      ]);

      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.hasBreaking).toBe(true);
      expect(result.breaking[0]?.details).toContain(
        'Supported versions removed: 1'
      );
      expect(result.breaking[0]?.details).toContain(
        'Current marker changed: aaaa000000000000 -> dddd000000000000'
      );
      expect(result.breaking[0]?.details).toContain(
        'Version 1 status changed: live -> archived'
      );
      expect(result.breaking[0]?.details).toContain(
        'Version 1 marker changed: bbbb000000000000 -> eeee000000000000'
      );
    });

    test('force event changes are reported as audit warnings', () => {
      const prev = topoGraph([
        entry({
          id: 'versioned.trail',
        }),
      ]);
      const curr = topoGraph([
        entry({
          forces: [
            {
              acceptedAt: '2026-05-20T00:00:00.000Z',
              change: 'modified',
              detail: 'Required input field "name" added',
              id: 'versioned.trail',
              kind: 'trail',
              severity: 'breaking',
              source: 'trails compile --force',
            },
          ],
          id: 'versioned.trail',
        }),
      ]);

      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.warnings[0]?.details).toContain(
        'Force event recorded: modified Required input field "name" added'
      );
    });

    test('graph-level force event changes are reported as audit warnings', () => {
      const prev = topoGraph([
        entry({
          id: 'hello',
        }),
      ]);
      const curr = {
        ...topoGraph([
          entry({
            id: 'hello',
          }),
        ]),
        forces: [
          {
            acceptedAt: '2026-05-20T00:00:00.000Z',
            change: 'removed' as const,
            detail: 'Trail "bye" removed',
            id: 'bye',
            kind: 'trail' as const,
            severity: 'breaking' as const,
            source: 'trails compile --force' as const,
          },
        ],
      };

      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.warnings[0]).toMatchObject({
        id: 'bye',
        kind: 'trail',
      });
      expect(result.warnings[0]?.details).toContain(
        'Force event recorded: removed Trail "bye" removed'
      );
    });
  });

  describe('trailheads', () => {
    test('reports added trailheads as informational', () => {
      const prev = topoGraph([]);
      const curr = {
        ...topoGraph([]),
        trailheads: [
          {
            description: 'Read topo.',
            id: 'topo',
            memberIds: ['topo.read'],
            memberSetHash: 'a'.repeat(64),
            surfaces: ['mcp'],
          },
        ],
      };

      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.info[0]).toMatchObject({
        change: 'added',
        id: 'topo',
        kind: 'trailhead',
      });
      expect(result.info[0]?.details).toContain('Trailhead "topo" added');
    });

    test('reports trailhead membership changes as warnings', () => {
      const prev = {
        ...topoGraph([]),
        trailheads: [
          {
            description: 'Read topo.',
            id: 'topo',
            memberIds: ['topo.read'],
            memberSetHash: 'a'.repeat(64),
            surfaces: ['mcp'],
          },
        ],
      };
      const curr = {
        ...topoGraph([]),
        trailheads: [
          {
            description: 'Read topo.',
            id: 'topo',
            memberIds: ['topo.read', 'topo.describe'],
            memberSetHash: 'b'.repeat(64),
            surfaces: ['mcp'],
          },
        ],
      };

      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.warnings[0]).toMatchObject({
        change: 'modified',
        id: 'topo',
        kind: 'trailhead',
      });
      expect(result.warnings[0]?.details).toContain(
        'Trailhead member added: "topo.describe"'
      );
      expect(result.warnings[0]?.details).toContain(
        'Trailhead member-set hash changed'
      );
    });

    test('reports trailhead description changes as informational', () => {
      const prev = {
        ...topoGraph([]),
        trailheads: [
          {
            description: 'Old topo.',
            id: 'topo',
            memberIds: ['topo.read'],
            memberSetHash: 'a'.repeat(64),
            surfaces: ['mcp'],
          },
        ],
      };
      const curr = {
        ...topoGraph([]),
        trailheads: [
          {
            description: 'New topo.',
            id: 'topo',
            memberIds: ['topo.read'],
            memberSetHash: 'a'.repeat(64),
            surfaces: ['mcp'],
          },
        ],
      };

      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.info[0]).toMatchObject({
        change: 'modified',
        id: 'topo',
        kind: 'trailhead',
      });
      expect(result.info[0]?.details).toContain('Description updated');
    });
  });

  describe('severity partitioning', () => {
    test('DiffResult partitions correctly into breaking, warnings, info', () => {
      const prev = topoGraph([
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
      const curr = topoGraph([
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
      const result = deriveTopoGraphDiff(prev, curr);

      expect(result.entries.length).toBeGreaterThanOrEqual(2);

      const modifiedEntry = result.entries.find((e) => e.id === 'a.trail');
      expect(modifiedEntry?.severity).toBe('breaking');

      const addedEntry = result.entries.find((e) => e.id === 'b.trail');
      expect(addedEntry?.severity).toBe('info');
    });
  });
});
