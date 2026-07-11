/**
 * Factory contract completeness (TRL-1195, TRL-1201): crud()/reconcile()/
 * sync() declare permits and share table entities instead of forcing
 * consuming apps to post-process the produced trails.
 */

import { describe, expect, test } from 'bun:test';
import { Result, ValidationError, resource, topo } from '@ontrails/core';
import { z } from 'zod';

import type {
  EntityOf,
  ReadOnlyStoreTableAccessor,
  StoreAccessor,
} from '../index.js';
import { store } from '../index.js';
import type { TableEntity } from '../trails/index.js';
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

describe('shared table entities', () => {
  test('crud exposes its entity and reconcile reuses the instance', () => {
    const crudTrails = crud(noteDefinition.tables.notes, notesResource);
    expect(crudTrails.entity).toBeDefined();
    expect(crudTrails[0].entities[0]).toBe(crudTrails.entity);

    const reconcileNotes = reconcile({
      entity: crudTrails.entity,
      permit: { scopes: ['notes:write'] },
      resource: notesResource,
      table: noteDefinition.tables.notes,
    });
    expect(reconcileNotes.entities[0]).toBe(crudTrails.entity);
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

  test('unshared entities still collide at topo() so the sharing is load-bearing', () => {
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
    ).toThrow(/[Dd]uplicate entity/);
  });

  test('crud accepts an existing entity instance', () => {
    const first = crud(noteDefinition.tables.notes, notesResource);
    const second = crud(noteDefinition.tables.notes, notesResource, {
      entity: first.entity,
    });
    expect(second.entity).toBe(first.entity);
    expect(second[0].entities[0]).toBe(first.entity);
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
  readonly fromEntity?: TableEntity<ExternalTable>;
  readonly permit?: Parameters<typeof sync>[0]['permit'];
  readonly toEntity?: TableEntity<typeof noteDefinition.tables.notes>;
}) =>
  sync({
    from: {
      ...(options?.fromEntity === undefined
        ? {}
        : { entity: options.fromEntity }),
      resource: externalResource,
      table: externalDefinition.tables.externalNotes,
    },
    ...(options?.permit === undefined ? {} : { permit: options.permit }),
    to: {
      ...(options?.toEntity === undefined ? {} : { entity: options.toEntity }),
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

describe('sync() shared entities', () => {
  test('sync reuses a crud bundle entity so topo sees one instance', () => {
    const crudTrails = crud(noteDefinition.tables.notes, notesResource);
    const syncTrail = syncNotes({ toEntity: crudTrails.entity });
    expect(syncTrail.entities[1]).toBe(crudTrails.entity);

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

  test('unshared entities still collide at topo() so the sharing is load-bearing', () => {
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
    ).toThrow(/[Dd]uplicate entity/);
  });

  test('sync reuses a source-side crud entity so topo sees one instance', () => {
    const externalCrud = crud(
      externalDefinition.tables.externalNotes,
      writableExternalResource
    );
    const syncTrail = syncNotes({ fromEntity: externalCrud.entity });
    expect(syncTrail.entities[0]).toBe(externalCrud.entity);

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

describe('retired contour factory options', () => {
  test('crud rejects contour instead of silently building a different entity', () => {
    const options = { contour: true, entity: undefined };

    expect(() =>
      crud(noteDefinition.tables.notes, notesResource, options)
    ).toThrow(ValidationError);
  });

  test('reconcile rejects contour instead of silently building a different entity', () => {
    const options = {
      contour: true,
      resource: notesResource,
      table: noteDefinition.tables.notes,
    };

    expect(() => reconcile(options)).toThrow(
      'uses retired "contour"; use "entity" instead'
    );
  });

  test('sync rejects contour on either endpoint', () => {
    const createOptions = (endpoint: 'from' | 'to') => ({
      from: {
        ...(endpoint === 'from' ? { contour: true } : {}),
        resource: externalResource,
        table: externalDefinition.tables.externalNotes,
      },
      to: {
        ...(endpoint === 'to' ? { contour: true } : {}),
        resource: notesResource,
        table: noteDefinition.tables.notes,
      },
      transform: (source: EntityOf<ExternalTable>) => ({
        body: source.bodyText,
        id: source.id,
        title: source.heading,
      }),
    });

    expect(() => sync(createOptions('from'))).toThrow(
      'sync() from options uses retired "contour"'
    );
    expect(() => sync(createOptions('to'))).toThrow(
      'sync() to options uses retired "contour"'
    );
  });
});
