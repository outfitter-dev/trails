import { describe, expect, test } from 'bun:test';

import { serviceDeclarations } from '../rules/service-declarations.js';

const TEST_FILE = 'test.ts';

describe('service-declarations', () => {
  describe('clean cases', () => {
    test('declared services match service.from(ctx) usage', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => {
    return Result.ok({ source: db.from(ctx).source });
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('local helper named service() is not treated as ctx lookup', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => {
    const service = (id: string) => id;
    return Result.ok({
      resolved: service('db.main'),
      source: db.from(ctx).source,
    });
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('declared services match ctx.service() usage', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => {
    const resolved = ctx.service('db.main');
    return Result.ok(resolved);
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes destructured service() calls', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => {
    const { service } = ctx;
    return Result.ok(service('db.main'));
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });

    test('recognizes ctx.service(db) lookups by declared service object', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.service(db));
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('error cases', () => {
    test('service.from(ctx) without a declaration produces an error', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok({ source: db.from(ctx).source });
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.rule).toBe('service-declarations');
      expect(diagnostics[0]?.message).toContain('db.from(ctx)');
      expect(diagnostics[0]?.message).toContain('not declared in services');
    });

    test('ctx.service() without a declaration produces an error', () => {
      const code = `
trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.service('db.main'));
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.service('db.main')");
    });

    test('unresolved imported service declarations do not suppress lookup diagnostics', () => {
      const code = `
import { Result, trail } from '@ontrails/core';
import { db } from './services';

// const db = service('db.main', {
//   create: () => Result.ok({ source: 'factory' }),
// });

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.service('db.main'));
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain("ctx.service('db.main')");
    });

    test('ctx.service(db) without a declaration produces an error', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.service(db));
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('ctx.service(db)');
    });
  });

  describe('warn cases', () => {
    test('declared but unused service produces a warning', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  blaze: async () => {
    return Result.ok({ ok: true });
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.rule).toBe('service-declarations');
      expect(diagnostics[0]?.message).toContain("'db' declared in services");
      expect(diagnostics[0]?.message).toContain('never used');
    });
  });

  describe('single-object overload', () => {
    test('recognizes trail({ id, services, run }) form', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail({
  id: 'entity.show',
  services: [db],
  blaze: async (_input, ctx) => {
    return Result.ok({ source: db.from(ctx).source });
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('context parameter naming', () => {
    test('recognizes database.from(context) when second param is named context', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const database = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [database],
  blaze: async (_input, context) => {
    return Result.ok(database.from(context));
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('nested run false positives', () => {
    test('metadata.run does not trigger false positives', () => {
      const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  metadata: { blaze: async () => ctx.service('phantom') },
  blaze: async (_input, ctx) => {
    return Result.ok(db.from(ctx));
  },
});
`;

      const diagnostics = serviceDeclarations.check(code, TEST_FILE);

      expect(diagnostics.length).toBe(0);
    });
  });

  test('skips test files', () => {
    const code = `
trail('entity.show', {
  blaze: async (_input, ctx) => {
    return Result.ok(ctx.service('db.main'));
  },
});
`;

    expect(serviceDeclarations.check(code, 'entity.test.ts')).toEqual([]);
  });
});
