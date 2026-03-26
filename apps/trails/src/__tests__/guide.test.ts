import { describe, expect, test } from 'bun:test';

import { trail, topo, Result } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const helloTrail = trail('hello', {
  description: 'Say hello',
  detours: {
    NotFoundError: ['search'],
  },
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
  implementation: (input) => {
    const name = input.name ?? 'world';
    return Result.ok({ message: `Hello, ${name}!` });
  },
  input: z.object({ name: z.string().optional() }),
  output: z.object({ message: z.string() }),
  readOnly: true,
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

    const raw = hello as unknown as Record<string, unknown>;
    expect(raw['description']).toBe('Say hello');
  });

  test('trail detail includes examples', () => {
    const item = app.get('hello');
    expect(item).toBeDefined();

    const raw = item as unknown as Record<string, unknown>;
    const examples = raw['examples'] as { name: string }[];
    expect(examples.length).toBe(2);
    expect(examples[0]?.name).toBe('Default greeting');
  });

  test('JSON output for trail is valid', () => {
    const item = app.get('hello');
    expect(item).toBeDefined();

    const raw = item as unknown as Record<string, unknown>;
    const json = JSON.stringify({
      description: raw['description'],
      detours: raw['detours'],
      examples: raw['examples'],
      id: (item as { id: string }).id,
      kind: (item as { kind: string }).kind,
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
    const item = app.get('hello');
    expect(item).toBeDefined();

    const raw = item as unknown as Record<string, unknown>;
    const detours = raw['detours'] as Record<string, string[]>;
    expect(detours['NotFoundError']).toEqual(['search']);
  });
});
