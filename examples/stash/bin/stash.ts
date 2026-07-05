#!/usr/bin/env bun

/**
 * CLI entry point for stash.
 *
 * Usage:
 *   bun run bin/stash.ts snippet list
 *   bun run bin/stash.ts snippet get --id snip_hello
 *   bun run bin/stash.ts search query --query greet
 *   bun run bin/stash.ts snippet star --id snip_hello --token stash_bob_dev_token
 *
 * Set STASH_DB_PATH to persist snippets between invocations; the default is
 * a freshly seeded in-memory database per run.
 */

import { outputModePreset, tokenPreset } from '@ontrails/cli';
import { surface } from '@ontrails/commander';
import { AuthError, Result } from '@ontrails/core';

import { graph } from '../src/app.js';
import { createStashAuthAdapter } from '../src/resources/auth.js';
import { db } from '../src/resources/db.js';
import { openStashDb } from '../src/server.js';

const conn = await openStashDb();
const adapter = createStashAuthAdapter(conn);

// oxlint-disable-next-line require-hook -- CLI entry point, not a test file
await surface(graph, {
  description: 'Self-hosted gists: snippets with immutable revision history',
  name: 'stash',
  presets: [outputModePreset(), tokenPreset()],
  resolvePermitFromToken: async ({ requestId, token }) => {
    const authed = await adapter.authenticate({
      bearerToken: token,
      requestId,
      surface: 'cli',
    });
    if (authed.isErr()) {
      return Result.err(new AuthError(authed.error.message));
    }
    return authed.value === null
      ? Result.err(new AuthError('Unknown or revoked token'))
      : Result.ok(authed.value);
  },
  resources: { [db.id]: conn, auth: adapter },
  version: '0.1.0',
});
