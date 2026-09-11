import { describe, expect, test } from 'bun:test';

import {
  ciStateFromCheckRuns,
  evaluateReleasePolicy,
  isGraphiteMergeQueueComment,
  labelsForReleasePullRequest,
  readReleaseLabelVersions,
  releaseIntentForVersionDelta,
  releasePolicyRequiresCiProof,
  selectGeneratedReleasePullRequest,
  selectReleasePolicyPullRequest,
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

describe('selectGeneratedReleasePullRequest', () => {
  const sourcePullRequest = {
    base: { ref: 'main' },
    head: { ref: 'docs/agents/process-capture' },
    labels: [{ name: 'release:none' }],
    number: 991,
  };
  const generatedReleasePullRequest = {
    base: { ref: 'main' },
    head: { ref: 'changeset-release/main' },
    labels: [{ name: 'release:patch' }],
    number: 995,
  };

  test('rejects ordinary source PRs from generated release discovery', () => {
    expect(
      selectGeneratedReleasePullRequest([sourcePullRequest])
    ).toBeUndefined();
  });

  test('selects the generated release PR regardless of API order', () => {
    expect(
      selectGeneratedReleasePullRequest([
        sourcePullRequest,
        generatedReleasePullRequest,
      ])
    ).toBe(generatedReleasePullRequest);
    expect(
      selectGeneratedReleasePullRequest([
        generatedReleasePullRequest,
        sourcePullRequest,
      ])
    ).toBe(generatedReleasePullRequest);
  });
});

describe('selectReleasePolicyPullRequest', () => {
  const context = {
    previousVersion: '1.0.0',
    ref: 'refs/heads/main',
    repository: 'outfitter-dev/trails',
    version: '0.2.0',
  };
  const manual = {
    base: { ref: 'main' },
    head: {
      ref: 'trl-1347-retarget-the-prepared-trails-package-family-to-010',
    },
    labels: [{ name: 'publish:manual' }, { name: 'channel:stable' }],
    number: 1033,
  };

  test('discovers the approved manual version PR without treating it as bot-generated', () => {
    expect(selectGeneratedReleasePullRequest([manual])).toBeUndefined();
    expect(selectReleasePolicyPullRequest([manual], context)).toBe(manual);
  });

  test.each([
    { repository: 'another/repository' },
    { ref: 'refs/heads/feature' },
    { previousVersion: '0.1.0' },
    { previousVersion: undefined },
    { version: '0.3.0' },
  ])(
    'rejects a manual fallback outside the initial release context: %j',
    (change) => {
      expect(
        selectReleasePolicyPullRequest([manual], { ...context, ...change })
      ).toBeUndefined();
    }
  );

  test.each([
    { base: { ref: 'feature' } },
    { head: { ref: 'another-manual-release' } },
    { labels: [{ name: 'publish:manual' }] },
    { labels: [{ name: 'channel:stable' }] },
    { labels: [...manual.labels, { name: 'release:patch' }] },
    { labels: [...manual.labels, { name: 'publish:auto' }] },
    { labels: [...manual.labels, { name: 'channel:beta' }] },
  ])('rejects an unapproved manual PR shape: %j', (change) => {
    expect(
      selectReleasePolicyPullRequest([{ ...manual, ...change }], context)
    ).toBeUndefined();
  });

  test('preserves normal generated PR selection outside the initial transition', () => {
    const generated = { ...manual, head: { ref: 'changeset-release/main' } };
    expect(
      selectReleasePolicyPullRequest([manual, generated], {
        ...context,
        version: '0.3.0',
      })
    ).toBe(generated);
  });
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

  test('keeps source PR release labels out of generated release intent', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        releasePullRequest: undefined,
        sourcePullRequests: [
          {
            commitShas: ['abc123'],
            hasChangeset: true,
            labels: ['release:none', 'stack:boundary'],
            number: 991,
            title: 'docs: capture source process',
          },
        ],
      })
    );

    expect(report.decision).toBe('manual');
    expect(report.blockers).toEqual([]);
    expect(report.shouldPublish).toBe(false);
    expect(report.createGitHubRelease).toBe(false);
    expect(report.reasons).toContain(
      'No publish:* label is set; routing to manual approval'
    );
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
    expect(report.shouldPublish).toBe(true);
    expect(report.createGitHubRelease).toBe(true);
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

  test('allows canonical lock and skill metadata updates in generated releases', () => {
    const input = baseInput();
    const report = evaluateReleasePolicy({
      ...input,
      changedFiles: [
        ...input.changedFiles,
        { path: 'bun.lock', status: 'M' },
        { path: 'plugin/skills/trails/SKILL.md', status: 'M' },
      ],
    });

    expect(report.decision).toBe('auto');
    expect(report.autoEligible).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  test.each([
    { path: 'plugin/.claude-plugin/plugin.json', status: 'M' },
    { path: '.claude-plugin/marketplace.json', status: 'M' },
    { path: 'plugin/skills/trails/references/getting-started.md', status: 'M' },
    { path: 'plugin/skills/other/SKILL.md', status: 'M' },
    { path: 'plugin/skills/trails/SKILL.md', status: 'A' },
    { path: 'plugin/skills/trails/SKILL.md', status: 'D' },
    { path: 'bun.lock', status: 'A' },
    { path: 'bun.lock', status: 'D' },
    { path: 'apps/trails/bun.lock', status: 'M' },
    { path: 'bun.lockb', status: 'M' },
  ])('keeps non-generated metadata changes manual: %j', (file) => {
    const input = baseInput();
    const report = evaluateReleasePolicy({
      ...input,
      changedFiles: [...input.changedFiles, file],
    });

    expect(report.decision).toBe('manual');
    expect(report.diagnostics).toContain(
      `Unexpected release diff entry: ${file.status} ${file.path}`
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
            versionPublished: true,
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

  test('does not skip publish when the tag matches without consumer proof', () => {
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
    expect(report.shouldPublish).toBe(true);
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

  test('preserves registry probe errors in policy blockers', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        registryPackages: [
          {
            error: 'npm error 503 Service Unavailable',
            name: '@ontrails/core',
            status: 'inaccessible',
            version: '1.0.0-beta.19',
          },
        ],
      })
    );

    expect(report.decision).toBe('block');
    expect(report.blockers).toContain(
      '@ontrails/core: registry state is inaccessible: npm error 503 Service Unavailable'
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

  test('allows manual publication for the initial latest zero-line transition', () => {
    const report = evaluateReleasePolicy(
      baseInput({
        distTag: 'latest',
        previousVersion: '1.0.0',
        registryPackages: [
          {
            expectedTagVersion: '1.0.0-beta.16',
            name: '@ontrails/core',
            status: 'published',
            version: '0.2.0',
            versionPublished: false,
          },
        ],
        releasePullRequest: {
          ...releasePr,
          headRefName:
            'trl-1347-retarget-the-prepared-trails-package-family-to-010',
          labels: ['publish:manual', 'channel:stable'],
          title: 'chore(release): prepare the 0.2.0 package family',
          userLogin: 'galligan',
        },
        version: '0.2.0',
      })
    );

    expect(report.decision).toBe('manual');
    expect(report.blockers).toEqual([]);
    expect(report.shouldPublish).toBe(true);
    expect(report.createGitHubRelease).toBe(true);
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
  test('routes the initial zero-line transition to manual stable publication', () => {
    expect(
      labelsForReleasePullRequest({
        currentVersion: '1.0.0',
        existingLabels: [],
        nextDistTag: 'latest',
        nextVersion: '0.2.0',
        sourcePullRequests: [
          {
            commitShas: ['abc123'],
            hasChangeset: true,
            labels: ['stack:boundary'],
            number: 99,
            title: 'fix: release preparation',
          },
        ],
      })
    ).toEqual(['publish:manual', 'channel:stable']);
  });

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

describe('readReleaseLabelVersions', () => {
  const releaseRefs = {
    baseRefName: 'main',
    headRefName: 'changeset-release/main',
  };
  const refVersions: Record<string, string> = {
    'changeset-release/main': '1.0.0-beta.48',
    main: '1.0.0-beta.47',
  };

  test('reads the previous version from the PR base ref, not local files', async () => {
    const reads: string[] = [];
    const versions = await readReleaseLabelVersions(
      'outfitter-dev/trails',
      releaseRefs,
      (repository, ref) => {
        reads.push(`${repository}@${ref}`);
        return Promise.resolve(refVersions[ref] ?? '');
      }
    );

    expect(versions).toEqual({
      currentVersion: '1.0.0-beta.47',
      nextVersion: '1.0.0-beta.48',
    });
    expect(reads).toEqual([
      'outfitter-dev/trails@main',
      'outfitter-dev/trails@changeset-release/main',
    ]);
  });

  test('labels a versioned checkout with release:patch from base-ref delta', async () => {
    const versions = await readReleaseLabelVersions(
      'outfitter-dev/trails',
      releaseRefs,
      (_repository, ref) => Promise.resolve(refVersions[ref] ?? '')
    );

    // Rerunning the workflow after a manual repair keeps existing families
    // untouched and only fills the missing release:* family.
    expect(
      labelsForReleasePullRequest({
        ...versions,
        existingLabels: ['publish:manual', 'channel:beta'],
        nextDistTag: 'beta',
      })
    ).toEqual(['release:patch']);
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
