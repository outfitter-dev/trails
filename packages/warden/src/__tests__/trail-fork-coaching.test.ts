import { describe, expect, test } from 'bun:test';

import { trailForkCoaching } from '../rules/trail-fork-coaching.js';

const check = (sourceCode: string) =>
  trailForkCoaching.check(sourceCode, 'src/trails/users.ts');

describe('trail-fork-coaching', () => {
  test('warns when a trail branches on an action discriminator', () => {
    const source = `
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const usersManage = trail('users.manage', {
  input: z.object({
    action: z.enum(['create', 'delete']),
    id: z.string().optional(),
  }),
  implementation: async (input) => {
    switch (input.action) {
      case 'create':
        return Result.ok({ created: true });
      case 'delete':
        return Result.ok({ deleted: true });
    }
  },
});
`;
    const diagnostics = check(source);
    const switchLine =
      source.split('\n').findIndex((line) => line.includes('switch')) + 1;

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      line: switchLine,
      rule: 'trail-fork-coaching',
      severity: 'warn',
    });
    expect(diagnostics[0]?.message).toContain('Trail "users.manage"');
    expect(diagnostics[0]?.message).toContain('input.action');
    expect(diagnostics[0]?.message).toContain('trail fork');
    expect(diagnostics[0]?.message).toContain('change semantics');
    expect(diagnostics[0]?.message).toContain('trailhead');
  });

  test('warns when a trail branches on an extracted input schema', () => {
    const diagnostics = check(`
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

const manageInput = z.object({
  action: z.enum(['create', 'delete']),
  id: z.string().optional(),
});

export const usersManage = trail('users.manage', {
  input: manageInput,
  implementation: async (input) => {
    if (input.action === 'delete') {
      return Result.ok({ deleted: true });
    }
    return Result.ok({ created: true });
  },
});
`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('input.action');
  });

  test('warns when a trail branches on a direct destructured input parameter', () => {
    const diagnostics = check(`
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const usersManage = trail('users.manage', {
  input: z.object({
    action: z.enum(['create', 'delete']),
    id: z.string().optional(),
  }),
  implementation: async ({ action }) => {
    if (action === 'delete') {
      return Result.ok({ deleted: true });
    }
    return Result.ok({ created: true });
  },
});
`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('input.action');
  });

  test('warns when a trail branches on a destructured operation discriminator', () => {
    const diagnostics = check(`
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const migration = trail('migration.run', {
  input: z.object({
    operation: z.union([z.literal('apply'), z.literal('review')]),
    root: z.string(),
  }),
  implementation: async (input) => {
    const { operation: selectedOperation } = input;
    if (selectedOperation === 'apply') {
      return Result.ok({ applied: true });
    }
    return Result.ok({ reviewed: true });
  },
});
`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('input.operation');
    expect(diagnostics[0]?.message).toContain('"apply"');
    expect(diagnostics[0]?.message).toContain('"review"');
  });

  test('allows non-branching domain action fields', () => {
    const diagnostics = check(`
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const notify = trail('entity.notify', {
  input: z.object({
    action: z.enum(['created', 'updated', 'deleted']),
    entityId: z.string(),
  }),
  implementation: async (input) => Result.ok({ action: input.action }),
});
`);

    expect(diagnostics).toEqual([]);
  });

  test('allows output computations from action fields', () => {
    const diagnostics = check(`
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const notify = trail('entity.notify', {
  input: z.object({
    action: z.enum(['created', 'updated', 'deleted']),
    entityId: z.string(),
  }),
  implementation: async (input) => Result.ok({ isCreated: input.action === 'created' }),
});
`);

    expect(diagnostics).toEqual([]);
  });

  test('ignores signal definitions with action payloads', () => {
    const diagnostics = check(`
import { Result, signal } from '@ontrails/core';
import { z } from 'zod';

export const entityChanged = signal('entity.changed', {
  input: z.object({
    action: z.enum(['created', 'updated', 'deleted']),
    entityId: z.string(),
  }),
  implementation: async (input) => Result.ok(input),
});
`);

    expect(diagnostics).toEqual([]);
  });

  test('does not flag unrelated discriminators', () => {
    const diagnostics = check(`
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const publish = trail('release.publish', {
  input: z.object({
    status: z.enum(['draft', 'published']),
  }),
  implementation: async (input) => {
    if (input.status === 'published') {
      return Result.ok({ visible: true });
    }
    return Result.ok({ visible: false });
  },
});
`);

    expect(diagnostics).toEqual([]);
  });
});
