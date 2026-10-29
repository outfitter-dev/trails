import { describe, expect, test } from 'bun:test';
import {
  AuthError,
  Result,
  createTrailContext,
  trail,
  topo,
} from '@ontrails/core';
import { z } from 'zod';

import { deriveMcpTools } from '../build.js';
import type { ResolveMcpPermitInput } from '../build.js';
import { resolveMcpPermit } from '../permit-resolution.js';

const permit = { id: 'org-42', scopes: ['record:read'] };

describe('shared MCP permit resolution', () => {
  test('passes raw Authorization to configured policy without a successful Bearer parse', async () => {
    for (const authorization of ['org-key', 'Bearer', undefined]) {
      let observed: ResolveMcpPermitInput | undefined;
      let calls = 0;
      const result = await resolveMcpPermit(
        {
          resolvePermit: (input) => {
            calls += 1;
            observed = input;
            return Result.ok(permit);
          },
        },
        { authorization }
      );
      expect(result.unwrap()).toEqual(permit);
      expect(calls).toBe(1);
      expect(observed?.authorization).toBe(authorization);
      expect(observed?.bearerToken).toBeUndefined();
    }
  });

  test('retains best-effort Bearer and untrusted metadata without copying fields from metadata', async () => {
    let observed: ResolveMcpPermitInput | undefined;
    const _meta = { apiKey: 'untrusted', authorization: 'untrusted' };
    await resolveMcpPermit(
      {
        resolvePermit: (input) => {
          observed = input;
          return Result.ok(null);
        },
      },
      { _meta, authorization: 'Bearer accepted' }
    );
    expect(observed).toEqual({
      _meta,
      authorization: 'Bearer accepted',
      bearerToken: 'accepted',
    });
  });

  test('preserves null absence and selected failure as distinct outcomes', async () => {
    const absent = await resolveMcpPermit(
      { resolvePermit: () => Result.ok(null) },
      {}
    );
    expect(absent.unwrap()).toBeUndefined();
    const error = new AuthError('Selected credential rejected');
    const invalid = await resolveMcpPermit(
      { resolvePermit: () => Result.err(error) },
      { authorization: 'invalid-key' }
    );
    expect(invalid.isErr()).toBe(true);
    if (invalid.isErr()) {
      expect(invalid.error).toBe(error);
    }
  });

  test('preserves explicit trusted host permit precedence and unconfigured parser behavior', async () => {
    let calls = 0;
    const trusted = await resolveMcpPermit(
      {
        resolvePermit: () => {
          calls += 1;
          return Result.err(new AuthError('Unused resolver'));
        },
      },
      { authorization: 'invalid', permit }
    );
    expect(trusted.unwrap()).toEqual(permit);
    expect(calls).toBe(0);
    const unconfigured = await resolveMcpPermit(
      {},
      { authorization: 'Basic rejected' }
    );
    expect(unconfigured.isErr()).toBe(true);
  });

  test('configured failure stops a public tool before host-context fallback or implementation', async () => {
    let invoked = false;
    let contexts = 0;
    const read = trail('public.read', {
      implementation: () => {
        invoked = true;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permit: 'public',
    });
    const tools = deriveMcpTools(topo('mcp-credentials', { read }), {
      createContext: () => {
        contexts += 1;
        return createTrailContext({ permit });
      },
      resolvePermit: () =>
        Result.err(new AuthError('Selected credential rejected')),
    }).unwrap();
    const [tool] = tools;
    expect(tool).toBeDefined();
    if (tool === undefined) {
      return;
    }
    const result = await tool.handler({}, { authorization: 'bad-key' });
    expect(result.isError).toBe(true);
    expect(invoked).toBe(false);
    expect(contexts).toBe(0);
  });

  test('keeps verified request identity before trusted host-context fallback', async () => {
    for (const requestPermit of [null, permit]) {
      let resolutions = 0;
      let contexts = 0;
      const read = trail('context.read', {
        implementation: (_input, ctx) =>
          Result.ok({ id: ctx.permit?.id ?? 'anonymous' }),
        input: z.object({}),
        output: z.object({ id: z.string() }),
        permit: { scopes: ['record:read'] },
      });
      const tools = deriveMcpTools(topo('mcp-credentials', { read }), {
        createContext: () => {
          contexts += 1;
          return createTrailContext({
            permit: { id: 'local-host', scopes: ['record:read'] },
          });
        },
        resolvePermit: () => {
          resolutions += 1;
          return Result.ok(requestPermit);
        },
      }).unwrap();
      const [tool] = tools;
      expect(tool).toBeDefined();
      if (tool === undefined) {
        return;
      }
      const result = await tool.handler({}, {});
      expect(result.structuredContent).toEqual({
        id: requestPermit === null ? 'local-host' : 'org-42',
      });
      expect(contexts).toBe(1);
      expect(resolutions).toBe(1);
    }
  });

  test('normalizes opaque credentials for a protected tool through the same helper', async () => {
    const read = trail('protected.read', {
      implementation: (_input, ctx) =>
        Result.ok({ id: ctx.permit?.id ?? 'anonymous' }),
      input: z.object({}),
      output: z.object({ id: z.string() }),
      permit: { scopes: ['record:read'] },
    });
    const tools = deriveMcpTools(topo('mcp-credentials', { read }), {
      resolvePermit: (input) =>
        input.authorization === 'org-key' ? Result.ok(permit) : Result.ok(null),
    }).unwrap();
    const [tool] = tools;
    expect(tool).toBeDefined();
    if (tool === undefined) {
      return;
    }
    const result = await tool.handler({}, { authorization: 'org-key' });
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent).toEqual({ id: 'org-42' });
  });
});
