# MCP Over HTTP

`@ontrails/mcp/fetch` builds a Web-standard MCP HTTP entry from the same tools and resources as stdio. It serves modern requests and legacy stateless requests through the official SDK. The entry returns `fetch(request): Promise<Response>` and `close()` for shutdown. Import this subpath in portable runtimes; the root `@ontrails/mcp` entry also exposes stdio.

## Bun

```typescript
import { createFetchHandler } from '@ontrails/mcp/fetch';
import { graph } from './app';

const mcp = createFetchHandler(graph);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 3000,
  fetch: mcp.fetch,
});

// At shutdown:
await mcp.close();
server.stop();
```

`close()` stops accepting MCP requests, aborts active server instances and closes their response streams in both eras. Trail implementations must honor their abort signal to stop their own asynchronous work. Clients control their request deadlines and cancellation; a legacy SDK client can retain a pending call after EOF until it cancels or reaches that deadline.

## Hono

Attach the same function at an explicit route. Hono owns routing; the MCP entry owns protocol handling.

```typescript
import { Hono } from 'hono';
import { createFetchHandler } from '@ontrails/mcp/fetch';
import { graph } from './app';

const mcp = createFetchHandler(graph);
const app = new Hono();
app.all('/mcp', (context) => mcp.fetch(context.req.raw));

export default app;
```

The SDK preserves request-scoped SSE responses for progress and other related messages. This is distinct from an independent GET event stream or session replay. The legacy lane is stateless: it does not restore the retired session-based HTTP+SSE protocol or support interactive exchanges requiring a persistent server-to-client channel.

## Host And Origin Protection

The boundary runs before SDK dispatch, body parsing and permit resolution. It protects the network/browser boundary; it grants no identity and configures no CORS response headers.

| Option | Meaning | Default |
| --- | --- | --- |
| `allowedHosts` | Exact request URL hostnames, without ports | `localhost`, `127.0.0.1`, `[::1]` |
| `allowedOrigins` | Exact serialized HTTP(S) origins, including scheme and effective port | `[]` |

Configured hosts replace the defaults; an empty host list denies every request. Wildcards, suffix rules and unspecified bind addresses such as `0.0.0.0` or `::` are not request hostnames. Configuration is validated once, and invalid entries fail construction.

The fetch runtime's `request.url` is authoritative and must use HTTP or HTTPS. A missing Host header is valid. A present Host must be a valid authority matching the request URL's hostname and effective port. Conflicting authorities fail even if one is allowlisted. IPv6 and default ports use URL-aware normalization. Trusted reverse proxies must reconstruct the Request at their own boundary; this entry never infers trust from forwarded headers.

An absent Origin is valid. A present empty, opaque, malformed or unlisted Origin returns 403. Same-origin browser callers must explicitly list the endpoint origin; allowing a public hostname does not allow browser origins automatically. Origins compare scheme, hostname and effective port, so a different port or scheme is distinct. Credentials, paths, query strings, fragments and multiple origins are rejected rather than normalized into permission. The initial profile accepts HTTP(S) origins only.

```typescript
const mcp = createFetchHandler(graph, {
  allowedHosts: ['api.example.com'],
  allowedOrigins: ['https://console.example.com'],
  resolvePermit,
});
```

No-Origin clients still pass through ordinary permit resolution. Host and Origin checks do not replace authentication, authorization or a deployment's separate CORS policy.

## Request Credentials And Current Gates

The fresh HTTP server instance receives the actual request's raw Authorization value. Tools and resource list/read operations use the existing shared permit resolver with that value, a best-effort bearer token, and SDK-normalized application `_meta`. Metadata is untrusted context and is never promoted into a header. The entry does not label an unverified token as SDK `authInfo` or cache a protocol-session permit.

The [resource read policy](mcp.md#resource-read-policy) applies without a second verification path. A selected credential failure remains terminal; trusted local-host permit configuration is available only after credential absence.

This entry's HTTP challenge integration is still gated on the shared auth surface interface. RFC 9728 metadata, effective-permission decisions and `WWW-Authenticate` formatting remain owned by the auth packages; this entry does not introduce an independent OAuth implementation. SDK HTTP and local Bun/Hono controls do not establish live Claude Code or ChatGPT interoperability. Those clients' required protocol-era checks remain explicit acceptance work before the full HTTP-host issue can close.
