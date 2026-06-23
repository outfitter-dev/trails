import { describe, expect, test } from 'bun:test';

import {
  findLockfileWorkspaceMetadataMismatches,
  isReleasePackCoherenceFile,
  parseReleasePackCoherenceArgs,
  shouldRunReleasePackCoherenceCheck,
  syncLockfileWorkspaceMetadataText,
} from '../release/index.js';

describe('release pack coherence guard', () => {
  test('selects release and publishable package metadata files', () => {
    expect(isReleasePackCoherenceFile('bun.lock')).toBe(true);
    expect(isReleasePackCoherenceFile('.changeset/pre.json')).toBe(true);
    expect(isReleasePackCoherenceFile('package.json')).toBe(true);
    expect(isReleasePackCoherenceFile('packages/core/package.json')).toBe(true);
    expect(isReleasePackCoherenceFile('apps/trails/CHANGELOG.md')).toBe(true);
  });

  test('ignores source-only and ordinary changeset intent files', () => {
    expect(isReleasePackCoherenceFile('packages/core/src/trail.ts')).toBe(
      false
    );
    expect(isReleasePackCoherenceFile('docs/releases/stable-cutover.md')).toBe(
      false
    );
    expect(isReleasePackCoherenceFile('.changeset/core-change.md')).toBe(false);
  });

  test('runs on generated release branches even before file-list inspection', () => {
    expect(
      shouldRunReleasePackCoherenceCheck({
        branchName: 'changeset-release/main',
        changedFiles: [],
      })
    ).toBe(true);
  });

  test('runs only for package release metadata on ordinary branches', () => {
    expect(
      shouldRunReleasePackCoherenceCheck({
        branchName: 'feature/example',
        changedFiles: ['packages/core/src/trail.ts'],
      })
    ).toBe(false);

    expect(
      shouldRunReleasePackCoherenceCheck({
        branchName: 'feature/example',
        changedFiles: ['packages/core/package.json'],
      })
    ).toBe(true);
  });

  test('rejects malformed flag arguments before falling back to git state', () => {
    expect(() => parseReleasePackCoherenceArgs(['--changed-files'])).toThrow(
      'Missing value for release pack coherence argument: --changed-files'
    );
    expect(() =>
      parseReleasePackCoherenceArgs([
        '--branch',
        '--changed-files',
        'files.txt',
      ])
    ).toThrow('Missing value for release pack coherence argument: --branch');
  });

  test('reports stale bun.lock workspace metadata', () => {
    expect(
      findLockfileWorkspaceMetadataMismatches({
        lockfileWorkspaces: {
          'packages/core': {
            name: '@ontrails/core',
            version: '1.0.0-beta.25',
          },
          'packages/warden': {
            name: '@ontrails/warden',
            version: '1.0.0-beta.24',
          },
        },
        sourceWorkspaces: [
          {
            name: '@ontrails/core',
            path: 'packages/core',
            version: '1.0.0-beta.25',
          },
          {
            name: '@ontrails/warden',
            path: 'packages/warden',
            version: '1.0.0-beta.25',
          },
          {
            name: '@ontrails/trails',
            path: 'apps/trails',
            version: '1.0.0-beta.25',
          },
        ],
      })
    ).toEqual([
      'packages/warden/package.json has version 1.0.0-beta.25, but bun.lock records 1.0.0-beta.24',
      'apps/trails/package.json is missing from bun.lock workspaces',
    ]);
  });

  test('accepts coherent bun.lock workspace metadata', () => {
    expect(
      findLockfileWorkspaceMetadataMismatches({
        lockfileWorkspaces: {
          'packages/core': {
            name: '@ontrails/core',
            version: '1.0.0-beta.25',
          },
        },
        sourceWorkspaces: [
          {
            name: '@ontrails/core',
            path: 'packages/core',
            version: '1.0.0-beta.25',
          },
        ],
      })
    ).toEqual([]);
  });

  test('syncs stale bun.lock workspace versions without full lockfile churn', () => {
    const lockfile = `{
  "lockfileVersion": 1,
  "workspaces": {
    "packages/core": {
      "name": "@ontrails/core",
      "version": "1.0.0-beta.25",
      "dependencies": {
        "zod": "catalog:",
      },
    },
    "packages/warden": {
      "name": "@ontrails/warden",
      "version": "1.0.0-beta.24",
    },
  },
}
`;

    expect(
      syncLockfileWorkspaceMetadataText(lockfile, [
        {
          name: '@ontrails/core',
          path: 'packages/core',
          version: '1.0.0-beta.26',
        },
        {
          name: '@ontrails/warden',
          path: 'packages/warden',
          version: '1.0.0-beta.26',
        },
      ])
    ).toEqual({
      text: `{
  "lockfileVersion": 1,
  "workspaces": {
    "packages/core": {
      "name": "@ontrails/core",
      "version": "1.0.0-beta.26",
      "dependencies": {
        "zod": "catalog:",
      },
    },
    "packages/warden": {
      "name": "@ontrails/warden",
      "version": "1.0.0-beta.26",
    },
  },
}
`,
      updates: [
        'packages/core/package.json: 1.0.0-beta.25 -> 1.0.0-beta.26',
        'packages/warden/package.json: 1.0.0-beta.24 -> 1.0.0-beta.26',
      ],
    });
  });

  test('keeps coherent bun.lock workspace text unchanged', () => {
    const lockfile = `{
  "workspaces": {
    "packages/core": {
      "name": "@ontrails/core",
      "version": "1.0.0-beta.26",
    },
  },
}
`;

    expect(
      syncLockfileWorkspaceMetadataText(lockfile, [
        {
          name: '@ontrails/core',
          path: 'packages/core',
          version: '1.0.0-beta.26',
        },
      ])
    ).toEqual({
      text: lockfile,
      updates: [],
    });
  });
});
