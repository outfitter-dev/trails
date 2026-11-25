/**
 * MCP-over-HTTP smoke: serve the demo app's MCP surface through the
 * fetch-shaped handler and drive it with the official SDK client on both
 * protocol eras, then probe the Host and Origin boundary with raw requests.
 *
 * Regressions in the HTTP rendering of the MCP surface (header rules, the
 * boundary guard, the network credential posture) show up here before a
 * release, without a listening server or a Cloudflare account.
 */

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AuthError, Result } from '@ontrails/core';
import type { BasePermit, ResourceOverrideMap, Topo } from '@ontrails/core';
import { createFetchHandler } from '@ontrails/mcp/fetch';

const repoRoot = resolve(process.cwd());
const demoAppPath = join(repoRoot, 'apps/trails-demo/src/app.ts');

export interface McpHttpSmokeResult {
  readonly check: 'mcp-http';
  readonly eras: number;
  readonly message: string;
  readonly passed: true;
  readonly toolCount: number;
}

const SMOKE_BEARER = 'smoke-writer';
const SMOKE_PERMIT: BasePermit = {
  actors: [],
  id: 'smoke-writer',
  scopes: ['entity:write'],
};

const isTopo = (value: unknown): value is Topo =>
  typeof value === 'object' &&
  value !== null &&
  'list' in value &&
  typeof value.list === 'function';

const loadDemoGraph = async (): Promise<Topo> => {
  const module: unknown = await import(pathToFileURL(demoAppPath).href);
  const graph =
    typeof module === 'object' && module !== null && 'graph' in module
      ? module.graph
      : undefined;
  if (!isTopo(graph)) {
    throw new Error(`MCP HTTP smoke: ${demoAppPath} did not export a topo`);
  }
  return graph;
};

interface MockedResources {
  readonly dispose: () => Promise<void>;
  readonly overrides: ResourceOverrideMap;
}

/**
 * Every demo resource runs on its own mock so the smoke never needs
 * infrastructure. Overrides bypass the pipeline's lifecycle, so the smoke
 * owns disposal (the entity store mock opens a SQLite connection).
 */
const mockResources = async (graph: Topo): Promise<MockedResources> => {
  const overrides: Record<string, unknown> = {};
  const disposers: (() => Promise<void>)[] = [];
  for (const definition of graph.listResources()) {
    if (definition.mock === undefined) {
      throw new Error(
        `MCP HTTP smoke: demo resource "${definition.id}" has no mock`
      );
    }
    const instance = await definition.mock();
    overrides[definition.id] = instance;
    const { dispose } = definition;
    if (dispose !== undefined) {
      disposers.push(async () => {
        await dispose(instance);
      });
    }
  }
  return {
    dispose: async () => {
      await Promise.all(disposers.map((run) => run()));
    },
    overrides,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const namesIn = (value: unknown): readonly string[] =>
  isRecord(value) && Array.isArray(value['results'])
    ? value['results'].flatMap((entry: unknown) =>
        isRecord(entry) && typeof entry['name'] === 'string'
          ? [entry['name']]
          : []
      )
    : [];

const expectStatus = (
  label: string,
  response: Response,
  status: number
): void => {
  if (response.status !== status) {
    throw new Error(
      `MCP HTTP smoke: ${label} answered ${response.status}, expected ${status}`
    );
  }
};

interface EraReport {
  readonly era: string;
  readonly toolCount: number;
}

const driveEra = async (
  fetchHandler: (request: Request) => Promise<Response>,
  mode: 'legacy' | { readonly pin: '2026-07-28' },
  suffix: string
): Promise<EraReport> => {
  const { Client, StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/client');
  const era = typeof mode === 'object' ? 'modern' : 'legacy';
  let authorization: string | undefined;
  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost/mcp'),
    {
      fetch: (input, init) => {
        const request = new Request(input, init);
        if (authorization !== undefined) {
          request.headers.set('authorization', authorization);
        }
        return fetchHandler(request);
      },
    }
  );
  const client = new Client(
    { name: `mcp-http-smoke-${era}`, version: '1' },
    { versionNegotiation: { mode } }
  );
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    if (!names.includes('demo_search') || !names.includes('demo_entity_add')) {
      throw new Error(
        `MCP HTTP smoke (${era}): tools/list did not expose the demo trails: ${names.join(', ')}`
      );
    }
    const searched = await client.callTool({
      arguments: { limit: 10, query: 'Alpha' },
      name: 'demo_search',
    });
    if (searched.isError === true) {
      throw new TypeError(
        `MCP HTTP smoke (${era}): demo_search answered isError`
      );
    }
    // The demo mock seeds an entity named Alpha; an empty hit list means the
    // search path is broken even though the call succeeded.
    if (!namesIn(searched.structuredContent).includes('Alpha')) {
      throw new Error(
        `MCP HTTP smoke (${era}): demo_search did not return the seeded Alpha entity: ${JSON.stringify(searched.structuredContent)}`
      );
    }
    const resource = await client.readResource({ uri: 'trails://surface-map' });
    if (resource.contents.length !== 1) {
      throw new Error(
        `MCP HTTP smoke (${era}): resources/read returned ${resource.contents.length} contents`
      );
    }
    const anonymousWrite = await client.callTool({
      arguments: {
        name: `Smoke ${suffix}`,
        tags: [],
        type: 'smoke',
      },
      name: 'demo_entity_add',
    });
    if (anonymousWrite.isError !== true) {
      throw new TypeError(
        `MCP HTTP smoke (${era}): an anonymous caller ran a protected trail`
      );
    }
    authorization = `Bearer ${SMOKE_BEARER}`;
    const verifiedWrite = await client.callTool({
      arguments: {
        name: `Smoke ${suffix}`,
        tags: [],
        type: 'smoke',
      },
      name: 'demo_entity_add',
    });
    if (verifiedWrite.isError === true) {
      throw new TypeError(
        `MCP HTTP smoke (${era}): a verified caller was refused on a protected trail: ${JSON.stringify(verifiedWrite.content)}`
      );
    }
    return { era, toolCount: names.length };
  } finally {
    await client.close();
  }
};

const probeBoundary = async (
  fetchHandler: (request: Request) => Promise<Response>
): Promise<void> => {
  const body = JSON.stringify({
    id: 1,
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
  });
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
  expectStatus(
    'a request with a non-loopback Host',
    await fetchHandler(
      new Request('http://localhost/mcp', {
        body,
        headers: { ...headers, host: 'attacker.example' },
        method: 'POST',
      })
    ),
    403
  );
  expectStatus(
    'a request with a disallowed Origin',
    await fetchHandler(
      new Request('http://localhost/mcp', {
        body,
        headers: { ...headers, origin: 'https://attacker.example' },
        method: 'POST',
      })
    ),
    403
  );
  expectStatus(
    'a request to a non-loopback URL',
    await fetchHandler(
      new Request('http://attacker.example/mcp', {
        body,
        headers,
        method: 'POST',
      })
    ),
    403
  );
};

/**
 * Run the MCP-over-HTTP smoke against the demo app.
 *
 * @example
 * ```ts
 * import { runMcpHttpSmoke } from '../release/mcp-http-smoke.js';
 *
 * const result = await runMcpHttpSmoke();
 * // result.passed === true
 * ```
 */
export const runMcpHttpSmoke = async (): Promise<McpHttpSmokeResult> => {
  const graph = await loadDemoGraph();
  const mocked = await mockResources(graph);
  const handler = createFetchHandler(graph, {
    resolvePermit: ({ bearerToken }) => {
      if (bearerToken === undefined) {
        return Result.ok(null);
      }
      return bearerToken === SMOKE_BEARER
        ? Result.ok(SMOKE_PERMIT)
        : Result.err(new AuthError('MCP HTTP smoke rejected the credential'));
    },
    resources: mocked.overrides,
  });
  try {
    const legacy = await driveEra(handler.fetch, 'legacy', 'legacy');
    const modern = await driveEra(
      handler.fetch,
      { pin: '2026-07-28' },
      'modern'
    );
    await probeBoundary(handler.fetch);
    const toolCount = Math.min(legacy.toolCount, modern.toolCount);
    return {
      check: 'mcp-http',
      eras: 2,
      message: `MCP over HTTP smoke passed: ${toolCount} demo tools served on both eras, Host and Origin boundary refused.`,
      passed: true,
      toolCount,
    };
  } finally {
    await handler.close();
    await mocked.dispose();
  }
};

/** Exposed for the release surface: the smoke's own shape check. */
export const isMcpHttpSmokeResult = (
  value: unknown
): value is McpHttpSmokeResult =>
  isRecord(value) &&
  value['check'] === 'mcp-http' &&
  value['passed'] === true &&
  typeof value['eras'] === 'number' &&
  typeof value['toolCount'] === 'number' &&
  typeof value['message'] === 'string';
