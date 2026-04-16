/**
 * The one-liner convenience for wiring an App to Commander.
 */

import type {
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContextInit,
} from '@ontrails/core';

import type { ActionResultContext } from '../build.js';
import { buildCliCommands } from '../build.js';
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
  const commands = buildCliCommands(app, {
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

  const commanderOpts: ToCommanderOptions = {
    name: options.name ?? app.name,
  };
  if (options.version !== undefined || app.version !== undefined) {
    commanderOpts.version = options.version ?? app.version;
  }
  if (options.description !== undefined || app.description !== undefined) {
    commanderOpts.description = options.description ?? app.description;
  }

  const program = toCommander(commands, commanderOpts);
  await program.parseAsync();
};
