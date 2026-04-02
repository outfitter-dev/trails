import { describe, expect, test } from 'bun:test';

import { provisionExists } from '../rules/provision-exists.js';

const TEST_FILE = 'entity.ts';

describe('provision-exists', () => {
  test('passes when a locally declared provision exists', () => {
    const code = `
import { Result, provision, trail } from '@ontrails/core';
import type { Provision } from '@ontrails/core';

const db: Provision<{ source: string }> = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    expect(provisionExists.check(code, TEST_FILE)).toEqual([]);
  });

  test('ignores commented-out provision declarations when resolving local ids', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.show', {
  provisions: ['db.main'],
  blaze: async (_input, ctx) => Result.ok(ctx.provision('db.main')),
});

// const db = provision('db.main', {
//   create: () => Result.ok({ source: 'factory' }),
// });
`;

    const diagnostics = provisionExists.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('provision-exists');
    expect(diagnostics[0]?.message).toContain('db.main');
  });

  test('flags a declared provision missing from project context', () => {
    const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    const diagnostics = provisionExists.checkWithContext(code, TEST_FILE, {
      knownProvisionIds: new Set(['db.other']),
      knownTrailIds: new Set(['entity.show']),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('provision-exists');
    expect(diagnostics[0]?.message).toContain('db.main');
  });

  test('passes when project context includes the declared provision', () => {
    const code = `
import { Result, provision, trail } from '@ontrails/core';

const db = provision('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    const diagnostics = provisionExists.checkWithContext(code, TEST_FILE, {
      knownProvisionIds: new Set(['db.main']),
      knownTrailIds: new Set(['entity.show']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('skips unresolved imported provisions instead of guessing', () => {
    const code = `
import { trail } from '@ontrails/core';
import { db } from './provisions';

trail('entity.show', {
  provisions: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    expect(
      provisionExists.checkWithContext(code, TEST_FILE, {
        knownProvisionIds: new Set(['db.main']),
        knownTrailIds: new Set(['entity.show']),
      })
    ).toEqual([]);
  });

  test('skips test files', () => {
    const code = `
trail('entity.show', {
  provisions: ['db.main'],
  blaze: async (_input, ctx) => Result.ok(ctx.provision('db.main')),
});
`;

    expect(provisionExists.check(code, 'entity.test.ts')).toEqual([]);
  });
});
