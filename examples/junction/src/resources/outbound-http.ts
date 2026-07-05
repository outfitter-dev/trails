/**
 * Outbound HTTP client resource for webhook deliveries.
 *
 * The runtime client wraps `fetch` and converts transport failures and
 * non-2xx responses into `NetworkError` results, so delivery trails stay on
 * the Result boundary. The mock client never touches the network: it records
 * every call for assertions and simulates failures by URL suffix —
 * `/unreachable` always fails, `/flaky` fails once per URL then succeeds —
 * which keeps `testAll(graph)` and the retry-detour tests fully offline.
 */

import { NetworkError, Result, resource } from '@ontrails/core';

export interface OutboundResponse {
  readonly status: number;
}

export interface OutboundCall {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly url: string;
}

export interface OutboundHttpClient {
  readonly calls: readonly OutboundCall[];
  post(
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>
  ): Promise<Result<OutboundResponse, NetworkError>>;
}

const createFetchClient = (): OutboundHttpClient => {
  const calls: OutboundCall[] = [];
  return {
    calls,
    async post(url, body, headers) {
      calls.push({ body, headers, url });
      try {
        const response = await fetch(url, {
          body,
          headers: { 'content-type': 'application/json', ...headers },
          method: 'POST',
        });
        if (!response.ok) {
          return Result.err(
            new NetworkError(
              `Target responded ${response.status} for POST ${url}`,
              { context: { status: response.status, url } }
            )
          );
        }
        return Result.ok({ status: response.status });
      } catch (error) {
        return Result.err(
          new NetworkError(`POST ${url} failed`, {
            ...(error instanceof Error ? { cause: error } : {}),
            context: { url },
          })
        );
      }
    },
  };
};

export const createMockOutboundClient = (): OutboundHttpClient => {
  const calls: OutboundCall[] = [];
  const flakyFailures = new Set<string>();
  return {
    calls,
    post(url, body, headers) {
      calls.push({ body, headers, url });
      if (url.endsWith('/unreachable')) {
        return Promise.resolve(
          Result.err(
            new NetworkError(`POST ${url} failed`, { context: { url } })
          )
        );
      }
      if (url.endsWith('/flaky') && !flakyFailures.has(url)) {
        flakyFailures.add(url);
        return Promise.resolve(
          Result.err(
            new NetworkError(`POST ${url} failed`, { context: { url } })
          )
        );
      }
      return Promise.resolve(Result.ok({ status: 200 }));
    },
  };
};

export const outboundHttpResource = resource<OutboundHttpClient>(
  'junction.http',
  {
    create: () => Result.ok(createFetchClient()),
    description:
      'Outbound fetch client junction uses to POST deliveries to targets.',
    mock: createMockOutboundClient,
  }
);
