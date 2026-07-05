/**
 * HTTP app builder.
 *
 * `createApp` projects every public trail as a route, and `file.raw`'s
 * `blobRefSchema` output is streamed as real bytes with its `mimeType` as
 * the Content-Type — the framework derives byte serving from the trail
 * contract, so the app mounts nothing by hand.
 */

import { AuthError, Result } from '@ontrails/core';
import { createApp } from '@ontrails/hono';
import type { Hono } from 'hono';

import { graph } from './app.js';
import { createStashAuthAdapter } from './resources/auth.js';
import type { StashConnection } from './resources/db.js';
import { db } from './resources/db.js';

export interface StashServer {
  readonly app: Hono;
  readonly conn: StashConnection;
}

/** Open the runtime store connection declared by the db resource. */
export const openStashDb = async (): Promise<StashConnection> => {
  const created = await db.create({
    config: undefined,
    cwd: process.cwd(),
    env: process.env,
    workspaceRoot: process.cwd(),
  });
  if (created.isErr()) {
    throw created.error;
  }
  return created.value;
};

/**
 * Build the stash Hono app over an existing connection.
 *
 * Exported separately from the listening entry so tests can drive it with
 * `app.request()` and a seeded mock connection.
 */
export const createStashApp = (conn: StashConnection): Hono => {
  const adapter = createStashAuthAdapter(conn);
  const resolvePermit = async (input: {
    readonly bearerToken?: string | undefined;
    readonly requestId?: string | undefined;
  }) => {
    const authed = await adapter.authenticate({
      ...(input.bearerToken === undefined
        ? {}
        : { bearerToken: input.bearerToken }),
      requestId: input.requestId ?? 'stash-http',
      surface: 'http',
    });
    if (authed.isErr()) {
      return Result.err(new AuthError(authed.error.message));
    }
    return Result.ok(authed.value);
  };

  return createApp(graph, {
    name: 'stash',
    resolvePermit,
    resources: { [db.id]: conn, auth: adapter },
  });
};

/** Build the full runtime server: real connection + app. */
export const createStashServer = async (): Promise<StashServer> => {
  const conn = await openStashDb();
  return { app: createStashApp(conn), conn };
};
