import { describe, expect, test } from 'bun:test';

import { staticResourceAccessorPreference } from '../rules/static-resource-accessor-preference.js';

const TEST_FILE = 'src/entity.trail.ts';

describe('static-resource-accessor-preference', () => {
  test('warns when a same-file resource definition is looked up by id', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.resource('db.main'));
  },
});
`;

    const diagnostics = staticResourceAccessorPreference.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.rule).toBe('static-resource-accessor-preference');
    expect(diagnostics[0]?.message).toContain("ctx.resource('db.main')");
    expect(diagnostics[0]?.message).toContain('Prefer db.from(ctx)');
  });

  test('warns when a declared resource definition is looked up by identifier', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.resource(db));
  },
});
`;

    const diagnostics = staticResourceAccessorPreference.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('ctx.resource(db)');
    expect(diagnostics[0]?.message).toContain('Prefer db.from(ctx)');
  });

  test('warns for imported resource definitions looked up by identifier', () => {
    const code = `
import { Result, trail } from '@ontrails/core';
import { db } from './resources';

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.resource(db));
  },
});
`;

    const diagnostics = staticResourceAccessorPreference.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('ctx.resource(db)');
    expect(diagnostics[0]?.message).toContain('Prefer db.from(ctx)');
  });

  test('recognizes destructured resource aliases', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    const { resource: getResource } = ctx;
    return Result.ok(getResource(db));
  },
});
`;

    const diagnostics = staticResourceAccessorPreference.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('getResource(db)');
  });

  test('does not warn when the static helper is already used', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(db.from(ctx));
  },
});
`;

    expect(staticResourceAccessorPreference.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not warn for unresolved imported resources looked up by id', () => {
    const code = `
import { Result, trail } from '@ontrails/core';
import { db } from './resources';

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.resource('db.main'));
  },
});
`;

    expect(staticResourceAccessorPreference.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not warn for string declarations without a static resource definition', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.show', {
  resources: ['db.main'],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.resource('db.main'));
  },
});
`;

    expect(staticResourceAccessorPreference.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not warn for dynamic resource ids', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (input, ctx) => {
    return Result.ok(ctx.resource(input.resourceId));
  },
});
`;

    expect(staticResourceAccessorPreference.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not warn when a local binding shadows a declared resource name', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (input, ctx) => {
    const db = input.resourceId;
    return Result.ok(ctx.resource(db));
  },
});
`;

    expect(staticResourceAccessorPreference.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not warn when a string resource lookup resolves to a shadowed declared name', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (input, ctx) => {
    const db = input.override;
    return Result.ok(ctx.resource('db.main'));
  },
});
`;

    expect(staticResourceAccessorPreference.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not warn when a local constructor shadows an imported dependency constructor', () => {
    const code = `
import { Result, trail } from '@ontrails/core';
import { PrismaClient } from '@prisma/client';

trail('entity.show', {
  blaze: async () => {
    const PrismaClient = class LocalClient {};
    const db = new PrismaClient();
    return Result.ok(db);
  },
});
`;

    expect(staticResourceAccessorPreference.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not warn inside framework harness files', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => Result.ok(ctx.resource(db)),
});
`;

    expect(
      staticResourceAccessorPreference.check(
        code,
        '/repo/packages/testing/src/harness.ts'
      )
    ).toEqual([]);
  });

  test('warns for obvious imported external client construction inside blaze', () => {
    const code = `
import { Result, trail } from '@ontrails/core';
import { PrismaClient } from '@prisma/client';

trail('entity.show', {
  blaze: async () => {
    const db = new PrismaClient();
    return Result.ok(db);
  },
});
`;

    const diagnostics = staticResourceAccessorPreference.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('new PrismaClient(...)');
    expect(diagnostics[0]?.message).toContain(
      'Move the client behind a resource definition'
    );
  });

  test('warns for renamed AWS SDK client constructors inside blaze', () => {
    const code = `
import { Result, trail } from '@ontrails/core';
import { HeadBucketCommand, S3Client as Storage } from '@aws-sdk/client-s3';

trail('entity.show', {
  blaze: async () => {
    const storage = new Storage({ region: 'us-east-1' });
    const command = new HeadBucketCommand({ Bucket: 'docs' });
    return Result.ok({ command, storage });
  },
});
`;

    const diagnostics = staticResourceAccessorPreference.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('new Storage(...)');
    expect(diagnostics[0]?.message).not.toContain('HeadBucketCommand');
  });

  test('does not warn for arbitrary constructors without import provenance', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

class Client {}

trail('entity.show', {
  blaze: async () => {
    const client = new Client();
    return Result.ok(client);
  },
});
`;

    expect(staticResourceAccessorPreference.check(code, TEST_FILE)).toEqual([]);
  });
});
