import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkRegistryPosture,
  discoverRegistryWorkspaces,
  formatDistTagSummary,
  registryPostureErrors,
} from '../check-registry-preflight.ts';
import type {
  RegistryView,
  RegistryWorkspace,
} from '../check-registry-preflight.ts';

const workspaces: readonly RegistryWorkspace[] = [
  {
    name: '@ontrails/core',
    path: 'packages/core',
    version: '1.0.0-beta.15',
  },
  {
    name: '@ontrails/commander',
    path: 'adapters/commander',
    version: '1.0.0-beta.15',
  },
  {
    name: '@ontrails/http',
    path: 'packages/http',
    version: '1.0.0-beta.15',
  },
];

const mixedRegistryView: RegistryView = async (name) => {
  if (name === '@ontrails/commander') {
    return null;
  }
  return {
    'dist-tags': { beta: '1.0.0-beta.15' },
    name,
    version: '1.0.0-beta.15',
  };
};

const staleTagRegistryView: RegistryView = async (name) => ({
  'dist-tags': { beta: '1.0.0-beta.14' },
  name,
  version: '1.0.0-beta.14',
});

const failingRegistryView: RegistryView = async () => {
  throw new Error('registry unavailable');
};

describe('formatDistTagSummary', () => {
  test('formats latest and beta dist-tags together for beta-channel audits', () => {
    expect(
      formatDistTagSummary({
        beta: '1.0.0-beta.18',
        latest: '1.0.0-beta.16',
      })
    ).toBe('latest=1.0.0-beta.16, beta=1.0.0-beta.18');
    expect(formatDistTagSummary({ beta: '1.0.0-beta.18' })).toBe(
      'latest=missing, beta=1.0.0-beta.18'
    );
  });
});

describe('checkRegistryPosture', () => {
  test('classifies published and first-time package candidates', async () => {
    const results = await checkRegistryPosture(
      workspaces,
      mixedRegistryView,
      'beta'
    );

    expect(results.map((result) => [result.name, result.status])).toEqual([
      ['@ontrails/core', 'published'],
      ['@ontrails/commander', 'missing'],
      ['@ontrails/http', 'published'],
    ]);
    expect(registryPostureErrors(results, 'beta', false)).toEqual([]);
    expect(registryPostureErrors(results, 'beta', true)).toEqual([
      '@ontrails/commander: package is missing from the registry',
    ]);
  });

  test('fails when the expected dist-tag points at a different version', async () => {
    const results = await checkRegistryPosture(
      [workspaces[0]],
      staleTagRegistryView,
      'beta'
    );

    expect(registryPostureErrors(results, 'beta', false)).toEqual([
      '@ontrails/core: dist-tag beta points to 1.0.0-beta.14, expected 1.0.0-beta.15',
    ]);
  });

  test('surfaces registry probe failures', async () => {
    const results = await checkRegistryPosture(
      [workspaces[0]],
      failingRegistryView,
      'beta'
    );

    expect(registryPostureErrors(results, 'beta', false)).toEqual([
      '@ontrails/core: registry probe failed: registry unavailable',
    ]);
  });

  test('probes registry workspaces concurrently while preserving result order', async () => {
    const started: string[] = [];
    const concurrentRegistryView: RegistryView = async (name) => {
      started.push(name);
      await Bun.sleep(10);
      return {
        'dist-tags': { beta: '1.0.0-beta.15' },
        name,
        version: '1.0.0-beta.15',
      };
    };

    const resultsPromise = checkRegistryPosture(
      workspaces,
      concurrentRegistryView,
      'beta'
    );
    await Bun.sleep(0);

    expect(started).toEqual(workspaces.map((workspace) => workspace.name));
    const results = await resultsPromise;
    expect(results.map((result) => result.name)).toEqual(
      workspaces.map((workspace) => workspace.name)
    );
  });
});

describe('discoverRegistryWorkspaces', () => {
  test('ignores missing workspace glob parents', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'trails-registry-'));
    await writeFile(
      join(repoRoot, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] })
    );

    await expect(discoverRegistryWorkspaces(repoRoot)).resolves.toEqual([]);
  });

  test('fails loudly when workspace glob parents are unreadable', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'trails-registry-'));
    await writeFile(
      join(repoRoot, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] })
    );
    await writeFile(join(repoRoot, 'packages'), '');

    await expect(discoverRegistryWorkspaces(repoRoot)).rejects.toThrow(
      'Unable to read workspace directory packages'
    );
  });
});
