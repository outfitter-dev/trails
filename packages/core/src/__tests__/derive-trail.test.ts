import { describe, expect, mock, test } from 'bun:test';

import { z } from 'zod';

import { contour } from '../contour.js';
import { createTrailContext } from '../context.js';
import { DerivationError, InternalError, NotFoundError } from '../errors.js';
import { Result } from '../result.js';
import { resource } from '../resource.js';
import type { DeriveTrailOperation } from '../trails/index.js';
import { deriveTrail } from '../trails/index.js';

const note = contour(
  'note',
  {
    body: z.string().default('draft'),
    createdAt: z.string(),
    id: z.string(),
    title: z.string(),
  },
  {
    examples: [
      {
        body: 'Hello, Trails',
        createdAt: '2026-04-10T12:00:00.000Z',
        id: 'note-1',
        title: 'First note',
      },
    ],
    identity: 'id',
  }
);

const noteResource = resource('db.notes', {
  create: () =>
    Result.ok({
      name: 'notes',
    }),
});

const noteExample = note.examples?.[0];

const createBlaze = () => Result.ok(noteExample);
const deleteBlaze = () => Result.ok();
const listBlaze = () => Result.ok([noteExample]);

const unsupportedOperation = (operation: never): never => {
  throw new TypeError(`Unsupported test operation: ${String(operation)}`);
};

const deriveNoteTrail = <TOperation extends DeriveTrailOperation>(
  operation: TOperation
) => {
  switch (operation) {
    case 'create': {
      return deriveTrail(note, operation, {
        blaze: createBlaze,
        generated: ['id', 'createdAt'],
        resource: noteResource,
      });
    }
    case 'read': {
      return deriveTrail(note, operation, {
        blaze: createBlaze,
        resource: noteResource,
      });
    }
    case 'update': {
      return deriveTrail(note, operation, {
        blaze: createBlaze,
        generated: ['id', 'createdAt'],
        resource: noteResource,
      });
    }
    case 'delete': {
      return deriveTrail(note, operation, {
        blaze: deleteBlaze,
        resource: noteResource,
      });
    }
    case 'list': {
      return deriveTrail(note, operation, {
        blaze: listBlaze,
        resource: noteResource,
      });
    }
    default: {
      return unsupportedOperation(operation);
    }
  }
};

const deriveCrudTrails = () => ({
  created: deriveNoteTrail('create'),
  listed: deriveNoteTrail('list'),
  read: deriveNoteTrail('read'),
  removed: deriveNoteTrail('delete'),
  updated: deriveNoteTrail('update'),
});

const expectTrailMetadata = (
  trail: ReturnType<typeof deriveNoteTrail>,
  expectedId: string,
  expectedIntent: 'destroy' | 'read' | 'write'
) => {
  expect(trail.id).toBe(expectedId);
  expect(trail.intent).toBe(expectedIntent);
};

const expectCreateSchemas = (
  created: ReturnType<typeof deriveNoteTrail<'create'>>
) => {
  expect(
    created.input.safeParse({ body: 'Body', title: 'Created note' }).success
  ).toBe(true);
  expect(
    created.input.parse({
      createdAt: '2026-04-10T12:00:00.000Z',
      id: 'note-1',
      title: 'Created note',
    })
  ).toEqual({ body: 'draft', title: 'Created note' });
  expect(created.output?.safeParse(note.examples?.[0]).success).toBe(true);
};

const expectReadSchemas = (
  read: ReturnType<typeof deriveNoteTrail<'read'>>
) => {
  expect(read.input.safeParse({ id: 'note-1' }).success).toBe(true);
  expect(read.input.safeParse({ title: 'Nope' }).success).toBe(false);
  expect(read.output?.safeParse(note.examples?.[0]).success).toBe(true);
};

const expectUpdateSchemas = (
  updated: ReturnType<typeof deriveNoteTrail<'update'>>
) => {
  expect(updated.input.safeParse({ id: 'note-1' }).success).toBe(true);
  expect(
    updated.input.safeParse({ body: 'Updated', id: 'note-1' }).success
  ).toBe(true);
  expect(
    updated.input.parse({
      createdAt: '2026-04-10T12:00:00.000Z',
      id: 'note-1',
    })
  ).toEqual({ id: 'note-1' });
};

const expectDeleteSchemas = (
  removed: ReturnType<typeof deriveNoteTrail<'delete'>>
) => {
  expect(removed.input.safeParse({ id: 'note-1' }).success).toBe(true);
  expect(removed.output?.safeParse().success).toBe(true);
  expect(removed.output?.safeParse(note.examples?.[0]).success).toBe(false);
};

const expectListSchemas = (
  listed: ReturnType<typeof deriveNoteTrail<'list'>>
) => {
  expect(listed.input.safeParse({}).success).toBe(true);
  expect(listed.input.safeParse({ id: 'note-1' }).success).toBe(true);
  expect(listed.output?.safeParse([note.examples?.[0]]).success).toBe(true);
};

describe('deriveTrail()', () => {
  test('derives trail ids, intents, contours, and resources for CRUD operations', () => {
    const { created, listed, read, removed, updated } = deriveCrudTrails();

    expectTrailMetadata(created, 'note.create', 'write');
    expectTrailMetadata(read, 'note.read', 'read');
    expectTrailMetadata(updated, 'note.update', 'write');
    expectTrailMetadata(removed, 'note.delete', 'destroy');
    expectTrailMetadata(listed, 'note.list', 'read');

    expect(created.contours).toEqual([note]);
    expect(created.resources).toEqual([noteResource]);
  });

  test('derives input and output schemas for each CRUD operation', () => {
    const { created, listed, read, removed, updated } = deriveCrudTrails();

    expectCreateSchemas(created);
    expectReadSchemas(read);
    expectUpdateSchemas(updated);
    expectDeleteSchemas(removed);
    expectListSchemas(listed);
  });

  test('derives per-operation examples from contour examples', () => {
    const { created, listed, read, removed, updated } = deriveCrudTrails();

    expect(created.examples).toEqual([
      {
        expected: note.examples?.[0],
        input: { body: 'Hello, Trails', title: 'First note' },
        name: 'Create note note-1',
      },
    ]);
    expect(read.examples).toEqual([
      {
        expected: note.examples?.[0],
        input: { id: 'note-1' },
        name: 'Read note note-1',
      },
    ]);
    expect(updated.examples).toEqual([
      {
        expected: note.examples?.[0],
        input: { body: 'Hello, Trails', id: 'note-1', title: 'First note' },
        name: 'Update note note-1',
      },
    ]);
    expect(removed.examples).toEqual([
      {
        input: { id: 'note-1' },
        name: 'Delete note note-1',
      },
    ]);
    expect(listed.examples).toEqual([
      {
        expected: [note.examples?.[0]],
        input: {},
        name: 'note list example',
      },
    ]);
  });

  test('drops schema defaults from update and list filters', () => {
    const updated = deriveNoteTrail('update');
    const listed = deriveNoteTrail('list');

    expect(updated.input.parse({ id: 'note-1' })).toEqual({ id: 'note-1' });
    expect(listed.input.parse({})).toEqual({});
  });

  test('does not auto-stamp a pattern when none is declared', () => {
    const created = deriveNoteTrail('create');

    expect(created.pattern).toBeUndefined();
  });

  test('preserves a caller-declared pattern', () => {
    const created = deriveTrail(note, 'create', {
      blaze: createBlaze,
      generated: ['id', 'createdAt'],
      pattern: 'crud',
      resource: noteResource,
    });

    expect(created.pattern).toBe('crud');
  });
});

// ---------------------------------------------------------------------------
// Default-blaze synthesis
// ---------------------------------------------------------------------------

interface NoteEntity {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
}

interface FakeNoteAccessor {
  get: (id: string) => Promise<NoteEntity | null>;
  list: (filters?: Partial<NoteEntity>) => Promise<readonly NoteEntity[]>;
  upsert: (input: Partial<NoteEntity>) => Promise<NoteEntity>;
  remove: (id: string) => Promise<{ readonly deleted: boolean }>;
  insert?: (input: Partial<NoteEntity>) => Promise<NoteEntity>;
  update?: (
    id: string,
    patch: Partial<NoteEntity>
  ) => Promise<NoteEntity | null>;
}

const cloneNote = (value: NoteEntity): NoteEntity => ({ ...value });

const seedNote: NoteEntity = {
  body: 'Hello, Trails',
  createdAt: '2026-04-10T12:00:00.000Z',
  id: 'note-1',
  title: 'First note',
};

const matchesFilters = (
  row: NoteEntity,
  filters: Partial<NoteEntity> | undefined
): boolean =>
  filters === undefined ||
  Object.entries(filters).every(
    ([field, value]) => row[field as keyof NoteEntity] === value
  );

const readOneFromMap = <V>(table: Map<string, V>, id: string): V | null => {
  const entry = table.get(id);
  return entry === undefined ? null : entry;
};

const seedRecords = (seed: NoteEntity | null): Map<string, NoteEntity> => {
  const records = new Map<string, NoteEntity>();
  if (seed !== null) {
    records.set(seed.id, cloneNote(seed));
  }
  return records;
};

const makeBaseAccessor = (
  records: Map<string, NoteEntity>
): FakeNoteAccessor => {
  const writePayload = (input: Partial<NoteEntity>) => {
    const payload = { ...seedNote, ...(input as NoteEntity) };
    records.set(payload.id, payload);
    return cloneNote(payload);
  };
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    get: async (id) => readOneFromMap(records, id),
    // eslint-disable-next-line @typescript-eslint/require-await
    list: async (filters) =>
      [...records.values()].filter((row) => matchesFilters(row, filters)),
    // eslint-disable-next-line @typescript-eslint/require-await
    remove: async (id) => ({ deleted: records.delete(id) }),
    // eslint-disable-next-line @typescript-eslint/require-await
    upsert: async (input) => writePayload(input),
  };
};

const attachInsert = (
  accessor: FakeNoteAccessor,
  records: Map<string, NoteEntity>
): void => {
  // eslint-disable-next-line @typescript-eslint/require-await
  accessor.insert = async (input) => {
    const payload = { ...seedNote, ...(input as NoteEntity) };
    records.set(payload.id, payload);
    return cloneNote(payload);
  };
};

const attachUpdate = (
  accessor: FakeNoteAccessor,
  records: Map<string, NoteEntity>
): void => {
  // eslint-disable-next-line @typescript-eslint/require-await
  accessor.update = async (id, patch) => {
    const existing = records.get(id);
    if (!existing) {
      return null;
    }
    const merged = { ...existing, ...patch } as NoteEntity;
    records.set(id, merged);
    return cloneNote(merged);
  };
};

const createFakeAccessor = (
  options: {
    insert?: boolean;
    update?: boolean;
    seed?: NoteEntity | null;
  } = {}
): FakeNoteAccessor => {
  const seed = options.seed === undefined ? seedNote : options.seed;
  const records = seedRecords(seed);
  const accessor = makeBaseAccessor(records);
  if (options.insert !== false) {
    attachInsert(accessor, records);
  }
  if (options.update !== false) {
    attachUpdate(accessor, records);
  }
  return accessor;
};

interface VersionedFake {
  readonly accessor: FakeNoteAccessor;
  readonly upsertLog: readonly Record<string, unknown>[];
}

const createVersionedFake = (): VersionedFake => {
  const versionedSeed = {
    ...seedNote,
    version: 7,
  } as NoteEntity & { version: number };
  const records = new Map<string, NoteEntity & { version: number }>([
    [versionedSeed.id, versionedSeed],
  ]);
  const upsertLog: Record<string, unknown>[] = [];
  const accessor: FakeNoteAccessor = {
    // eslint-disable-next-line @typescript-eslint/require-await
    get: async (id) => readOneFromMap(records, id),
    // eslint-disable-next-line @typescript-eslint/require-await
    list: async () => [...records.values()],
    // eslint-disable-next-line @typescript-eslint/require-await
    remove: async (id) => ({ deleted: records.delete(id) }),
    // eslint-disable-next-line @typescript-eslint/require-await
    upsert: async (input) => {
      const payload = input as Record<string, unknown>;
      upsertLog.push(payload);
      const merged = {
        ...versionedSeed,
        ...(payload as NoteEntity & { version?: number }),
      };
      records.set(merged.id, merged);
      return cloneNote(merged);
    },
  };
  return { accessor, upsertLog };
};

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const expectErr = <T>(result: Result<T, Error>): Error => {
  if (result.isOk()) {
    throw new Error(`Expected error, got ok: ${JSON.stringify(result.value)}`);
  }
  return result.error;
};

const makeNotesResource = (accessor: FakeNoteAccessor) =>
  resource('db.notes', {
    create: () => Result.ok({ note: accessor }),
  });

const ctxFor = (accessor: FakeNoteAccessor) =>
  createTrailContext({
    extensions: {
      'db.notes': { note: accessor },
    },
  });

describe('deriveTrail() default blaze synthesis — create', () => {
  test('synthesizes create blaze that calls accessor.insert', async () => {
    const accessor = createFakeAccessor();
    const notesResource = makeNotesResource(accessor);

    const created = deriveTrail(note, 'create', {
      generated: ['id', 'createdAt'],
      resource: notesResource,
    });

    const result = await created.blaze(
      { body: 'Bye, Trails', title: 'Second note' },
      ctxFor(accessor)
    );
    expect(result.isOk()).toBe(true);
  });

  test('create falls back to upsert when insert is absent', async () => {
    const accessor = createFakeAccessor({ insert: false });
    const notesResource = makeNotesResource(accessor);

    const created = deriveTrail(note, 'create', {
      generated: ['id', 'createdAt'],
      resource: notesResource,
    });

    const result = await created.blaze(
      { body: 'Upsert body', title: 'Upsert note' },
      ctxFor(accessor)
    );
    expect(result.isOk()).toBe(true);
  });

  test('custom blaze wins over default synthesis', async () => {
    const accessor = createFakeAccessor();
    const notesResource = makeNotesResource(accessor);
    // eslint-disable-next-line @typescript-eslint/require-await
    const customBlaze = mock(async () => Result.ok(seedNote));

    const created = deriveTrail(note, 'create', {
      blaze: customBlaze,
      generated: ['id', 'createdAt'],
      resource: notesResource,
    });

    await created.blaze(
      { body: 'ignored', title: 'ignored' },
      ctxFor(accessor)
    );
    expect(customBlaze).toHaveBeenCalledTimes(1);
  });
});

describe('deriveTrail() default blaze synthesis — read', () => {
  test('synthesizes read blaze that returns entity', async () => {
    const accessor = createFakeAccessor();
    const notesResource = makeNotesResource(accessor);

    const read = deriveTrail(note, 'read', { resource: notesResource });
    const result = await read.blaze({ id: 'note-1' }, ctxFor(accessor));
    const value = expectOk(result);
    expect(value.id).toBe('note-1');
  });

  test('read returns InternalError when accessor has no get', async () => {
    const accessor = createFakeAccessor();
    const broken = {
      ...accessor,
      get: undefined,
    } as unknown as FakeNoteAccessor;
    const notesResource = makeNotesResource(broken);

    const read = deriveTrail(note, 'read', { resource: notesResource });
    const result = await read.blaze({ id: 'note-1' }, ctxFor(broken));
    expect(expectErr(result)).toBeInstanceOf(InternalError);
  });

  test('read returns Result.err when resource lookup throws', async () => {
    const accessor = createFakeAccessor();
    const notesResource = makeNotesResource(accessor);

    const read = deriveTrail(note, 'read', { resource: notesResource });
    const result = await read.blaze(
      { id: 'note-1' },
      createTrailContext({ extensions: {} })
    );

    expect(expectErr(result)).toBeInstanceOf(InternalError);
  });
});

describe('deriveTrail() default blaze synthesis — update', () => {
  test('update uses accessor.update when present', async () => {
    const accessor = createFakeAccessor();
    const notesResource = makeNotesResource(accessor);

    const updated = deriveTrail(note, 'update', {
      generated: ['id', 'createdAt'],
      resource: notesResource,
    });

    const result = await updated.blaze(
      { id: 'note-1', title: 'Renamed' },
      ctxFor(accessor)
    );
    const value = expectOk(result);
    expect(value.title).toBe('Renamed');
  });

  test('update returns NotFoundError when accessor.update returns null', async () => {
    const accessor = createFakeAccessor({ seed: null });
    const notesResource = makeNotesResource(accessor);

    const updated = deriveTrail(note, 'update', {
      generated: ['id', 'createdAt'],
      resource: notesResource,
    });

    const result = await updated.blaze(
      { id: 'missing', title: 'Nope' },
      ctxFor(accessor)
    );
    expect(expectErr(result)).toBeInstanceOf(NotFoundError);
  });

  test('update fallback read-null returns NotFoundError', async () => {
    const accessor = createFakeAccessor({ seed: null, update: false });
    const notesResource = makeNotesResource(accessor);

    const updated = deriveTrail(note, 'update', {
      generated: ['id', 'createdAt'],
      resource: notesResource,
    });

    const result = await updated.blaze(
      { id: 'missing', title: 'Nope' },
      ctxFor(accessor)
    );
    expect(expectErr(result)).toBeInstanceOf(NotFoundError);
  });

  test('update fallback reads, merges, and upserts when update method is absent', async () => {
    const accessor = createFakeAccessor({ update: false });
    const upsertSpy = mock(accessor.upsert);
    accessor.upsert = upsertSpy;
    const notesResource = makeNotesResource(accessor);

    const updated = deriveTrail(note, 'update', {
      generated: ['id', 'createdAt'],
      resource: notesResource,
    });

    const result = await updated.blaze(
      { id: 'note-1', title: 'Via fallback' },
      ctxFor(accessor)
    );
    expect(result.isOk()).toBe(true);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  test('update fallback strips generated fields from merged payload', async () => {
    const { accessor, upsertLog } = createVersionedFake();

    const updated = deriveTrail(note, 'update', {
      generated: ['id', 'createdAt'],
      resource: makeNotesResource(accessor),
    });

    const result = await updated.blaze(
      { id: 'note-1', title: 'No version' },
      ctxFor(accessor)
    );
    expectOk(result);
    expect(upsertLog.length).toBe(1);
    const keys = Object.keys(upsertLog[0] as Record<string, unknown>);
    // Identity preserved even though it's in generated; non-identity generated stripped
    expect(keys).toContain('id');
    expect(keys).not.toContain('createdAt');
    expect(keys).toContain('version');
  });
});

describe('deriveTrail() default blaze synthesis — delete and list', () => {
  test('synthesizes delete blaze returning Result.ok(undefined)', async () => {
    const accessor = createFakeAccessor();
    const notesResource = makeNotesResource(accessor);

    const removed = deriveTrail(note, 'delete', { resource: notesResource });
    const result = await removed.blaze({ id: 'note-1' }, ctxFor(accessor));

    expect(expectOk(result)).toBeUndefined();
  });

  test('synthesizes list blaze returning array', async () => {
    const accessor = createFakeAccessor();
    const notesResource = makeNotesResource(accessor);

    const listed = deriveTrail(note, 'list', { resource: notesResource });
    const result = await listed.blaze({}, ctxFor(accessor));

    const value = expectOk(result);
    expect(Array.isArray(value)).toBe(true);
    expect(value.length).toBe(1);
  });
});

describe('deriveTrail() multi-resource and invalid input', () => {
  test('rejects multi-resource derivation without a blaze', () => {
    const accessor = createFakeAccessor();
    const a = makeNotesResource(accessor);
    const b = makeNotesResource(accessor);

    expect(() =>
      deriveTrail(note, 'create', {
        generated: ['id', 'createdAt'],
        resource: [a, b],
      })
    ).toThrow(DerivationError);
  });

  test('rejects derivation with empty resource array and no blaze', () => {
    expect(() =>
      deriveTrail(note, 'create', {
        generated: ['id', 'createdAt'],
        resource: [],
      })
    ).toThrow(
      'deriveTrail("note.create") requires an explicit `blaze` when no resources are declared'
    );
  });
});
