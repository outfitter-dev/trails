import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  createNpmPublishCommand,
  publicationActionForRegistryState,
  trustedPublishingPreflightErrors,
  unsupportedPublishLifecycleScripts,
} from '../release/index.js';
import type { NativeBunPublishWorkspace } from '../release/index.js';
import { publishRepositoryMetadataErrors } from '../release/native-bun-publish.js';

const coreWorkspace = (
  overrides: Partial<NativeBunPublishWorkspace> = {}
): NativeBunPublishWorkspace => ({
  isPrivate: false,
  name: '@ontrails/core',
  path: join(process.cwd(), 'packages/core'),
  repository: {
    directory: 'packages/core',
    type: 'git',
    url: 'git+https://github.com/outfitter-dev/trails.git',
  },
  version: '1.0.0-beta.44',
  workspaceDeps: [],
  ...overrides,
});

describe('native Bun publish handoff', () => {
  test('publishes the Bun-packed tarball through npm', () => {
    expect(
      createNpmPublishCommand({
        otp: undefined,
        tag: 'beta',
        tarballPath: '/tmp/ontrails-core.tgz',
      })
    ).toEqual([
      'npm',
      'publish',
      '/tmp/ontrails-core.tgz',
      '--access',
      'public',
      '--tag',
      'beta',
    ]);
    const otpCommand = createNpmPublishCommand({
      otp: '123456',
      tag: 'beta',
      tarballPath: '/tmp/ontrails-core.tgz',
    });
    expect(otpCommand.slice(-2)).toEqual(['--otp', '123456']);
  });

  test('publishes missing targets, skips complete state, and blocks tag repair', () => {
    expect(publicationActionForRegistryState({ kind: 'complete' })).toBe(
      'skip'
    );
    expect(publicationActionForRegistryState({ kind: 'needs-publish' })).toBe(
      'publish'
    );
    expect(
      publicationActionForRegistryState({ kind: 'first-time-package' })
    ).toBe('publish');
    expect(
      publicationActionForRegistryState({ kind: 'first-time-package' }, true)
    ).toBe('block');
    expect(
      publicationActionForRegistryState({
        currentTagVersion: '1.0.0-beta.42',
        kind: 'needs-tag-repair',
      })
    ).toBe('block');
  });

  test('rejects publish-only lifecycle hooks that tarball publication skips', () => {
    expect(
      unsupportedPublishLifecycleScripts([
        coreWorkspace({
          publishLifecycleScripts: ['prepublishOnly', 'publish'],
        }),
      ])
    ).toEqual([
      '@ontrails/core defines unsupported prepublishOnly',
      '@ontrails/core defines unsupported publish',
    ]);
  });

  test('checks trusted-publishing repository metadata during ordinary validation', () => {
    expect(publishRepositoryMetadataErrors([coreWorkspace()])).toEqual([]);
    expect(
      publishRepositoryMetadataErrors([
        coreWorkspace({ repository: undefined }),
        coreWorkspace({ isPrivate: true, repository: undefined }),
      ])
    ).toEqual([
      '@ontrails/core must declare repository git+https://github.com/outfitter-dev/trails.git with directory packages/core',
    ]);
  });

  test('accepts a complete trusted-publishing environment', () => {
    expect(
      trustedPublishingPreflightErrors({
        env: {
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'present',
          ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.test/token',
          GITHUB_ACTIONS: 'true',
        },
        nodeVersion: '24.6.0',
        npmVersion: '11.18.0',
        workspaces: [coreWorkspace()],
      })
    ).toEqual([]);
  });

  test('reports missing OIDC, runtime, and repository prerequisites together', () => {
    expect(
      trustedPublishingPreflightErrors({
        env: {},
        nodeVersion: '22.13.0',
        npmVersion: '11.4.0',
        workspaces: [coreWorkspace({ repository: undefined })],
      })
    ).toEqual([
      'trusted publishing requires a GitHub Actions runner',
      'GitHub OIDC request URL is unavailable (id-token: write)',
      'GitHub OIDC request token is unavailable (id-token: write)',
      'trusted publishing requires Node >= 22.14.0; found 22.13.0',
      'trusted publishing requires npm >= 11.5.1; found 11.4.0',
      '@ontrails/core must declare repository git+https://github.com/outfitter-dev/trails.git with directory packages/core',
    ]);
  });
});
