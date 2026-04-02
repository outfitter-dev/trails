import { describe, expect, test } from 'bun:test';

import { serviceExists } from '../rules/service-exists.js';

const TEST_FILE = 'entity.ts';

describe('service-exists', () => {
  test('passes when a locally declared service exists', () => {
    const code = `
import { Result, service, trail } from '@ontrails/core';
import type { Service } from '@ontrails/core';

const db: Service<{ source: string }> = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    expect(serviceExists.check(code, TEST_FILE)).toEqual([]);
  });

  test('ignores commented-out service declarations when resolving local ids', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.show', {
  services: ['db.main'],
  blaze: async (_input, ctx) => Result.ok(ctx.service('db.main')),
});

// const db = service('db.main', {
//   create: () => Result.ok({ source: 'factory' }),
// });
`;

    const diagnostics = serviceExists.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('service-exists');
    expect(diagnostics[0]?.message).toContain('db.main');
  });

  test('flags a declared service missing from project context', () => {
    const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    const diagnostics = serviceExists.checkWithContext(code, TEST_FILE, {
      knownServiceIds: new Set(['db.other']),
      knownTrailIds: new Set(['entity.show']),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('service-exists');
    expect(diagnostics[0]?.message).toContain('db.main');
  });

  test('passes when project context includes the declared service', () => {
    const code = `
import { Result, service, trail } from '@ontrails/core';

const db = service('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    const diagnostics = serviceExists.checkWithContext(code, TEST_FILE, {
      knownServiceIds: new Set(['db.main']),
      knownTrailIds: new Set(['entity.show']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('skips unresolved imported services instead of guessing', () => {
    const code = `
import { trail } from '@ontrails/core';
import { db } from './services';

trail('entity.show', {
  services: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    expect(
      serviceExists.checkWithContext(code, TEST_FILE, {
        knownServiceIds: new Set(['db.main']),
        knownTrailIds: new Set(['entity.show']),
      })
    ).toEqual([]);
  });

  test('skips test files', () => {
    const code = `
trail('entity.show', {
  services: ['db.main'],
  blaze: async (_input, ctx) => Result.ok(ctx.service('db.main')),
});
`;

    expect(serviceExists.check(code, 'entity.test.ts')).toEqual([]);
  });
});
