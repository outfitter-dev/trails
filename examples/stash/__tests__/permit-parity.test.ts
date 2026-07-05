/**
 * Permit parity and the secret-snippet non-leak guarantee, proven per
 * surface with real bearer tokens.
 *
 * Every surface resolves tokens through the same db-backed auth adapter:
 * HTTP reads the Authorization header, MCP reads the request authorization,
 * and the CLI resolves `--token`. On each of them, another user's secret
 * snippet is indistinguishable from a missing one — `NotFoundError`, never a
 * permission error — while non-owner writes to a *public* snippet fail with
 * a plain `PermissionError`.
 */

import { describe, expect, test } from 'bun:test';

import { tokenPreset } from '@ontrails/cli';
import type { ActionResultContext } from '@ontrails/cli';
import { createProgram } from '@ontrails/commander';
import {
  AuthError,
  NotFoundError,
  PermissionError,
  Result,
} from '@ontrails/core';
import type { BasePermit } from '@ontrails/core';
import { MCP_TOOL_ERROR_META_KEY, deriveToolName } from '@ontrails/mcp';
import { createHttpHarness } from '@ontrails/testing/http';
import { createMcpHarness } from '@ontrails/testing/mcp';

import { graph } from '../src/app.js';
import { createStashAuthAdapter } from '../src/resources/auth.js';
import { createMockDb, db } from '../src/resources/db.js';

const ALICE_TOKEN = 'stash_alice_dev_token';
const BOB_TOKEN = 'stash_bob_dev_token';

interface Setup {
  adapter: ReturnType<typeof createStashAuthAdapter>;
  conn: ReturnType<typeof createMockDb>;
}

const setup = (): Setup => {
  const conn = createMockDb();
  return { adapter: createStashAuthAdapter(conn), conn };
};

/**
 * Adapt the permits-package adapter result (whose error side is a plain
 * `{ code, message }` shape) to the surface resolver contract, which wants
 * an `Error` on the failure side.
 */
const resolveThroughAdapter = async (
  adapter: Setup['adapter'],
  bearerToken: string | undefined,
  surface: 'http' | 'mcp' | 'cli',
  requestId: string
): Promise<Result<BasePermit | null, Error>> => {
  const authed = await adapter.authenticate({
    ...(bearerToken === undefined ? {} : { bearerToken }),
    requestId,
    surface,
  });
  if (authed.isErr()) {
    return Result.err(new AuthError(authed.error.message));
  }
  return Result.ok(authed.value);
};

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

const httpHarness = ({ adapter, conn }: Setup) =>
  createHttpHarness({
    graph,
    resolvePermit: ({ bearerToken, requestId }) =>
      resolveThroughAdapter(
        adapter,
        bearerToken,
        'http',
        requestId ?? 'test-http'
      ),
    resources: { [db.id]: conn },
  });

const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});

describe('HTTP: secret snippets never leak', () => {
  test('non-owner and anonymous reads are indistinguishable from missing ids', async () => {
    const harness = httpHarness(setup());

    const asBob = await harness.get(
      '/snippet/get',
      { id: 'snip_secret' },
      bearer(BOB_TOKEN)
    );
    expect(asBob.status).toBe(404);
    expect(asBob.error?.message).toBe('Snippet "snip_secret" not found');

    const anonymous = await harness.get('/snippet/get', { id: 'snip_secret' });
    expect(anonymous.status).toBe(404);

    const missing = await harness.get(
      '/snippet/get',
      { id: 'snip_missing' },
      bearer(BOB_TOKEN)
    );
    expect(missing.status).toBe(404);
    // Same category and code as the hidden snippet — nothing distinguishes them.
    expect(missing.error?.category).toBe(asBob.error?.category);
    expect(missing.error?.code).toBe(asBob.error?.code);

    const asOwner = await harness.get(
      '/snippet/get',
      { id: 'snip_secret' },
      bearer(ALICE_TOKEN)
    );
    expect(asOwner.status).toBe(200);
    expect(asOwner.data).toMatchObject({ id: 'snip_secret' });
  });

  test('non-owner writes: public snippets are forbidden, secret snippets are not-found', async () => {
    const harness = httpHarness(setup());

    const publicWrite = await harness.delete(
      '/snippet/delete',
      { id: 'snip_hello' },
      bearer(BOB_TOKEN)
    );
    expect(publicWrite.status).toBe(403);

    const secretWrite = await harness.delete(
      '/snippet/delete',
      { id: 'snip_secret' },
      bearer(BOB_TOKEN)
    );
    expect(secretWrite.status).toBe(404);
  });

  test('revoked tokens stop authenticating', async () => {
    const state = setup();
    await state.conn.tokens.update('tok_bob', { revoked: true });
    const harness = httpHarness(state);

    const read = await harness.get(
      '/snippet/get',
      { id: 'snip_secret' },
      bearer(BOB_TOKEN)
    );
    expect(read.status).toBe(404);

    const write = await harness.delete(
      '/snippet/delete',
      { id: 'snip_hello' },
      bearer(BOB_TOKEN)
    );
    expect(write.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// MCP surface
// ---------------------------------------------------------------------------

const mcpCall = async (
  state: Setup,
  trailId: string,
  args: Record<string, unknown>,
  token?: string
) => {
  const harness = createMcpHarness({
    graph,
    ...(token === undefined
      ? {}
      : { extra: { authorization: `Bearer ${token}` } }),
    resolvePermit: ({ bearerToken }) =>
      resolveThroughAdapter(state.adapter, bearerToken, 'mcp', 'test-mcp'),
    resources: { [db.id]: state.conn },
  });
  return await harness.callTool(deriveToolName(graph.name, trailId), args);
};

const mcpErrorName = (result: {
  meta?: Record<string, unknown> | undefined;
}) => {
  const meta = result.meta?.[MCP_TOOL_ERROR_META_KEY];
  return meta !== null && typeof meta === 'object' && 'name' in meta
    ? meta.name
    : undefined;
};

describe('MCP: secret snippets never leak', () => {
  test('non-owner reads report NotFoundError, owner reads succeed', async () => {
    const state = setup();

    const asBob = await mcpCall(
      state,
      'snippet.get',
      { id: 'snip_secret' },
      BOB_TOKEN
    );
    expect(asBob.isError).toBe(true);
    expect(mcpErrorName(asBob)).toBe('NotFoundError');

    const missing = await mcpCall(
      state,
      'snippet.get',
      { id: 'snip_missing' },
      BOB_TOKEN
    );
    expect(mcpErrorName(missing)).toBe(mcpErrorName(asBob));

    const asOwner = await mcpCall(
      state,
      'snippet.get',
      { id: 'snip_secret' },
      ALICE_TOKEN
    );
    expect(asOwner.isError ?? false).toBe(false);
    expect(asOwner.structuredContent).toMatchObject({ id: 'snip_secret' });
  });

  test('non-owner writes: forbidden on public, not-found on secret', async () => {
    const state = setup();

    const publicWrite = await mcpCall(
      state,
      'snippet.delete',
      { id: 'snip_hello' },
      BOB_TOKEN
    );
    expect(mcpErrorName(publicWrite)).toBe('PermissionError');

    const secretWrite = await mcpCall(
      state,
      'snippet.delete',
      { id: 'snip_secret' },
      BOB_TOKEN
    );
    expect(mcpErrorName(secretWrite)).toBe('NotFoundError');
  });
});

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

const cliRun = async (state: Setup, argv: readonly string[]) => {
  const results: ActionResultContext[] = [];
  const program = createProgram(graph, {
    name: 'stash',
    onResult: (resultCtx) => {
      results.push(resultCtx);
      return Promise.resolve();
    },
    presets: [tokenPreset()],
    resolvePermitFromToken: async ({ requestId, token }) => {
      const authed = await resolveThroughAdapter(
        state.adapter,
        token,
        'cli',
        requestId
      );
      if (authed.isErr()) {
        return authed;
      }
      return authed.value === null
        ? Result.err(new AuthError('Unknown or revoked token'))
        : Result.ok(authed.value);
    },
    resources: { [db.id]: state.conn },
  });
  program.exitOverride();
  await program.parseAsync([...argv], { from: 'user' });
  const [outcome] = results;
  if (outcome === undefined) {
    throw new Error(`CLI produced no result for: ${argv.join(' ')}`);
  }
  return outcome;
};

describe('CLI: secret snippets never leak', () => {
  test('non-owner --token reads report NotFoundError, owner reads succeed', async () => {
    const state = setup();

    const asBob = await cliRun(state, [
      'snippet',
      'get',
      '--id',
      'snip_secret',
      '--token',
      BOB_TOKEN,
    ]);
    expect(asBob.result.isErr()).toBe(true);
    expect(asBob.result.isErr() && asBob.result.error).toBeInstanceOf(
      NotFoundError
    );

    const asOwner = await cliRun(state, [
      'snippet',
      'get',
      '--id',
      'snip_secret',
      '--token',
      ALICE_TOKEN,
    ]);
    expect(asOwner.result.isOk()).toBe(true);
  });

  test('non-owner writes: forbidden on public, not-found on secret', async () => {
    const state = setup();

    const publicWrite = await cliRun(state, [
      'snippet',
      'delete',
      '--id',
      'snip_hello',
      '--token',
      BOB_TOKEN,
    ]);
    expect(
      publicWrite.result.isErr() && publicWrite.result.error
    ).toBeInstanceOf(PermissionError);

    const secretWrite = await cliRun(state, [
      'snippet',
      'delete',
      '--id',
      'snip_secret',
      '--token',
      BOB_TOKEN,
    ]);
    expect(
      secretWrite.result.isErr() && secretWrite.result.error
    ).toBeInstanceOf(NotFoundError);
  });
});
