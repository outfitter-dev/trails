/* eslint-disable no-use-before-define -- release policy keeps exported entrypoints before the local CLI/GitHub helpers. */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { discoverRegistryWorkspaces } from './native-bun-registry.js';
import type { RegistryResult } from './native-bun-registry.js';

export type PublishIntent =
  | 'publish:auto'
  | 'publish:block'
  | 'publish:manual'
  | 'publish:none';
export type ChannelIntent = 'channel:beta' | 'channel:stable';
export type ReleaseIntent = 'release:major' | 'release:minor' | 'release:patch';
export type ReleasePolicyDecision = 'auto' | 'block' | 'manual' | 'none';
export type StackIntent = 'stack:boundary';

export interface ReleasePolicyChangedFile {
  readonly path: string;
  readonly status?: string;
}

export interface ReleasePolicyCommit {
  readonly authorEmail: string;
  readonly authorName: string;
  readonly committerEmail: string;
  readonly committerName: string;
  readonly subject: string;
}

export interface ReleasePolicyPullRequest {
  readonly baseRefName: string;
  readonly body: string;
  readonly comments: readonly string[];
  readonly headRefName: string;
  readonly headSha?: string | undefined;
  readonly labels: readonly string[];
  readonly number: number;
  readonly title: string;
  readonly userLogin: string;
}

export interface ReleasePolicySourcePullRequest {
  readonly commitShas: readonly string[];
  readonly hasChangeset: boolean;
  readonly labels: readonly string[];
  readonly number: number;
  readonly title: string;
}

export interface ReleasePolicyRegistryPackage {
  readonly expectedTagVersion?: string | undefined;
  readonly name: string;
  readonly status: 'inaccessible' | 'missing' | 'published';
  readonly version: string;
  readonly versionPublished?: boolean | undefined;
}

export type ReleasePolicyCiProofSource =
  | 'assumed'
  | 'exact-sha'
  | 'missing'
  | 'release-pr-head';

export interface ReleasePolicyCiProof {
  readonly passed: boolean;
  readonly source: ReleasePolicyCiProofSource;
  readonly summary: string;
}

export interface ReleasePolicyCheckRun {
  readonly check_suite?: { readonly app?: { readonly slug?: string } };
  readonly conclusion?: string | null;
  readonly name: string;
  readonly status: string;
}

export interface ReleasePolicyInput {
  readonly changedFiles: readonly ReleasePolicyChangedFile[];
  readonly ciPassed?: boolean | undefined;
  readonly ciProof?: ReleasePolicyCiProof | undefined;
  readonly commit: ReleasePolicyCommit;
  readonly distTag: string;
  readonly previousVersion?: string | undefined;
  readonly ref: string;
  readonly registryPackages: readonly ReleasePolicyRegistryPackage[];
  readonly releasePullRequest?: ReleasePolicyPullRequest | undefined;
  readonly repository: string;
  readonly sha: string;
  readonly sourcePullRequests?: readonly ReleasePolicySourcePullRequest[];
  readonly version: string;
}

export interface ReleasePolicyReport {
  readonly autoEligible: boolean;
  readonly blockers: readonly string[];
  readonly channel: ChannelIntent | undefined;
  readonly ciProof?: ReleasePolicyCiProof | undefined;
  readonly createGitHubRelease: boolean;
  readonly decision: ReleasePolicyDecision;
  readonly diagnostics: readonly string[];
  readonly publish: PublishIntent | undefined;
  readonly reasons: readonly string[];
  readonly release: ReleaseIntent | undefined;
  readonly shouldPublish: boolean;
  readonly stack: StackIntent | undefined;
}

interface FamilyResult<T extends string> {
  readonly conflicts: readonly string[];
  readonly unknown: readonly string[];
  readonly value?: T;
}

interface ReleasePolicyCiProofTarget {
  readonly sha: string;
  readonly source: Exclude<ReleasePolicyCiProofSource, 'assumed' | 'missing'>;
  readonly summary: string;
}

const repoRoot = resolve(process.cwd());
const publishIntents = new Set<PublishIntent>([
  'publish:auto',
  'publish:block',
  'publish:manual',
  'publish:none',
]);
const channelIntents = new Set<ChannelIntent>([
  'channel:beta',
  'channel:stable',
]);
const releaseIntents = new Set<ReleaseIntent>([
  'release:major',
  'release:minor',
  'release:patch',
]);
const stackIntents = new Set<StackIntent>(['stack:boundary']);

export const channelIntentForDistTag = (
  distTag: string
): ChannelIntent | undefined => {
  if (distTag === 'beta') {
    return 'channel:beta';
  }
  if (distTag === 'latest') {
    return 'channel:stable';
  }
  return undefined;
};

export const evaluateReleasePolicy = (
  input: ReleasePolicyInput
): ReleasePolicyReport => {
  const labels = input.releasePullRequest?.labels ?? [];
  const publish = readLabelFamily(labels, 'publish:', publishIntents);
  const channel = readLabelFamily(labels, 'channel:', channelIntents);
  const release = readLabelFamily(labels, 'release:', releaseIntents);
  const stack = readSourceStackLabels(input.sourcePullRequests);
  const blockers = [
    ...publish.conflicts,
    ...channel.conflicts,
    ...release.conflicts,
    ...stack.conflicts,
    ...publish.unknown,
    ...channel.unknown,
    ...release.unknown,
    ...stack.unknown,
    ...registryBlockers(input.registryPackages, input.distTag),
  ];
  const diagnostics: string[] = [];
  const reasons: string[] = [];

  if (publish.value === 'publish:block') {
    blockers.push('publish:block is set');
  }

  if (blockers.length > 0) {
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: 'block',
      diagnostics,
      publish: publish.value,
      reasons,
      release: release.value,
      stack: stack.value,
    });
  }

  if (publish.value === 'publish:none') {
    if (!hasPublishNoneReason(input.releasePullRequest)) {
      return makeReport(input, {
        blockers: [
          'publish:none requires an audit reason in the release PR body or comments',
        ],
        channel: channel.value,
        decision: 'block',
        diagnostics,
        publish: publish.value,
        reasons,
        release: release.value,
        stack: stack.value,
      });
    }

    reasons.push(
      'publish:none is set, so npm publish and GitHub release creation are skipped'
    );
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: 'none',
      diagnostics,
      publish: publish.value,
      reasons,
      release: release.value,
      stack: stack.value,
    });
  }

  if (!publish.value) {
    reasons.push('No publish:* label is set; routing to manual approval');
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: 'manual',
      diagnostics,
      reasons,
      release: release.value,
      stack: stack.value,
    });
  }

  if (publish.value === 'publish:manual') {
    reasons.push('publish:manual is set');
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: 'manual',
      diagnostics,
      publish: publish.value,
      reasons,
      release: release.value,
      stack: stack.value,
    });
  }

  const autoChecks = evaluateAutoChecks(
    input,
    channel.value,
    release.value,
    stack.value
  );
  diagnostics.push(...autoChecks.diagnostics);

  if (!autoChecks.ok) {
    reasons.push(
      'publish:auto requested, but one or more low-risk checks failed; routing to manual approval'
    );
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: 'manual',
      diagnostics,
      publish: publish.value,
      reasons,
      release: release.value,
      stack: stack.value,
    });
  }

  const proof = readCiProofFromInput(input);
  if (proof) {
    reasons.push(`${proof.summary} passed`);
  }
  reasons.push(
    'publish:auto is set and low-risk release checks passed for the generated release'
  );
  return makeReport(input, {
    autoEligible: true,
    blockers,
    channel: channel.value,
    decision: 'auto',
    diagnostics,
    publish: publish.value,
    reasons,
    release: release.value,
    stack: stack.value,
  });
};

export const labelsForReleasePullRequest = ({
  currentVersion,
  existingLabels,
  nextDistTag,
  nextVersion,
  sourcePullRequests,
}: {
  readonly currentVersion: string;
  readonly existingLabels: readonly string[];
  readonly nextDistTag: string;
  readonly nextVersion: string;
  readonly sourcePullRequests?: readonly ReleasePolicySourcePullRequest[];
}): readonly string[] => {
  const labels = new Set(existingLabels);
  const labelsToAdd: string[] = [];
  const stack = readSourceStackLabels(sourcePullRequests);
  const stackDiagnostics = [
    ...stack.conflicts,
    ...stack.unknown,
    ...evaluateSourceStackEvidence(sourcePullRequests, stack.value),
  ];
  const expectedChannel = channelIntentForDistTag(nextDistTag);
  const expectedRelease = releaseIntentForVersionDelta(
    currentVersion,
    nextVersion
  );

  if (!hasLabelFamily(labels, 'publish:')) {
    labelsToAdd.push(
      stackDiagnostics.length === 0 && expectedChannel
        ? 'publish:auto'
        : 'publish:manual'
    );
  }

  if (expectedChannel && !hasLabelFamily(labels, 'channel:')) {
    labelsToAdd.push(expectedChannel);
  }

  if (expectedRelease && !hasLabelFamily(labels, 'release:')) {
    labelsToAdd.push(expectedRelease);
  }

  return labelsToAdd;
};

export const releasePolicyRequiresCiProof = (
  input: ReleasePolicyInput
): boolean => {
  const publish = readLabelFamily(
    input.releasePullRequest?.labels ?? [],
    'publish:',
    publishIntents
  );
  return (
    publish.value === 'publish:auto' &&
    publish.conflicts.length === 0 &&
    publish.unknown.length === 0
  );
};

export const selectReleasePolicyCiProofTarget = ({
  releasePullRequest,
  releasePullRequestHeadTreeSha,
  sha,
  shaTreeSha,
}: {
  readonly releasePullRequest?: ReleasePolicyPullRequest | undefined;
  readonly releasePullRequestHeadTreeSha?: string | undefined;
  readonly sha: string;
  readonly shaTreeSha?: string | undefined;
}): ReleasePolicyCiProofTarget => {
  if (
    releasePullRequest?.headSha &&
    shaTreeSha &&
    releasePullRequestHeadTreeSha &&
    shaTreeSha === releasePullRequestHeadTreeSha
  ) {
    return {
      sha: releasePullRequest.headSha,
      source: 'release-pr-head',
      summary: 'Generated release PR head CI proof',
    };
  }

  return {
    sha,
    source: 'exact-sha',
    summary: 'Exact-SHA CI proof',
  };
};

const makeReport = (
  input: ReleasePolicyInput,
  options: {
    readonly autoEligible?: boolean;
    readonly blockers: readonly string[];
    readonly channel: ChannelIntent | undefined;
    readonly decision: ReleasePolicyDecision;
    readonly diagnostics: readonly string[];
    readonly publish?: PublishIntent | undefined;
    readonly reasons: readonly string[];
    readonly release: ReleaseIntent | undefined;
    readonly stack: StackIntent | undefined;
  }
): ReleasePolicyReport => {
  const canPublish =
    options.decision === 'auto' || options.decision === 'manual';
  const packagesPublished = registryComplete(input.registryPackages);
  const reasons = [...options.reasons];
  if (canPublish) {
    reasons.push(
      packagesPublished
        ? 'Registry package state already matches this release; npm publish will be skipped'
        : 'Registry package state is incomplete for this release; npm publish remains required'
    );
  }
  return {
    autoEligible: options.autoEligible ?? false,
    blockers: options.blockers,
    channel: options.channel,
    ciProof: readCiProofFromInput(input),
    createGitHubRelease: canPublish,
    decision: options.decision,
    diagnostics: options.diagnostics,
    publish: options.publish,
    reasons,
    release: options.release,
    shouldPublish: canPublish && !packagesPublished,
    stack: options.stack,
  };
};

const readLabelFamily = <T extends string>(
  labels: readonly string[],
  prefix: string,
  allowed: ReadonlySet<T>
): FamilyResult<T> => {
  const values = labels.filter((label) => label.startsWith(prefix));
  const known = values.filter((label): label is T => allowed.has(label as T));
  const unknown = values.filter((label) => !allowed.has(label as T));

  if (known.length > 1) {
    return {
      conflicts: [`Conflicting ${prefix} labels: ${known.join(', ')}`],
      unknown: unknown.map((label) => `Unknown ${prefix} label: ${label}`),
    };
  }

  const result: { conflicts: string[]; unknown: string[]; value?: T } = {
    conflicts: [],
    unknown: unknown.map((label) => `Unknown ${prefix} label: ${label}`),
  };
  const [value] = known;
  if (value) {
    result.value = value;
  }
  return result;
};

const registryComplete = (
  packages: readonly ReleasePolicyRegistryPackage[]
): boolean =>
  packages.length > 0 &&
  packages.every(
    (entry) =>
      entry.status === 'published' &&
      entry.expectedTagVersion === entry.version &&
      (entry.versionPublished ?? true)
  );

const registryBlockers = (
  packages: readonly ReleasePolicyRegistryPackage[],
  distTag: string
): readonly string[] =>
  packages.flatMap((entry) => {
    if (entry.status === 'inaccessible') {
      return [`${entry.name}: registry state is inaccessible`];
    }

    if (
      entry.status === 'published' &&
      entry.expectedTagVersion !== undefined &&
      entry.expectedTagVersion !== entry.version &&
      compareSemver(entry.expectedTagVersion, entry.version) > 0
    ) {
      return [
        `${entry.name}: dist-tag ${distTag} points to ${entry.expectedTagVersion}, expected ${entry.version}`,
      ];
    }

    if (
      entry.status === 'published' &&
      entry.versionPublished === true &&
      entry.expectedTagVersion !== entry.version
    ) {
      return [
        `${entry.name}: version ${entry.version} is already published but dist-tag ${distTag} points to ${entry.expectedTagVersion ?? '(missing)'}`,
      ];
    }

    return [];
  });

const evaluateAutoChecks = (
  input: ReleasePolicyInput,
  channel: ChannelIntent | undefined,
  release: ReleaseIntent | undefined,
  stack: StackIntent | undefined
) => {
  const diagnostics: string[] = [];
  const generatedDiff = evaluateGeneratedReleaseDiff(input.changedFiles);
  diagnostics.push(...generatedDiff.diagnostics);
  diagnostics.push(
    ...evaluateSourceStackEvidence(input.sourcePullRequests, stack)
  );

  if (input.repository !== 'outfitter-dev/trails') {
    diagnostics.push(
      `Expected repository outfitter-dev/trails, found ${input.repository}`
    );
  }

  if (input.ref !== 'refs/heads/main') {
    diagnostics.push(`Expected refs/heads/main, found ${input.ref}`);
  }

  const expectedChannel = channelIntentForDistTag(input.distTag);
  if (!expectedChannel) {
    diagnostics.push(
      `Unsupported release dist-tag for automation: ${input.distTag}`
    );
  } else if (channel !== expectedChannel) {
    diagnostics.push(
      `Expected ${expectedChannel} for npm dist-tag ${input.distTag}, found ${channel ?? 'no channel:* label'}`
    );
  }

  if (input.releasePullRequest) {
    if (input.releasePullRequest.headRefName !== 'changeset-release/main') {
      diagnostics.push(
        `Expected release PR head changeset-release/main, found ${input.releasePullRequest.headRefName}`
      );
    }
    if (input.releasePullRequest.baseRefName !== 'main') {
      diagnostics.push(
        `Expected release PR base main, found ${input.releasePullRequest.baseRefName}`
      );
    }
    if (input.releasePullRequest.title !== 'chore(release): version packages') {
      diagnostics.push(
        `Expected release PR title "chore(release): version packages", found "${input.releasePullRequest.title}"`
      );
    }
    if (input.releasePullRequest.userLogin !== 'github-actions[bot]') {
      diagnostics.push(
        `Expected release PR author github-actions[bot], found ${input.releasePullRequest.userLogin}`
      );
    }
  } else {
    diagnostics.push(
      'Could not resolve the release pull request for the current commit'
    );
  }

  if (
    !/^chore\(release\): version packages \(#\d+\)$/u.test(input.commit.subject)
  ) {
    diagnostics.push(
      `Expected squash commit subject chore(release): version packages (#<pr>), found "${input.commit.subject}"`
    );
  }

  if (
    !isGitHubActionsIdentity(input.commit.authorName, input.commit.authorEmail)
  ) {
    diagnostics.push(
      `Expected GitHub Actions bot author, found ${input.commit.authorName} <${input.commit.authorEmail}>`
    );
  }

  if (
    !isGitHubCommitter(input.commit.committerName, input.commit.committerEmail)
  ) {
    diagnostics.push(
      `Expected GitHub committer, found ${input.commit.committerName} <${input.commit.committerEmail}>`
    );
  }

  const expectedRelease = input.previousVersion
    ? releaseIntentForVersionDelta(input.previousVersion, input.version)
    : undefined;
  if (!input.previousVersion) {
    diagnostics.push(
      'Could not read previous @ontrails/trails package version'
    );
  } else if (!expectedRelease) {
    diagnostics.push(
      `Expected ${input.version} to be newer than previous version ${input.previousVersion}`
    );
  } else if (release && expectedRelease !== release) {
    diagnostics.push(
      `${release} is set, but ${input.previousVersion} -> ${input.version} looks like ${expectedRelease}`
    );
  }

  diagnostics.push(...evaluateCiProofEvidence(input));

  return { diagnostics, ok: diagnostics.length === 0 };
};

const evaluateCiProofEvidence = (
  input: ReleasePolicyInput
): readonly string[] => {
  const proof = readCiProofFromInput(input);
  if (proof?.passed) {
    return [];
  }
  return [
    proof
      ? `${proof.summary} has not passed`
      : 'CI proof has not been evaluated',
  ];
};

const readCiProofFromInput = (
  input: ReleasePolicyInput
): ReleasePolicyCiProof | undefined => {
  if (input.ciProof) {
    return input.ciProof;
  }
  if (input.ciPassed === undefined) {
    return undefined;
  }
  return {
    passed: input.ciPassed,
    source: 'exact-sha',
    summary: 'Exact-SHA CI proof',
  };
};

const readSourceStackLabels = (
  sourcePullRequests: readonly ReleasePolicySourcePullRequest[] | undefined
) => {
  if (!sourcePullRequests) {
    return { conflicts: [], unknown: [] };
  }
  const labels = sourcePullRequests.flatMap((pull) =>
    pull.labels
      .filter((label) => label.startsWith('stack:'))
      .map((label) => `${label} on #${pull.number}`)
  );
  const normalized = [
    ...new Set(labels.map((label) => label.split(' on #', 1)[0] ?? label)),
  ];
  const result = readLabelFamily(normalized, 'stack:', stackIntents);

  return {
    conflicts: result.conflicts.map(
      (conflict) => `${conflict} across source PRs`
    ),
    unknown: result.unknown.map((unknown) => {
      const label = unknown.replace('Unknown stack: label: ', '');
      const source = labels.find((candidate) => candidate.startsWith(label));
      return source ? `Unknown stack: label: ${source}` : unknown;
    }),
    value: result.value,
  };
};

const evaluateSourceStackEvidence = (
  sourcePullRequests: readonly ReleasePolicySourcePullRequest[] | undefined,
  stack: StackIntent | undefined
): readonly string[] => {
  if (!sourcePullRequests) {
    return [
      'Could not resolve source PR stack evidence for the generated release',
    ];
  }

  const changesetPulls = sourcePullRequests.filter((pull) => pull.hasChangeset);
  if (changesetPulls.length === 0) {
    return [
      'Could not find a source PR that introduced a consumed .changeset/*.md file',
    ];
  }

  const missingBoundary = changesetPulls.filter(
    (pull) => !pull.labels.includes('stack:boundary')
  );
  if (stack !== 'stack:boundary' || missingBoundary.length > 0) {
    return [
      `publish:auto requires stack:boundary on every changeset source PR in the release range; missing: ${missingBoundary
        .map((pull) => `#${pull.number}`)
        .join(', ')}`,
    ];
  }

  return [];
};

const evaluateGeneratedReleaseDiff = (
  changedFiles: readonly ReleasePolicyChangedFile[]
) => {
  const diagnostics: string[] = [];
  let hasChangesetDeletion = false;
  let hasPackageVersionFile = false;

  for (const file of changedFiles) {
    if (file.path === '.changeset/pre.json' && file.status === 'M') {
      continue;
    }

    if (/^\.changeset\/[^/]+\.md$/u.test(file.path) && file.status === 'D') {
      hasChangesetDeletion = true;
      continue;
    }

    if (
      /^packages\/[^/]+\/(?:CHANGELOG\.md|package\.json)$/u.test(file.path) &&
      file.status === 'M'
    ) {
      hasPackageVersionFile = true;
      continue;
    }

    if (
      /^adapters\/[^/]+\/(?:CHANGELOG\.md|package\.json)$/u.test(file.path) &&
      file.status === 'M'
    ) {
      hasPackageVersionFile = true;
      continue;
    }

    if (
      /^apps\/trails\/(?:CHANGELOG\.md|package\.json)$/u.test(file.path) &&
      file.status === 'M'
    ) {
      hasPackageVersionFile = true;
      continue;
    }

    diagnostics.push(
      `Unexpected release diff entry: ${file.status ?? '?'} ${file.path}`
    );
  }

  if (!hasPackageVersionFile) {
    diagnostics.push(
      'Generated release diff did not modify package.json or CHANGELOG.md files'
    );
  }
  if (!hasChangesetDeletion) {
    diagnostics.push(
      'Generated release diff did not delete a consumed .changeset/*.md file'
    );
  }

  return { diagnostics, ok: diagnostics.length === 0 };
};

const hasPublishNoneReason = (
  pr: ReleasePolicyPullRequest | undefined
): boolean => {
  if (!pr) {
    return false;
  }
  const texts = [pr.body, ...pr.comments].map((text) => text.toLowerCase());
  return texts.some(
    (text) =>
      text.includes('publish:none') &&
      /(because|intentional|reason|skip|no publish)/u.test(text)
  );
};

const hasLabelFamily = (
  labels: ReadonlySet<string>,
  prefix: string
): boolean => {
  for (const label of labels) {
    if (label.startsWith(prefix)) {
      return true;
    }
  }
  return false;
};

const isGitHubActionsIdentity = (name: string, email: string): boolean =>
  name === 'github-actions[bot]' &&
  email === '41898282+github-actions[bot]@users.noreply.github.com';

const isGitHubCommitter = (name: string, email: string): boolean =>
  name === 'GitHub' && email === 'noreply@github.com';

export const releaseIntentForVersionDelta = (
  previousVersion: string,
  nextVersion: string
): ReleaseIntent | undefined => {
  const previous = parseSemver(previousVersion);
  const next = parseSemver(nextVersion);
  if (!previous || !next) {
    return undefined;
  }
  if (compareSemver(nextVersion, previousVersion) <= 0) {
    return undefined;
  }
  if (next.major !== previous.major) {
    return 'release:major';
  }
  if (next.minor !== previous.minor) {
    return 'release:minor';
  }
  if (
    next.patch !== previous.patch ||
    next.prerelease !== previous.prerelease
  ) {
    return 'release:patch';
  }
  return undefined;
};

const compareSemver = (leftVersion: string, rightVersion: string): number => {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) {
    return leftVersion.localeCompare(rightVersion);
  }

  for (const key of ['major', 'minor', 'patch'] as const) {
    const delta = left[key] - right[key];
    if (delta !== 0) {
      return delta;
    }
  }

  if (left.prerelease === right.prerelease) {
    return 0;
  }
  if (!left.prerelease) {
    return 1;
  }
  if (!right.prerelease) {
    return -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
};

const comparePrerelease = (leftValue: string, rightValue: string): number => {
  const left = parsePrerelease(leftValue);
  const right = parsePrerelease(rightValue);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart - rightPart;
    }
    if (typeof leftPart === 'number') {
      return -1;
    }
    if (typeof rightPart === 'number') {
      return 1;
    }
    const delta = leftPart.localeCompare(rightPart);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
};

const parsePrerelease = (value: string): (number | string)[] =>
  value
    .split('.')
    .map((part) => (/^[0-9]+$/u.test(part) ? Number.parseInt(part, 10) : part));

const parseSemver = (version: string) => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u);
  if (!match) {
    return;
  }
  const [, major, minor, patch, prerelease] = match;
  if (!major || !minor || !patch) {
    return;
  }
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    prerelease,
  };
};

const writeGitHubOutput = async (
  values: Record<string, boolean | number | string | undefined>
): Promise<void> => {
  const outputPath = process.env['GITHUB_OUTPUT'];
  if (!outputPath) {
    return;
  }
  const lines = Object.entries(values).map(
    ([key, value]) => `${key}=${value ?? ''}`
  );
  await Bun.write(outputPath, `${lines.join('\n')}\n`);
};

const printReport = (report: ReleasePolicyReport): void => {
  console.error(`trails: release policy decision is ${report.decision}`);
  for (const reason of report.reasons) {
    console.error(`trails: ${reason}`);
  }
  for (const diagnostic of report.diagnostics) {
    console.error(`trails: policy diagnostic: ${diagnostic}`);
  }
  for (const blocker of report.blockers) {
    console.error(`trails: policy blocker: ${blocker}`);
  }
};

const runText = async (
  command: readonly string[],
  options: { readonly allowFailure?: boolean } = {}
): Promise<string> => {
  const subprocess = Bun.spawn([...command], {
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  if (exitCode !== 0) {
    if (options.allowFailure) {
      return '';
    }
    throw new Error(`${command.join(' ')} failed: ${stderr.trim()}`);
  }

  return stdout.trim();
};

const readCommitInfo = async (): Promise<ReleasePolicyCommit> => {
  const output = await runText([
    'git',
    'log',
    '-1',
    '--format=%an%n%ae%n%cn%n%ce%n%s',
  ]);
  const [authorName, authorEmail, committerName, committerEmail, ...subject] =
    output.split('\n');
  if (!authorName || !authorEmail || !committerName || !committerEmail) {
    throw new Error('Could not read current commit identity');
  }
  return {
    authorEmail,
    authorName,
    committerEmail,
    committerName,
    subject: subject.join('\n'),
  };
};

const readChangedFiles = async (): Promise<ReleasePolicyChangedFile[]> => {
  const parentExists = await runText(
    ['git', 'rev-parse', '--verify', 'HEAD^'],
    {
      allowFailure: true,
    }
  );
  if (!parentExists) {
    return [];
  }
  const output = await runText([
    'git',
    'diff',
    '--name-status',
    'HEAD^',
    'HEAD',
  ]);
  if (!output) {
    return [];
  }
  return output.split('\n').map((line) => {
    const [status, path] = line.split(/\s+/, 2);
    if (!status || !path) {
      throw new Error(`Could not parse git diff entry: ${line}`);
    }
    return { path, status };
  });
};

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
}

const readTrailsPackageVersion = async (ref = 'HEAD'): Promise<string> => {
  const raw =
    ref === 'HEAD'
      ? await readFile(join(repoRoot, 'apps', 'trails', 'package.json'), 'utf8')
      : await runText(['git', 'show', `${ref}:apps/trails/package.json`], {
          allowFailure: true,
        });
  if (!raw) {
    return '';
  }
  const packageJson = JSON.parse(raw) as PackageJson;
  return packageJson.version ?? '';
};

const readPreviousVersion = async (): Promise<string | undefined> => {
  const version = await readTrailsPackageVersion('HEAD^');
  return version || undefined;
};

const distTagForVersion = async (version: string): Promise<string> => {
  if (!version.includes('-')) {
    return 'latest';
  }

  const prePath = join(repoRoot, '.changeset', 'pre.json');
  if (await Bun.file(prePath).exists()) {
    const pre = (await Bun.file(prePath).json()) as {
      readonly mode?: string;
      readonly tag?: string;
    };
    if (pre.mode === 'pre' && pre.tag) {
      return pre.tag;
    }
  }
  return version.includes('-')
    ? (version.split('-')[1]?.split('.')[0] ?? 'latest')
    : 'latest';
};

const registryPackagesFromResults = async (
  results: readonly RegistryResult[]
): Promise<readonly ReleasePolicyRegistryPackage[]> =>
  Promise.all(
    results.map(async (result) => {
      const versionPublished =
        result.status === 'published'
          ? await readPackageVersionPublished(
              result.name,
              result.workspaceVersion
            )
          : false;

      if (result.status === 'published') {
        return {
          expectedTagVersion: result.expectedTagVersion,
          name: result.name,
          status: 'published',
          version: result.workspaceVersion,
          versionPublished,
        };
      }
      return {
        name: result.name,
        status: result.status,
        version: result.workspaceVersion,
        versionPublished,
      };
    })
  );

const readPackageVersionPublished = async (
  name: string,
  version: string
): Promise<boolean> => {
  const subprocess = Bun.spawn(
    ['npm', 'view', `${name}@${version}`, 'version', '--json'],
    {
      cwd: repoRoot,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  if (exitCode === 0) {
    return JSON.parse(stdout.trim()) === version;
  }

  const combined = `${stdout}\n${stderr}`;
  if (combined.includes('E404') || combined.includes('404 Not Found')) {
    return false;
  }

  throw new Error(stderr.trim() || `npm view failed for ${name}@${version}`);
};

const readRegistryPackages = async (
  distTag: string
): Promise<readonly ReleasePolicyRegistryPackage[]> => {
  const { checkRegistryPosture, npmRegistryView } =
    await import('./native-bun-registry.js');
  const workspaces = await discoverRegistryWorkspaces(repoRoot);
  const results = await checkRegistryPosture(
    workspaces,
    npmRegistryView,
    distTag
  );
  return registryPackagesFromResults(results);
};

const githubJson = async <T>(repository: string, path: string): Promise<T> => {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (process.env['GITHUB_TOKEN']) {
    headers['authorization'] = `Bearer ${process.env['GITHUB_TOKEN']}`;
  }
  const response = await fetch(
    `https://api.github.com/repos/${repository}${path}`,
    {
      headers,
    }
  );
  if (!response.ok) {
    throw new Error(
      `GitHub API request failed for ${path}: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as T;
};

interface GitHubPullRequest {
  readonly base: { readonly ref: string };
  readonly body?: string | null;
  readonly head: { readonly ref: string; readonly sha?: string };
  readonly labels: readonly { readonly name: string }[];
  readonly number: number;
  readonly title: string;
  readonly user: { readonly login: string };
}

interface GitHubComment {
  readonly body?: string | null;
}

interface GitHubContentFile {
  readonly content: string;
}

interface GitHubCommitResponse {
  readonly commit: { readonly tree?: { readonly sha?: string } };
}

interface GitHubCheckRunsResponse {
  readonly check_runs: readonly ReleasePolicyCheckRun[];
}

const managedGitHubLabels = [
  {
    color: '0e8a16',
    description:
      'Generated release PR may publish automatically after policy checks pass.',
    name: 'publish:auto',
  },
  {
    color: 'fbca04',
    description:
      'Generated release PR requires protected manual publish approval.',
    name: 'publish:manual',
  },
  {
    color: 'cfd3d7',
    description:
      'Generated release PR intentionally skips npm and GitHub release publication.',
    name: 'publish:none',
  },
  {
    color: 'b60205',
    description: 'Generated release PR is blocked from publishing.',
    name: 'publish:block',
  },
  {
    color: '1d76db',
    description:
      'Release publishes prerelease packages to the beta npm dist-tag.',
    name: 'channel:beta',
  },
  {
    color: '5319e7',
    description:
      'Release publishes stable packages to the latest npm dist-tag.',
    name: 'channel:stable',
  },
  {
    color: 'c2e0c6',
    description:
      'Release changes package versions by a patch-sized semver movement.',
    name: 'release:patch',
  },
  {
    color: 'bfdadc',
    description:
      'Release changes package versions by a minor-sized semver movement.',
    name: 'release:minor',
  },
  {
    color: 'f9d0c4',
    description:
      'Release changes package versions by a major-sized semver movement.',
    name: 'release:major',
  },
  {
    color: 'd4c5f9',
    description:
      'Source PR is a stack boundary with complete release evidence.',
    name: 'stack:boundary',
  },
] as const;

const readReleasePullRequest = async (
  repository: string,
  sha: string
): Promise<ReleasePolicyPullRequest | undefined> => {
  const pulls = await githubJson<GitHubPullRequest[]>(
    repository,
    `/commits/${sha}/pulls`
  );
  const pull = pulls.find((candidate) => candidate.base.ref === 'main');
  if (!pull) {
    return undefined;
  }
  const comments = await githubJson<GitHubComment[]>(
    repository,
    `/issues/${pull.number}/comments`
  );
  return {
    baseRefName: pull.base.ref,
    body: pull.body ?? '',
    comments: comments.map((comment) => comment.body ?? ''),
    headRefName: pull.head.ref,
    ...(pull.head.sha === undefined ? {} : { headSha: pull.head.sha }),
    labels: pull.labels.map((label) => label.name),
    number: pull.number,
    title: pull.title,
    userLogin: pull.user.login,
  };
};

const readOpenReleasePullRequest = async (
  repository: string
): Promise<ReleasePolicyPullRequest | undefined> => {
  const pulls = await githubJson<GitHubPullRequest[]>(
    repository,
    '/pulls?state=open&base=main&per_page=100'
  );
  const pull = pulls.find(
    (candidate) => candidate.head.ref === 'changeset-release/main'
  );
  if (!pull) {
    return undefined;
  }
  return {
    baseRefName: pull.base.ref,
    body: pull.body ?? '',
    comments: [],
    headRefName: pull.head.ref,
    ...(pull.head.sha === undefined ? {} : { headSha: pull.head.sha }),
    labels: pull.labels.map((label) => label.name),
    number: pull.number,
    title: pull.title,
    userLogin: pull.user.login,
  };
};

const readPackageVersionFromRef = async (
  repository: string,
  ref: string
): Promise<string> => {
  const file = await githubJson<GitHubContentFile>(
    repository,
    `/contents/apps/trails/package.json?ref=${encodeURIComponent(ref)}`
  );
  const packageJson = JSON.parse(
    Buffer.from(file.content, 'base64').toString('utf8')
  ) as PackageJson;
  if (!packageJson.version) {
    throw new Error(`Missing version in apps/trails/package.json at ${ref}`);
  }
  return packageJson.version;
};

const ensureGitHubLabels = async (repository: string): Promise<void> => {
  await Promise.all(
    managedGitHubLabels.map((label) =>
      runText([
        'gh',
        'label',
        'create',
        label.name,
        '--repo',
        repository,
        '--color',
        label.color,
        '--description',
        label.description,
        '--force',
      ])
    )
  );
};

const readCommitChangedFiles = async (
  commitSha: string
): Promise<ReleasePolicyChangedFile[]> => {
  const output = await runText([
    'git',
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-r',
    commitSha,
  ]);
  if (!output) {
    return [];
  }
  return output.split('\n').map((line) => {
    const [status, path] = line.split(/\s+/, 2);
    if (!status || !path) {
      throw new Error(`Could not parse git diff entry: ${line}`);
    }
    return { path, status };
  });
};

const readSourcePullRequests = async (
  repository: string,
  previousVersion: string,
  endRef = 'HEAD^'
): Promise<readonly ReleasePolicySourcePullRequest[] | undefined> => {
  const previousVersionCommit = await runText([
    'git',
    'log',
    '-n',
    '1',
    '--format=%H',
    '-S',
    `"version": "${previousVersion}"`,
    endRef,
    '--',
    'apps/trails/package.json',
  ]);
  if (!previousVersionCommit) {
    return undefined;
  }

  const output = await runText([
    'git',
    'rev-list',
    '--reverse',
    `${previousVersionCommit}..${endRef}`,
  ]);
  if (!output) {
    return [];
  }

  const byNumber = new Map<number, ReleasePolicySourcePullRequest>();
  for (const commitSha of output.split('\n')) {
    const changedFiles = await readCommitChangedFiles(commitSha);
    const hasChangeset = changedFiles.some(
      (file) =>
        /^\.changeset\/[^/]+\.md$/u.test(file.path) && file.status !== 'D'
    );
    const pulls = await githubJson<GitHubPullRequest[]>(
      repository,
      `/commits/${commitSha}/pulls`
    );
    const [pull] = pulls;

    if (!pull) {
      byNumber.set(-byNumber.size - 1, {
        commitShas: [commitSha],
        hasChangeset,
        labels: [],
        number: 0,
        title: `Unresolved source commit ${commitSha.slice(0, 7)}`,
      });
      continue;
    }

    const existing = byNumber.get(pull.number);
    if (existing) {
      byNumber.set(pull.number, {
        ...existing,
        commitShas: [...existing.commitShas, commitSha],
        hasChangeset: existing.hasChangeset || hasChangeset,
      });
      continue;
    }

    byNumber.set(pull.number, {
      commitShas: [commitSha],
      hasChangeset,
      labels: pull.labels.map((label) => label.name),
      number: pull.number,
      title: pull.title,
    });
  }

  return [...byNumber.values()];
};

const readCiProof = async (
  repository: string,
  sha: string,
  releasePullRequest: ReleasePolicyPullRequest | undefined
): Promise<ReleasePolicyCiProof> => {
  if (process.env['TRAILS_RELEASE_POLICY_ASSUME_CI_PASSED'] === '1') {
    return {
      passed: true,
      source: 'assumed',
      summary: 'Assumed CI proof',
    };
  }

  const [shaTreeSha, releasePullRequestHeadTreeSha] = await Promise.all([
    readCommitTreeSha(repository, sha),
    releasePullRequest?.headSha
      ? readCommitTreeSha(repository, releasePullRequest.headSha)
      : undefined,
  ]);
  const target = selectReleasePolicyCiProofTarget({
    releasePullRequest,
    releasePullRequestHeadTreeSha,
    sha,
    shaTreeSha,
  });
  const attempts = Number.parseInt(
    process.env['TRAILS_RELEASE_POLICY_CI_ATTEMPTS'] ?? '1',
    10
  );
  const waitMs = Number.parseInt(
    process.env['TRAILS_RELEASE_POLICY_CI_WAIT_MS'] ?? '0',
    10
  );

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const state = await readCiState(repository, target.sha);
    if (state === 'passed') {
      return {
        passed: true,
        source: target.source,
        summary: target.summary,
      };
    }
    if (state === 'failed') {
      return {
        passed: false,
        source: target.source,
        summary: target.summary,
      };
    }
    if (attempt < attempts && waitMs > 0) {
      console.error(
        `trails: waiting for ${target.summary.toLowerCase()} (${attempt}/${attempts})`
      );
      await Bun.sleep(waitMs);
    }
  }

  return {
    passed: false,
    source: target.source,
    summary: target.summary,
  };
};

const readCommitTreeSha = async (
  repository: string,
  sha: string
): Promise<string | undefined> => {
  try {
    const response = await githubJson<GitHubCommitResponse>(
      repository,
      `/commits/${sha}`
    );
    return response.commit.tree?.sha;
  } catch {
    return undefined;
  }
};

const readCiState = async (
  repository: string,
  sha: string
): Promise<'failed' | 'passed' | 'pending'> => {
  const response = await githubJson<GitHubCheckRunsResponse>(
    repository,
    `/commits/${sha}/check-runs?per_page=100`
  );
  return ciStateFromCheckRuns(response.check_runs);
};

export const ciStateFromCheckRuns = (
  runs: readonly ReleasePolicyCheckRun[]
): 'failed' | 'passed' | 'pending' => {
  const requiredNames = [
    'Build',
    'Lint & Format',
    'Dead Code',
    'Typecheck',
    'Test',
    'Governance',
  ] as const;
  const relevantRuns = runs
    .filter((run) => run.check_suite?.app?.slug === 'github-actions')
    .filter((run) =>
      requiredNames.includes(run.name as (typeof requiredNames)[number])
    );

  for (const name of requiredNames) {
    const namedRuns = relevantRuns.filter((run) => run.name === name);
    if (namedRuns.length === 0) {
      return 'pending';
    }
    if (
      namedRuns.some(
        (run) => run.status === 'completed' && run.conclusion !== 'success'
      )
    ) {
      return 'failed';
    }
    if (
      !namedRuns.some(
        (run) => run.status === 'completed' && run.conclusion === 'success'
      )
    ) {
      return 'pending';
    }
  }
  return 'passed';
};

const readPolicyInput = async (): Promise<ReleasePolicyInput> => {
  const version = await readTrailsPackageVersion();
  const distTag = await distTagForVersion(version);
  const repository =
    process.env['GITHUB_REPOSITORY'] ??
    (await runText([
      'gh',
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ]));
  const ref =
    process.env['GITHUB_REF'] ??
    `refs/heads/${await runText(['git', 'branch', '--show-current'])}`;
  const sha =
    process.env['GITHUB_SHA'] ?? (await runText(['git', 'rev-parse', 'HEAD']));
  const previousVersion = await readPreviousVersion();
  const registryPackages = await readRegistryPackages(distTag);
  const [releasePullRequest, commit, changedFiles] = await Promise.all([
    readReleasePullRequest(repository, sha),
    readCommitInfo(),
    readChangedFiles(),
  ]);
  const sourcePullRequests = previousVersion
    ? await readSourcePullRequests(repository, previousVersion)
    : undefined;

  return {
    changedFiles,
    commit,
    distTag,
    ...(previousVersion === undefined ? {} : { previousVersion }),
    ref,
    registryPackages,
    ...(releasePullRequest === undefined ? {} : { releasePullRequest }),
    repository,
    sha,
    ...(sourcePullRequests === undefined ? {} : { sourcePullRequests }),
    version,
  };
};

const commandPolicy = async (): Promise<void> => {
  let input = await readPolicyInput();
  let report = releasePolicyRequiresCiProof(input)
    ? evaluateReleasePolicy({
        ...input,
        ciProof: {
          passed: true,
          source: 'missing',
          summary: 'Deferred CI proof',
        },
      })
    : evaluateReleasePolicy(input);

  if (report.decision === 'auto') {
    input = {
      ...input,
      ciProof: await readCiProof(
        input.repository,
        input.sha,
        input.releasePullRequest
      ),
    };
    report = evaluateReleasePolicy(input);
  }

  printReport(report);
  await writeGitHubOutput({
    channel: report.channel ?? '',
    create_github_release: report.createGitHubRelease,
    decision: report.decision,
    publish: report.publish ?? '',
    release: report.release ?? '',
    should_publish: report.shouldPublish,
    tag: input.distTag,
    version: input.version,
  });
  if (report.decision === 'block') {
    throw new Error(
      `Release policy blocked publish: ${report.blockers.join('; ')}`
    );
  }
};

const commandLabelReleasePr = async (): Promise<void> => {
  const currentVersion = await readTrailsPackageVersion();
  const repository =
    process.env['GITHUB_REPOSITORY'] ??
    (await runText([
      'gh',
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ]));
  const releasePullRequest = await readOpenReleasePullRequest(repository);

  if (!releasePullRequest) {
    console.error('trails: no open changeset-release/main pull request found');
    return;
  }

  const nextVersion = await readPackageVersionFromRef(
    repository,
    releasePullRequest.headRefName
  );
  const nextDistTag = await distTagForVersion(nextVersion);
  const sourcePullRequests = await readSourcePullRequests(
    repository,
    currentVersion,
    'HEAD'
  );
  const labelsToAdd = labelsForReleasePullRequest({
    currentVersion,
    existingLabels: releasePullRequest.labels,
    nextDistTag,
    nextVersion,
    ...(sourcePullRequests === undefined ? {} : { sourcePullRequests }),
  });

  if (labelsToAdd.length === 0) {
    console.error(
      `trails: release PR #${releasePullRequest.number} already has release intent labels`
    );
    return;
  }

  await ensureGitHubLabels(repository);

  for (const label of labelsToAdd) {
    await runText([
      'gh',
      'issue',
      'edit',
      String(releasePullRequest.number),
      '--repo',
      repository,
      '--add-label',
      label,
    ]);
  }

  console.error(
    `trails: added ${labelsToAdd.join(', ')} to release PR #${releasePullRequest.number}`
  );
};

export const runReleasePolicyCli = async (
  args: readonly string[] = process.argv.slice(2)
): Promise<number> => {
  const [command = 'policy'] = args;
  try {
    if (command === 'policy') {
      await commandPolicy();
      return 0;
    }
    if (command === 'label-release-pr') {
      await commandLabelReleasePr();
      return 0;
    }
    throw new Error(`Unknown release policy command: ${command}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};

if (import.meta.main) {
  process.exit(await runReleasePolicyCli(process.argv.slice(2)));
}
