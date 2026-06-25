import { describe, expect, test } from 'bun:test';

import {
  checkRegistryPosture,
  classifyPackageRegistryState,
  registryPostureErrors,
} from '../release/native-bun-registry.js';
import type {
  PackageRegistryFacts,
  RegistryResult,
  RegistryVersionView,
  RegistryView,
  RegistryWorkspace,
} from '../release/native-bun-registry.js';

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

const publishedFacts = (
  overrides: Partial<PackageRegistryFacts> = {}
): PackageRegistryFacts => ({
  expectedTagVersion: '1.0.0-beta.28',
  status: 'published',
  targetVersion: '1.0.0-beta.28',
  versionPublished: true,
  ...overrides,
});

describe('classifyPackageRegistryState', () => {
  test('complete when target is published and the tag points at it', () => {
    expect(classifyPackageRegistryState(publishedFacts()).kind).toBe(
      'complete'
    );
  });

  test('complete when publish state is unknown but the tag is at target', () => {
    // Preserves the policy `versionPublished ?? true` default.
    expect(
      classifyPackageRegistryState(
        publishedFacts({ versionPublished: undefined })
      ).kind
    ).toBe('complete');
  });

  test('first-time-package when the package is missing entirely', () => {
    expect(
      classifyPackageRegistryState({
        expectedTagVersion: undefined,
        status: 'missing',
        targetVersion: '1.0.0-beta.28',
        versionPublished: false,
      }).kind
    ).toBe('first-time-package');
  });

  test('needs-publish when the target version is absent and the tag is behind', () => {
    // The live beta.28 incident shape.
    expect(
      classifyPackageRegistryState(
        publishedFacts({
          expectedTagVersion: '1.0.0-beta.24',
          versionPublished: false,
        })
      ).kind
    ).toBe('needs-publish');
  });

  test('needs-publish (not tag-repair) when the tag is behind but publish state is unknown', () => {
    // Preserves conservative policy behavior: an unprobed behind-tag must not
    // be promoted to a tag repair (which policy treats as a blocker).
    expect(
      classifyPackageRegistryState(
        publishedFacts({
          expectedTagVersion: '1.0.0-beta.24',
          versionPublished: undefined,
        })
      ).kind
    ).toBe('needs-publish');
  });

  test('needs-tag-repair when the target is published but the tag is behind', () => {
    const state = classifyPackageRegistryState(
      publishedFacts({
        expectedTagVersion: '1.0.0-beta.24',
        versionPublished: true,
      })
    );
    expect(state.kind).toBe('needs-tag-repair');
    expect(state).toMatchObject({ currentTagVersion: '1.0.0-beta.24' });
  });

  test('tag-points-ahead when the dist-tag is newer than the target', () => {
    const state = classifyPackageRegistryState(
      publishedFacts({
        expectedTagVersion: '1.0.0-beta.29',
        versionPublished: true,
      })
    );
    expect(state.kind).toBe('tag-points-ahead');
    expect(state).toMatchObject({ currentTagVersion: '1.0.0-beta.29' });
  });

  test('registry-inaccessible when the probe failed', () => {
    expect(
      classifyPackageRegistryState({
        error: 'boom',
        expectedTagVersion: undefined,
        status: 'inaccessible',
        targetVersion: '1.0.0-beta.28',
        versionPublished: false,
      }).kind
    ).toBe('registry-inaccessible');
  });
});

const incidentWorkspaces: readonly RegistryWorkspace[] = [
  { name: '@ontrails/core', path: 'packages/core', version: '1.0.0-beta.28' },
];

// Repo target beta.28; beta tag at beta.24; beta.28 tarball absent.
const behindTagView: RegistryView = async (name) => ({
  'dist-tags': { beta: '1.0.0-beta.24' },
  name,
  version: '1.0.0-beta.24',
});

// Target beta.28 is published, but the beta tag still points at beta.24.
const publishedStaleTagView: RegistryView = async (name) => ({
  'dist-tags': { beta: '1.0.0-beta.24' },
  name,
  version: '1.0.0-beta.28',
});

// The beta tag points one release ahead of the repo target.
const tagAheadView: RegistryView = async (name) => ({
  'dist-tags': { beta: '1.0.0-beta.29' },
  name,
  version: '1.0.0-beta.29',
});

const targetAbsent: RegistryVersionView = async () => false;
const targetPublished: RegistryVersionView = async () => true;

describe('registryPostureErrors — live beta.28 incident', () => {
  test('ready phase passes (publish pending); published phase fails', async () => {
    const results = await checkRegistryPosture(
      incidentWorkspaces,
      behindTagView,
      targetAbsent,
      'beta'
    );

    expect(registryPostureErrors(results, 'beta', 'ready')).toEqual([]);
    expect(registryPostureErrors(results, 'beta', 'published')).toEqual([
      '@ontrails/core: target version 1.0.0-beta.28 is not published',
    ]);
  });

  test('preserves the legacy exported helper signatures', async () => {
    const results = await acceptsLegacyCheckRegistryPostureSignature(
      incidentWorkspaces,
      behindTagView,
      'beta'
    );

    expect(results).toEqual([
      {
        distTags: { beta: '1.0.0-beta.24' },
        expectedTagVersion: '1.0.0-beta.24',
        name: '@ontrails/core',
        status: 'published',
        version: '1.0.0-beta.24',
        versionPublished: undefined,
        workspaceVersion: '1.0.0-beta.28',
      },
    ]);
    expect(
      acceptsLegacyRegistryPostureErrorsSignature(results, 'beta', false)
    ).toEqual([]);
    expect(
      acceptsLegacyRegistryPostureErrorsSignature(results, 'beta', true)
    ).toEqual([
      '@ontrails/core: target version 1.0.0-beta.28 publish state was not probed',
    ]);
  });
});

describe('registryPostureErrors — phase behavior', () => {
  test('a published target with a stale tag only fails in published phase', async () => {
    const results = await checkRegistryPosture(
      incidentWorkspaces,
      publishedStaleTagView,
      targetPublished,
      'beta'
    );

    expect(registryPostureErrors(results, 'beta', 'ready')).toEqual([]);
    expect(registryPostureErrors(results, 'beta', 'published')).toEqual([
      '@ontrails/core: needs dist-tag update — beta points to 1.0.0-beta.24, target 1.0.0-beta.28',
    ]);
  });

  test('a tag ahead of the target blocks in both phases', async () => {
    const results = await checkRegistryPosture(
      incidentWorkspaces,
      tagAheadView,
      targetPublished,
      'beta'
    );
    const ahead =
      '@ontrails/core: dist-tag beta points to 1.0.0-beta.29, which is newer than target 1.0.0-beta.28';

    expect(registryPostureErrors(results, 'beta', 'ready')).toEqual([ahead]);
    expect(registryPostureErrors(results, 'beta', 'published')).toEqual([
      ahead,
    ]);
  });
});
