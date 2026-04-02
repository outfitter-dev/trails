import { describe, expect, test } from 'bun:test';

import { provisionDeclarations } from '../rules/provision-declarations.js';

const TEST_FILE = 'test.ts';

describe('provision-declarations', () => {
  describe('clean cases', () => {
    test('declared provisions match provision.from(ctx) usage', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => {
    return Result.ok({ source: db.from(ctx).source });
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('local helper named provision() is not treated as ctx lookup', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => {
    const provision = (id: string) => id;
    return Result.ok({
      resolved: provision('db.main'),
      source: db.from(ctx).source,
    });
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('declared provisions match ctx.provision() usage', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => {
    const resolved = ctx.provision('db.main');
    return Result.ok(resolved);
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes destructured provision() calls', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => {
    const { provision } = ctx;
    return Result.ok(provision('db.main'));
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes ctx.provision(db) lookups by declared provision object', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.provision(db));
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('error cases', () => {
    test('provision.from(ctx) without a declaration produces an error', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok({ source: db.from(ctx).source });
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.rule).toBe('provision-declarations');
      expect(diagnostics[0]?.message).toContain('db.from(ctx)');
      expect(diagnostics[0]?.message).toContain('not declared in provisions');
    });

    test('ctx.provision() without a declaration produces an error', () => {
      const code = `
trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.provision('db.main'));
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.provision('db.main')");
    });

    test('unresolved imported provision declarations do not suppress lookup diagnostics', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import { db } from './provisions';

// const db = provision('db.main', {
//   create: () => Result.ok({ source: 'factory' }),
// });

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.provision('db.main'));
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.provision('db.main')");
    });

    test('ctx.provision(db) without a declaration produces an error', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.provision(db));
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('ctx.provision(db)');
    });
  });

  describe('warn cases', () => {
    test('declared but unused provision produces a warning', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  blaze: async () => {
    return Result.ok({ ok: true });
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.rule).toBe('provision-declarations');
      expect(diagnostics[0]?.message).toContain("'db' declared in provisions");
      expect(diagnostics[0]?.message).toContain('never used');
    });
  });

  describe('single-object overload', () => {
    test('recognizes trail({ id, provisions, blaze }) form', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail({
  id: 'entity.show',
  provisions: [db],
  blaze: async (_input, ctx) => {
    return Result.ok({ source: db.from(ctx).source });
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('context parameter naming', () => {
    test('recognizes database.from(context) when second param is named context', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const database = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [database],
  blaze: async (_input, context) => {
    return Result.ok(database.from(context));
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('nested run false positives', () => {
    test('meta.run does not trigger false positives', () => {
      const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  meta: { blaze: async () => ctx.provision('phantom') },
  blaze: async (_input, ctx) => {
    return Result.ok(db.from(ctx));
  },
});
`;

      const diagnostics = provisionDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  test('skips test files', () => {
    const code = `
trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.provision('db.main'));
  },
});
`;

    expect(provisionDeclarations.check(code, 'entity.test.ts')).toEqual([]);
  });
});
