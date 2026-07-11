import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, resolve } from 'node:path';

import {
  defaultOnResult,
  devPermitPreset,
  deriveCliCommands,
  outputModePreset,
  permitPreset,
  tokenPreset,
  tracePreset,
  watchPreset,
} from '@ontrails/cli';
import type {
  ActionResultContext,
  ResolveCliPermitFromToken,
} from '@ontrails/cli';
import { createProgram } from '@ontrails/commander';
import type { CreateProgramOptions } from '@ontrails/commander';
import { resolvePermitFromBearerToken } from '@ontrails/permits';
import { deriveTopoGraph } from '@ontrails/topography';

import { app, trailsCliIncludedTrails, trailsOverlays } from './app.js';
import { resolveInputWithClack } from './clack.js';
import { getRetiredTopoCommandDiagnostic } from './retired-topo-command.js';
import { attachCompletionsInstallCommand } from './run-completions-install.js';
import { attachSchemaCommand } from './run-schema.js';
import {
  applyAdapterCheckExitCode,
  tryAdapterCheckOutput,
} from './run-adapter-check.js';
import {
  applyReleaseCheckExitCode,
  tryReleaseCheckOutput,
} from './run-release-check.js';
import { tryRecoverFromRunCollision } from './run-collision.js';
import { tryExampleRunOutput } from './run-example.js';
import { tryExamplesRunOutput } from './run-examples.js';
import { tryQuietRunOutput } from './run-quiet.js';
import {
  argvHasTraceFlag,
  installTraceSink,
  tryTraceJsonOutput,
  writeTraceTreeToStderr,
} from './run-trace.js';
import type { TraceSession } from './run-trace.js';
import {
  argvHasWatchFlag,
  hashTopoGraphEntry,
  readRunTrailId,
  runWatchLoop,
} from './run-watch.js';
import { tryWardenOutput } from './run-warden.js';
import { tryWayfindOutlineOutput } from './run-wayfind-outline.js';
import { tryLoadFreshAppLease } from './trails/load-app.js';
import { resolveRunModulePath } from './trails/run.js';
import { resolveTrailRootDir } from './trails/root-dir.js';
import { trailsPackageVersion } from './versions.js';

const buildOnResult =
  (session: TraceSession | undefined) =>
  async (ctx: ActionResultContext): Promise<void> => {
    const recovered = await tryRecoverFromRunCollision(ctx, { graph: app });
    const resolvedCtx: ActionResultContext =
      recovered === undefined
        ? ctx
        : {
            ...ctx,
            input: recovered.isOk()
              ? (ctx.trail.input.safeParse(ctx.input).data ?? ctx.input)
              : ctx.input,
            result: recovered,
          };

    // `--trace --json` (without `--quiet`) emits a single Result-shaped
    // envelope on stdout that includes the captured records under
    // `tracing`. Hand that case off before the regular chain so the
    // existing handlers do not also write to stdout.
    applyAdapterCheckExitCode(resolvedCtx);
    applyReleaseCheckExitCode(resolvedCtx);
    if (session !== undefined && tryTraceJsonOutput(resolvedCtx, session)) {
      return;
    }

    if (tryExampleRunOutput(resolvedCtx)) {
      return;
    }
    if (tryExamplesRunOutput(resolvedCtx)) {
      return;
    }
    if (await tryQuietRunOutput(resolvedCtx)) {
      return;
    }
    if (tryWardenOutput(resolvedCtx)) {
      return;
    }
    if (tryAdapterCheckOutput(resolvedCtx)) {
      return;
    }
    if (tryReleaseCheckOutput(resolvedCtx)) {
      return;
    }
    if (tryWayfindOutlineOutput(resolvedCtx)) {
      return;
    }
    await defaultOnResult(resolvedCtx);
  };

const traceEnabled = argvHasTraceFlag(process.argv);
const maybeInstallTraceSession = (): TraceSession | undefined =>
  traceEnabled ? installTraceSink() : undefined;

const resolveCliPermitFromToken: ResolveCliPermitFromToken = (input) =>
  resolvePermitFromBearerToken({
    bearerToken: input.token,
    configValues: input.configValues,
    env: process.env as Record<string, string | undefined>,
    graph: input.graph,
    missingAuthResourceMessage:
      '--token requires an auth adapter. Register authResource from @ontrails/permits in your topo.',
    nullPermitMessage: 'Auth adapter did not produce a permit for --token',
    requestId: input.requestId,
    resources: input.resources,
    surface: 'cli',
  });

interface WatchRunTarget {
  readonly app?: string | undefined;
  readonly id: string;
  readonly module?: string | undefined;
  readonly rootDir?: string | undefined;
}

const readFlagValue = (
  args: readonly string[],
  flagName: string
): string | undefined => {
  const longFlag = `--${flagName}`;
  const prefixedFlag = `${longFlag}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === longFlag) {
      return args[i + 1];
    }
    if (arg?.startsWith(prefixedFlag)) {
      return arg.slice(prefixedFlag.length);
    }
  }
  return undefined;
};

const resolveWatchRunTarget = (
  argv: readonly string[]
): WatchRunTarget | null => {
  const args = argv.slice(2);
  const id = readRunTrailId(args);
  if (id === undefined) {
    return null;
  }
  return {
    app: readFlagValue(args, 'app'),
    id,
    module: readFlagValue(args, 'module'),
    rootDir: readFlagValue(args, 'root-dir'),
  };
};

/**
 * Resolve the directory whose source-file events wake the `--watch` loop.
 * Reruns still depend on the resolved TopoGraph entry hash; this path is
 * only the cheap filesystem event source.
 */
const toWatchSourcePath = (rootDir: string, modulePath: string): string => {
  if (modulePath.startsWith('file:')) {
    return fileURLToPath(modulePath);
  }
  return isAbsolute(modulePath) ? modulePath : resolve(rootDir, modulePath);
};

const resolveWatchDirectorySourcePath = async (
  target: WatchRunTarget | null
): Promise<string> => {
  if (target !== null) {
    const rootDirResult = resolveTrailRootDir(target.rootDir, process.cwd());
    if (rootDirResult.isErr()) {
      throw rootDirResult.error;
    }
    const moduleResult = await resolveRunModulePath(
      rootDirResult.value,
      target.module,
      target.id,
      target.app
    );
    if (moduleResult.isOk()) {
      return toWatchSourcePath(rootDirResult.value, moduleResult.value);
    }
  }
  const cwd = process.cwd();
  const srcDir = join(cwd, 'src');
  if (existsSync(srcDir)) {
    return join(srcDir, 'app.ts');
  }
  return join(cwd, 'app.ts');
};

const readWatchTopoGraphEntryHash = async (
  target: WatchRunTarget | null
): Promise<string | null> => {
  if (target === null) {
    return null;
  }
  const rootDirResult = resolveTrailRootDir(target.rootDir, process.cwd());
  if (rootDirResult.isErr()) {
    throw rootDirResult.error;
  }
  const rootDir = rootDirResult.value;
  const moduleResult = await resolveRunModulePath(
    rootDir,
    target.module,
    target.id,
    target.app
  );
  if (moduleResult.isErr()) {
    throw moduleResult.error;
  }
  const leaseResult = await tryLoadFreshAppLease(moduleResult.value, rootDir);
  if (leaseResult.isErr()) {
    throw leaseResult.error;
  }
  const lease = leaseResult.value;
  try {
    const topoGraph = deriveTopoGraph(lease.app);
    const entry = topoGraph.entries.find(
      (candidate) => candidate.kind === 'trail' && candidate.id === target.id
    );
    return entry === undefined ? null : hashTopoGraphEntry(entry);
  } finally {
    lease.release();
  }
};

const wardenValueFlags = new Set([
  '--apps',
  '--config-path',
  '--depth',
  '--drafts',
  '--fail-on',
  '--format',
  '--scope-exclude',
  '--lock',
  '--root-dir',
]);

const normalizeWardenArgv = (argv: readonly string[]): string[] => {
  if (argv[2] !== 'warden') {
    return [...argv];
  }

  const normalized = [...argv];
  let previousFlagConsumesValue = false;
  for (let index = 3; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === undefined) {
      continue;
    }

    if (previousFlagConsumesValue) {
      previousFlagConsumesValue = false;
      continue;
    }

    if (arg === '-a') {
      normalized[index] = '--apps';
      previousFlagConsumesValue = true;
      continue;
    }

    previousFlagConsumesValue = wardenValueFlags.has(arg);
  }

  return normalized;
};

/**
 * Invoke `surface()` once with an optional fresh trace session.
 *
 * When `--trace` is set, a fresh {@link TraceSession} is installed for the
 * duration of the call and finalized in the `finally` block. Under
 * `--watch`, this produces a fresh sink (and a fresh stderr tree) per
 * rerun rather than letting records accumulate in a single
 * process-lifetime sink.
 */
const runSurfaceOnce = async (): Promise<void> => {
  const retiredTopoCommand = getRetiredTopoCommandDiagnostic(process.argv);
  if (retiredTopoCommand !== null) {
    process.stderr.write(`${retiredTopoCommand.message}\n`);
    process.exitCode = 1;
    return;
  }

  const session = maybeInstallTraceSession();
  try {
    const surfaceOptions = {
      description: 'Agent-native, contract-first TypeScript framework',
      include: trailsCliIncludedTrails,
      name: 'trails',
      onResult: buildOnResult(session),
      overlays: trailsOverlays,
      presets: [
        outputModePreset(),
        tracePreset(),
        permitPreset(),
        tokenPreset(),
        devPermitPreset(),
        watchPreset(),
      ],
      resolveInput: resolveInputWithClack,
      resolvePermitFromToken: resolveCliPermitFromToken,
      version: trailsPackageVersion,
    } satisfies CreateProgramOptions;
    const program = createProgram(app, surfaceOptions);
    const schemaCommands = deriveCliCommands(app, surfaceOptions);
    if (schemaCommands.isErr()) {
      throw schemaCommands.error;
    }
    attachSchemaCommand(program, schemaCommands.value);
    attachCompletionsInstallCommand(program);
    await program.parseAsync(normalizeWardenArgv(process.argv));
  } finally {
    if (session !== undefined) {
      const records = session.finalize();
      writeTraceTreeToStderr(records);
    }
  }
};

const watchTarget = argvHasWatchFlag(process.argv)
  ? resolveWatchRunTarget(process.argv)
  : null;

await (argvHasWatchFlag(process.argv)
  ? runWatchLoop({
      readTopoGraphEntryHash: () => readWatchTopoGraphEntryHash(watchTarget),
      run: runSurfaceOnce,
      sourcePath: await resolveWatchDirectorySourcePath(watchTarget),
    })
  : runSurfaceOnce());
