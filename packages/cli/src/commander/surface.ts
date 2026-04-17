/**
 * Surface helpers for wiring a topo to Commander.
 */

import type {
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';

import type { ActionResultContext } from '../build.js';
import { deriveCliCommands } from '../build.js';
import type { CliFlag } from '../command.js';
import { defaultOnResult } from '../on-result.js';
import type { InputResolver } from '../prompt.js';
import type { ToCommanderOptions } from './to-commander.js';
import { toCommander } from './to-commander.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TrailheadCliOptions {
  createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  description?: string | undefined;
  exclude?: readonly string[] | undefined;
  include?: readonly string[] | undefined;
  layers?: Layer[] | undefined;
  name?: string | undefined;
  onResult?: ((ctx: ActionResultContext) => Promise<void>) | undefined;
  presets?: CliFlag[][] | undefined;
  resources?: ResourceOverrideMap | undefined;
  resolveInput?: InputResolver | undefined;
  /** Set to `false` to skip topo validation at startup. Defaults to `true`. */
  validate?: boolean | undefined;
  version?: string | undefined;
}

export type CreateProgramOptions = TrailheadCliOptions;

export interface SurfaceCliResult {
  readonly exitCode: number;
}

// ---------------------------------------------------------------------------
// createProgram
// ---------------------------------------------------------------------------

const deriveCommanderOptions = (
  app: Topo,
  options: TrailheadCliOptions
): ToCommanderOptions => {
  const commanderOpts: ToCommanderOptions = {
    name: options.name ?? app.name,
  };
  if (options.version !== undefined || app.version !== undefined) {
    commanderOpts.version = options.version ?? app.version;
  }
  if (options.description !== undefined || app.description !== undefined) {
    commanderOpts.description = options.description ?? app.description;
  }
  return commanderOpts;
};

/**
 * Create a Commander program from a topo without parsing argv.
 */
export const createProgram = (
  app: Topo,
  options: CreateProgramOptions = {}
) => {
  const commandsResult = deriveCliCommands(app, {
    createContext: options.createContext,
    exclude: options.exclude,
    include: options.include,
    layers: options.layers,
    onResult: options.onResult ?? defaultOnResult,
    presets: options.presets,
    resolveInput: options.resolveInput,
    resources: options.resources,
    validate: options.validate,
  });

  if (commandsResult.isErr()) {
    throw commandsResult.error;
  }

  return toCommander(
    commandsResult.value,
    deriveCommanderOptions(app, options)
  );
};

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

/**
 * Parse argv for a topo through Commander.
 *
 * Returns the process exit code without calling `process.exit()`, so callers
 * can run cleanup before terminating. The CLI `trailhead()` entry point
 * delegates here and lets the process exit naturally.
 */
export const surface = async (
  app: Topo,
  options: TrailheadCliOptions = {}
): Promise<SurfaceCliResult> => {
  const program = createProgram(app, options);
  await program.parseAsync();
  const { exitCode } = process;
  return { exitCode: typeof exitCode === 'number' ? exitCode : 0 };
};

// ---------------------------------------------------------------------------
// trailhead
// ---------------------------------------------------------------------------

/**
 * Wire an App to Commander and parse argv in one call.
 *
 * Validation is handled by `buildCliCommands` — pass `validate: false`
 * to skip it (e.g. during hot-reload or progressive startup).
 *
 * ```ts
 * import { topo } from "@ontrails/core";
 * import { trailhead } from "@ontrails/cli/commander";
 * import * as entity from "./trails/entity.ts";
 *
 * const app = topo("myapp", entity);
 * trailhead(app);
 * ```
 */
export const trailhead = async (
  app: Topo,
  options: TrailheadCliOptions = {}
): Promise<void> => {
  await surface(app, options);
};
