import { describe, expect, test } from 'bun:test';
import { ValidationError } from '@ontrails/core';
import { z } from 'zod';

import type {
  AnyStoreTable,
  EntityOf,
  FixtureInputOf,
  FixtureOf,
  InsertOf,
  UpdateOf,
} from '../index.js';
import { store } from '../index.js';
import { bindStoreDefinition } from '../internal/signal-identity.js';

const userSchema = z.object({
  email: z.string().email(),
  id: z.string(),
});

const gistSchema = z.object({
  createdAt: z.string(),
  description: z.string().nullable().default(null),
  id: z.string(),
  isPublic: z.boolean().default(true),
  ownerId: z.string(),
  tags: z.array(z.string()).default([]),
  updatedAt: z.string(),
});

const createStoreDefinition = () =>
  store({
    gists: {
      generated: ['id', 'createdAt', 'updatedAt'],
      identity: 'id',
      indexed: ['ownerId'],
      references: { ownerId: 'users' },
      schema: gistSchema,
      search: { fts: true },
    },
    users: {
      generated: ['id'],
      identity: 'id',
      schema: userSchema,
    },
  });

const expectGistSignals = (
  table: ReturnType<typeof createStoreDefinition>['tables']['gists']
) => {
  expect(table.signals.created.id).toBe('gists.created');
  expect(table.signals.updated.id).toBe('gists.updated');
  expect(table.signals.removed.id).toBe('gists.removed');
  expect(
    table.signals.created.payload.parse({
      createdAt: '2026-04-03T12:00:00.000Z',
      id: 'gist-1',
      ownerId: 'user-1',
      updatedAt: '2026-04-03T12:00:00.000Z',
    })
  ).toEqual({
    createdAt: '2026-04-03T12:00:00.000Z',
    description: null,
    id: 'gist-1',
    isPublic: true,
    ownerId: 'user-1',
    tags: [],
    updatedAt: '2026-04-03T12:00:00.000Z',
  });
};

const expectNormalizedGistTable = (
  table: ReturnType<typeof createStoreDefinition>['tables']['gists']
) => {
  expect(table.name).toBe('gists');
  expect(table.identity).toBe('id');
  expect(table.primaryKey).toBe('id');
  expect(table.generated).toEqual(['id', 'createdAt', 'updatedAt']);
  expect(table.indexed).toEqual(['ownerId']);
  expect(table.indexes).toEqual(['ownerId']);
  expect(table.references).toEqual({ ownerId: 'users' });
  expect(table.search).toEqual({ fts: true });
  expectGistSignals(table);
};

const expectDerivedSchemas = (
  table: ReturnType<typeof createStoreDefinition>['tables']['gists']
) => {
  expect(table.schema).toBeDefined();
  expect(table.fixtureSchema).toBeDefined();
  expect(table.insertSchema).toBeDefined();
  expect(table.updateSchema).toBeDefined();

  expect(
    table.insertSchema.parse({
      ownerId: 'user-1',
    })
  ).toEqual({
    description: null,
    isPublic: true,
    ownerId: 'user-1',
    tags: [],
  });

  expect(
    table.updateSchema.parse({
      description: 'Updated',
    })
  ).toEqual({
    description: 'Updated',
  });
};

const createTypeTestStore = () =>
  store({
    gists: {
      generated: ['id', 'createdAt', 'updatedAt'],
      identity: 'id',
      schema: gistSchema,
    },
  });

const createVersionedStoreDefinition = () =>
  store({
    gists: {
      generated: ['id', 'createdAt', 'updatedAt'],
      identity: 'id',
      schema: gistSchema,
      versioned: true,
    },
  });

type VersionedGistTable = ReturnType<
  typeof createVersionedStoreDefinition
>['tables']['gists'];

const createGistEntity = <TTable extends AnyStoreTable>() =>
  ({
    createdAt: '2026-04-03T12:00:00.000Z',
    description: null,
    id: 'gist-1',
    isPublic: true,
    ownerId: 'user-1',
    tags: ['core'],
    updatedAt: '2026-04-03T12:00:00.000Z',
  }) as EntityOf<TTable>;

const requireFixture = <T>(fixture: T | undefined): T => {
  if (fixture === undefined) {
    throw new Error('Expected fixture to be present');
  }

  return fixture;
};

const createVersionedGistTypeSamples = (): {
  readonly entity: EntityOf<VersionedGistTable>;
  readonly fixtureInput: FixtureInputOf<VersionedGistTable>;
  readonly insertInput: InsertOf<VersionedGistTable>;
} => ({
  entity: {
    createdAt: '2026-04-03T12:00:00.000Z',
    description: null,
    id: 'gist-1',
    isPublic: true,
    ownerId: 'user-1',
    tags: ['core'],
    updatedAt: '2026-04-03T12:00:00.000Z',
    version: 1,
  },
  fixtureInput: {
    ownerId: 'user-2',
    version: 2,
  },
  insertInput: {
    ownerId: 'user-3',
  },
});

const expectVersionedGistTypeSamples = ({
  entity,
  fixtureInput,
  insertInput,
}: ReturnType<typeof createVersionedGistTypeSamples>): void => {
  expect(entity.version).toBe(1);
  expect(fixtureInput.version).toBe(2);
  expect(insertInput.ownerId).toBe('user-3');
};

const expectVersionedFixtureDefaults = (
  db: ReturnType<typeof createVersionedStoreDefinition>
): void => {
  expect(db.tables.gists.fixtureSchema.parse({ ownerId: 'user-4' })).toEqual({
    description: null,
    isPublic: true,
    ownerId: 'user-4',
    tags: [],
  });
};

describe('@ontrails/store', () => {
  test('normalizes tables and derives insert/update schemas', () => {
    const db = createStoreDefinition();

    expect(db.kind).toBe('tabular');
    expect(db.signals.map((candidate) => candidate.id)).toEqual([
      'gists.created',
      'gists.updated',
      'gists.removed',
      'users.created',
      'users.updated',
      'users.removed',
    ]);
    expect(db.tableNames).toEqual(['gists', 'users']);
    expect(db.type).toBe('store');

    const table = db.tables.gists;
    expectNormalizedGistTable(table);
    expect(db.get('users')).toBe(db.tables.users);
    expectDerivedSchemas(table);
  });

  test('accepts an explicit backend-agnostic kind', () => {
    const db = store(
      {
        gists: {
          identity: 'id',
          schema: gistSchema,
        },
      },
      { kind: 'document' }
    );

    expect(db.kind).toBe('document');
    expect(db.tables.gists.identity).toBe('id');
  });

  test('normalizes fixtures through the derived fixture schema', () => {
    const db = store({
      gists: {
        fixtures: [
          {
            id: 'gist-seed',
            ownerId: 'user-1',
          },
        ],
        generated: ['id', 'createdAt', 'updatedAt'],
        identity: 'id',
        schema: gistSchema,
      },
    });

    type GistTable = typeof db.tables.gists;

    const fixtureInput: FixtureInputOf<GistTable> = {
      id: 'gist-other',
      ownerId: 'user-2',
    };
    const fixture: FixtureOf<GistTable> = requireFixture(
      db.tables.gists.fixtures[0]
    );

    expect(fixtureInput.ownerId).toBe('user-2');
    expect(fixture).toEqual({
      description: null,
      id: 'gist-seed',
      isPublic: true,
      ownerId: 'user-1',
      tags: [],
    });
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(Object.isFrozen(db.tables.gists.fixtures)).toBe(true);
    expect(db.tables.gists.fixtureSchema.parse({ ownerId: 'user-3' })).toEqual({
      description: null,
      isPublic: true,
      ownerId: 'user-3',
      tags: [],
    });
  });

  test('normalizes versioned tables with a framework-managed version field', () => {
    const db = createVersionedStoreDefinition();
    const samples = createVersionedGistTypeSamples();

    expect(db.tables.gists.versioned).toBe(true);
    expect(db.tables.gists.generated).toEqual([
      'id',
      'createdAt',
      'updatedAt',
      'version',
    ]);
    expectVersionedGistTypeSamples(samples);
    expect(db.tables.gists.schema.parse(samples.entity)).toEqual(
      samples.entity
    );
    expect(
      db.tables.gists.signals.updated.payload.parse({
        createdAt: '2026-04-03T12:00:00.000Z',
        id: 'gist-1',
        ownerId: 'user-1',
        updatedAt: '2026-04-03T12:00:00.000Z',
        version: 2,
      })
    ).toEqual({
      createdAt: '2026-04-03T12:00:00.000Z',
      description: null,
      id: 'gist-1',
      isPublic: true,
      ownerId: 'user-1',
      tags: [],
      updatedAt: '2026-04-03T12:00:00.000Z',
      version: 2,
    });
    expectVersionedFixtureDefaults(db);
  });

  test('rejects duplicate fixture primary keys when they are explicitly provided', () => {
    expect(() =>
      store({
        gists: {
          fixtures: [
            {
              id: 'gist-seed',
              ownerId: 'user-1',
            },
            {
              id: 'gist-seed',
              ownerId: 'user-2',
            },
          ],
          generated: ['id', 'createdAt', 'updatedAt'],
          identity: 'id',
          schema: gistSchema,
        },
      })
    ).toThrow(
      new ValidationError(
        'Store table "gists" fixture 2 duplicates primary key "gist-seed"'
      )
    );
  });

  test('rejects non-object schemas and unknown metadata fields', () => {
    expect(() =>
      store({
        broken: {
          identity: 'id' as never,
          schema: z.string() as never,
        },
      })
    ).toThrow(
      new ValidationError('Store table "broken" must use a Zod object schema')
    );

    expect(() =>
      store({
        gists: {
          identity: 'slug' as never,
          schema: gistSchema,
        },
      })
    ).toThrow(
      new ValidationError(
        'Store table "gists" declares identity "slug" that is not present on the schema'
      )
    );

    expect(() =>
      store({
        gists: {
          generated: ['missing'] as const as never,
          identity: 'id',
          schema: gistSchema,
        },
      })
    ).toThrow(
      new ValidationError(
        'Store table "gists" declares generated field "missing" that is not present on the schema'
      )
    );

    expect(() =>
      store({
        gists: {
          identity: 'id',
          schema: gistSchema.extend({ version: z.number().int() }),
          versioned: true,
        },
      })
    ).toThrow(
      new ValidationError(
        'Store table "gists" cannot declare a "version" field when versioned storage is enabled because the framework manages that field.'
      )
    );

    expect(() =>
      store({
        gists: {
          identity: 'id',
          indexed: ['missing'] as const as never,
          schema: gistSchema,
        },
      })
    ).toThrow(
      new ValidationError(
        'Store table "gists" declares indexed field "missing" that is not present on the schema'
      )
    );

    expect(() =>
      store({
        gists: {
          fixtures: [{ id: 'gist-seed' } as never],
          generated: ['id', 'createdAt', 'updatedAt'],
          identity: 'id',
          schema: gistSchema,
        },
      })
    ).toThrow(
      new ValidationError(
        'Store table "gists" fixture 1 is invalid: Invalid input: expected string, received undefined'
      )
    );
  });

  test('rejects bad references', () => {
    expect(() =>
      store({
        gists: {
          identity: 'id',
          references: { missing: 'users' } as never,
          schema: gistSchema,
        },
        users: {
          identity: 'id',
          schema: userSchema,
        },
      })
    ).toThrow(
      new ValidationError(
        'Store table "gists" declares reference field "missing" that is not present on the schema'
      )
    );

    expect(() =>
      store({
        gists: {
          identity: 'id',
          references: { ownerId: 'accounts' },
          schema: gistSchema,
        },
        users: {
          identity: 'id',
          schema: userSchema,
        },
      })
    ).toThrow(
      new ValidationError(
        'Store table "gists" references unknown table "accounts"'
      )
    );
  });

  test('keeps tabular aliases working for existing stores', () => {
    const db = store({
      gists: {
        generated: ['id'],
        indexes: ['ownerId'],
        primaryKey: 'id',
        schema: gistSchema,
      },
    });

    expect(db.kind).toBe('tabular');
    expect(db.tables.gists.identity).toBe('id');
    expect(db.tables.gists.primaryKey).toBe('id');
    expect(db.tables.gists.indexed).toEqual(['ownerId']);
    expect(db.tables.gists.indexes).toEqual(['ownerId']);
  });

  test('type-level helpers expose connector-facing contracts', () => {
    const db = createTypeTestStore();

    type GistTable = typeof db.tables.gists;

    const entity = createGistEntity<GistTable>();

    const insert: InsertOf<GistTable> = {
      description: null,
      isPublic: true,
      ownerId: 'user-1',
      tags: ['core'],
    };

    const update: UpdateOf<GistTable> = {
      description: 'Updated',
    };

    expect(insert.ownerId).toBe('user-1');
    expect(update.description).toBe('Updated');
    expect(entity.id).toBe('gist-1');
    expect(db.tables.gists.name).toBe('gists');
  });
});

describe('bindStoreDefinition', () => {
  const definition = store({
    gists: {
      generated: ['id'],
      identity: 'id',
      schema: gistSchema,
    },
  });

  test('rejects scopes containing ":"', () => {
    expect(() => bindStoreDefinition(definition, 'bad:scope')).toThrow(
      new ValidationError(
        'Store resource id "bad:scope" is invalid: must be a non-empty string with no ":" characters and no whitespace.'
      )
    );
  });

  test('rejects scopes containing whitespace', () => {
    expect(() => bindStoreDefinition(definition, 'bad scope')).toThrow(
      ValidationError
    );
  });

  test('rejects empty scopes', () => {
    expect(() => bindStoreDefinition(definition, '')).toThrow(ValidationError);
  });

  test('accepts valid scopes and scopes store signal ids', () => {
    const bound = bindStoreDefinition(definition, 'primary');
    expect(bound.tables.gists.signals.created.id).toBe('primary:gists.created');
    expect(bound.tables.gists.signals.updated.id).toBe('primary:gists.updated');
    expect(bound.tables.gists.signals.removed.id).toBe('primary:gists.removed');
  });
});
