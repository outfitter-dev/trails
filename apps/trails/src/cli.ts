import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, resolve } from 'node:path';

import {
  defaultOnResult,
  devPermitPreset,
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
import { createProgram } from '@ontrails/cli/commander';
import { resolvePermitFromBearerToken } from '@ontrails/permits';
import { deriveSurfaceMap } from '@ontrails/topographer';

import { app } from './app.js';
import { resolveInputWithClack } from './clack.js';
import { attachCompletionsInstallCommand } from './run-completions-install.js';
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
  hashSurfaceMapEntry,
  readRunTrailId,
  runWatchLoop,
} from './run-watch.js';
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
    await defaultOnResult(resolvedCtx);
  };

const traceEnabled = argvHasTraceFlag(process.argv);
const maybeInstallTraceSession = (): TraceSession | undefined =>
  traceEnabled ? installTraceSink() : undefined;

const resolveCliPermitFromToken: ResolveCliPermitFromToken = (input) =>
  resolvePermitFromBearerToken({
    bearerToken: input.token,
    env: process.env as Record<string, string | undefined>,
    graph: input.graph,
    missingAuthResourceMessage:
      '--token requires an auth connector. Register authResource from @ontrails/permits in your topo.',
    nullPermitMessage: 'Auth connector did not produce a permit for --token',
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
 * Reruns still depend on the resolved surface-map entry hash; this path is
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

const readWatchSurfaceHash = async (
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
    const surfaceMap = deriveSurfaceMap(lease.app);
    const entry = surfaceMap.entries.find(
      (candidate) => candidate.kind === 'trail' && candidate.id === target.id
    );
    return entry === undefined ? null : hashSurfaceMapEntry(entry);
  } finally {
    lease.release();
  }
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
  const session = maybeInstallTraceSession();
  try {
    const program = createProgram(app, {
      description: 'Agent-native, contract-first TypeScript framework',
      name: 'trails',
      onResult: buildOnResult(session),
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
    });
    attachCompletionsInstallCommand(program);
    await program.parseAsync();
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
      readSurfaceHash: () => readWatchSurfaceHash(watchTarget),
      run: runSurfaceOnce,
      sourcePath: await resolveWatchDirectorySourcePath(watchTarget),
    })
  : runSurfaceOnce());
