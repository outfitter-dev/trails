/**
 * The signal-driven search loop.
 *
 * Producers fire `snippet.created` / `snippet.updated`; the internal
 * `search.index` consumer re-derives that snippet's index rows. These tests
 * drive real trails through `run()` (which wires signal fan-out) and assert
 * the index state that `search.query` sees afterward.
 */

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';

import { graph } from '../src/app.js';
import { seedSearchEntries } from '../src/fixtures.js';
import { createMockDb, db } from '../src/resources/db.js';

const options = (
  conn: ReturnType<typeof createMockDb>,
  subject = 'usr_alice',
  scopes: readonly string[] = [
    'snippet:write',
    'snippet:interact',
    'search:admin',
  ]
) => ({
  ctx: {
    extensions: { [db.id]: conn },
    permit: { id: subject, scopes: [...scopes] },
  },
});

const queryTotal = async (
  conn: ReturnType<typeof createMockDb>,
  query: string
): Promise<number> => {
  const found = await run(graph, 'search.query', { query }, options(conn));
  if (found.isErr()) {
    throw found.error;
  }
  const { total } = found.value as { total: number };
  return total;
};

describe('signal-driven indexing', () => {
  test('snippet.create fires snippet.created and the consumer indexes it', async () => {
    const conn = createMockDb();
    expect(await queryTotal(conn, 'xylophone')).toBe(0);

    const created = await run(
      graph,
      'snippet.create',
      {
        description: 'A xylophone tuning table',
        files: [{ content: 'c4 d4 e4\n', name: 'notes.txt' }],
        visibility: 'public',
      },
      options(conn)
    );
    expect(created.isOk()).toBe(true);

    expect(await queryTotal(conn, 'xylophone')).toBe(1);
  });

  test('snippet.update reindexes; snippet.delete deindexes', async () => {
    const conn = createMockDb();

    const updated = await run(
      graph,
      'snippet.update',
      {
        files: [{ content: 'quokka census data\n', name: 'greet.ts' }],
        id: 'snip_hello',
        message: 'now about quokkas',
      },
      options(conn)
    );
    expect(updated.isOk()).toBe(true);
    expect(await queryTotal(conn, 'quokka')).toBe(1);

    const deleted = await run(
      graph,
      'snippet.delete',
      { id: 'snip_hello' },
      options(conn)
    );
    expect(deleted.isOk()).toBe(true);
    expect(await queryTotal(conn, 'quokka')).toBe(0);
    expect(await queryTotal(conn, 'greet')).toBe(0);
  });

  test('secret snippets are never indexed', async () => {
    const conn = createMockDb();
    const created = await run(
      graph,
      'snippet.create',
      {
        description: 'a very wombat secret',
        files: [{ content: 'wombat\n', name: 'w.txt' }],
        visibility: 'secret',
      },
      options(conn)
    );
    expect(created.isOk()).toBe(true);
    // Not even the owner finds it through search — the index is public-only.
    expect(await queryTotal(conn, 'wombat')).toBe(0);
  });

  test('seeded index rows match a from-scratch reindex', async () => {
    const conn = createMockDb();
    const rebuilt = await run(graph, 'search.reindex', {}, options(conn));
    expect(rebuilt.isOk()).toBe(true);

    const rows = await conn.searchEntries.list();
    const rebuiltSet = new Set(
      rows.map((row) => `${row.snippetId}::${row.term}`)
    );
    const seededSet = new Set(
      seedSearchEntries.map((row) => `${row.snippetId}::${row.term}`)
    );
    expect(rebuiltSet).toEqual(seededSet);
  });
});
