import { describe, expect, test } from 'bun:test';

import { missingReconcile } from '../rules/missing-reconcile.js';

const TEST_FILE = 'store.ts';

describe('missing-reconcile', () => {
  test('warns when a versioned store table is used with crud() but no reconcile() trail exists', () => {
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
    versioned: true,
  },
});

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const noteTrails = crud(definition.tables.notes, notesResource);
`;

    const diagnostics = missingReconcile.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('missing-reconcile');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('notes');
    expect(diagnostics[0]?.message).toContain('reconcile');
  });

  test('stays quiet when reconcile() is present for the versioned table', () => {
    const code = `
import { Result, resource } from '@ontrails/core';
import { store } from '@ontrails/store';
import { crud, reconcile } from '@ontrails/store/trails';
import { z } from 'zod';

const definition = store({
  notes: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      title: z.string(),
    }),
    versioned: true,
  },
});

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const noteTrails = crud(definition.tables.notes, notesResource);
const reconcileNote = reconcile({
  resource: notesResource,
  table: definition.tables.notes,
});
`;

    expect(missingReconcile.check(code, TEST_FILE)).toEqual([]);
  });

  test('tracks two stores with colliding table names independently', () => {
    const code = `
import { Result, resource } from '@ontrails/core';
import { store } from '@ontrails/store';
import { crud, reconcile } from '@ontrails/store/trails';
import { z } from 'zod';

const primary = store({
  notes: {
    identity: 'id',
    schema: z.object({ id: z.string(), title: z.string() }),
    versioned: true,
  },
});

const archive = store({
  notes: {
    identity: 'id',
    schema: z.object({ id: z.string(), title: z.string() }),
    versioned: true,
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

// primary gets both crud and reconcile — should be quiet
const primaryCrud = crud(primary.tables.notes, primaryResource);
const primaryReconcile = reconcile({
  resource: primaryResource,
  table: primary.tables.notes,
});

// archive only gets crud — should warn ONCE for archive (not primary)
const archiveCrud = crud(archive.tables.notes, archiveResource);
`;

    const diagnostics = missingReconcile.check(code, TEST_FILE);

    // Only archive should warn; primary's reconcile is correctly paired.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('missing-reconcile');
    expect(diagnostics[0]?.message).toContain('notes');
  });

  test('stays quiet for non-versioned tables even when crud() is present', () => {
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

    expect(missingReconcile.check(code, TEST_FILE)).toEqual([]);
  });
});
