/**
 * `warden` trail -- Governance checks.
 *
 * Thin wrapper around the shared @ontrails/warden command surface.
 */

import { posix } from 'node:path';

import { Result, trail, ValidationError } from '@ontrails/core';
import {
  diagnosticSchema,
  runWardenCommand,
  wardenDepthValues,
  wardenDraftsValues,
  wardenFailOnValues,
  wardenFormatValues,
  wardenLockValues,
} from '@ontrails/warden';
import type {
  EffectiveWardenConfig,
  WardenExpectedAppBinding,
  WardenTopoDriftResult,
} from '@ontrails/warden';
import { deriveWorkspaceView } from '@ontrails/topography';
import { z } from 'zod';

import {
  createIsolatedExampleRoot,
  writeIsolatedExampleTextFile,
} from '../local-state-io.js';

import {
  assertObservableProjectApps,
  resolveOperatorProjectContext,
} from './project-context.js';
import type {
  OperatorProjectApp,
  OperatorProjectContext,
} from './project-context.js';
import {
  operatorProjectContextOutput,
  operatorProjectContextOutputSchema,
} from './project-context-output.js';
import type { OperatorProjectContextOutput } from './project-context-output.js';

const wardenWorkspaceAppEvidenceSchema = z.object({
  appId: z.string(),
  appRoot: z.string(),
  artifactPath: z.string(),
  binding: z.enum(['matched', 'unobserved']),
  blockedReason: z.string().optional(),
  committedHash: z.string().nullable().optional(),
  currentHash: z.string().optional(),
  freshness: z.enum(['fresh', 'stale', 'unavailable', 'unobserved']),
  modulePath: z.string(),
  moduleSource: z.enum(['config', 'convention', 'module']),
  provenance: z.literal('warden-app-drift'),
  status: z.enum(['available', 'missing', 'unobserved']),
});

const wardenWorkspaceEvidenceSchema = z.object({
  apps: z.array(wardenWorkspaceAppEvidenceSchema).readonly(),
  completeness: z.enum(['complete', 'partial']),
});

type WardenWorkspaceEvidence = z.output<typeof wardenWorkspaceEvidenceSchema>;

const assertWardenArtifactBindings = async (
  context: OperatorProjectContext
): Promise<Result<void, ValidationError>> => {
  if (context.identity.workspace === undefined) {
    return Result.ok();
  }
  const selectedAppIds =
    context.selectedExtent === 'workspace'
      ? context.apps.map((app) => app.id as string)
      : [context.app.id as string];
  try {
    const view = await deriveWorkspaceView({
      identity: context.identity,
      selectedAppIds,
    });
    const invalid = view.evidence.apps.filter(
      (app) =>
        selectedAppIds.includes(app.id) &&
        (app.binding === 'mismatched' || app.status === 'invalid')
    );
    return invalid.length === 0
      ? Result.ok()
      : Result.err(
          new ValidationError(
            `Saved artifact evidence is invalid for Config-owned app selection: ${invalid.map((app) => app.id).join(', ')}.`,
            {
              context: {
                appIds: selectedAppIds,
                evidence: invalid,
                projectRoot: context.projectRoot,
                reason: 'invalid-binding',
              },
            }
          )
        );
  } catch (error) {
    return Result.err(
      new ValidationError(
        'Unable to inspect saved artifact identity before Warden execution.',
        {
          ...(error instanceof Error ? { cause: error } : {}),
          context: {
            appIds: selectedAppIds,
            detail: error instanceof Error ? error.message : String(error),
            projectRoot: context.projectRoot,
            reason: 'invalid-binding',
          },
        }
      )
    );
  }
};

const assertWardenArtifactPreflight = async (
  context: OperatorProjectContext
): Promise<Result<void, ValidationError>> => {
  const observable = await assertObservableProjectApps(context);
  return observable.isErr()
    ? observable
    : await assertWardenArtifactBindings(context);
};

/**
 * Report whether a resolved Warden run can reach saved lock evidence.
 *
 * Deliberately over-approximates the shared CLI drift gate (`shouldRunDrift`
 * in `packages/warden/src/cli.ts`, which on this path only fires at depth
 * `all` with the lock not skipped): lock skipping opts out entirely, and both
 * topo-aware depths otherwise preflight so no lock-reading depth can drift out
 * of coverage. Fixing is not an exemption — a `--fix` run at the default depth
 * still reports drift evidence, so it needs the same artifact preflight as a
 * reporting run.
 */
const consumesSavedArtifactEvidence = (
  effectiveConfig: EffectiveWardenConfig | undefined
): boolean => {
  if (effectiveConfig === undefined) {
    return true;
  }
  if (effectiveConfig.lock === 'skip') {
    return false;
  }
  return effectiveConfig.depth === 'topo' || effectiveConfig.depth === 'all';
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

const wardenInputSchema = z
  .object({
    adapterCheck: z
      .boolean()
      .default(false)
      .describe('Run shared adapter authoring checks'),
    app: z.string().optional().describe('Configured workspace app ID'),
    apps: z
      .array(z.string())
      .optional()
      .describe('Legacy app names or module paths to govern'),
    cached: z.boolean().default(false).describe('Alias for --lock cached'),
    ci: z.boolean().default(false).describe('Use the CI Warden preset'),
    configPath: z.string().optional().describe('Path to trails.config.ts'),
    depth: z
      .enum(wardenDepthValues)
      .optional()
      .describe('Cumulative analysis depth'),
    drafts: z.enum(wardenDraftsValues).optional().describe('Draft state mode'),
    excludeDrafts: z
      .boolean()
      .default(false)
      .describe('Alias for --drafts exclude'),
    failOn: z.enum(wardenFailOnValues).optional().describe('Failure threshold'),
    fix: z.boolean().default(false).describe('Apply safe source fixes'),
    format: z.enum(wardenFormatValues).optional().describe('Output format'),
    github: z.boolean().default(false).describe('Alias for --format github'),
    includeDrafts: z
      .boolean()
      .default(false)
      .describe('Alias for --drafts include'),
    json: z.boolean().default(false).describe('Alias for --format json'),
    lock: z.enum(wardenLockValues).optional().describe('Lockfile mode'),
    noLockMutation: z
      .boolean()
      .default(false)
      .describe('Suppress lockfile mutation'),
    onlyDrafts: z.boolean().default(false).describe('Alias for --drafts only'),
    prePush: z.boolean().default(false).describe('Use the pre-push preset'),
    refresh: z.boolean().default(false).describe('Alias for --lock refresh'),
    rootDir: z.string().optional().describe('Root directory to scan'),
    scopeExclude: z
      .array(z.string())
      .optional()
      .describe('Root-relative path globs that Warden should not govern'),
    skipLock: z.boolean().default(false).describe('Alias for --lock skip'),
    strict: z.boolean().default(false).describe('Alias for --fail-on warning'),
    summary: z.boolean().default(false).describe('Alias for --format summary'),
  })
  .refine((input) => input.app === undefined || input.apps === undefined, {
    message:
      'Use --app for Config-owned app selection; do not combine it with legacy --apps.',
    path: ['app'],
  });

type WardenTrailInput = z.infer<typeof wardenInputSchema>;

/**
 * Report whether an authored input pins lock skipping through any alias.
 *
 * Mirrors the lock alias precedence in {@link buildWardenCommandArgs}, where
 * `--skip-lock` outranks `--refresh` and `--cached`, which in turn outrank an
 * explicit `--lock` value.
 */
const inputSkipsLockEvidence = (input: WardenTrailInput): boolean => {
  if (input.skipLock === true) {
    return true;
  }
  if (input.refresh === true || input.cached === true) {
    return false;
  }
  return input.lock === 'skip';
};

/**
 * Report whether a fixing run must preflight saved artifacts before Warden
 * writes any patched source file.
 *
 * The shared runner applies safe fixes inside `runWarden` itself
 * (`applySafeFixesToFiles` in `packages/warden/src/cli.ts`), so the post-run
 * {@link consumesSavedArtifactEvidence} gate cannot protect source: by the time
 * `report.effectiveConfig` exists the files have already been rewritten, and
 * those fixes were selected against the very topo evidence the gate validates.
 * This input-level predicate therefore runs before the command and deliberately
 * over-approximates the post-run gate: it exempts only an input that explicitly
 * pins both lock skipping and `source` depth. Presets cannot widen that
 * exemption -- `parseWardenCommandArgs` applies `--pre-push`/`--ci` in a first
 * token pass and explicit options in a second, so an explicit `--depth source`
 * always wins -- and the CLI layer outranks the config and environment layers
 * in `resolveWardenConfig`. Every other fixing input preflights, including
 * inputs whose resolved depth would never have read a lock.
 *
 * Moving this gate to its single owner -- a preflight hook inside `runWarden`,
 * so the shared runner validates evidence before its own writes -- is tracked
 * as TRL-1322.
 */
const fixRunNeedsArtifactPreflight = (input: WardenTrailInput): boolean =>
  input.fix === true &&
  !(inputSkipsLockEvidence(input) && input.depth === 'source');

const createIsolatedWardenExampleRoot = (name: string): string => {
  const rootDir = createIsolatedExampleRoot(
    `warden-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
  writeIsolatedExampleTextFile(rootDir, 'src/clean.ts', 'export {};\n');
  return rootDir;
};

const pushFlag = (args: string[], condition: boolean, flag: string): void => {
  if (condition) {
    args.push(flag);
  }
};

const pushValue = (
  args: string[],
  flag: string,
  value: string | undefined
): void => {
  if (value !== undefined) {
    args.push(flag, value);
  }
};

const pushApps = (
  args: string[],
  apps: readonly string[] | undefined
): void => {
  if (apps !== undefined && apps.length > 0) {
    args.push('--apps', apps.join(','));
  }
};

const pushRepeatedValues = (
  args: string[],
  flag: string,
  values: readonly string[] | undefined
): void => {
  for (const value of values ?? []) {
    args.push(flag, value);
  }
};

export const buildWardenCommandArgs = (
  input: WardenTrailInput
): readonly string[] => {
  const args: string[] = [];

  pushFlag(args, input.prePush, '--pre-push');
  pushFlag(args, input.ci, '--ci');
  pushValue(args, '--depth', input.depth);
  if (input.strict) {
    args.push('--strict');
  } else {
    pushValue(args, '--fail-on', input.failOn);
  }
  if (input.github) {
    args.push('--github');
  } else if (input.json) {
    args.push('--json');
  } else if (input.summary) {
    args.push('--summary');
  } else {
    pushValue(args, '--format', input.format);
  }
  if (input.skipLock) {
    args.push('--skip-lock');
  } else if (input.refresh) {
    args.push('--refresh');
  } else if (input.cached) {
    args.push('--cached');
  } else {
    pushValue(args, '--lock', input.lock);
  }
  if (input.onlyDrafts) {
    args.push('--only-drafts');
  } else if (input.excludeDrafts) {
    args.push('--exclude-drafts');
  } else if (input.includeDrafts) {
    args.push('--include-drafts');
  } else {
    pushValue(args, '--drafts', input.drafts);
  }
  pushFlag(args, input.noLockMutation, '--no-lock-mutation');
  pushFlag(args, input.fix, '--fix');
  pushFlag(args, input.adapterCheck, '--adapter-check');
  pushValue(args, '--config-path', input.configPath);
  pushRepeatedValues(args, '--scope-exclude', input.scopeExclude);
  pushApps(args, input.apps);

  return args;
};

const projectRelativeModulePath = (app: OperatorProjectApp): string =>
  app.configured ? posix.join(app.root, app.modulePath) : app.modulePath;

interface SelectedWardenApps {
  readonly apps: readonly string[] | undefined;
  readonly expectedAppBindings: readonly WardenExpectedAppBinding[] | undefined;
}

const selectedWardenApps = (
  context: OperatorProjectContext,
  legacyApps: readonly string[] | undefined
): Result<SelectedWardenApps, ValidationError> => {
  if (context.identity.workspace === undefined) {
    return Result.ok({
      apps: legacyApps,
      expectedAppBindings: undefined,
    });
  }
  if (legacyApps !== undefined) {
    return Result.err(
      new ValidationError(
        'Configured workspaces derive Warden app targets from workspace.apps. Use --app <id> to narrow one invocation; legacy --apps is not a second app catalog.',
        {
          context: {
            configuredAppIds: context.identity.apps.map((app) => app.id),
            reason: 'invalid-binding',
          },
        }
      )
    );
  }
  const selectedApps =
    context.selectedExtent === 'workspace' ? context.apps : [context.app];
  const bindings: WardenExpectedAppBinding[] = [];
  for (const app of selectedApps) {
    if (app.id === undefined) {
      return Result.err(
        new ValidationError(
          'Configured Warden app selection is missing its Config-owned identity.',
          { context: { appRoot: app.root, reason: 'invalid-binding' } }
        )
      );
    }
    bindings.push({
      app: projectRelativeModulePath(app),
      expectedAppId: app.id,
      rootDir: app.rootDir,
    });
  }
  return Result.ok({
    apps: bindings.map((binding) => binding.app),
    expectedAppBindings: bindings,
  });
};

const renderWardenSelection = (
  formatted: string,
  format: 'github' | 'json' | 'summary',
  project: OperatorProjectContextOutput,
  workspaceEvidence?: WardenWorkspaceEvidence | undefined
): Result<string, ValidationError> => {
  if (format === 'json') {
    try {
      const parsed = JSON.parse(formatted) as Record<string, unknown>;
      return Result.ok(
        JSON.stringify({
          ...parsed,
          project,
          ...(workspaceEvidence === undefined ? {} : { workspaceEvidence }),
        })
      );
    } catch (error) {
      return Result.err(
        new ValidationError(
          'Warden returned invalid JSON output.',
          error instanceof Error ? { cause: error } : {}
        )
      );
    }
  }
  const selection = `Selection: ${project.selectedExtent} (${project.selectionProvenance}) at ${project.projectRoot}`;
  return Result.ok(
    formatted.length === 0 ? selection : `${selection}\n${formatted}`
  );
};

const deriveWardenWorkspaceEvidence = (
  context: OperatorProjectContext,
  topoDrift: readonly WardenTopoDriftResult[] | undefined
): WardenWorkspaceEvidence | undefined => {
  if (context.selectedExtent !== 'workspace') {
    return undefined;
  }
  const observations = new Map(
    (topoDrift ?? []).map((entry) => [entry.name, entry.drift])
  );
  const apps = context.apps.map((app) => {
    const drift = observations.get(app.id as string);
    let status: WardenWorkspaceEvidence['apps'][number]['status'];
    let freshness: WardenWorkspaceEvidence['apps'][number]['freshness'];
    if (drift === undefined) {
      status = 'unobserved';
      freshness = 'unobserved';
    } else if (drift.committedHash === null) {
      status = 'missing';
      freshness = 'unavailable';
    } else {
      status = 'available';
      freshness = drift.stale ? 'stale' : 'fresh';
    }
    return {
      appId: app.id as string,
      appRoot: app.root,
      artifactPath: app.lockPath,
      binding:
        drift === undefined ? ('unobserved' as const) : ('matched' as const),
      ...(drift?.blockedReason === undefined
        ? {}
        : { blockedReason: drift.blockedReason }),
      ...(drift === undefined
        ? {}
        : {
            committedHash: drift.committedHash,
            currentHash: drift.currentHash,
          }),
      freshness,
      modulePath: app.modulePath,
      moduleSource: app.moduleSource,
      provenance: 'warden-app-drift' as const,
      status,
    };
  });
  return {
    apps: apps.toSorted((left, right) => left.appId.localeCompare(right.appId)),
    completeness: apps.every((app) => app.status === 'available')
      ? 'complete'
      : 'partial',
  };
};

export const wardenTrail = trail('warden', {
  description: 'Run governance checks (lint + drift)',
  examples: [
    {
      input: {
        depth: 'source',
        lock: 'skip',
        rootDir: createIsolatedWardenExampleRoot('default'),
      },
      name: 'Default warden run',
    },
    {
      input: {
        depth: 'source',
        format: 'github',
        lock: 'skip',
        rootDir: createIsolatedWardenExampleRoot('github'),
      },
      name: 'GitHub Actions annotations',
    },
  ],
  implementation: async (input, ctx) => {
    const contextResult = await resolveOperatorProjectContext(input, {
      cwd: ctx.cwd,
    });
    if (contextResult.isErr()) {
      return contextResult;
    }
    const context = contextResult.value;
    const apps = selectedWardenApps(context, input.apps);
    if (apps.isErr()) {
      return apps;
    }
    if (fixRunNeedsArtifactPreflight(input)) {
      const fixPreflight = await assertWardenArtifactPreflight(context);
      if (fixPreflight.isErr()) {
        return fixPreflight;
      }
    }
    const result = await runWardenCommand({
      args: buildWardenCommandArgs({
        ...input,
        apps: apps.value.apps === undefined ? undefined : [...apps.value.apps],
      }),
      cwd: context.projectRoot,
      env: ctx.env ?? {},
      expectedAppBindings: apps.value.expectedAppBindings,
    });
    if (result.preflightError !== undefined) {
      return Result.err(result.preflightError);
    }
    const { report } = result;
    if (consumesSavedArtifactEvidence(report.effectiveConfig)) {
      const preflight = await assertWardenArtifactPreflight(context);
      if (preflight.isErr()) {
        return preflight;
      }
    }
    const project = operatorProjectContextOutput(context);
    const workspaceEvidence = deriveWardenWorkspaceEvidence(
      context,
      report.topoDrift
    );
    const formatted = renderWardenSelection(
      result.output,
      report.effectiveConfig?.format ?? 'summary',
      project,
      workspaceEvidence
    );
    if (formatted.isErr()) {
      return formatted;
    }

    return Result.ok({
      diagnostics: [...report.diagnostics],
      drift: report.drift,
      errorCount: report.errorCount,
      fixes: report.fixes,
      formatted: formatted.value,
      passed: report.passed,
      project,
      ...(workspaceEvidence === undefined ? {} : { workspaceEvidence }),
      warnCount: report.warnCount,
    });
  },
  input: wardenInputSchema,
  intent: 'write',
  output: z.object({
    diagnostics: z.array(
      diagnosticSchema.extend({ topoName: z.string().optional() })
    ),
    drift: z
      .object({
        blockedReason: z.string().optional(),
        committedHash: z.string().nullable(),
        currentHash: z.string(),
        stale: z.boolean(),
      })
      .nullable(),
    errorCount: z.number(),
    fixes: z
      .object({
        applied: z.number(),
        filesChanged: z.number(),
        skipped: z.number(),
      })
      .optional(),
    formatted: z.string(),
    passed: z.boolean(),
    project: operatorProjectContextOutputSchema,
    warnCount: z.number(),
    workspaceEvidence: wardenWorkspaceEvidenceSchema.optional(),
  }),
  permit: 'public',
});
