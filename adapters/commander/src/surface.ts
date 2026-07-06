/**
 * Surface helpers for wiring a topo to Commander.
 */

import type {
  BaseSurfaceOptions,
  Layer,
  OverlayEnvelopeLike,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';
import type {
  ActionResultContext,
  CliFlag,
  InputResolver,
  ResolveCliPermitFromToken,
} from '@ontrails/cli';
import { defaultOnResult, deriveCliCommands } from '@ontrails/cli';
import type { ToCommanderOptions } from './to-commander.js';
import { toCommander } from './to-commander.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for creating Commander CLI surfaces from a Trails topo.
 */
export interface CreateProgramOptions extends BaseSurfaceOptions {
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly description?: string | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly name?: string | undefined;
  readonly onResult?: ((ctx: ActionResultContext) => Promise<void>) | undefined;
  /**
   * App-authored overlay envelopes (conventionally the app module's
   * `trailsOverlays` export); the `surfaces` envelope's `cli` bindings
   * project synonym and command-group routes onto the program.
   */
  readonly overlays?: readonly OverlayEnvelopeLike[] | undefined;
  readonly presets?: CliFlag[][] | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  readonly resolveInput?: InputResolver | undefined;
  readonly resolvePermitFromToken?: ResolveCliPermitFromToken | undefined;
  readonly version?: string | undefined;
}

/**
 * Result returned by running the Commander surface bootstrap.
 */
export interface SurfaceCliResult {
  readonly exitCode: number;
}

// ---------------------------------------------------------------------------
// createProgram
// ---------------------------------------------------------------------------

const deriveCommanderOptions = (
  graph: Topo,
  options: CreateProgramOptions
): ToCommanderOptions => {
  const commanderOpts: ToCommanderOptions = {
    name: options.name ?? graph.name,
    topoName: graph.name,
  };
  if (options.version !== undefined || graph.version !== undefined) {
    commanderOpts.version = options.version ?? graph.version;
  }
  if (options.description !== undefined || graph.description !== undefined) {
    commanderOpts.description = options.description ?? graph.description;
  }
  return commanderOpts;
};

/**
 * Create a Commander program from a topo without parsing argv.
 *
 * @remarks This is a host materialization boundary. Derivation failures are
 * thrown for the caller's CLI bootstrap code after `deriveCliCommands` has
 * already represented the framework error as a Result.
 *
 * @example
 * ```ts
 * import { createProgram } from '@ontrails/commander';
 *
 * const program = createProgram(graph, { name: 'demo' });
 * program.parse();
 * ```
 */
export const createProgram = (
  graph: Topo,
  options: CreateProgramOptions = {}
) => {
  const commandsResult = deriveCliCommands(graph, {
    configValues: options.configValues,
    createContext: options.createContext,
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
    layers: options.layers,
    onResult: options.onResult ?? defaultOnResult,
    overlays: options.overlays,
    presets: options.presets,
    resolveInput: options.resolveInput,
    resolvePermitFromToken: options.resolvePermitFromToken,
    resources: options.resources,
    validate: options.validate,
  });

  if (commandsResult.isErr()) {
    throw commandsResult.error;
  }

  return toCommander(
    commandsResult.value,
    deriveCommanderOptions(graph, options)
  );
};

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

/**
 * Parse argv for a topo through Commander.
 *
 * Returns the process exit code without calling `process.exit()`, so callers
 * can run cleanup before terminating. The CLI `surface()` entry point
 * delegates here and lets the process exit naturally.
 *
 * @example
 * ```ts
 * import { surface } from '@ontrails/commander';
 *
 * const { exitCode } = await surface(graph, { name: 'demo' });
 * ```
 */
export const surface = async (
  graph: Topo,
  options: CreateProgramOptions = {}
): Promise<SurfaceCliResult> => {
  const program = createProgram(graph, options);
  await program.parseAsync();
  const { exitCode } = process;
  return { exitCode: typeof exitCode === 'number' ? exitCode : 0 };
};
