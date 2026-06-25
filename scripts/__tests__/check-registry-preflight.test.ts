import { describe, expect, mock, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkRegistryPosture,
  discoverRegistryWorkspaces,
  formatDistTagSummary,
  registryPostureErrors,
  runRegistryPreflight,
} from '../check-registry-preflight.ts';
import type {
  RegistryResult,
  RegistryVersionView,
  RegistryView,
  RegistryWorkspace,
} from '../check-registry-preflight.ts';

const acceptsLegacyCheckRegistryPostureSignature: (
  workspaces: readonly RegistryWorkspace[],
  view: RegistryView,
  expectedTag: string
) => Promise<RegistryResult[]> = checkRegistryPosture;

const acceptsLegacyRegistryPostureErrorsSignature: (
  results: readonly RegistryResult[],
  expectedTag: string,
  requirePublished: boolean
) => string[] = registryPostureErrors;

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

const publishedVersionView: RegistryVersionView = async () => true;
const unpublishedVersionView: RegistryVersionView = async () => false;

const withConsoleOutput = async (
  invoke: () => Promise<number>
): Promise<{
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}> => {
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const stderr: string[] = [];
  const stdout: string[] = [];
  console.error = mock((...args: unknown[]) => {
    stderr.push(args.map(String).join(' '));
  }) as typeof console.error;
  console.log = mock((...args: unknown[]) => {
    stdout.push(args.map(String).join(' '));
  }) as typeof console.log;
  try {
    return {
      code: await invoke(),
      stderr: stderr.join('\n'),
      stdout: stdout.join('\n'),
    };
  } finally {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  }
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
      publishedVersionView,
      'beta'
    );

    expect(results.map((result) => [result.name, result.status])).toEqual([
      ['@ontrails/core', 'published'],
      ['@ontrails/commander', 'missing'],
      ['@ontrails/http', 'published'],
    ]);
    expect(registryPostureErrors(results, 'beta', 'ready')).toEqual([]);
    expect(registryPostureErrors(results, 'beta', 'published')).toEqual([
      '@ontrails/commander: package is missing from the registry',
    ]);
  });

  test('treats a behind dist-tag with an unpublished target as pending in ready phase', async () => {
    const results = await checkRegistryPosture(
      [workspaces[0]],
      staleTagRegistryView,
      unpublishedVersionView,
      'beta'
    );

    expect(registryPostureErrors(results, 'beta', 'ready')).toEqual([]);
    expect(registryPostureErrors(results, 'beta', 'published')).toEqual([
      '@ontrails/core: target version 1.0.0-beta.15 is not published',
    ]);
  });

  test('surfaces registry probe failures', async () => {
    const results = await checkRegistryPosture(
      [workspaces[0]],
      failingRegistryView,
      publishedVersionView,
      'beta'
    );

    expect(registryPostureErrors(results, 'beta', 'ready')).toEqual([
      '@ontrails/core: registry probe failed: registry unavailable',
    ]);
  });

  test('keeps the exported legacy helper call shapes working', async () => {
    const results = await acceptsLegacyCheckRegistryPostureSignature(
      [workspaces[0]],
      staleTagRegistryView,
      'beta'
    );

    expect(results).toEqual([
      {
        distTags: { beta: '1.0.0-beta.14' },
        expectedTagVersion: '1.0.0-beta.14',
        name: '@ontrails/core',
        status: 'published',
        version: '1.0.0-beta.14',
        versionPublished: undefined,
        workspaceVersion: '1.0.0-beta.15',
      },
    ]);
    expect(
      acceptsLegacyRegistryPostureErrorsSignature(results, 'beta', false)
    ).toEqual([]);
    expect(
      acceptsLegacyRegistryPostureErrorsSignature(results, 'beta', true)
    ).toEqual([
      '@ontrails/core: target version 1.0.0-beta.15 publish state was not probed',
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
      publishedVersionView,
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

describe('runRegistryPreflight', () => {
  test('keeps injected registry views no-network unless a version view is supplied', async () => {
    const output = await withConsoleOutput(() =>
      runRegistryPreflight(
        { requirePublished: false, tag: 'beta' },
        staleTagRegistryView
      )
    );

    expect(output.code).toBe(0);
    expect(output.stdout).toContain('target version publish state unknown');
    expect(output.stdout).not.toContain('target version not published yet');
  });

  test('reports unpublished targets when callers explicitly pass a version view', async () => {
    const output = await withConsoleOutput(() =>
      runRegistryPreflight(
        { requirePublished: false, tag: 'beta' },
        staleTagRegistryView,
        unpublishedVersionView
      )
    );

    expect(output.code).toBe(0);
    expect(output.stdout).toContain('target version not published yet');
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
