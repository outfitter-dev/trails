/**
 * HTTP probe client resource.
 *
 * The client answers every request with a data-shaped {@link ProbeReply}
 * instead of throwing, so `probe.run` can classify transient failure classes
 * (timeout, connection reset, 502/503) for its detour contracts.
 *
 * The mock is scriptable per URL: tests queue a sequence of replies (fail,
 * fail, succeed) and each request consumes the next entry. An unscripted or
 * exhausted URL answers 200 so `testAll(app)` runs green offline.
 */

import { Result, resource } from '@ontrails/core';

export interface ProbeRequest {
  readonly method: 'GET' | 'HEAD';
  readonly timeoutMs: number;
  readonly url: string;
}

export type ProbeReply =
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly body: string;
    }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'connection-reset'; readonly message: string };

export interface WebhookPost {
  readonly body: Readonly<Record<string, unknown>>;
  readonly url: string;
}

export interface ProbeHttpClient {
  /** Deliver a JSON webhook payload. Used by the notify.dispatch webhook channel. */
  post(input: WebhookPost): Promise<ProbeReply>;
  request(input: ProbeRequest): Promise<ProbeReply>;
}

const BODY_PREVIEW_LIMIT = 4096;

const isTimeoutCause = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'TimeoutError' || error.name === 'AbortError');

const liveRequest = async (input: ProbeRequest): Promise<ProbeReply> => {
  try {
    const response = await fetch(input.url, {
      method: input.method,
      redirect: 'follow',
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const fullBody = input.method === 'HEAD' ? '' : await response.text();
    return {
      body: fullBody.slice(0, BODY_PREVIEW_LIMIT),
      kind: 'response',
      status: response.status,
    };
  } catch (error) {
    if (isTimeoutCause(error) || isTimeoutCause((error as Error).cause)) {
      return { kind: 'timeout' };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'connection-reset', message };
  }
};

const WEBHOOK_TIMEOUT_MS = 5000;

const livePost = async (input: WebhookPost): Promise<ProbeReply> => {
  try {
    const response = await fetch(input.url, {
      body: JSON.stringify(input.body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const fullBody = await response.text();
    return {
      body: fullBody.slice(0, BODY_PREVIEW_LIMIT),
      kind: 'response',
      status: response.status,
    };
  } catch (error) {
    if (isTimeoutCause(error) || isTimeoutCause((error as Error).cause)) {
      return { kind: 'timeout' };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'connection-reset', message };
  }
};

/**
 * Scriptable probe client. Each URL key holds a queue of replies consumed one
 * per request; unscripted or exhausted URLs answer `200 ok`.
 */
export const createScriptedProbeHttp = (
  script: Readonly<Record<string, readonly ProbeReply[]>> = {}
): ProbeHttpClient => {
  const queues = new Map<string, ProbeReply[]>(
    Object.entries(script).map(([url, replies]) => [url, [...replies]])
  );
  const nextReply = (url: string): ProbeReply => {
    const queue = queues.get(url);
    return queue?.shift() ?? { body: 'ok', kind: 'response', status: 200 };
  };
  return {
    post(input: WebhookPost): Promise<ProbeReply> {
      return Promise.resolve(nextReply(input.url));
    },
    request(input: ProbeRequest): Promise<ProbeReply> {
      return Promise.resolve(nextReply(input.url));
    },
  };
};

export const probeHttp = resource<ProbeHttpClient>('lookout.probe-http', {
  create: () => Result.ok({ post: livePost, request: liveRequest }),
  description:
    'Outbound HTTP client used by probe.run; the mock plays scripted per-URL reply sequences.',
  mock: () => createScriptedProbeHttp(),
});
