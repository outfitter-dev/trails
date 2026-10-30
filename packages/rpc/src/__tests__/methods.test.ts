import { describe, expect, test } from 'bun:test';

import { Result, signal, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { deriveRpcMethods } from '../methods.js';
import { RPC_SUBPROTOCOL } from '../protocol.js';

const greet = trail('greet', {
  description: 'Say hello',
  examples: [
    {
      expected: { greeting: 'Hello, Ada!' },
      input: { name: 'Ada' },
      name: 'Ada',
    },
  ],
  implementation: (input: { name: string }) =>
    Result.ok({ greeting: `Hello, ${input.name}!` }),
  input: z.object({ name: z.string() }),
  intent: 'read',
  output: z.object({ greeting: z.string() }),
});

const hidden = trail('audit.read', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
  visibility: 'internal',
});

describe('deriveRpcMethods', () => {
  test('renders trail ids as methods with schemas, examples and intent', () => {
    const table = deriveRpcMethods(topo('app', { greet, hidden })).unwrap();

    expect(table.subprotocol).toBe(RPC_SUBPROTOCOL);
    expect(table.trails.map((entry) => entry.method)).toEqual(['greet']);
    const [entry] = table.trails;
    expect(entry?.trailId).toBe('greet');
    expect(entry?.intent).toBe('read');
    expect(entry?.description).toBe('Say hello');
    expect(entry?.inputSchema['type']).toBe('object');
    expect(entry?.outputSchema?.['type']).toBe('object');
    expect(entry?.examples?.[0]?.name).toBe('Ada');
    expect(entry?.layerRenderings).toEqual([]);
  });

  test('advertises only implemented framework methods', () => {
    const table = deriveRpcMethods(topo('app', { greet })).unwrap();
    expect(table.framework.map((entry) => entry.method)).toEqual([
      'trails.discover',
    ]);
  });

  test('lists topo signals as channel candidates', () => {
    const changed = signal<{ id: string }>('greeting.changed', {
      description: 'A greeting changed',
      payload: z.object({ id: z.string() }),
    });
    const table = deriveRpcMethods(topo('app', { changed, greet })).unwrap();
    expect(table.signals).toEqual([
      { description: 'A greeting changed', id: 'greeting.changed' },
    ]);
  });

  test('rejects trail ids under the reserved prefixes for the whole topo', () => {
    const reserved = trail('trails.ping', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      visibility: 'internal',
    });
    const result = deriveRpcMethods(topo('app', { greet, reserved }));
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }
    expect(result.error.message).toContain('trails.ping');
    expect(result.error.message).toContain('reserved');
  });

  test('honors include, exclude and intent selection', () => {
    const remove = trail('greeting.delete', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'destroy',
      output: z.object({ ok: z.boolean() }),
    });
    const graph = topo('app', { greet, remove });
    expect(
      deriveRpcMethods(graph, { intent: ['read'] })
        .unwrap()
        .trails.map((entry) => entry.method)
    ).toEqual(['greet']);
    expect(
      deriveRpcMethods(graph, { exclude: ['greet'] })
        .unwrap()
        .trails.map((entry) => entry.method)
    ).toEqual(['greeting.delete']);
  });
});
