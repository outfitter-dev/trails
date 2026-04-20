import { describe, expect, mock, test } from 'bun:test';
import { Result, createTrailContext, resource, topo } from '@ontrails/core';
import { z } from 'zod';

import type { EntityOf, InsertOf, StoreAccessor } from '../index.js';
import { testAll } from '../../../testing/src/index.js';
import { store } from '../index.js';
import { crud } from '../trails/index.js';

const noteSchema = z.object({
  body: z.string().default('draft'),
  createdAt: z.string(),
  id: z.string(),
  title: z.string(),
});

const noteDefinition = store({
  notes: {
    fixtures: [
      {
        body: 'Hello, Trails',
        createdAt: '2026-04-10T12:00:00.000Z',
        id: 'note-1',
        title: 'First note',
      },
    ],
    generated: ['id', 'createdAt'],
    identity: 'id',
    schema: noteSchema,
  },
});

type NotesTable = typeof noteDefinition.tables.notes;
type NotesConnection = Readonly<Record<'notes', StoreAccessor<NotesTable>>>;

const requireFixture = <T>(value: T | undefined): T => {
  if (value === undefined) {
    throw new Error('Expected store fixture to be present');
  }

  return value;
};

const noteFixture = requireFixture(noteDefinition.tables.notes.fixtures[0]);

const cloneEntity = <T>(value: T): T => structuredClone(value);

const matchesFilters = <TEntity extends Record<string, unknown>>(
  entity: TEntity,
  filters: Partial<TEntity> | undefined
): boolean => {
  if (filters === undefined) {
    return true;
  }

  return Object.entries(filters).every(
    ([field, value]) => entity[field as keyof TEntity] === value
  );
};

const createNotesAccessor = (): StoreAccessor<NotesTable> => {
  const records = new Map<string, EntityOf<NotesTable>>([
    [noteFixture.id, cloneEntity(noteFixture)],
  ]);

  return {
    get(id) {
      return Promise.resolve(cloneEntity(records.get(id) ?? null));
    },
    list(filters) {
      return Promise.resolve(
        [...records.values()]
          .filter((entity) => matchesFilters(entity, filters))
          .map((entity) => cloneEntity(entity))
      );
    },
    remove(id) {
      return Promise.resolve({ deleted: records.delete(id) });
    },
    upsert(input) {
      const existing =
        input.id === undefined
          ? records.get(noteFixture.id)
          : records.get(input.id);
      const next = {
        ...(existing ?? noteFixture),
        ...input,
        createdAt: (existing ?? noteFixture).createdAt,
        id: input.id ?? noteFixture.id,
      } satisfies EntityOf<NotesTable>;

      records.set(next.id, next);
      return Promise.resolve(cloneEntity(next));
    },
  };
};

const notesResource = resource<NotesConnection>('db.notes', {
  create: () =>
    Result.ok({
      notes: createNotesAccessor(),
    }),
  mock: () => ({
    notes: createNotesAccessor(),
  }),
});

const [createNote, readNote, updateNote, deleteNote, listNote] = crud(
  noteDefinition.tables.notes,
  notesResource
);

type CreateNoteInput = Parameters<typeof createNote.blaze>[0];
type UpdateNoteInput = Parameters<typeof updateNote.blaze>[0];

const createInputHasTitle: 'title' extends keyof CreateNoteInput
  ? true
  : false = true;
const createInputOmitsGeneratedId: 'id' extends keyof CreateNoteInput
  ? false
  : true = true;
const updateInputHasIdentity: 'id' extends keyof UpdateNoteInput
  ? true
  : false = true;
const updateInputHasWritableFields: 'title' extends keyof UpdateNoteInput
  ? true
  : false = true;

// oxlint-disable-next-line jest/require-hook -- testAll generates describe/test blocks, not setup code
testAll(
  topo('store-crud-app', {
    createNote,
    deleteNote,
    listNote,
    notesResource,
    readNote,
    updateNote,
  } as Record<string, unknown>)
);

const createCrudContext = () =>
  createTrailContext({
    extensions: {
      'db.notes': {
        notes: createNotesAccessor(),
      },
    },
  });

const expectCrudIds = () => {
  expect(createNote.id).toBe('notes.create');
  expect(readNote.id).toBe('notes.read');
  expect(updateNote.id).toBe('notes.update');
  expect(deleteNote.id).toBe('notes.delete');
  expect(listNote.id).toBe('notes.list');
};

const expectCrudPatterns = () => {
  expect(createNote.pattern).toBe('crud');
  expect(readNote.pattern).toBe('crud');
  expect(updateNote.pattern).toBe('crud');
  expect(deleteNote.pattern).toBe('crud');
  expect(listNote.pattern).toBe('crud');
};

const expectCrudInputSchemas = () => {
  const createParsed = createNote.input.safeParse({
    id: 'note-1',
    title: 'Created note',
  });

  expect(createNote.input.safeParse({ title: 'Created note' }).success).toBe(
    true
  );
  expect(createParsed.success).toBe(true);
  if (createParsed.success) {
    expect('id' in createParsed.data).toBe(false);
  }

  expect(readNote.input.safeParse({ id: 'note-1' }).success).toBe(true);
  expect(
    updateNote.input.safeParse({ id: 'note-1', title: 'Updated title' }).success
  ).toBe(true);
};

const expectCrudOutputSchemas = () => {
  expect(
    createNote.output?.safeParse({ id: 'note-1', title: 'Created note' })
      .success
  ).toBe(false);
  expect(deleteNote.output?.safeParse().success).toBe(true);
  expect(
    listNote.output?.safeParse([{ id: 'note-1', title: 'First note' }]).success
  ).toBe(false);
  expect(listNote.output?.safeParse([noteFixture]).success).toBe(true);
};

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
};

describe('crud()', () => {
  test('produces the five standard CRUD trails with derived schemas', () => {
    expect(createInputHasTitle).toBe(true);
    expect(createInputOmitsGeneratedId).toBe(true);
    expect(updateInputHasIdentity).toBe(true);
    expect(updateInputHasWritableFields).toBe(true);
    expectCrudIds();
    expectCrudPatterns();
    expectCrudInputSchemas();
    expectCrudOutputSchemas();
    expect(createNote.resources).toEqual([notesResource]);
    expect(createNote.contours.map((candidate) => candidate.name)).toEqual([
      'notes',
    ]);
  });

  const createPartialCrudTrails = () => {
    const partialSchema = z.object({
      body: z.string().default('draft'),
      createdAt: z.string(),
      id: z.string(),
      title: z.string(),
    });

    const partialDefinition = store({
      notes: {
        fixtures: [
          {
            // createdAt intentionally omitted — the store layer accepts it
            // through fixtureSchema, and the contour view built by
            // createTableContour must mirror that shape so contour example
            // validation does not crash. The identity field stays required
            // so downstream read/update/delete inputs remain sound.
            id: 'note-1',
            title: 'First note',
          },
        ],
        generated: ['id', 'createdAt'],
        identity: 'id',
        schema: partialSchema,
      },
    });

    return crud(partialDefinition.tables.notes, notesResource);
  };

  test('default blazes delegate to the store accessor contract', async () => {
    const ctx = createCrudContext();

    const created = expectOk(
      await createNote.blaze(
        { body: 'Hello, Trails', title: 'First note' },
        ctx
      )
    );
    expect(created).toEqual(noteFixture);

    expect(expectOk(await readNote.blaze({ id: noteFixture.id }, ctx))).toEqual(
      noteFixture
    );

    const updated = expectOk(
      await updateNote.blaze({ id: noteFixture.id, title: 'Renamed' }, ctx)
    );
    expect(updated).toEqual({
      ...noteFixture,
      title: 'Renamed',
    });

    expect(expectOk(await listNote.blaze({ id: noteFixture.id }, ctx))).toEqual(
      [updated]
    );

    expect(await deleteNote.blaze({ id: noteFixture.id }, ctx)).toEqual(
      Result.ok()
    );
  });

  test('keeps CRUD outputs strict even when fixtures omit generated fields', () => {
    const [create, read, update, remove, list] = createPartialCrudTrails();

    expect(create.id).toBe('notes.create');
    expect(read.id).toBe('notes.read');
    expect(update.id).toBe('notes.update');
    expect(remove.id).toBe('notes.delete');
    expect(list.id).toBe('notes.list');

    // Identity input must stay required even though the contour fixture shape
    // relaxes generated non-identity fields for example validation.
    expect(read.input.safeParse({}).success).toBe(false);
    expect(read.input.safeParse({ id: 'note-1' }).success).toBe(true);
    expect(
      create.output?.safeParse({ id: 'note-1', title: 'First note' }).success
    ).toBe(false);
    expect(
      list.output?.safeParse([{ id: 'note-1', title: 'First note' }]).success
    ).toBe(false);
  });

  test('drops output-bearing examples sourced from relaxed fixtures', () => {
    const [create, read, update, remove, list] = createPartialCrudTrails();

    expect(create.examples).toBeUndefined();
    expect(read.examples).toBeUndefined();
    expect(update.examples).toBeUndefined();
    expect(list.examples).toBeUndefined();
    expect(remove.examples).toEqual([
      {
        input: { id: 'note-1' },
        name: 'Delete notes note-1',
      },
    ]);
  });

  test('accepts per-operation blaze overrides', async () => {
    const createOverride = mock((input: InsertOf<NotesTable>) =>
      Result.ok({
        ...noteFixture,
        ...input,
        id: 'override-note',
      })
    );
    const [customCreate] = crud(noteDefinition.tables.notes, notesResource, {
      blaze: {
        create: createOverride,
      },
    });

    const result = await customCreate.blaze(
      { title: 'Custom note' },
      createCrudContext()
    );

    expect(createOverride).toHaveBeenCalledTimes(1);
    expect(expectOk(result)).toEqual({
      ...noteFixture,
      id: 'override-note',
      title: 'Custom note',
    });
  });
});
