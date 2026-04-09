import { describe, expect, test } from 'bun:test';

import { resourceExists } from '../rules/resource-exists.js';

const TEST_FILE = 'entity.ts';

describe('resource-exists', () => {
  test('passes when a locally declared resource exists', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';
import type { Resource } from '@ontrails/core';

const db: Resource<{ source: string }> = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    expect(resourceExists.check(code, TEST_FILE)).toEqual([]);
  });

  test('ignores commented-out resource declarations when resolving local ids', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.show', {
  resources: ['db.main'],
  blaze: async (_input, ctx) => Result.ok(ctx.resource('db.main')),
});

// const db = resource('db.main', {
//   create: () => Result.ok({ source: 'factory' }),
// });
`;

    const diagnostics = resourceExists.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('resource-exists');
    expect(diagnostics[0]?.message).toContain('db.main');
  });

  test('flags a declared resource missing from project context', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    const diagnostics = resourceExists.checkWithContext(code, TEST_FILE, {
      knownResourceIds: new Set(['db.other']),
      knownTrailIds: new Set(['entity.show']),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('resource-exists');
    expect(diagnostics[0]?.message).toContain('db.main');
  });

  test('passes when project context includes the declared resource', () => {
    const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    const diagnostics = resourceExists.checkWithContext(code, TEST_FILE, {
      knownResourceIds: new Set(['db.main']),
      knownTrailIds: new Set(['entity.show']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('skips unresolved imported resources instead of guessing', () => {
    const code = `
import { trail } from '@ontrails/core';
import { db } from './resources';

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});
`;

    expect(
      resourceExists.checkWithContext(code, TEST_FILE, {
        knownResourceIds: new Set(['db.main']),
        knownTrailIds: new Set(['entity.show']),
      })
    ).toEqual([]);
  });

  test('skips test files', () => {
    const code = `
trail('entity.show', {
  resources: ['db.main'],
  blaze: async (_input, ctx) => Result.ok(ctx.resource('db.main')),
});
`;

    expect(resourceExists.check(code, 'entity.test.ts')).toEqual([]);
  });
});
