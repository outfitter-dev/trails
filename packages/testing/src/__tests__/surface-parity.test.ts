import { describe, expect, test } from 'bun:test';

import { NotFoundError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { runSurfaceParityExample } from '../surface-parity.js';

describe('runSurfaceParityExample', () => {
  test('normalizes matching success payloads across CLI, MCP, and HTTP', async () => {
    const show = trail('entity.show', {
      examples: [
        {
          expected: { greeting: 'Hello, Ada Lovelace' },
          input: { name: 'Ada Lovelace' },
          name: 'Show Ada',
        },
      ],
      implementation: (input: { name: string }) =>
        Result.ok({ greeting: `Hello, ${input.name}` }),
      input: z.object({ name: z.string() }),
      intent: 'read',
      output: z.object({ greeting: z.string() }),
    });
    const graph = topo('parity-app', { show });
    const [example] = show.examples ?? [];
    if (example === undefined) {
      throw new Error('Expected show trail example');
    }

    const comparison = await runSurfaceParityExample(graph, show, example);

    expect(comparison).toEqual({
      cli: { ok: true, value: { greeting: 'Hello, Ada Lovelace' } },
      http: { ok: true, value: { greeting: 'Hello, Ada Lovelace' } },
      mcp: { ok: true, value: { greeting: 'Hello, Ada Lovelace' } },
    });
  });

  test('merges per-surface context options instead of clobbering them', async () => {
    const requestId = 'surface-request-123';
    const show = trail('context.show', {
      examples: [
        {
          expected: { requestId },
          input: {},
          name: 'Show request context',
        },
      ],
      implementation: (_input, ctx) => Result.ok({ requestId: ctx.requestId }),
      input: z.object({}),
      intent: 'read',
      output: z.object({ requestId: z.string() }),
    });
    const graph = topo('parity-app', { show });
    const [example] = show.examples ?? [];
    if (example === undefined) {
      throw new Error('Expected show trail example');
    }

    const comparison = await runSurfaceParityExample(graph, show, example, {
      cli: { ctx: { requestId } },
      http: { ctx: { requestId } },
      mcp: { createContext: () => ({ requestId }) },
    });

    expect(comparison).toEqual({
      cli: { ok: true, value: { requestId } },
      http: { ok: true, value: { requestId } },
      mcp: { ok: true, value: { requestId } },
    });
  });

  test('normalizes MCP structuredContent data envelopes for array output', async () => {
    const list = trail('entity.list', {
      examples: [
        {
          expected: ['one', 'two'],
          input: {},
          name: 'List entities',
        },
      ],
      implementation: () => Result.ok(['one', 'two']),
      input: z.object({}),
      intent: 'read',
      output: z.array(z.string()),
    });
    const graph = topo('parity-app', { list });
    const [example] = list.examples ?? [];
    if (example === undefined) {
      throw new Error('Expected list trail example');
    }

    const comparison = await runSurfaceParityExample(graph, list, example);

    expect(comparison).toEqual({
      cli: { ok: true, value: ['one', 'two'] },
      http: { ok: true, value: ['one', 'two'] },
      mcp: { ok: true, value: ['one', 'two'] },
    });
  });

  test('normalizes TrailsError category and code across surfaces', async () => {
    const missing = trail('entity.missing', {
      examples: [
        {
          error: 'NotFoundError',
          input: { name: 'Missing' },
          name: 'Missing entity',
        },
      ],
      implementation: () => Result.err(new NotFoundError('Entity not found')),
      input: z.object({ name: z.string() }),
      intent: 'read',
      output: z.object({ name: z.string() }),
    });
    const graph = topo('parity-app', { missing });
    const [example] = missing.examples ?? [];
    if (example === undefined) {
      throw new Error('Expected missing trail example');
    }

    const comparison = await runSurfaceParityExample(graph, missing, example);

    expect(comparison).toEqual({
      cli: {
        error: { category: 'not_found', code: 'NotFoundError' },
        ok: false,
      },
      http: {
        error: { category: 'not_found', code: 'NotFoundError' },
        ok: false,
      },
      mcp: {
        error: { category: 'not_found', code: 'NotFoundError' },
        ok: false,
      },
    });
  });
});
