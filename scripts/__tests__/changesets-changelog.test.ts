import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const require = createRequire(import.meta.url);
const changelog = require(
  join(import.meta.dir, '..', 'changesets', 'changelog.cjs')
) as {
  getDependencyReleaseLine: (
    changesets: unknown[],
    dependenciesUpdated: { name: string; newVersion: string }[]
  ) => Promise<string>;
  getReleaseLine: (
    changeset: { commit?: string; summary: string },
    type: string,
    options?: { repo?: string }
  ) => Promise<string>;
};

describe('changesets changelog formatter', () => {
  test('links release line commits when repo is configured', async () => {
    await expect(
      changelog.getReleaseLine(
        {
          commit: 'abcdef1234567890',
          summary: 'Render cleaner release notes.\nWith a continuation.',
        },
        'patch',
        { repo: 'outfitter-dev/trails' }
      )
    ).resolves.toBe(
      '- [`abcdef1`](https://github.com/outfitter-dev/trails/commit/abcdef1234567890): Render cleaner release notes.\n  With a continuation.'
    );
  });

  test('suppresses internal dependency cascade lines', async () => {
    await expect(
      changelog.getDependencyReleaseLine(
        [],
        [
          { name: '@ontrails/core', newVersion: '1.0.0-beta.33' },
          { name: '@ontrails/warden', newVersion: '1.0.0-beta.33' },
        ]
      )
    ).resolves.toBe('');
  });

  test('keeps external dependency updates visible', async () => {
    await expect(
      changelog.getDependencyReleaseLine(
        [],
        [
          { name: '@ontrails/core', newVersion: '1.0.0-beta.33' },
          { name: 'zod', newVersion: '4.3.7' },
        ]
      )
    ).resolves.toBe('- Updated dependency zod@4.3.7');
  });
});
