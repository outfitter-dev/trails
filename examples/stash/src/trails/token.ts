/**
 * Token self-service trails.
 *
 * `token.create` returns the secret exactly once; `token.list` never includes
 * it. Other users' token ids read as not-found — token existence is private,
 * the same non-leak posture as secret snippets.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';
import { requireSubject } from './shared.js';

const redactedTokenSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  name: z.string(),
  revoked: z.boolean(),
  scopes: z.array(z.string()),
});

const tokenNotFound = (id: string): NotFoundError =>
  new NotFoundError(`Token "${id}" not found`);

// ---------------------------------------------------------------------------
// token.create
// ---------------------------------------------------------------------------

export const create = trail('token.create', {
  description:
    'Create an API token; the secret is returned once and never again',
  examples: [
    {
      description: 'Mint a read-write token',
      input: {
        name: 'ci-publisher',
        scopes: ['snippet:write', 'snippet:interact'],
      },
      name: 'Create a token',
    },
  ],
  implementation: async (input, ctx) => {
    const subject = requireSubject(ctx);
    if (subject.isErr()) {
      return subject;
    }
    const conn = db.from(ctx);
    const token = await conn.tokens.insert({
      name: input.name,
      revoked: false,
      scopes: input.scopes,
      secret: `stash_tok_${crypto.randomUUID()}`,
      userId: subject.value,
    });
    return Result.ok({
      createdAt: token.createdAt,
      id: token.id,
      name: token.name,
      revoked: token.revoked,
      scopes: [...token.scopes],
      secret: token.secret,
    });
  },
  input: z.object({
    name: z.string().min(1).describe('Label for this token'),
    scopes: z
      .array(z.string())
      .min(1)
      .describe(
        'Scopes to grant: snippet:write, snippet:interact, token:manage, search:admin'
      ),
  }),
  intent: 'write',
  output: redactedTokenSchema.extend({
    secret: z.string(),
  }),
  permit: { scopes: ['token:manage'] },
  resources: [db],
});

// ---------------------------------------------------------------------------
// token.list
// ---------------------------------------------------------------------------

export const list = trail('token.list', {
  description: 'List your tokens with secrets redacted',
  examples: [
    {
      description: 'List tokens for the calling user',
      expected: {
        tokens: [
          {
            createdAt: '2026-01-01T00:00:00.000Z',
            id: 'tok_alice',
            name: 'alice-dev',
            revoked: false,
            scopes: [
              'snippet:write',
              'snippet:interact',
              'token:manage',
              'search:admin',
            ],
          },
          {
            createdAt: '2026-01-01T00:00:00.000Z',
            id: 'tok_alice_spare',
            name: 'alice-spare',
            revoked: false,
            scopes: ['snippet:write'],
          },
        ],
        total: 2,
      },
      input: {},
      name: 'List tokens',
    },
  ],
  implementation: async (_input, ctx) => {
    const subject = requireSubject(ctx);
    if (subject.isErr()) {
      return subject;
    }
    const conn = db.from(ctx);
    const rows = await conn.tokens.list({ userId: subject.value });
    const tokens = rows
      .toSorted((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({
        createdAt: row.createdAt,
        id: row.id,
        name: row.name,
        revoked: row.revoked,
        scopes: [...row.scopes],
      }));
    return Result.ok({ tokens, total: tokens.length });
  },
  input: z.object({}),
  intent: 'read',
  output: z.object({
    tokens: z.array(redactedTokenSchema),
    total: z.number().int(),
  }),
  permit: { scopes: ['token:manage'] },
  resources: [db],
});

// ---------------------------------------------------------------------------
// token.revoke
// ---------------------------------------------------------------------------

export const revoke = trail('token.revoke', {
  description: 'Revoke one of your tokens; revoked tokens stop authenticating',
  examples: [
    {
      description: 'Revoke a spare token',
      expected: { id: 'tok_alice_spare', revoked: true },
      input: { id: 'tok_alice_spare' },
      name: 'Revoke a token',
    },
    {
      description:
        'Unknown ids — and other users’ tokens — return NotFoundError',
      error: 'NotFoundError',
      input: { id: 'tok_missing' },
      name: 'Revoke a missing token',
    },
  ],
  implementation: async (input, ctx) => {
    const subject = requireSubject(ctx);
    if (subject.isErr()) {
      return subject;
    }
    const conn = db.from(ctx);
    const token = await conn.tokens.get(input.id);
    if (token === null || token.userId !== subject.value) {
      return Result.err(tokenNotFound(input.id));
    }
    await conn.tokens.update(input.id, { revoked: true });
    return Result.ok({ id: input.id, revoked: true });
  },
  input: z.object({
    id: z.string().describe('Token id to revoke'),
  }),
  intent: 'write',
  output: z.object({
    id: z.string(),
    revoked: z.boolean(),
  }),
  permit: { scopes: ['token:manage'] },
  resources: [db],
});
