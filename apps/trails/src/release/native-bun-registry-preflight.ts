/* oxlint-disable max-statements -- release preflight CLI with explicit reporting */
import { join, resolve } from 'node:path';

import {
  checkRegistryPosture,
  classifyPackageRegistryState,
  createNpmRegistryVersionProofView,
  createNpmRegistryView,
  discoverRegistryWorkspaces,
  factsFromRegistryResult,
  formatDistTagSummary,
  registryPostureErrors,
  runNpmRegistryCommand,
} from './native-bun-registry.js';
import type {
  RegistryPreflightOptions,
  RegistryResult,
  RegistryVersionProof,
  RegistryVersionView,
  RegistryView,
  RegistryWorkspace,
} from './native-bun-registry.js';

const REPO_ROOT = resolve(process.cwd());

interface RegistryVerificationRuntime {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly timeoutMs: number;
}

interface RegistryVerificationReport {
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly results: readonly RegistryResult[];
  readonly state: 'complete' | 'failed' | 'timeout';
}

type RegistryProbe = (
  workspaces: readonly RegistryWorkspace[],
  signal?: AbortSignal
) => Promise<RegistryResult[]>;

const verificationRuntime: RegistryVerificationRuntime = {
  now: () => performance.now(),
  sleep: async (ms) => {
    await Bun.sleep(ms);
  },
  timeoutMs: 120_000,
};

const USAGE = `Usage: bun scripts/check-registry-preflight.ts [options]

Read-only npm registry preflight for public @ontrails/* workspaces.

Options:
  --tag <tag>            Expected npm dist-tag. Defaults to .changeset/pre.json
                         tag while in prerelease mode, otherwise "latest".
  --require-published    Fail when any workspace package is missing from npm.
                         Use after publication to require exact metadata or
                         equivalent consumer package-fetch proof. Wait up to
                         two minutes for missing metadata or lagging tags.
  -h, --help             Show this help and exit.

Exit codes: 0 success, 1 registry posture failure, 2 arg-parse error.`;

const parseArgs = (argv: readonly string[]): RegistryPreflightOptions => {
  let requirePublished = false;
  let tag: string | undefined;

  const needsValue = (flag: string, value: string | undefined): string => {
    if (value === undefined || value.startsWith('--')) {
      console.error(`${flag} requires a value`);
      console.error(USAGE);
      process.exit(2);
    }
    return value;
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] as string;
    if (arg === '--require-published') {
      requirePublished = true;
    } else if (arg === '--tag') {
      i += 1;
      tag = needsValue('--tag', argv[i]);
    } else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error(USAGE);
      process.exit(2);
    }
    i += 1;
  }

  return { requirePublished, tag };
};

const resolveDefaultTag = async (): Promise<string> => {
  const prePath = join(REPO_ROOT, '.changeset', 'pre.json');
  if (!(await Bun.file(prePath).exists())) {
    return 'latest';
  }
  const pre = (await Bun.file(prePath).json()) as {
    mode?: string;
    tag?: string;
  };
  if (pre.mode !== 'pre') {
    return 'latest';
  }
  if (typeof pre.tag === 'string' && pre.tag.length > 0) {
    return pre.tag;
  }
  throw new Error(`${prePath} is in prerelease mode but has no tag`);
};

const formatTargetVersionStatus = (
  proof: RegistryVersionProof | undefined,
  versionPublished: boolean | undefined
): string => {
  if (proof?.kind === 'exact-metadata') {
    return 'exact-version metadata available';
  }
  if (proof?.kind === 'consumer-pack') {
    return 'exact-version metadata unavailable, consumer pack available';
  }
  if (proof?.kind === 'unavailable') {
    return 'exact-version metadata and consumer pack unavailable';
  }
  if (versionPublished === true) {
    return 'target version published';
  }
  if (versionPublished === false) {
    return 'target version not published yet';
  }
  return 'target version publish state unknown';
};

const printResults = (
  results: readonly RegistryResult[],
  expectedTag: string
): void => {
  console.log(`Registry preflight for dist-tag "${expectedTag}"`);
  for (const result of results) {
    if (result.status === 'published') {
      const targetStatus = formatTargetVersionStatus(
        result.versionProof,
        result.versionPublished
      );
      console.log(
        `✓ ${result.name}@${result.workspaceVersion}: package exists, ${targetStatus} (registry version ${result.version}, expected ${expectedTag}=${result.expectedTagVersion ?? 'missing'}, tags ${formatDistTagSummary(result.distTags)})`
      );
    } else if (result.status === 'missing') {
      console.log(
        `• ${result.name}@${result.workspaceVersion}: first-time package candidate (not found on registry)`
      );
    } else {
      console.log(`✗ ${result.name}: registry probe failed: ${result.error}`);
    }
  }
};

/**
 * Wait for npm observations to converge after publication, retaining complete
 * package proofs. The shared registry classifier remains the verdict owner;
 * only missing versions/packages and lagging tags earn another read-only probe.
 * The internal runtime seam makes the deadline and backoff testable without
 * exposing release tuning flags or sleeping through regression tests.
 */
export const verifyPublishedRegistry = async (
  workspaces: readonly RegistryWorkspace[],
  expectedTag: string,
  probe: RegistryProbe,
  runtime: RegistryVerificationRuntime = verificationRuntime
): Promise<RegistryVerificationReport> => {
  const start = runtime.now();
  const deadline = start + runtime.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.timeoutMs);
  const results = new Map<string, RegistryResult>();
  let pending = workspaces;
  let attempts = 0;
  let delayMs = 5000;
  const report = (
    state: RegistryVerificationReport['state']
  ): RegistryVerificationReport => ({
    attempts,
    elapsedMs: runtime.now() - start,
    results: [...results.values()],
    state,
  });

  try {
    while (pending.length > 0) {
      if (controller.signal.aborted || runtime.now() >= deadline) {
        controller.abort();
        return report('timeout');
      }
      attempts += 1;
      const observed = await probe(pending, controller.signal);
      const timedOut = controller.signal.aborted || runtime.now() >= deadline;
      for (const result of observed) {
        // Aborting npm must not erase the last useful propagation evidence.
        if (
          timedOut &&
          result.status === 'inaccessible' &&
          results.has(result.name)
        ) {
          continue;
        }
        results.set(result.name, result);
      }
      const pendingNames = new Set(
        observed
          .filter(
            (result) =>
              classifyPackageRegistryState(
                factsFromRegistryResult(result, expectedTag)
              ).kind !== 'complete'
          )
          .map(({ name }) => name)
      );
      pending = pending.filter(({ name }) => pendingNames.has(name));
      if (pending.length === 0) {
        return report('complete');
      }
      if (timedOut) {
        controller.abort();
        return report('timeout');
      }
      if (
        registryPostureErrors(observed, expectedTag, 'ready').length > 0 ||
        observed.some(
          (result) =>
            result.status === 'published' &&
            factsFromRegistryResult(result, expectedTag).versionPublished ===
              undefined
        )
      ) {
        return report('failed');
      }
      const waitMs = Math.min(delayMs, deadline - runtime.now());
      console.log(
        `Waiting for registry propagation: ${pending.length}/${workspaces.length} packages pending; retrying in ${waitMs / 1000}s (${pending.map(({ name }) => name).join(', ')}).`
      );
      await runtime.sleep(waitMs);
      delayMs = Math.min(delayMs * 2, 30_000);
    }
    return report('complete');
  } finally {
    clearTimeout(timer);
  }
};

const createRegistryProbe =
  (
    expectedTag: string,
    view: RegistryView | undefined,
    versionView: RegistryVersionView | undefined
  ): RegistryProbe =>
  async (workspaces, signal) => {
    if (view !== undefined) {
      return versionView === undefined
        ? checkRegistryPosture(workspaces, view, expectedTag)
        : checkRegistryPosture(workspaces, view, versionView, expectedTag);
    }
    const runNpm = (args: readonly string[]) =>
      runNpmRegistryCommand(args, signal);
    return checkRegistryPosture(
      workspaces,
      createNpmRegistryView(runNpm),
      createNpmRegistryVersionProofView(runNpm),
      expectedTag
    );
  };

/** Run the read-only readiness check or bounded post-publish verification. */
export const runRegistryPreflight = async (
  options: RegistryPreflightOptions,
  view?: RegistryView,
  versionView?: RegistryVersionView
): Promise<number> => {
  const expectedTag = options.tag ?? (await resolveDefaultTag());
  const workspaces = await discoverRegistryWorkspaces();
  const probe = createRegistryProbe(expectedTag, view, versionView);
  const verification = options.requirePublished
    ? await verifyPublishedRegistry(workspaces, expectedTag, probe)
    : undefined;
  const results = verification?.results ?? (await probe(workspaces));
  printResults(results, expectedTag);
  const errors = registryPostureErrors(
    results,
    expectedTag,
    options.requirePublished ? 'published' : 'ready'
  );
  if (verification?.state === 'timeout') {
    console.error(
      `\nPost-publish registry verification timed out after ${Math.round(verification.elapsedMs / 1000)}s (${verification.attempts} probes). No publication was retried. Inspect the remaining registry observations before recovery.`
    );
  } else if (errors.length > 0) {
    console.error(
      options.requirePublished
        ? '\nPost-publish registry verification failed; no publication was retried:'
        : '\nRegistry preflight failed:'
    );
  }
  if (errors.length > 0 || verification?.state === 'timeout') {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }
  console.log('\nRegistry preflight passed.');
  return 0;
};

export const runRegistryPreflightCli = async (
  args: readonly string[] = process.argv.slice(2)
): Promise<number> => {
  try {
    return await runRegistryPreflight(parseArgs(args));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};

if (import.meta.main) {
  process.exit(await runRegistryPreflightCli(process.argv.slice(2)));
}
