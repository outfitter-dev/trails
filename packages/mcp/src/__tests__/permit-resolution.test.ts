import { describe, expect, test } from 'bun:test';

import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { deriveMcpTools } from '../build.js';
import type { ResolveMcpPermit, ResolveMcpPermitInput } from '../build.js';

const createIdentityTool = (resolvePermit: ResolveMcpPermit) => {
  const identity = trail('identity.read', {
    implementation: (_input, ctx) => Result.ok({ id: ctx.permit?.id }),
    input: z.object({}),
    intent: 'read',
    output: z.object({ id: z.string().optional() }),
    permit: { scopes: ['identity:read'] },
  });
  const tools = deriveMcpTools(topo('permits', { identity }), {
    resolvePermit,
  });
  if (tools.isErr()) {
    throw tools.error;
  }
  const [tool] = tools.value;
  if (tool === undefined) {
    throw new Error('Expected identity tool');
  }
  return tool;
};

describe('per-request MCP permit resolution', () => {
  test('offers metadata credentials to the resolver without a bearer', async () => {
    const seen: ResolveMcpPermitInput[] = [];
    const tool = createIdentityTool((input) => {
      seen.push(input);
      return Result.ok(
        input._meta?.['credential'] === 'fixture-reader'
          ? { actors: [], id: 'reader', scopes: ['identity:read'] }
          : undefined
      );
    });
    const extra = { _meta: { credential: 'fixture-reader' } };
    const result = await tool.handler({}, extra);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ id: 'reader' });
    expect(seen).toEqual([
      { _meta: extra._meta, authorization: undefined, bearerToken: undefined },
    ]);
  });

  test('resolves each request independently of earlier credentials and legacy session fields', async () => {
    const seen: ResolveMcpPermitInput[] = [];
    const tool = createIdentityTool((input) => {
      seen.push(input);
      return Result.ok({
        actors: [],
        id: `${input.bearerToken}:${input._meta?.['realm']}`,
        scopes: ['identity:read'],
      });
    });
    const reader = {
      _meta: { realm: 'one' },
      authorization: 'Bearer reader',
      sessionId: 'legacy-one',
    };
    const other = {
      _meta: { realm: 'two' },
      authorization: 'Bearer other',
      sessionId: 'legacy-two',
    };
    const repeated = { ...reader, sessionId: 'different-legacy-id' };
    const first = await tool.handler({}, reader);
    const middle = await tool.handler({}, other);
    const last = await tool.handler({}, repeated);
    expect(first.structuredContent).toEqual({ id: 'reader:one' });
    expect(middle.structuredContent).toEqual({ id: 'other:two' });
    expect(last.structuredContent).toEqual(first.structuredContent);
    expect(seen).toEqual([
      {
        _meta: reader._meta,
        authorization: 'Bearer reader',
        bearerToken: 'reader',
      },
      {
        _meta: other._meta,
        authorization: 'Bearer other',
        bearerToken: 'other',
      },
      {
        _meta: repeated._meta,
        authorization: 'Bearer reader',
        bearerToken: 'reader',
      },
    ]);
    expect(seen.every((input) => !('sessionId' in input))).toBe(true);
  });
});
