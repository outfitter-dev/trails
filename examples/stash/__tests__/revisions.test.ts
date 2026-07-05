/**
 * Revision immutability by construction.
 *
 * `snippet.update` inserts a new revision and never mutates an existing one.
 * These tests drive updates through the real topo and then assert — both
 * through the read trails and directly against the store — that earlier
 * revisions are byte-identical to what was first written.
 */

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';

import { seedRevisions } from '../src/fixtures.js';
import { createMockDb, db } from '../src/resources/db.js';
import { graph } from '../src/app.js';

const alicePermit = {
  id: 'usr_alice',
  scopes: ['snippet:write'],
} as const;

const options = (conn: ReturnType<typeof createMockDb>) => ({
  ctx: {
    extensions: { [db.id]: conn },
    permit: alicePermit,
  },
});

const updateInput = (marker: string) => ({
  files: [
    {
      content: `export const greet = (): string => 'rev ${marker}';\n`,
      language: 'typescript',
      name: 'greet.ts',
    },
  ],
  id: 'snip_hello',
  message: `revision ${marker}`,
});

const originalContent = seedRevisions[0]?.files[0]?.content ?? '';

describe('revision immutability', () => {
  test('updates create new revisions and never mutate earlier ones', async () => {
    const conn = createMockDb();

    const first = await run(
      graph,
      'snippet.update',
      updateInput('two'),
      options(conn)
    );
    expect(first.isOk()).toBe(true);
    expect(first.isOk() && first.value).toMatchObject({ seq: 2 });

    const second = await run(
      graph,
      'snippet.update',
      updateInput('three'),
      options(conn)
    );
    expect(second.isOk()).toBe(true);
    expect(second.isOk() && second.value).toMatchObject({ seq: 3 });

    // Revision 1 read back through the trail is byte-identical to the seed.
    const rev1 = await run(
      graph,
      'revision.get',
      { seq: 1, snippetId: 'snip_hello' },
      options(conn)
    );
    expect(rev1.isOk()).toBe(true);
    expect(rev1.isOk() && rev1.value).toMatchObject({
      files: [
        {
          content: originalContent,
          encoding: 'utf8',
          language: 'typescript',
          name: 'greet.ts',
        },
      ],
      message: 'initial revision',
      seq: 1,
    });

    // Revision 2 survives revision 3 unchanged.
    const rev2 = await run(
      graph,
      'revision.get',
      { seq: 2, snippetId: 'snip_hello' },
      options(conn)
    );
    expect(rev2.isOk()).toBe(true);
    expect(rev2.isOk() && rev2.value).toMatchObject({
      message: 'revision two',
      seq: 2,
    });

    // History is contiguous and seq-ordered.
    const listed = await run(
      graph,
      'revision.list',
      { snippetId: 'snip_hello' },
      options(conn)
    );
    expect(listed.isOk()).toBe(true);
    expect(listed.isOk() && listed.value).toMatchObject({ total: 3 });

    // Straight-to-store proof: the seeded revision row is untouched.
    const stored = await conn.revisions.get('rev_hello_1');
    const seeded = seedRevisions.find((row) => row.id === 'rev_hello_1');
    expect(stored).toEqual(seeded ?? null);
  });

  test('the store path for updates is insert-only in app code', async () => {
    const conn = createMockDb();
    const before = await conn.revisions.list({ snippetId: 'snip_hello' });
    expect(before).toHaveLength(1);

    const updated = await run(
      graph,
      'snippet.update',
      updateInput('two'),
      options(conn)
    );
    expect(updated.isOk()).toBe(true);

    const after = await conn.revisions.list({ snippetId: 'snip_hello' });
    expect(after).toHaveLength(2);
    const kept = after.find((row) => row.id === 'rev_hello_1');
    expect(kept?.files).toEqual(before[0]?.files ?? []);
  });
});
