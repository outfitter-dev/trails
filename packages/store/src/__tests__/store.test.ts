import { describe, expect, test } from 'bun:test';
import { ValidationError } from '@ontrails/core';
import { z } from 'zod';

import type {
  EntityOf,
  FixtureInputOf,
  FixtureOf,
  InsertOf,
  UpdateOf,
} from '../index.js';
import {
  entitySchemaOf,
  fixtureSchemaOf,
  insertSchemaOf,
  store,
  updateSchemaOf,
} from '../index.js';

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
};

const expectDerivedSchemas = (
  table: ReturnType<typeof createStoreDefinition>['tables']['gists']
) => {
  expect(entitySchemaOf(table)).toBe(table.schema);
  expect(fixtureSchemaOf(table)).toBe(table.fixtureSchema);
  expect(insertSchemaOf(table)).toBe(table.insertSchema);
  expect(updateSchemaOf(table)).toBe(table.updateSchema);

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

const createGistEntity = <
  TTable extends Parameters<typeof entitySchemaOf>[0],
>() =>
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

describe('@ontrails/store', () => {
  test('normalizes tables and derives insert/update schemas', () => {
    const db = createStoreDefinition();

    expect(db.kind).toBe('tabular');
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
