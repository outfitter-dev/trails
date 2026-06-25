import { describe, expect, test } from 'bun:test';

import {
  ciStateFromCheckRuns,
  evaluateReleasePolicy,
  isGraphiteMergeQueueComment,
  labelsForReleasePullRequest,
  releaseIntentForVersionDelta,
  releasePolicyRequiresCiProof,
  selectReleasePolicyCiProofTarget,
} from '../release/policy.js';
import type {
  ReleasePolicyCheckRun,
  ReleasePolicyInput,
} from '../release/policy.js';

const botCommit = {
  authorEmail: '41898282+github-actions[bot]@users.noreply.github.com',
  authorName: 'github-actions[bot]',
  committerEmail: 'noreply@github.com',
  committerName: 'GitHub',
  subject: 'chore(release): version packages (#123)',
};

const releasePr = {
  baseRefName: 'main',
  body: '',
  comments: [],
  headRefName: 'changeset-release/main',
  headSha: 'release-head-sha',
  labels: ['publish:auto', 'channel:beta', 'release:patch'],
  number: 123,
  title: 'chore(release): version packages',
  userLogin: 'github-actions[bot]',
};

const baseInput = (
  overrides: Partial<ReleasePolicyInput> = {}
): ReleasePolicyInput => ({
  changedFiles: [
    { path: '.changeset/core.md', status: 'D' },
    { path: '.changeset/pre.json', status: 'M' },
    { path: 'apps/trails/package.json', status: 'M' },
    { path: 'apps/trails/CHANGELOG.md', status: 'M' },
    { path: 'packages/core/package.json', status: 'M' },
    { path: 'packages/core/CHANGELOG.md', status: 'M' },
  ],
  ciPassed: true,
  commit: botCommit,
  distTag: 'beta',
  previousVersion: '1.0.0-beta.18',
  ref: 'refs/heads/main',
  registryPackages: [
    {
      expectedTagVersion: '1.0.0-beta.18',
      name: '@ontrails/core',
      status: 'published',
      version: '1.0.0-beta.19',
    },
  ],
  releasePullRequest: releasePr,
  repository: 'outfitter-dev/trails',
  sha: 'abc123',
  sourcePullRequests: [
    {
      commitShas: ['abc123'],
      hasChangeset: true,
      labels: ['stack:boundary'],
      number: 99,
      title: 'feat: add release fact',
    },
  ],
  version: '1.0.0-beta.19',
  ...overrides,
});

const releasePolicySuccessRun = (name: string): ReleasePolicyCheckRun => ({
  check_suite: { app: { slug: 'github-actions' } },
  conclusion: 'success',
  name,
  status: 'completed',
});

describe('evaluateReleasePolicy', () => {
  test('allows publish:auto when generated release and stack evidence are complete', () => {
    const report = evaluateReleasePolicy(baseInput());

    expect(report.decision).toBe('auto');
    expect(report.autoEligible).toBe(true);
    expect(report.shouldPublish).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.diagnostics).toEqual([]);
  });

  test('routes publish:auto to manual when CI proof has not been evaluated', () => {
    const report = evaluateReleasePolicy(
      baseInput({ ciPassed: undefined, ciProof: undefined })
    );

    expect(report.decision).toBe('manual');
    expect(report.diagnostics).toContain('CI proof has not been evaluated');
  });

  test('keeps manual publish paths independent from CI proof', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        ciPassed: undefined,
        releasePullRequest: {
          ...releasePr,
          labels: ['publish:manual', 'channel:beta', 'release:patch'],
        },
      })
    );

    expect(report.decision).toBe('manual');
    expect(report.diagnostics).toEqual([]);
    expect(releasePolicyRequiresCiProof(baseInput())).toBe(true);
    expect(
      releasePolicyRequiresCiProof(
        baseInput({
          releasePullRequest: {
            ...releasePr,
            labels: ['publish:manual', 'channel:beta', 'release:patch'],
          },
        })
      )
    ).toBe(false);
  });

  test('blocks conflicting labels in managed families', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        releasePullRequest: {
          ...releasePr,
          labels: ['publish:auto', 'publish:manual', 'channel:beta'],
        },
      })
    );

    expect(report.decision).toBe('block');
    expect(report.blockers).toContain(
      'Conflicting publish: labels: publish:auto, publish:manual'
    );
  });

  test('blocks unknown managed labels', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        releasePullRequest: {
          ...releasePr,
          labels: ['publish:auto', 'channel:nightly', 'release:patch'],
        },
      })
    );

    expect(report.decision).toBe('block');
    expect(report.blockers).toContain(
      'Unknown channel: label: channel:nightly'
    );
  });

  test('routes missing stack boundary evidence to manual for publish:auto', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        sourcePullRequests: [
          {
            commitShas: ['abc123'],
            hasChangeset: true,
            labels: [],
            number: 99,
            title: 'feat: add release fact',
          },
        ],
      })
    );

    expect(report.decision).toBe('manual');
    expect(report.diagnostics).toContain(
      'publish:auto requires stack:boundary or trusted Graphite merge evidence on every changeset source PR in the release range; missing: #99'
    );
  });

  test('allows trusted Graphite source evidence without stack boundary labels', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        sourcePullRequests: [
          {
            commitShas: ['abc123'],
            hasChangeset: true,
            labels: [],
            number: 99,
            title: 'feat: add release fact',
            trustedStackEvidence:
              'Graphite merge queue and required CI passed on abc123',
          },
        ],
      })
    );

    expect(report.decision).toBe('auto');
    expect(report.diagnostics).toEqual([]);
  });

  test('routes unexpected generated release diff entries to manual', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        changedFiles: [
          { path: '.changeset/core.md', status: 'D' },
          { path: 'apps/trails/package.json', status: 'M' },
          { path: '.github/workflows/release.yml', status: 'M' },
        ],
      })
    );

    expect(report.decision).toBe('manual');
    expect(report.diagnostics).toContain(
      'Unexpected release diff entry: M .github/workflows/release.yml'
    );
  });

  test('skips publish when registry state is already complete', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        registryPackages: [
          {
            expectedTagVersion: '1.0.0-beta.19',
            name: '@ontrails/core',
            status: 'published',
            version: '1.0.0-beta.19',
          },
        ],
      })
    );

    expect(report.decision).toBe('auto');
    expect(report.shouldPublish).toBe(false);
    expect(report.createGitHubRelease).toBe(true);
    expect(report.reasons).toContain(
      'Registry package state already matches this release; npm publish will be skipped'
    );
  });

  test('blocks registry drift before publication routing', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        registryPackages: [
          {
            expectedTagVersion: '1.0.0-beta.20',
            name: '@ontrails/core',
            status: 'published',
            version: '1.0.0-beta.19',
          },
        ],
      })
    );

    expect(report.decision).toBe('block');
    expect(report.blockers).toContain(
      '@ontrails/core: dist-tag beta points to 1.0.0-beta.20, expected 1.0.0-beta.19'
    );
  });

  test('blocks already-published versions when the release tag is stale', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        registryPackages: [
          {
            expectedTagVersion: '1.0.0-beta.18',
            name: '@ontrails/core',
            status: 'published',
            version: '1.0.0-beta.19',
            versionPublished: true,
          },
        ],
      })
    );

    expect(report.decision).toBe('block');
    expect(report.blockers).toContain(
      '@ontrails/core: version 1.0.0-beta.19 is already published but dist-tag beta points to 1.0.0-beta.18'
    );
  });

  test('orders numeric prerelease identifiers before blocking registry drift', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        previousVersion: '1.0.0-beta.9',
        registryPackages: [
          {
            expectedTagVersion: '1.0.0-beta.9',
            name: '@ontrails/core',
            status: 'published',
            version: '1.0.0-beta.10',
          },
        ],
        version: '1.0.0-beta.10',
      })
    );

    expect(report.decision).toBe('auto');
    expect(report.blockers).toEqual([]);
  });

  test('does not block when the target version is unpublished and the tag is behind', () => {
    // The live beta.28 incident: repo target is ahead of the published beta
    // dist-tag, but the target tarball does not exist yet. This must stay a
    // publish-pending state, never a registry blocker.
    const report = evaluateReleasePolicy(
      baseInput({
        previousVersion: '1.0.0-beta.24',
        registryPackages: [
          {
            expectedTagVersion: '1.0.0-beta.24',
            name: '@ontrails/core',
            status: 'published',
            version: '1.0.0-beta.28',
            versionPublished: false,
          },
        ],
        version: '1.0.0-beta.28',
      })
    );

    expect(report.blockers).toEqual([]);
    expect(report.shouldPublish).toBe(true);
    expect(report.decision).not.toBe('block');
  });

  test('requires publish:none audit reason', () => {
    const blocked = evaluateReleasePolicy(
      baseInput({
        releasePullRequest: {
          ...releasePr,
          labels: ['publish:none', 'channel:beta'],
        },
      })
    );
    const allowed = evaluateReleasePolicy(
      baseInput({
        releasePullRequest: {
          ...releasePr,
          body: 'publish:none because this version PR only cleans generated state.',
          labels: ['publish:none', 'channel:beta'],
        },
      })
    );

    expect(blocked.decision).toBe('block');
    expect(allowed.decision).toBe('none');
    expect(allowed.shouldPublish).toBe(false);
    expect(allowed.createGitHubRelease).toBe(false);
  });
});

describe('labelsForReleasePullRequest', () => {
  test('fills missing release intent labels without overriding human labels', () => {
    expect(
      labelsForReleasePullRequest({
        currentVersion: '1.0.0-beta.18',
        existingLabels: [],
        nextDistTag: 'beta',
        nextVersion: '1.0.0-beta.19',
        sourcePullRequests: [
          {
            commitShas: ['abc123'],
            hasChangeset: true,
            labels: ['stack:boundary'],
            number: 99,
            title: 'feat: release fact',
          },
        ],
      })
    ).toEqual(['publish:auto', 'channel:beta', 'release:patch']);

    expect(
      labelsForReleasePullRequest({
        currentVersion: '1.0.0-beta.18',
        existingLabels: ['publish:block'],
        nextDistTag: 'beta',
        nextVersion: '1.0.0-beta.19',
        sourcePullRequests: [],
      })
    ).toEqual(['channel:beta', 'release:patch']);
  });

  test('maps stable generated versions to the stable channel label', () => {
    expect(
      labelsForReleasePullRequest({
        currentVersion: '1.0.0-beta.19',
        existingLabels: [],
        nextDistTag: 'latest',
        nextVersion: '1.0.0',
        sourcePullRequests: [
          {
            commitShas: ['abc123'],
            hasChangeset: true,
            labels: ['stack:boundary'],
            number: 99,
            title: 'feat: release fact',
          },
        ],
      })
    ).toEqual(['publish:auto', 'channel:stable', 'release:patch']);
  });

  test('uses trusted Graphite source evidence to select publish:auto', () => {
    expect(
      labelsForReleasePullRequest({
        currentVersion: '1.0.0-beta.18',
        existingLabels: [],
        nextDistTag: 'beta',
        nextVersion: '1.0.0-beta.19',
        sourcePullRequests: [
          {
            commitShas: ['abc123'],
            hasChangeset: true,
            labels: [],
            number: 99,
            title: 'feat: release fact',
            trustedStackEvidence:
              'Graphite merge queue and required CI passed on abc123',
          },
        ],
      })
    ).toEqual(['publish:auto', 'channel:beta', 'release:patch']);
  });
});

describe('isGraphiteMergeQueueComment', () => {
  test('recognizes the current Graphite merge queue comment shape', () => {
    expect(
      isGraphiteMergeQueueComment({
        body: 'Merged by the [Graphite merge queue](https://app.graphite.com/queue).',
        user: { login: 'graphite-app[bot]' },
      })
    ).toBe(true);
  });

  test('rejects non-Graphite comments and unrelated Graphite comments', () => {
    expect(
      isGraphiteMergeQueueComment({
        body: 'Merged by the [Graphite merge queue](https://app.graphite.com/queue).',
        user: { login: 'github-actions[bot]' },
      })
    ).toBe(false);
    expect(
      isGraphiteMergeQueueComment({
        body: 'Graphite stack updated.',
        user: { login: 'graphite-app[bot]' },
      })
    ).toBe(false);
  });
});

describe('ciStateFromCheckRuns', () => {
  const requiredNames = [
    'Build',
    'Lint & Format',
    'Dead Code',
    'Typecheck',
    'Test',
    'Governance',
  ];

  test('passes when every required GitHub Actions check succeeded', () => {
    expect(
      ciStateFromCheckRuns(requiredNames.map(releasePolicySuccessRun))
    ).toBe('passed');
  });

  test('reuses completed generated-release proof when duplicate checks are pending', () => {
    const runs = [
      ...requiredNames.map(
        (name): ReleasePolicyCheckRun => ({
          check_suite: { app: { slug: 'github-actions' } },
          conclusion: null,
          name,
          status: 'queued',
        })
      ),
      ...requiredNames.map(releasePolicySuccessRun),
    ];

    expect(ciStateFromCheckRuns(runs)).toBe('passed');
  });

  test('blocks when any required check has a completed failure', () => {
    expect(
      ciStateFromCheckRuns([
        ...requiredNames.map(releasePolicySuccessRun),
        {
          check_suite: { app: { slug: 'github-actions' } },
          conclusion: 'failure',
          name: 'Build',
          status: 'completed',
        },
      ])
    ).toBe('failed');
  });
});

describe('selectReleasePolicyCiProofTarget', () => {
  test('reuses generated release PR head checks when commit trees match', () => {
    expect(
      selectReleasePolicyCiProofTarget({
        releasePullRequest: releasePr,
        releasePullRequestHeadTreeSha: 'tree-1',
        sha: 'main-merge-sha',
        shaTreeSha: 'tree-1',
      })
    ).toEqual({
      sha: 'release-head-sha',
      source: 'release-pr-head',
      summary: 'Generated release PR head CI proof',
    });
  });

  test('falls back to exact SHA when generated release PR proof cannot match the tree', () => {
    expect(
      selectReleasePolicyCiProofTarget({
        releasePullRequest: releasePr,
        releasePullRequestHeadTreeSha: 'tree-2',
        sha: 'main-merge-sha',
        shaTreeSha: 'tree-1',
      })
    ).toEqual({
      sha: 'main-merge-sha',
      source: 'exact-sha',
      summary: 'Exact-SHA CI proof',
    });
  });
});

describe('releaseIntentForVersionDelta', () => {
  test('maps semver movement to release labels', () => {
    expect(releaseIntentForVersionDelta('1.0.0', '1.0.1')).toBe(
      'release:patch'
    );
    expect(releaseIntentForVersionDelta('1.0.0', '1.1.0')).toBe(
      'release:minor'
    );
    expect(releaseIntentForVersionDelta('1.0.0', '2.0.0')).toBe(
      'release:major'
    );
    expect(releaseIntentForVersionDelta('1.0.0-beta.9', '1.0.0-beta.10')).toBe(
      'release:patch'
    );
  });
});
