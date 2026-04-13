import { describe, expect, test } from 'bun:test';

import { incompleteCrud } from '../rules/incomplete-crud.js';

const TEST_FILE = 'entity.ts';

describe('incomplete-crud', () => {
  test('warns when deriveTrail only covers part of the CRUD set', () => {
    const code = `
import { Result, contour, resource } from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import { z } from 'zod';

const note = contour('note', {
  body: z.string(),
  id: z.string(),
  title: z.string(),
}, { identity: 'id' });

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

export const createNote = deriveTrail(note, 'create', {
  blaze: async () => Result.ok({}),
  resource: notesResource,
});

export const readNote = deriveTrail(note, 'read', {
  blaze: async () => Result.ok({}),
  resource: notesResource,
});
`;

    const diagnostics = incompleteCrud.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('incomplete-crud');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('note');
    expect(diagnostics[0]?.message).toContain('create');
    expect(diagnostics[0]?.message).toContain('read');
  });

  test('warns when crud() tuple destructuring captures only part of the standard trails', () => {
    const code = `
import { Result, resource } from '@ontrails/core';
import { store } from '@ontrails/store';
import { crud } from '@ontrails/store/trails';
import { z } from 'zod';

const db = store({
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

const [createNote, readNote] = crud(db.tables.notes, notesResource);
`;

    const diagnostics = incompleteCrud.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('incomplete-crud');
    expect(diagnostics[0]?.message).toContain('notes');
    expect(diagnostics[0]?.message).toContain('create');
    expect(diagnostics[0]?.message).toContain('read');
  });

  test('stays quiet when the full CRUD tuple is captured', () => {
    const code = `
import { Result, resource } from '@ontrails/core';
import { store } from '@ontrails/store';
import { crud } from '@ontrails/store/trails';
import { z } from 'zod';

const db = store({
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

const [createNote, readNote, updateNote, deleteNote, listNote] = crud(
  db.tables.notes,
  notesResource
);
`;

    expect(incompleteCrud.check(code, TEST_FILE)).toEqual([]);
  });

  test('tracks deriveTrail coverage for imported contours as pending-resolution', () => {
    const code = `
import { Result, resource } from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import { note } from './shared/contours.js';

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

export const createNote = deriveTrail(note, 'create', {
  blaze: async () => Result.ok({}),
  resource: notesResource,
});

export const readNote = deriveTrail(note, 'read', {
  blaze: async () => Result.ok({}),
  resource: notesResource,
});
`;

    const diagnostics = incompleteCrud.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('incomplete-crud');
    // Imported contours surface as pending-resolution so coverage is still tracked.
    expect(diagnostics[0]?.message).toContain('note');
    expect(diagnostics[0]?.message).toContain('pending-resolution');
    expect(diagnostics[0]?.message).toContain('create');
    expect(diagnostics[0]?.message).toContain('read');
  });

  test('does not warn when imported contour covers the full CRUD set', () => {
    const code = `
import { Result, resource } from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import { note } from './shared/contours.js';

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

export const createNote = deriveTrail(note, 'create', { blaze: async () => Result.ok({}), resource: notesResource });
export const readNote = deriveTrail(note, 'read', { blaze: async () => Result.ok({}), resource: notesResource });
export const updateNote = deriveTrail(note, 'update', { blaze: async () => Result.ok({}), resource: notesResource });
export const deleteNote = deriveTrail(note, 'delete', { blaze: async () => Result.ok({}), resource: notesResource });
export const listNote = deriveTrail(note, 'list', { blaze: async () => Result.ok({}), resource: notesResource });
`;

    expect(incompleteCrud.check(code, TEST_FILE)).toEqual([]);
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

// primary is fully covered
const [createPrimary, readPrimary, updatePrimary, deletePrimary, listPrimary] =
  crud(primary.tables.notes, primaryResource);

// archive is partially covered — the warning should target only archive
const [createArchive, readArchive] = crud(archive.tables.notes, archiveResource);
`;

    const diagnostics = incompleteCrud.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('incomplete-crud');
    // Stores are keyed by their local binding, so the colliding bare name
    // `notes` does not cause archive coverage to leak into primary.
    expect(diagnostics[0]?.message).toContain('archive:notes');
    expect(diagnostics[0]?.message).toContain('create');
    expect(diagnostics[0]?.message).toContain('read');
  });
});
