import { describe, expect, test } from 'bun:test';

import { resourceDeclarations } from '../rules/resource-declarations.js';

const TEST_FILE = 'test.ts';

describe('resource-declarations', () => {
  describe('clean cases', () => {
    test('declared resources match resource.from(ctx) usage', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    return Result.ok({ source: db.from(ctx).source });
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('local helper named resource() is not treated as ctx lookup', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    const resource = (id: string) => id;
    return Result.ok({
      resolved: resource('db.main'),
      source: db.from(ctx).source,
    });
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('declared resources match ctx.resource() usage', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    const resolved = ctx.resource('db.main');
    return Result.ok(resolved);
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes destructured resource() calls', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    const { resource } = ctx;
    return Result.ok(resource('db.main'));
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes parameter-level destructured resource() calls', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, { resource }) => {
    return Result.ok(resource('db.main'));
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes parameter-level renamed resource() calls', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, { resource: r }) => {
    return Result.ok(r('db.main'));
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes ctx.resource(db) lookups by declared resource object', () => {
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

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('error cases', () => {
    test('resource.from(ctx) without a declaration produces an error', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok({ source: db.from(ctx).source });
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.rule).toBe('resource-declarations');
      expect(diagnostics[0]?.message).toContain('db.from(ctx)');
      expect(diagnostics[0]?.message).toContain('not declared in resources');
    });

    test('ctx.resource() without a declaration produces an error', () => {
      const code = `
trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.resource('db.main'));
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.resource('db.main')");
    });

    test('unresolved imported resource declarations do not suppress lookup diagnostics', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import { db } from './resources';

// const db = resource('db.main', {
//   create: () => Result.ok({ source: 'factory' }),
// });

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.resource('db.main'));
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.resource('db.main')");
    });

    test('ctx.resource(db) without a declaration produces an error', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.resource(db));
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('ctx.resource(db)');
    });
  });

  describe('warn cases', () => {
    test('declared but unused resource produces a warning', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async () => {
    return Result.ok({ ok: true });
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.rule).toBe('resource-declarations');
      expect(diagnostics[0]?.message).toContain("'db' declared in resources");
      expect(diagnostics[0]?.message).toContain('never used');
    });
  });

  describe('single-object overload', () => {
    test('recognizes trail({ id, resources, blaze }) form', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail({
  id: 'entity.show',
  resources: [db],
  blaze: async (_input, ctx) => {
    return Result.ok({ source: db.from(ctx).source });
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('context parameter naming', () => {
    test('recognizes database.from(context) when second param is named context', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const database = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [database],
  blaze: async (_input, context) => {
    return Result.ok(database.from(context));
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('nested run false positives', () => {
    test('meta.run does not trigger false positives', () => {
      const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  meta: { blaze: async () => ctx.resource('phantom') },
  blaze: async (_input, ctx) => {
    return Result.ok(db.from(ctx));
  },
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  test('skips test files', () => {
    const code = `
trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.resource('db.main'));
  },
});
`;

    expect(resourceDeclarations.check(code, 'entity.test.ts')).toEqual([]);
  });
});
