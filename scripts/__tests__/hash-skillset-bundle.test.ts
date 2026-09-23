import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashSkillsetBundle } from '../hash-skillset-bundle.js';

const fixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'trails-bundle-hash-'));
  await Bun.write(join(root, 'nested/a.md'), 'alpha\n');
  await Bun.write(join(root, 'z.md'), 'omega\n');
  await Bun.write(join(root, 'skillset.lock'), 'first lock\n');
  return root;
};

describe('hashSkillsetBundle', () => {
  test('changes when a distributed path or file changes', async () => {
    const root = await fixture();
    const before = await hashSkillsetBundle(root);

    await writeFile(join(root, 'nested/a.md'), 'changed\n');

    expect(await hashSkillsetBundle(root)).not.toBe(before);
  });

  test('excludes the separate Skillset provenance lock', async () => {
    const root = await fixture();
    const before = await hashSkillsetBundle(root);

    await writeFile(join(root, 'skillset.lock'), 'second lock\n');

    expect(await hashSkillsetBundle(root)).toBe(before);
  });
});
