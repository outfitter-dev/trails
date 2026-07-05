/**
 * Permit parity: one declaration, three enforcements.
 *
 * The same trail-level `relay:write` requirement must reject a viewer
 * token identically on the HTTP surface and the MCP surface, and accept an
 * admin token on both. Tokens are real HS256 JWTs resolved through the
 * shared `authResource` boundary — nothing is stubbed between the bearer
 * token and the permit check.
 */

import { describe, expect, test } from 'bun:test';

import { createMcpHarness } from '@ontrails/testing/mcp';

import { graph } from '../src/app.js';
import {
  authConfigValues,
  jwtSecret,
  resolveMcpPermit,
} from '../src/permits.js';
import { createMockOutboundClient } from '../src/resources/outbound-http.js';
import { relayStoreResource } from '../src/resources/relay-store.js';
import { createServerApp } from '../src/server.js';
import { mintToken } from '../src/tokens.js';

const secret = jwtSecret();
const adminToken = mintToken({ role: 'admin', secret });
const viewerToken = mintToken({ role: 'viewer', secret });

const mockResources = () => ({
  'junction.http': createMockOutboundClient(),
  'junction.store': relayStoreResource.mock?.(),
});

const postJson = (
  app: ReturnType<typeof createServerApp>,
  path: string,
  body: unknown,
  token?: string
) =>
  app.request(path, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    method: 'POST',
  });

describe('HTTP surface', () => {
  test('a viewer token cannot mutate', async () => {
    const app = createServerApp({ resources: mockResources() });
    const response = await postJson(
      app,
      '/api/endpoint/disable',
      { id: 'ep_disabled_demo' },
      viewerToken
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      error: { category: string; code: string };
    };
    expect(body.error.category).toBe('permission');
  });

  test('an admin token can mutate', async () => {
    const app = createServerApp({ resources: mockResources() });
    const response = await postJson(
      app,
      '/api/endpoint/disable',
      { id: 'ep_disabled_demo' },
      adminToken
    );
    expect(response.status).toBe(200);
  });

  test('a viewer token can read', async () => {
    const app = createServerApp({ resources: mockResources() });
    const response = await app.request('/api/event/list', {
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(response.status).toBe(200);
  });

  test('a missing token cannot mutate', async () => {
    const app = createServerApp({ resources: mockResources() });
    const response = await postJson(app, '/api/endpoint/disable', {
      id: 'ep_disabled_demo',
    });
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(response.status).toBeLessThanOrEqual(403);
  });

  test('a garbage token is rejected as auth failure', async () => {
    const app = createServerApp({ resources: mockResources() });
    const response = await postJson(
      app,
      '/api/endpoint/disable',
      { id: 'ep_disabled_demo' },
      'not-a-jwt'
    );
    expect(response.status).toBe(401);
  });
});

describe('MCP surface', () => {
  const harness = (token: string) =>
    createMcpHarness({
      configValues: authConfigValues(),
      extra: { authorization: `Bearer ${token}` },
      graph,
      resolvePermit: resolveMcpPermit,
      resources: mockResources(),
    });

  test('a viewer token cannot mutate', async () => {
    const result = await harness(viewerToken).callTool(
      'junction_endpoint_disable',
      { id: 'ep_disabled_demo' }
    );
    expect(result.isError).toBe(true);
  });

  test('an admin token can mutate', async () => {
    const result = await harness(adminToken).callTool(
      'junction_endpoint_disable',
      { id: 'ep_disabled_demo' }
    );
    expect(result.isError).toBe(false);
  });

  test('a viewer token can read', async () => {
    const result = await harness(viewerToken).callTool(
      'junction_event_list',
      {}
    );
    expect(result.isError).toBe(false);
  });
});
