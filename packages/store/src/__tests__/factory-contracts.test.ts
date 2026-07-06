/**
 * Factory contract completeness (TRL-1195, TRL-1201): crud()/reconcile()/
 * sync() declare permits and share table contours instead of forcing
 * consuming apps to post-process the produced trails.
 */

import { describe, expect, test } from 'bun:test';
import { Result, resource, topo } from '@ontrails/core';
import { z } from 'zod';

import type {
  EntityOf,
  ReadOnlyStoreTableAccessor,
  StoreAccessor,
} from '../index.js';
import { store } from '../index.js';
import type { TableContour } from '../trails/index.js';
import { crud, reconcile, sync } from '../trails/index.js';

const noteSchema = z.object({
  body: z.string(),
  createdAt: z.string(),
  id: z.string(),
  title: z.string(),
});

const noteDefinition = store({
  notes: {
    fixtures: [
      {
        body: 'Seed body',
        createdAt: '2026-04-10T12:00:00.000Z',
        id: 'note-1',
        title: 'Seed title',
        version: 1,
      },
    ],
    generated: ['createdAt'],
    identity: 'id',
    schema: noteSchema,
    versioned: true,
  },
});

type NotesTable = typeof noteDefinition.tables.notes;
type NotesConnection = Readonly<Record<'notes', StoreAccessor<NotesTable>>>;

const createNotesAccessor = (): StoreAccessor<NotesTable> => {
  const records = new Map<string, EntityOf<NotesTable>>();
  return {
    get(id) {
      const entity = records.get(id);
      return Promise.resolve(
        entity === undefined ? null : structuredClone(entity)
      );
    },
    list() {
      return Promise.resolve(
        [...records.values()].map((entity) => structuredClone(entity))
      );
    },
    remove(id) {
      return Promise.resolve({ deleted: records.delete(id) });
    },
    upsert(entity) {
      const stored = {
        createdAt: '2026-04-10T12:00:00.000Z',
        ...structuredClone(entity),
      } as EntityOf<NotesTable>;
      records.set(String(stored.id), stored);
      return Promise.resolve(structuredClone(stored));
    },
  };
};

const notesResource = resource<NotesConnection>('db.notes.factory', {
  create: () => Result.ok({ notes: createNotesAccessor() }),
});

describe('crud() permits', () => {
  test('permit applies to every produced trail and permits override per op', () => {
    const [create, read, update, remove, list] = crud(
      noteDefinition.tables.notes,
      notesResource,
      {
        permit: { scopes: ['notes:write'] },
        permits: {
          delete: { scopes: ['notes:destroy'] },
          read: 'public',
        },
      }
    );

    expect(create.permit).toEqual({ scopes: ['notes:write'] });
    expect(update.permit).toEqual({ scopes: ['notes:write'] });
    expect(list.permit).toEqual({ scopes: ['notes:write'] });
    expect(read.permit).toBe('public');
    expect(remove.permit).toEqual({ scopes: ['notes:destroy'] });
    expect(remove.intent).toBe('destroy');
  });

  test('trails carry no permit when none is declared', () => {
    const [create] = crud(noteDefinition.tables.notes, notesResource);
    expect(create.permit).toBeUndefined();
  });
});

describe('shared table contours', () => {
  test('crud exposes its contour and reconcile reuses the instance', () => {
    const crudTrails = crud(noteDefinition.tables.notes, notesResource);
    expect(crudTrails.contour).toBeDefined();
    expect(crudTrails[0].contours[0]).toBe(crudTrails.contour);

    const reconcileNotes = reconcile({
      contour: crudTrails.contour,
      permit: { scopes: ['notes:write'] },
      resource: notesResource,
      table: noteDefinition.tables.notes,
    });
    expect(reconcileNotes.contours[0]).toBe(crudTrails.contour);
    expect(reconcileNotes.permit).toEqual({ scopes: ['notes:write'] });

    const [create, read, update, remove, list] = crudTrails;
    expect(() =>
      topo('factory-contract-app', {
        create,
        list,
        read,
        reconcileNotes,
        remove,
        update,
      })
    ).not.toThrow();
  });

  test('unshared contours still collide at topo() so the sharing is load-bearing', () => {
    const crudTrails = crud(noteDefinition.tables.notes, notesResource);
    const reconcileNotes = reconcile({
      resource: notesResource,
      table: noteDefinition.tables.notes,
    });

    const [create, read, update, remove, list] = crudTrails;
    expect(() =>
      topo('factory-contract-collision-app', {
        create,
        list,
        read,
        reconcileNotes,
        remove,
        update,
      })
    ).toThrow(/[Dd]uplicate contour/);
  });

  test('crud accepts an existing contour instance', () => {
    const first = crud(noteDefinition.tables.notes, notesResource);
    const second = crud(noteDefinition.tables.notes, notesResource, {
      contour: first.contour,
    });
    expect(second.contour).toBe(first.contour);
    expect(second[0].contours[0]).toBe(first.contour);
  });
});

const externalNoteSchema = z.object({
  bodyText: z.string(),
  createdAt: z.string(),
  heading: z.string(),
  id: z.string(),
});

const externalDefinition = store({
  externalNotes: {
    fixtures: [
      {
        bodyText: 'Copied body',
        createdAt: '2026-04-10T12:00:00.000Z',
        heading: 'Copied title',
        id: 'external-1',
      },
    ],
    identity: 'id',
    schema: externalNoteSchema,
  },
});

type ExternalTable = typeof externalDefinition.tables.externalNotes;
type ExternalConnection = Readonly<
  Record<'externalNotes', ReadOnlyStoreTableAccessor<ExternalTable>>
>;

const createExternalAccessor =
  (): ReadOnlyStoreTableAccessor<ExternalTable> => {
    const records = new Map<string, EntityOf<ExternalTable>>();
    return {
      get(id) {
        const entity = records.get(id);
        return Promise.resolve(
          entity === undefined ? null : structuredClone(entity)
        );
      },
      list() {
        return Promise.resolve(
          [...records.values()].map((entity) => structuredClone(entity))
        );
      },
    };
  };

const externalResource = resource<ExternalConnection>('db.external.factory', {
  create: () => Result.ok({ externalNotes: createExternalAccessor() }),
});

type WritableExternalConnection = Readonly<
  Record<'externalNotes', StoreAccessor<ExternalTable>>
>;

const createWritableExternalAccessor = (): StoreAccessor<ExternalTable> => {
  const records = new Map<string, EntityOf<ExternalTable>>();
  return {
    get(id) {
      const entity = records.get(id);
      return Promise.resolve(
        entity === undefined ? null : structuredClone(entity)
      );
    },
    list() {
      return Promise.resolve(
        [...records.values()].map((entity) => structuredClone(entity))
      );
    },
    remove(id) {
      return Promise.resolve({ deleted: records.delete(id) });
    },
    upsert(entity) {
      const stored = structuredClone(entity) as EntityOf<ExternalTable>;
      records.set(String(stored.id), stored);
      return Promise.resolve(structuredClone(stored));
    },
  };
};

const writableExternalResource = resource<WritableExternalConnection>(
  'db.external.crud.factory',
  {
    create: () =>
      Result.ok({ externalNotes: createWritableExternalAccessor() }),
  }
);

const syncNotes = (options?: {
  readonly fromContour?: TableContour<ExternalTable>;
  readonly permit?: Parameters<typeof sync>[0]['permit'];
  readonly toContour?: TableContour<typeof noteDefinition.tables.notes>;
}) =>
  sync({
    from: {
      ...(options?.fromContour === undefined
        ? {}
        : { contour: options.fromContour }),
      resource: externalResource,
      table: externalDefinition.tables.externalNotes,
    },
    ...(options?.permit === undefined ? {} : { permit: options.permit }),
    to: {
      ...(options?.toContour === undefined
        ? {}
        : { contour: options.toContour }),
      resource: notesResource,
      table: noteDefinition.tables.notes,
    },
    transform: (entity) => ({
      body: entity.bodyText,
      id: entity.id,
      title: entity.heading,
    }),
  });

describe('sync() permits', () => {
  test('permit is declared on the produced trail', () => {
    const syncTrail = syncNotes({ permit: { scopes: ['notes:write'] } });
    expect(syncTrail.permit).toEqual({ scopes: ['notes:write'] });
  });

  test('trail carries no permit when none is declared', () => {
    expect(syncNotes().permit).toBeUndefined();
  });
});

describe('sync() shared contours', () => {
  test('sync reuses a crud bundle contour so topo sees one instance', () => {
    const crudTrails = crud(noteDefinition.tables.notes, notesResource);
    const syncTrail = syncNotes({ toContour: crudTrails.contour });
    expect(syncTrail.contours[1]).toBe(crudTrails.contour);

    const [create, read, update, remove, list] = crudTrails;
    expect(() =>
      topo('factory-sync-shared-app', {
        create,
        list,
        read,
        remove,
        syncTrail,
        update,
      })
    ).not.toThrow();
  });

  test('unshared contours still collide at topo() so the sharing is load-bearing', () => {
    const crudTrails = crud(noteDefinition.tables.notes, notesResource);
    const syncTrail = syncNotes();

    const [create, read, update, remove, list] = crudTrails;
    expect(() =>
      topo('factory-sync-collision-app', {
        create,
        list,
        read,
        remove,
        syncTrail,
        update,
      })
    ).toThrow(/[Dd]uplicate contour/);
  });

  test('sync reuses a source-side crud contour so topo sees one instance', () => {
    const externalCrud = crud(
      externalDefinition.tables.externalNotes,
      writableExternalResource
    );
    const syncTrail = syncNotes({ fromContour: externalCrud.contour });
    expect(syncTrail.contours[0]).toBe(externalCrud.contour);

    const [create, read, update, remove, list] = externalCrud;
    expect(() =>
      topo('factory-sync-source-shared-app', {
        create,
        list,
        read,
        remove,
        syncTrail,
        update,
      })
    ).not.toThrow();
  });
});
