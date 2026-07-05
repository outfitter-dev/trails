/**
 * user.me — whoami for a token.
 *
 * The empty-scope permit requirement means "any authenticated permit": the
 * pipeline rejects anonymous callers before the blaze runs, and any valid
 * token qualifies regardless of scopes.
 */

import { AuthError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';
import { requireSubject } from './shared.js';

export const me = trail('user.me', {
  blaze: async (_input, ctx) => {
    const subject = requireSubject(ctx);
    if (subject.isErr()) {
      return subject;
    }
    const conn = db.from(ctx);
    const user = await conn.users.get(subject.value);
    if (user === null) {
      return Result.err(
        new AuthError(`Permit subject "${subject.value}" has no user record`)
      );
    }
    return Result.ok({
      id: user.id,
      name: user.name,
      scopes: [...(ctx.permit?.scopes ?? [])],
    });
  },
  description: 'Show the user and scopes behind the calling token',
  examples: [
    {
      description: 'Identify the calling token',
      expected: {
        id: 'usr_alice',
        name: 'alice',
        scopes: [
          'snippet:write',
          'snippet:interact',
          'token:manage',
          'search:admin',
        ],
      },
      input: {},
      name: 'Who am I',
    },
  ],
  input: z.object({}),
  intent: 'read',
  output: z.object({
    id: z.string(),
    name: z.string(),
    scopes: z.array(z.string()),
  }),
  permit: { scopes: [] },
  resources: [db],
});
