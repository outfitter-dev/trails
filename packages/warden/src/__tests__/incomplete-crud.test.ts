import { describe, expect, test } from 'bun:test';

import { incompleteCrud } from '../rules/incomplete-crud.js';
import type { ProjectContext } from '../rules/types.js';

const TEST_FILE = 'entity.ts';

const buildContext = (
  coverage: Record<string, readonly string[]>
): ProjectContext => ({
  crudCoverageByEntity: new Map(
    Object.entries(coverage).map(([entityId, operations]) => [
      entityId,
      new Set(operations) as ReadonlySet<string>,
    ])
  ),
  knownTrailIds: new Set<string>(),
});

const splitFileSource = (operation: string): string => `
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

export const ${operation}Note = deriveTrail(note, '${operation}', {
  blaze: async () => Result.ok({}),
  resource: notesResource,
});
`;

const importedSplitFileSource = (
  operation: string,
  source = './shared/contours.js'
): string => `
import { Result, resource } from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import { note } from '${source}';

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

export const ${operation}Note = deriveTrail(note, '${operation}', {
  blaze: async () => Result.ok({}),
  resource: notesResource,
});
`;

const suffixedBindingSplitFileSource = (operation: string): string => `
import { Result, contour, resource } from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import { z } from 'zod';

const noteContour = contour('note', {
  body: z.string(),
  id: z.string(),
  title: z.string(),
}, { identity: 'id' });

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

export const ${operation}Note = deriveTrail(noteContour, '${operation}', {
  blaze: async () => Result.ok({}),
  resource: notesResource,
});
`;

const importedSuffixedBindingSplitFileSource = (operation: string): string => `
import { Result, resource } from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import { noteContour } from './shared/contours.js';

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

export const ${operation}Note = deriveTrail(noteContour, '${operation}', {
  blaze: async () => Result.ok({}),
  resource: notesResource,
});
`;

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

  describe('project-aware (cross-file) coverage', () => {
    const CREATE_FILE = 'notes/create.ts';
    const READ_FILE = 'notes/read.ts';

    test('stays quiet when sibling files cover the remaining CRUD operations', () => {
      const context = buildContext({
        note: ['create', 'read', 'update', 'delete', 'list'],
      });

      expect(
        incompleteCrud.checkWithContext(
          splitFileSource('create'),
          CREATE_FILE,
          context
        )
      ).toEqual([]);
      expect(
        incompleteCrud.checkWithContext(
          splitFileSource('read'),
          READ_FILE,
          context
        )
      ).toEqual([]);
    });

    test('merges local and imported contour coverage for the same entity', () => {
      const context = buildContext({
        'imported:note': ['read', 'update', 'delete', 'list'],
        note: ['create'],
      });

      expect(
        incompleteCrud.checkWithContext(
          splitFileSource('create'),
          CREATE_FILE,
          context
        )
      ).toEqual([]);
      expect(
        incompleteCrud.checkWithContext(
          importedSplitFileSource('read'),
          READ_FILE,
          context
        )
      ).toEqual([]);
    });

    test('merges imported coverage when the contour binding ends with Contour', () => {
      const context = buildContext({
        'imported:noteContour': ['read', 'update', 'delete', 'list'],
        note: ['create'],
      });

      expect(
        incompleteCrud.checkWithContext(
          suffixedBindingSplitFileSource('create'),
          CREATE_FILE,
          context
        )
      ).toEqual([]);
      expect(
        incompleteCrud.checkWithContext(
          importedSuffixedBindingSplitFileSource('read'),
          READ_FILE,
          context
        )
      ).toEqual([]);
    });

    test('does not collapse authored contour IDs that end with Contour', () => {
      const source = `
import { Result, contour, resource } from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import { z } from 'zod';

const noteContour = contour('noteContour', {
  body: z.string(),
  id: z.string(),
  title: z.string(),
}, { identity: 'id' });

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

export const readNote = deriveTrail(noteContour, 'read', {
  blaze: async () => Result.ok({}),
  resource: notesResource,
});
`;
      const context = buildContext({
        note: ['create', 'update', 'delete', 'list'],
        noteContour: ['read'],
      });

      const diagnostics = incompleteCrud.checkWithContext(
        source,
        READ_FILE,
        context
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('noteContour');
      expect(diagnostics[0]?.message).not.toContain('"note"');
    });

    test('does not merge imported coverage from a different module origin', () => {
      const context = buildContext({
        'imported:./shared/a.js#note': ['read', 'update', 'delete', 'list'],
      });

      const diagnostics = incompleteCrud.checkWithContext(
        importedSplitFileSource('create', './shared/b.js'),
        CREATE_FILE,
        context
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('note');
      expect(diagnostics[0]?.message).toContain('create');
      expect(diagnostics[0]?.message).toContain('read');
    });

    test('still warns when aggregated coverage is incomplete', () => {
      const context = buildContext({
        note: ['create', 'read'],
      });

      const diagnostics = incompleteCrud.checkWithContext(
        splitFileSource('create'),
        CREATE_FILE,
        context
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.filePath).toBe(CREATE_FILE);
      expect(diagnostics[0]?.message).toContain('note');
      expect(diagnostics[0]?.message).toContain('create');
      expect(diagnostics[0]?.message).toContain('read');
      expect(diagnostics[0]?.message).toContain('update');
    });

    test('colocated full-coverage still passes via checkWithContext', () => {
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

export const createNote = deriveTrail(note, 'create', { blaze: async () => Result.ok({}), resource: notesResource });
export const readNote = deriveTrail(note, 'read', { blaze: async () => Result.ok({}), resource: notesResource });
export const updateNote = deriveTrail(note, 'update', { blaze: async () => Result.ok({}), resource: notesResource });
export const deleteNote = deriveTrail(note, 'delete', { blaze: async () => Result.ok({}), resource: notesResource });
export const listNote = deriveTrail(note, 'list', { blaze: async () => Result.ok({}), resource: notesResource });
`;

      expect(
        incompleteCrud.checkWithContext(
          code,
          TEST_FILE,
          buildContext({
            note: ['create', 'read', 'update', 'delete', 'list'],
          })
        )
      ).toEqual([]);
    });

    test('project context with no matching entity falls back to file-scoped behavior', () => {
      const diagnostics = incompleteCrud.checkWithContext(
        splitFileSource('create'),
        CREATE_FILE,
        buildContext({})
      );

      // The local file has only `create`, so without cross-file context
      // the rule behaves exactly like the file-scoped check.
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.filePath).toBe(CREATE_FILE);
      expect(diagnostics[0]?.message).toContain('note');
    });
  });
});
