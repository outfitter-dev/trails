import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { findPackedFirstPartyDependencyMismatches } from '../publish.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const workspace = ({
  isPrivate = false,
  name = '@ontrails/core',
  version = '1.0.0-beta.18',
}: {
  readonly isPrivate?: boolean;
  readonly name?: string;
  readonly version?: string;
} = {}) => ({
  isPrivate,
  name,
  path: join(repoRoot, 'packages', name.split('/').at(-1) ?? 'core'),
  version,
  workspaceDeps: [],
});

describe('publish manifest checks', () => {
  test('flags stale packed first-party dependency ranges from workspace sources', () => {
    const workspacesByName = new Map([['@ontrails/core', workspace()]]);

    const errors = findPackedFirstPartyDependencyMismatches({
      packageName: '@ontrails/trails',
      packagePath: join(repoRoot, 'apps/trails'),
      packedPackage: {
        dependencies: {
          '@ontrails/core': '^1.0.0-beta.17',
        },
      },
      sourcePackage: {
        dependencies: {
          '@ontrails/core': 'workspace:^',
        },
      },
      workspacesByName,
    });

    expect(errors).toEqual([
      'Packed manifest for @ontrails/trails (apps/trails) contains stale first-party workspace dependency ranges:',
      '  @ontrails/trails packed dependencies @ontrails/core resolved to ^1.0.0-beta.17, expected ^1.0.0-beta.18 from packages/core/package.json',
    ]);
  });

  test('accepts packed first-party dependency ranges matching live workspace versions', () => {
    const workspacesByName = new Map([['@ontrails/core', workspace()]]);

    const errors = findPackedFirstPartyDependencyMismatches({
      packageName: '@ontrails/trails',
      packagePath: join(repoRoot, 'apps/trails'),
      packedPackage: {
        dependencies: {
          '@ontrails/core': '^1.0.0-beta.18',
        },
      },
      sourcePackage: {
        dependencies: {
          '@ontrails/core': 'workspace:^',
        },
      },
      workspacesByName,
    });

    expect(errors).toEqual([]);
  });

  test('checks first-party workspace ranges across dependency fields and protocol forms', () => {
    const workspacesByName = new Map([
      [
        '@ontrails/core',
        workspace({ name: '@ontrails/core', version: '1.0.0-beta.18' }),
      ],
      [
        '@ontrails/testing',
        workspace({ name: '@ontrails/testing', version: '1.0.0-beta.18' }),
      ],
      [
        '@ontrails/private-harness',
        workspace({
          isPrivate: true,
          name: '@ontrails/private-harness',
          version: '1.0.0-beta.18',
        }),
      ],
    ]);

    const errors = findPackedFirstPartyDependencyMismatches({
      packageName: '@ontrails/trails',
      packagePath: join(repoRoot, 'apps/trails'),
      packedPackage: {
        dependencies: {
          '@ontrails/core': '~1.0.0-beta.17',
        },
        optionalDependencies: {
          '@ontrails/private-harness': '1.0.0-beta.17',
        },
        peerDependencies: {
          '@ontrails/testing': '1.0.0-beta.17',
        },
      },
      sourcePackage: {
        dependencies: {
          '@ontrails/core': 'workspace:~',
        },
        optionalDependencies: {
          '@ontrails/private-harness': 'workspace:*',
        },
        peerDependencies: {
          '@ontrails/testing': 'workspace:',
        },
      },
      workspacesByName,
    });

    expect(errors).toEqual([
      'Packed manifest for @ontrails/trails (apps/trails) contains stale first-party workspace dependency ranges:',
      '  @ontrails/trails packed dependencies @ontrails/core resolved to ~1.0.0-beta.17, expected ~1.0.0-beta.18 from packages/core/package.json',
      '  @ontrails/trails packed peerDependencies @ontrails/testing resolved to 1.0.0-beta.17, expected 1.0.0-beta.18 from packages/testing/package.json',
      '  @ontrails/trails packed optionalDependencies @ontrails/private-harness resolved to 1.0.0-beta.17, expected 1.0.0-beta.18 from packages/private-harness/package.json',
    ]);
  });

  test('accepts explicit workspace protocol ranges unchanged', () => {
    const workspacesByName = new Map([['@ontrails/core', workspace()]]);

    const errors = findPackedFirstPartyDependencyMismatches({
      packageName: '@ontrails/trails',
      packagePath: join(repoRoot, 'apps/trails'),
      packedPackage: {
        peerDependencies: {
          '@ontrails/core': '>=1.0.0-beta.18 <2',
        },
      },
      sourcePackage: {
        peerDependencies: {
          '@ontrails/core': 'workspace:>=1.0.0-beta.18 <2',
        },
      },
      workspacesByName,
    });

    expect(errors).toEqual([]);
  });
});
