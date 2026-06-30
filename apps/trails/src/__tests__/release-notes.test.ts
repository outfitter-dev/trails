import { describe, expect, test } from 'bun:test';

import {
  dedupeReleaseChanges,
  extractChangelogEntry,
  renderReleaseNotes,
} from '../release/notes.js';

describe('release notes rendering', () => {
  test('extracts the requested changelog version entry', () => {
    const changelog = `# @ontrails/core

## 1.0.0-beta.32

### Patch Changes

- [\`abc1234\`](https://github.com/outfitter-dev/trails/commit/abc1234): Ship the thing.

## 1.0.0-beta.31

### Patch Changes

- Previous thing.
`;

    expect(extractChangelogEntry(changelog, '1.0.0-beta.32')).toContain(
      'Ship the thing.'
    );
    expect(extractChangelogEntry(changelog, '1.0.0-beta.31')).toContain(
      'Previous thing.'
    );
    expect(extractChangelogEntry(changelog, '1.0.0-beta.30')).toBeUndefined();
  });

  test('dedupes changes across packages and keeps package provenance', () => {
    const changes = dedupeReleaseChanges([
      {
        commit: 'abc1234',
        packageName: '@ontrails/core',
        summary: 'Export shared helpers.',
        url: 'https://github.com/outfitter-dev/trails/commit/abc1234',
      },
      {
        commit: 'abc1234',
        packageName: '@ontrails/warden',
        summary: 'Export shared helpers.',
        url: 'https://github.com/outfitter-dev/trails/commit/abc1234',
      },
      {
        commit: 'def5678',
        packageName: '@ontrails/trails',
        summary: 'Render release notes.',
      },
    ]);

    expect(changes).toEqual([
      {
        commit: 'abc1234',
        packages: ['@ontrails/core', '@ontrails/warden'],
        summary: 'Export shared helpers.',
        url: 'https://github.com/outfitter-dev/trails/commit/abc1234',
      },
      {
        commit: 'def5678',
        packages: ['@ontrails/trails'],
        summary: 'Render release notes.',
      },
    ]);
  });

  test('renders release PR notes with highlights, changes, and package versions', () => {
    const notes = renderReleaseNotes({
      changes: [
        {
          commit: 'abc1234',
          packages: ['@ontrails/core', '@ontrails/warden'],
          summary: 'Export shared helpers.',
          url: 'https://github.com/outfitter-dev/trails/commit/abc1234',
        },
      ],
      distTag: 'beta',
      mode: 'release-pr',
      packageVersions: [
        { name: '@ontrails/core', version: '1.0.0-beta.33' },
        { name: '@ontrails/warden', version: '1.0.0-beta.33' },
      ],
      repo: 'outfitter-dev/trails',
      version: '1.0.0-beta.33',
    });

    expect(notes).toContain('# Release 1.0.0-beta.33');
    expect(notes).toContain('## Highlights');
    expect(notes).toContain('- Export shared helpers.');
    expect(notes).toContain('## Changes');
    expect(notes).toContain(
      '- [`abc1234`](https://github.com/outfitter-dev/trails/commit/abc1234): Export shared helpers. Packages: `@ontrails/core`, `@ontrails/warden`'
    );
    expect(notes).toContain('<summary>Package Versions</summary>');
    expect(notes).toContain('`@ontrails/core@1.0.0-beta.33`');
  });

  test('renders GitHub Release notes with published dist-tag copy', () => {
    const notes = renderReleaseNotes({
      changes: [],
      distTag: 'beta',
      mode: 'github-release',
      packageVersions: [{ name: '@ontrails/core', version: '1.0.0-beta.33' }],
      version: '1.0.0-beta.33',
    });

    expect(notes).toContain(
      'Published the publishable `@ontrails/*` package set at `1.0.0-beta.33` on the `beta` dist-tag.'
    );
    expect(notes).toContain(
      '- No user-facing changes were detected in package changelogs.'
    );
  });
});
