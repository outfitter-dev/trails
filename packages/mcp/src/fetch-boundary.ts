import { ValidationError } from '@ontrails/core';

/** Network/browser boundary configuration, independent of permit policy. */
export interface McpFetchBoundaryOptions {
  readonly allowedHosts?: readonly string[] | undefined;
  readonly allowedOrigins?: readonly string[] | undefined;
}

const invalidAuthority = /[\s/\\?#@,%*]/;

const parseAuthority = (
  authority: string,
  protocol: string
): URL | undefined => {
  if (
    authority.length === 0 ||
    invalidAuthority.test(authority) ||
    authority.endsWith(':')
  ) {
    return undefined;
  }
  try {
    return new URL(`${protocol}//${authority}`);
  } catch {
    return undefined;
  }
};

const parseOrigin = (value: string): URL | undefined => {
  const match = /^https?:\/\/([^/?#]+)$/i.exec(value);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return parseAuthority(
    match[1],
    value.slice(0, value.indexOf(':') + 1).toLowerCase()
  );
};

const effectivePort = (url: URL): string =>
  url.port || (url.protocol === 'https:' ? '443' : '80');

/** Validate configuration once and guard each request before SDK dispatch. */
export const createMcpFetchBoundary = (
  options: McpFetchBoundaryOptions
): ((request: Request) => Response | undefined) => {
  const hosts = new Set(
    (options.allowedHosts ?? ['localhost', '127.0.0.1', '[::1]']).map(
      (value) => {
        const url = parseAuthority(value, 'http:');
        const hasPort = value.startsWith('[')
          ? !value.endsWith(']')
          : value.includes(':');
        if (
          url === undefined ||
          hasPort ||
          url.hostname === '0.0.0.0' ||
          url.hostname === '[::]'
        ) {
          throw new ValidationError(`Invalid MCP allowed hostname: ${value}`);
        }
        return url.hostname;
      }
    )
  );
  const origins = new Set(
    (options.allowedOrigins ?? []).map((value) => {
      const url = parseOrigin(value);
      if (url === undefined) {
        throw new ValidationError(`Invalid MCP allowed origin: ${value}`);
      }
      return url.origin;
    })
  );

  return (request) => {
    const url = new URL(request.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !hosts.has(url.hostname)
    ) {
      return new Response('Forbidden', { status: 403 });
    }
    const host = request.headers.get('host');
    if (host !== null) {
      const authority = parseAuthority(host, url.protocol);
      if (
        authority === undefined ||
        authority.hostname !== url.hostname ||
        effectivePort(authority) !== effectivePort(url)
      ) {
        return new Response('Forbidden', { status: 403 });
      }
    }
    const origin = request.headers.get('origin');
    const parsed = origin === null ? undefined : parseOrigin(origin);
    return origin !== null &&
      (parsed === undefined || !origins.has(parsed.origin))
      ? new Response('Forbidden', { status: 403 })
      : undefined;
  };
};
