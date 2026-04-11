import { describe, expect, test } from 'bun:test';

import { orphanedSignal } from '../rules/orphaned-signal.js';

const TEST_FILE = 'store.ts';

describe('orphaned-signal', () => {
  test('warns when a crud-backed store table has no reactive consumers for its change signals', () => {
    const code = `
import { Result, resource } from '@ontrails/core';
import { store } from '@ontrails/store';
import { crud } from '@ontrails/store/trails';
import { z } from 'zod';

const definition = store({
  notes: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      title: z.string(),
    }),
  },
});

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const noteTrails = crud(definition.tables.notes, notesResource);
`;

    const diagnostics = orphanedSignal.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('orphaned-signal');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('notes');
    expect(diagnostics[0]?.message).toContain('notes.created');
    expect(diagnostics[0]?.message).toContain('notes.updated');
    expect(diagnostics[0]?.message).toContain('notes.removed');
  });

  test('stays quiet when all derived change signals are consumed elsewhere in the project', () => {
    const code = `
import { store } from '@ontrails/store';
import { z } from 'zod';

const definition = store({
  notes: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      title: z.string(),
    }),
  },
});
`;

    const diagnostics = orphanedSignal.checkWithContext(code, TEST_FILE, {
      // Keys are composite (`${storeBinding}:${tableName}`) so two stores
      // that share a table name don't collide across files.
      crudTableIds: new Set(['definition:notes']),
      knownTrailIds: new Set(['notes.notify']),
      onTargetSignalIds: new Set([
        'definition:notes.created',
        'definition:notes.updated',
        'definition:notes.removed',
      ]),
    });

    expect(diagnostics).toEqual([]);
  });

  test('tracks two stores with colliding table names independently', () => {
    const code = `
import { Result, resource } from '@ontrails/core';
import { store } from '@ontrails/store';
import { crud } from '@ontrails/store/trails';
import { z } from 'zod';

const primary = store({
  notes: {
    identity: 'id',
    schema: z.object({ id: z.string(), title: z.string() }),
  },
});

const archive = store({
  notes: {
    identity: 'id',
    schema: z.object({ id: z.string(), title: z.string() }),
  },
});

const primaryResource = resource('db.primary', {
  create: () => Result.ok({}),
  mock: () => ({}),
});
const archiveResource = resource('db.archive', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const primaryTrails = crud(primary.tables.notes, primaryResource);
const archiveTrails = crud(archive.tables.notes, archiveResource);
`;

    const diagnostics = orphanedSignal.check(code, TEST_FILE);

    // Both stores warn, but independently — not one combined message.
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.rule).toBe('orphaned-signal');
      expect(diagnostic.message).toContain('notes');
    }
  });

  test('stays quiet when the table is not used with crud()', () => {
    const code = `
import { store } from '@ontrails/store';
import { z } from 'zod';

const definition = store({
  notes: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      title: z.string(),
    }),
  },
});
`;

    expect(orphanedSignal.check(code, TEST_FILE)).toEqual([]);
  });
});
