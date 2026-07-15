import { describe, expect, test } from 'bun:test';

import { resource, Result, topo, trail } from '@ontrails/core';
import { deriveToolName } from '@ontrails/mcp';
import { z } from 'zod';

import { createMcpHarness } from '../harness-mcp.js';

describe('createMcpHarness', () => {
  test('threads resource overrides through MCP rendering options', async () => {
    const dbResource = resource('db.main', {
      create: () => Result.ok({ source: 'factory' }),
    });
    const readResource = trail('resource.read', {
      implementation: (_input, ctx) =>
        Result.ok({ source: dbResource.from(ctx).source as string }),
      input: z.object({}),
      output: z.object({ source: z.string() }),
      resources: [dbResource],
    });
    const graph = topo('test-app', { dbResource, readResource });
    const harness = createMcpHarness({
      graph,
      resources: {
        'db.main': { source: 'override' },
      },
    });

    const result = await harness.callTool(
      deriveToolName(graph.name, readResource.id),
      {}
    );

    expect(result.isError).toBe(false);
    expect(JSON.stringify(result.content)).toContain('override');
  });

  test('forwards authorization through the harness so bearer-token permits enforce', async () => {
    // Regression for TRL-1176: the harness used to drop authorization,
    // permit, and sessionId from options.extra, so permit-guarded tools
    // always failed with "No permit provided" even for valid tokens.
    const protectedTrail = trail('permit.guarded', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['thing:read'] },
    });
    const graph = topo('test-app', { protectedTrail });
    let seenSession: string | undefined;
    const buildHarness = (authorization: string) =>
      createMcpHarness({
        extra: { authorization, sessionId: 'session-1' },
        graph,
        resolvePermit: ({ bearerToken, sessionId }) => {
          seenSession = sessionId;
          return Result.ok(
            bearerToken === 'admin-token'
              ? { id: 'admin', scopes: ['thing:read'] }
              : { id: 'guest', scopes: [] }
          );
        },
      });
    const toolName = deriveToolName(graph.name, protectedTrail.id);

    const accepted = await buildHarness('Bearer admin-token').callTool(
      toolName,
      {}
    );
    expect(accepted.isError).toBe(false);
    expect(JSON.stringify(accepted.content)).toContain('true');
    expect(seenSession).toBe('session-1');

    const rejected = await buildHarness('Bearer guest-token').callTool(
      toolName,
      {}
    );
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected.content)).toContain('Missing scopes');
  });

  test('forwards an explicit permit from options.extra', async () => {
    const protectedTrail = trail('permit.direct', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['thing:read'] },
    });
    const graph = topo('test-app', { protectedTrail });
    const harness = createMcpHarness({
      extra: { permit: { id: 'direct', scopes: ['thing:read'] } },
      graph,
    });

    const result = await harness.callTool(
      deriveToolName(graph.name, protectedTrail.id),
      {}
    );

    expect(result.isError).toBe(false);
  });
});
