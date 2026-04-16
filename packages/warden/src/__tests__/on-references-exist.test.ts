import { describe, expect, test } from 'bun:test';

import { onReferencesExist } from '../rules/on-references-exist.js';

const TEST_FILE = 'consumer.ts';

describe('on-references-exist', () => {
  test('passes when a locally defined signal is referenced', () => {
    const code = `
import { signal, trail, Result } from '@ontrails/core';
import { z } from 'zod';

const created = signal('entity.created', { payload: z.object({ id: z.string() }) });

trail('notify', {
  on: ['entity.created'],
  input: z.object({ id: z.string() }),
  blaze: async (input, ctx) => Result.ok({}),
});
`;

    expect(onReferencesExist.check(code, TEST_FILE)).toEqual([]);
  });

  test('flags an on: reference missing from project context', () => {
    const code = `
import { trail, Result } from '@ontrails/core';

trail('notify', {
  on: ['entity.created'],
  blaze: async (input, ctx) => Result.ok({}),
});
`;

    const diagnostics = onReferencesExist.checkWithContext(code, TEST_FILE, {
      knownSignalIds: new Set(['some.other.signal']),
      knownTrailIds: new Set(['notify']),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('on-references-exist');
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.message).toContain('entity.created');
  });

  test('passes when project context includes the referenced signal', () => {
    const code = `
import { trail, Result } from '@ontrails/core';

trail('notify', {
  on: ['entity.created'],
  blaze: async (input, ctx) => Result.ok({}),
});
`;

    const diagnostics = onReferencesExist.checkWithContext(code, TEST_FILE, {
      knownSignalIds: new Set(['entity.created']),
      knownTrailIds: new Set(['notify']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('flags only the unresolved id when multiple references are present', () => {
    const code = `
import { trail, Result } from '@ontrails/core';

trail('notify', {
  on: ['entity.created', 'audit.logged'],
  blaze: async (input, ctx) => Result.ok({}),
});
`;

    const diagnostics = onReferencesExist.checkWithContext(code, TEST_FILE, {
      knownSignalIds: new Set(['entity.created']),
      knownTrailIds: new Set(['notify']),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('audit.logged');
  });

  test('skips trails with no on: declaration', () => {
    const code = `
import { trail, Result } from '@ontrails/core';

trail('plain', {
  blaze: async (input, ctx) => Result.ok({}),
});
`;

    expect(
      onReferencesExist.checkWithContext(code, TEST_FILE, {
        knownSignalIds: new Set(),
        knownTrailIds: new Set(['plain']),
      })
    ).toEqual([]);
  });

  test('resolves const identifiers in on: array', () => {
    const code = `
import { trail, Result } from '@ontrails/core';

const ENTITY_CREATED = 'entity.created';

trail('notify', {
  on: [ENTITY_CREATED],
  blaze: async (input, ctx) => Result.ok({}),
});
`;

    const diagnostics = onReferencesExist.checkWithContext(code, TEST_FILE, {
      knownSignalIds: new Set(['entity.created']),
      knownTrailIds: new Set(['notify']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('skips test files', () => {
    const code = `
trail('notify', {
  on: ['unknown.signal'],
  blaze: async (input, ctx) => Result.ok({}),
});
`;

    expect(
      onReferencesExist.check(code, 'src/__tests__/notify.test.ts')
    ).toEqual([]);
  });

  test('skips object-form Signal value references without error', () => {
    const code = `
import { trail, signal, Result } from '@ontrails/core';
const orderPlaced = signal('order.placed', { payload: z.object({}) });
trail('notify', {
  on: [orderPlaced],
  blaze: async (input, ctx) => Result.ok({}),
});
`;

    // Even without registering 'order.placed' as known, the object-form entry
    // is skipped — runtime normalization is the source of truth.
    const diagnostics = onReferencesExist.checkWithContext(code, TEST_FILE, {
      knownSignalIds: new Set(),
      knownTrailIds: new Set(['notify']),
    });
    expect(diagnostics).toEqual([]);
  });
});
