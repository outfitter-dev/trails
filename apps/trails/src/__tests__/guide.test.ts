import { describe, expect, test } from 'bun:test';

import type { AnyTrail } from '@ontrails/core';
import { ConflictError, trail, topo, Result } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const helloTrail = trail('hello', {
  blaze: (input) => {
    const name = input.name ?? 'world';
    return Result.ok({ message: `Hello, ${name}!` });
  },
  description: 'Say hello',
  detours: [
    {
      on: ConflictError,
      /* oxlint-disable-next-line require-await -- test stub */
      recover: async () => Result.ok({ message: 'recovered' }),
    },
  ],
  examples: [
    {
      expected: { message: 'Hello, world!' },
      input: {},
      name: 'Default greeting',
    },
    {
      expected: { message: 'Hello, Trails!' },
      input: { name: 'Trails' },
      name: 'Named greeting',
    },
  ],
  input: z.object({ name: z.string().optional() }),
  intent: 'read',
  output: z.object({ message: z.string() }),
});

const app = topo('test-app', { hello: helloTrail });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trails guide', () => {
  test('lists trails with descriptions', () => {
    const items = app.list();
    expect(items.length).toBe(1);

    const [hello] = items;
    expect(hello).toBeDefined();
    expect(hello?.id).toBe('hello');

    expect((hello as AnyTrail).description).toBe('Say hello');
  });

  test('trail detail includes examples', () => {
    const item = app.get('hello') as AnyTrail;
    expect(item).toBeDefined();
    expect(item.examples).toBeDefined();
    expect(item.examples?.length).toBe(2);
    expect(item.examples?.[0]?.name).toBe('Default greeting');
  });

  test('JSON output for trail is valid', () => {
    const t = app.get('hello') as AnyTrail;
    expect(t).toBeDefined();

    const json = JSON.stringify({
      description: t.description,
      detours: t.detours,
      examples: t.examples,
      id: t.id,
      kind: t.kind,
    });

    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['id']).toBe('hello');
    expect(parsed['kind']).toBe('trail');
    expect(parsed['description']).toBe('Say hello');
  });

  test('non-existent trail returns undefined from topo', () => {
    const item = app.get('does-not-exist');
    expect(item).toBeUndefined();
  });

  test('detours are accessible on trail', () => {
    const t = app.get('hello') as AnyTrail;
    expect(t).toBeDefined();
    expect(t.detours).toHaveLength(1);
    expect(t.detours[0]?.on).toBe(ConflictError);
  });
});
