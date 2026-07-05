/**
 * Fork lineage and fork visibility rules.
 */

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';

import { graph } from '../src/app.js';
import { createMockDb, db } from '../src/resources/db.js';

const options = (
  conn: ReturnType<typeof createMockDb>,
  subject: 'usr_alice' | 'usr_bob'
) => ({
  ctx: {
    extensions: { [db.id]: conn },
    permit: { id: subject, scopes: ['snippet:write', 'snippet:interact'] },
  },
});

describe('snippet.fork', () => {
  test('fork copies the latest revision and records lineage', async () => {
    const conn = createMockDb();
    const forked = await run(
      graph,
      'snippet.fork',
      { id: 'snip_hello' },
      options(conn, 'usr_bob')
    );
    expect(forked.isOk()).toBe(true);
    expect(forked.isOk() && forked.value).toMatchObject({
      description: 'Greet the trail crew from TypeScript',
      forkOf: 'snip_hello',
      ownerId: 'usr_bob',
      starCount: 0,
      visibility: 'public',
    });

    // The source snippet is untouched.
    const source = await run(
      graph,
      'snippet.get',
      { id: 'snip_hello' },
      options(conn, 'usr_bob')
    );
    expect(source.isOk() && source.value).toMatchObject({
      forkOf: null,
      ownerId: 'usr_alice',
    });
  });

  test('another user’s secret snippet is unforkable and reads as missing', async () => {
    const conn = createMockDb();
    const forked = await run(
      graph,
      'snippet.fork',
      { id: 'snip_secret' },
      options(conn, 'usr_bob')
    );
    expect(forked.isErr()).toBe(true);
    expect(forked.isErr() && forked.error.name).toBe('NotFoundError');
    expect(forked.isErr() && forked.error.message).toBe(
      'Snippet "snip_secret" not found'
    );
  });

  test('owners can fork their own secret snippets, staying secret', async () => {
    const conn = createMockDb();
    const forked = await run(
      graph,
      'snippet.fork',
      { id: 'snip_secret' },
      options(conn, 'usr_alice')
    );
    expect(forked.isOk()).toBe(true);
    expect(forked.isOk() && forked.value).toMatchObject({
      forkOf: 'snip_secret',
      ownerId: 'usr_alice',
      visibility: 'secret',
    });
  });
});
