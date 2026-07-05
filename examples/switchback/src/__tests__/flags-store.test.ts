/**
 * File-backed store behavior plus the fixture/JSON sync guarantee: the
 * committed switchback.flags.json must stay identical to src/fixtures.ts
 * (regenerate with `bun run scripts/generate-flags-file.ts`).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureFlags } from '../fixtures.js';
import { flagSchema } from '../model.js';
import { createFileFlagStore } from '../resources/flags.js';

const tempDirs: string[] = [];
const tempStorePath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'switchback-flags-'));
  tempDirs.push(dir);
  return join(dir, 'switchback.flags.json');
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('committed flag definitions', () => {
  test('switchback.flags.json matches src/fixtures.ts exactly', () => {
    const committed = JSON.parse(
      readFileSync(
        join(import.meta.dir, '..', '..', 'switchback.flags.json'),
        'utf8'
      )
    );
    const expected = fixtureFlags().toSorted((a, b) =>
      a.key.localeCompare(b.key)
    );
    expect(committed).toEqual(expected);
  });

  test('every committed definition parses against the flag schema', () => {
    for (const flag of fixtureFlags()) {
      expect(flagSchema.parse(flag)).toEqual(flag);
    }
  });
});

describe('createFileFlagStore', () => {
  test('missing file reads as an empty definition set', async () => {
    const store = createFileFlagStore(tempStorePath());
    expect(await store.list()).toEqual([]);
    expect(await store.get('anything')).toBeUndefined();
  });

  test('put persists and reloads on the next read', async () => {
    const path = tempStorePath();
    const store = createFileFlagStore(path);
    const [flag] = fixtureFlags();
    await store.put(flag as NonNullable<typeof flag>);
    expect(await store.get('checkout-v2')).toEqual(flag);

    // A second store over the same file sees the write: reload-on-read.
    const reopened = createFileFlagStore(path);
    const reloaded = await reopened.list();
    expect(reloaded.map((entry) => entry.key)).toEqual(['checkout-v2']);
  });

  test('put replaces an existing definition by key', async () => {
    const store = createFileFlagStore(tempStorePath());
    const [flag] = fixtureFlags();
    const base = flag as NonNullable<typeof flag>;
    await store.put(base);
    await store.put({ ...base, description: 'Updated' });
    const flags = await store.list();
    expect(flags).toHaveLength(1);
    expect(flags[0]?.description).toBe('Updated');
  });

  test('invalid stored content fails loudly at the schema boundary', async () => {
    const path = tempStorePath();
    await Bun.write(path, JSON.stringify([{ key: 'not-a-flag' }]));
    const store = createFileFlagStore(path);
    expect(store.list()).rejects.toThrow();
  });
});
