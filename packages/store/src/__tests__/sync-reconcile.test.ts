import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  ConflictError,
  Result,
  ValidationError,
  createTrailContext,
  resource,
} from '@ontrails/core';
import { z } from 'zod';

import type {
  EntityOf,
  ReadOnlyStoreTableAccessor,
  StoreAccessor,
  UpsertOf,
} from '../index.js';
import { store } from '../index.js';
import {
  ReconcileRetryExhaustedError,
  reconcile,
  sync,
} from '../trails/index.js';

const cloneOrNull = <T>(value: T | undefined): T | null =>
  value === undefined ? null : structuredClone(value);

const noteSchema = z.object({
  body: z.string(),
  createdAt: z.string(),
  id: z.string(),
  title: z.string(),
});

const externalNoteSchema = z.object({
  bodyText: z.string(),
  createdAt: z.string(),
  heading: z.string(),
  id: z.string(),
});

const versionedNoteDefinition = store({
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

const plainNoteDefinition = store({
  notes: {
    generated: ['createdAt'],
    identity: 'id',
    schema: noteSchema,
  },
});

const sourceDefinition = store({
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

const targetDefinition = store({
  notes: {
    fixtures: [
      {
        body: 'Copied body',
        createdAt: '2026-04-10T12:00:00.000Z',
        id: 'external-1',
        title: 'Copied title',
      },
    ],
    generated: ['createdAt'],
    identity: 'id',
    schema: noteSchema,
  },
});

type SourceTable = typeof sourceDefinition.tables.externalNotes;
type TargetTable = typeof targetDefinition.tables.notes;
type VersionedNotesTable = typeof versionedNoteDefinition.tables.notes;
type PlainNotesTable = typeof plainNoteDefinition.tables.notes;

type SourceConnection = Readonly<
  Record<'externalNotes', ReadOnlyStoreTableAccessor<SourceTable>>
>;

type TargetConnection = Readonly<Record<'notes', StoreAccessor<TargetTable>>>;
type VersionedConnection = Readonly<
  Record<'notes', StoreAccessor<VersionedNotesTable>>
>;
type PlainConnection = Readonly<
  Record<'notes', StoreAccessor<PlainNotesTable>>
>;

const requireFixture = <T>(value: T | undefined): T => {
  if (value === undefined) {
    throw new Error('Expected fixture to be present');
  }

  return value;
};

const sourceFixture = requireFixture(
  sourceDefinition.tables.externalNotes.fixtures[0]
);
const targetFixture = requireFixture(targetDefinition.tables.notes.fixtures[0]);
const versionedFixture = requireFixture(
  versionedNoteDefinition.tables.notes.fixtures[0]
);

const clone = <T>(value: T): T => structuredClone(value);

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
};

const createSourceAccessor = (): ReadOnlyStoreTableAccessor<SourceTable> => ({
  get(id) {
    return Promise.resolve(
      id === sourceFixture.id ? clone(sourceFixture) : null
    );
  },
  list(filters) {
    const matches =
      filters === undefined ||
      Object.entries(filters).every(
        ([field, value]) =>
          sourceFixture[field as keyof typeof sourceFixture] === value
      );

    return Promise.resolve(matches ? [clone(sourceFixture)] : []);
  },
});

const createTargetAccessor = (
  records = new Map<string, EntityOf<TargetTable>>()
): StoreAccessor<TargetTable> => ({
  get(id) {
    return Promise.resolve(clone(records.get(id) ?? null));
  },
  list(filters) {
    return Promise.resolve(
      [...records.values()]
        .filter((entity) =>
          filters === undefined
            ? true
            : Object.entries(filters).every(
                ([field, value]) =>
                  entity[field as keyof EntityOf<TargetTable>] === value
              )
        )
        .map((entity) => clone(entity))
    );
  },
  remove(id) {
    return Promise.resolve({ deleted: records.delete(id) });
  },
  upsert(input) {
    const next = {
      body: input.body ?? targetFixture.body,
      createdAt: input.createdAt ?? targetFixture.createdAt,
      id: input.id ?? targetFixture.id,
      title: input.title ?? targetFixture.title,
    } satisfies EntityOf<TargetTable>;

    records.set(next.id, next);
    return Promise.resolve(clone(next));
  },
});

const createConflictAccessor = (
  calls: UpsertOf<VersionedNotesTable>[] = []
): StoreAccessor<VersionedNotesTable> => {
  let current = clone({
    ...versionedFixture,
    body: 'Current body',
    title: 'Current title',
    version: 2,
  });

  return {
    get(id) {
      return Promise.resolve(id === current.id ? clone(current) : null);
    },
    list(filters) {
      const matches =
        filters === undefined ||
        Object.entries(filters).every(
          ([field, value]) => current[field as keyof typeof current] === value
        );

      return Promise.resolve(matches ? [clone(current)] : []);
    },
    remove(id) {
      const deleted = id === current.id;
      if (deleted) {
        current = { ...current, id: '__deleted__' };
      }

      return Promise.resolve({ deleted });
    },
    upsert(input) {
      calls.push(clone(input));

      if (input.id === current.id && input.version !== current.version) {
        throw new ConflictError(
          `Version conflict for "${current.id}": expected ${String(input.version)}, found ${String(current.version)}`
        );
      }

      current = {
        ...current,
        ...input,
        version: current.version + 1,
      };

      return clone(current);
    },
  };
};

const sourceResource = resource<SourceConnection>('db.source', {
  create: () =>
    Result.ok({
      externalNotes: createSourceAccessor(),
    }),
  mock: () => ({
    externalNotes: createSourceAccessor(),
  }),
});

const targetResource = resource<TargetConnection>('db.target', {
  create: () =>
    Result.ok({
      notes: createTargetAccessor(new Map<string, EntityOf<TargetTable>>()),
    }),
  mock: () => ({
    notes: createTargetAccessor(new Map<string, EntityOf<TargetTable>>()),
  }),
});

const plainResource = resource<PlainConnection>('db.notes.plain', {
  create: () =>
    Result.ok({
      notes:
        createTargetAccessor() as unknown as StoreAccessor<PlainNotesTable>,
    }),
  mock: () => ({
    notes: createTargetAccessor() as unknown as StoreAccessor<PlainNotesTable>,
  }),
});

const createSyncContext = (records: Map<string, EntityOf<TargetTable>>) =>
  createTrailContext({
    extensions: {
      'db.source': {
        externalNotes: createSourceAccessor(),
      },
      'db.target': {
        notes: createTargetAccessor(records),
      },
    },
  });

const expectSyncShape = (
  syncNote: ReturnType<
    typeof sync<SourceTable, TargetTable, SourceConnection, TargetConnection>
  >
) => {
  expect(syncNote.id).toBe('notes.sync');
  expect(syncNote.resources).toEqual([sourceResource, targetResource]);
  expect(syncNote.contours.map((candidate) => candidate.name)).toEqual([
    'externalNotes',
    'notes',
  ]);
  expect(syncNote.input.safeParse({ id: sourceFixture.id }).success).toBe(true);
  expect(syncNote.output?.safeParse(targetFixture).success).toBe(true);
  expect(syncNote.examples).toEqual([
    {
      expected: targetFixture,
      input: { id: sourceFixture.id },
      name: 'Sync notes external-1',
    },
  ]);
};

describe('sync()', () => {
  let targetRecords: Map<string, EntityOf<TargetTable>>;

  beforeEach(() => {
    targetRecords = new Map<string, EntityOf<TargetTable>>();
  });

  test('reads from the source resource and writes to the target resource', async () => {
    const syncNote = sync({
      from: {
        resource: sourceResource,
        table: sourceDefinition.tables.externalNotes,
      },
      to: {
        resource: targetResource,
        table: targetDefinition.tables.notes,
      },
      transform: (entity) => ({
        body: entity.bodyText,
        createdAt: entity.createdAt,
        id: entity.id,
        title: entity.heading,
      }),
    });

    const result = await syncNote.blaze(
      { id: sourceFixture.id },
      createSyncContext(targetRecords)
    );

    expectSyncShape(syncNote);
    expect(expectOk(result)).toEqual(targetFixture);
    expect(targetRecords.get(targetFixture.id)).toEqual(targetFixture);
  });

  test('applies the transform before writing to the target accessor', async () => {
    const transform = mock((entity: EntityOf<SourceTable>) => ({
      body: `${entity.bodyText} (normalized)`,
      createdAt: entity.createdAt,
      id: entity.id,
      title: entity.heading.toUpperCase(),
    }));
    const syncNote = sync({
      from: {
        resource: sourceResource,
        table: sourceDefinition.tables.externalNotes,
      },
      to: {
        resource: targetResource,
        table: targetDefinition.tables.notes,
      },
      transform,
    });
    const records = new Map<string, EntityOf<TargetTable>>();

    const result = await syncNote.blaze(
      { id: sourceFixture.id },
      createSyncContext(records)
    );

    expect(transform).toHaveBeenCalledTimes(1);
    expect(expectOk(result)).toEqual({
      body: 'Copied body (normalized)',
      createdAt: sourceFixture.createdAt,
      id: sourceFixture.id,
      title: 'COPIED TITLE',
    });
  });
});

describe('reconcile()', () => {
  test('retries version conflicts with the last-write-wins strategy', async () => {
    const calls: UpsertOf<VersionedNotesTable>[] = [];
    const reconcileNote = reconcile({
      resource: resource<VersionedConnection>('db.notes.versioned', {
        create: () =>
          Result.ok({
            notes: createConflictAccessor(calls),
          }),
        mock: () => ({
          notes: createConflictAccessor([]),
        }),
      }),
      strategy: 'last-write-wins',
      table: versionedNoteDefinition.tables.notes,
    });

    const result = await reconcileNote.blaze(
      {
        body: 'Incoming body',
        createdAt: versionedFixture.createdAt,
        id: versionedFixture.id,
        title: 'Incoming title',
        version: 1,
      },
      createTrailContext({
        extensions: {
          'db.notes.versioned': {
            notes: createConflictAccessor(calls),
          },
        },
      })
    );

    expect(reconcileNote.id).toBe('notes.reconcile');
    expect(
      reconcileNote.input.safeParse({
        body: 'Incoming body',
        id: versionedFixture.id,
        title: 'Incoming title',
        version: 1,
      }).success
    ).toBe(true);
    expect(reconcileNote.output?.safeParse(expectOk(result)).success).toBe(
      true
    );
    expect(calls).toEqual([
      {
        body: 'Incoming body',
        createdAt: versionedFixture.createdAt,
        id: versionedFixture.id,
        title: 'Incoming title',
        version: 1,
      },
      {
        body: 'Incoming body',
        createdAt: versionedFixture.createdAt,
        id: versionedFixture.id,
        title: 'Incoming title',
        version: 2,
      },
    ]);
    expect(expectOk(result)).toEqual({
      body: 'Incoming body',
      createdAt: versionedFixture.createdAt,
      id: versionedFixture.id,
      title: 'Incoming title',
      version: 3,
    });
  });

  test('delegates conflict resolution to a custom strategy', async () => {
    const calls: UpsertOf<VersionedNotesTable>[] = [];
    const strategy = mock(
      ({
        current,
        incoming,
      }: {
        current: EntityOf<VersionedNotesTable>;
        incoming: UpsertOf<VersionedNotesTable>;
      }) => ({
        ...current,
        body: `${current.body} + ${incoming.body as string}`,
        title: `${current.title} / resolved`,
      })
    );
    const reconcileNote = reconcile({
      resource: resource<VersionedConnection>('db.notes.strategy', {
        create: () =>
          Result.ok({
            notes: createConflictAccessor(calls),
          }),
        mock: () => ({
          notes: createConflictAccessor([]),
        }),
      }),
      strategy,
      table: versionedNoteDefinition.tables.notes,
    });

    const result = await reconcileNote.blaze(
      {
        body: 'Incoming body',
        createdAt: versionedFixture.createdAt,
        id: versionedFixture.id,
        title: 'Incoming title',
        version: 1,
      },
      createTrailContext({
        extensions: {
          'db.notes.strategy': {
            notes: createConflictAccessor(calls),
          },
        },
      })
    );

    expect(strategy).toHaveBeenCalledTimes(1);
    expect(calls[1]).toEqual({
      body: 'Current body + Incoming body',
      createdAt: versionedFixture.createdAt,
      id: versionedFixture.id,
      title: 'Current title / resolved',
      version: 2,
    });
    expect(expectOk(result)).toEqual({
      body: 'Current body + Incoming body',
      createdAt: versionedFixture.createdAt,
      id: versionedFixture.id,
      title: 'Current title / resolved',
      version: 3,
    });
  });

  test('rejects non-versioned tables at factory creation time', () => {
    expect(() =>
      reconcile({
        resource: plainResource,
        table: plainNoteDefinition.tables.notes,
      })
    ).toThrow(ValidationError);
  });

  test('requires `version` in the derived input schema for versioned tables', () => {
    const reconcileNote = reconcile({
      resource: resource<VersionedConnection>('db.notes.versioned.required', {
        create: () =>
          Result.ok({
            notes: createConflictAccessor([]),
          }),
        mock: () => ({
          notes: createConflictAccessor([]),
        }),
      }),
      strategy: 'last-write-wins',
      table: versionedNoteDefinition.tables.notes,
    });

    const withoutVersion = reconcileNote.input.safeParse({
      body: 'Incoming body',
      id: versionedFixture.id,
      title: 'Incoming title',
    });
    expect(withoutVersion.success).toBe(false);

    const withVersion = reconcileNote.input.safeParse({
      body: 'Incoming body',
      id: versionedFixture.id,
      title: 'Incoming title',
      version: 1,
    });
    expect(withVersion.success).toBe(true);
  });

  test('surfaces ReconcileRetryExhaustedError when the retry also conflicts', async () => {
    // Accessor that always throws ConflictError on upsert, mirroring a
    // concurrent writer that races the retry path. The retry in
    // recoverConflict produces a second ConflictError, which the blaze
    // wraps in ReconcileRetryExhaustedError so callers can distinguish
    // "retry reconcile at a higher level" from "reconcile lost the race".
    const stubbornCurrent = {
      body: 'Current body',
      createdAt: versionedFixture.createdAt,
      id: versionedFixture.id,
      title: 'Current title',
      version: 99,
    } satisfies EntityOf<VersionedNotesTable>;

    const stubbornById = new Map<string, typeof stubbornCurrent>([
      [stubbornCurrent.id, stubbornCurrent],
    ]);
    const stubbornAccessor: StoreAccessor<VersionedNotesTable> = {
      get: async (id) => {
        await Promise.resolve();
        return cloneOrNull(stubbornById.get(id));
      },
      list: async () => {
        await Promise.resolve();
        return [structuredClone(stubbornCurrent)];
      },
      remove: async () => {
        await Promise.resolve();
        return { deleted: false };
      },
      upsert: () => {
        throw new ConflictError(`Version conflict for "${stubbornCurrent.id}"`);
      },
    };

    const reconcileNote = reconcile({
      resource: resource<VersionedConnection>('db.notes.stubborn', {
        create: () =>
          Result.ok({
            notes: stubbornAccessor,
          }),
        mock: () => ({
          notes: stubbornAccessor,
        }),
      }),
      strategy: 'last-write-wins',
      table: versionedNoteDefinition.tables.notes,
    });

    const result = await reconcileNote.blaze(
      {
        body: 'Incoming body',
        createdAt: versionedFixture.createdAt,
        id: versionedFixture.id,
        title: 'Incoming title',
        version: 1,
      },
      createTrailContext({
        extensions: {
          'db.notes.stubborn': {
            notes: stubbornAccessor,
          },
        },
      })
    );

    const err = result.match({
      err: (e) => e,
      ok: () => {
        throw new Error('expected reconcile to fail after retry');
      },
    });
    expect(err).toBeInstanceOf(ReconcileRetryExhaustedError);
    // Subclass of ConflictError so callers that catch the base class
    // still catch it.
    expect(err).toBeInstanceOf(ConflictError);
  });
});
