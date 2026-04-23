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

    test('blaze with no second parameter: unrelated closure ctx.resource is not tracked', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const ctx = { resource: () => ({}) };

trail('demo', {
  blaze: async () => {
    ctx.resource('db.main');
    return Result.ok({ ok: true });
  },
  resources: [],
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);
      // The blaze has no context parameter, so `ctx` in the body is an
      // unrelated closure-scoped binding, not the trail context. It must
      // not be tracked — no diagnostics.
      expect(diagnostics.length).toBe(0);
    });

    test('blaze with no second parameter: unrelated closure context.resource is not tracked', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const context = { resource: () => ({}) };

trail('demo', {
  blaze: async () => {
    context.resource('db.main');
    return Result.ok({ ok: true });
  },
  resources: [],
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });

    test('defaulted context param is detected (AssignmentPattern)', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const fallbackCtx = { resource: () => ({}) };

trail('demo', {
  blaze: async (_input, ctx = fallbackCtx) => {
    ctx.resource('db.main');
    return Result.ok({ ok: true });
  },
  resources: [],
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);
      // The param is an AssignmentPattern; its `.left` is the Identifier `ctx`.
      // Without AssignmentPattern handling in extractContextParamName, ctx-access
      // analysis would silently drop and this undeclared access would go
      // unreported.
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.resource('db.main')");
    });

    test('custom-named context param: only that name is tracked', () => {
      const code = `
import { trail, Result } from '@ontrails/core';

const ctx = { resource: () => ({}) };

trail('customCtx', {
  blaze: async (_input, c) => {
    ctx.resource('whatever');
    return Result.ok(c);
  },
  resources: [],
});
`;

      const diagnostics = resourceDeclarations.check(code, TEST_FILE);
      // `c` is the real trail context (unused here, but it's the param).
      // The closure `ctx.resource('whatever')` must not be flagged because
      // `ctx` is not the trail context — only `c` is.
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
