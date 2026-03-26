/**
 * The one-liner convenience for wiring an App to Commander.
 */

import type { Layer, Topo, TrailContext } from '@ontrails/core';

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

export interface BlazeCliOptions {
  createContext?: (() => TrailContext | Promise<TrailContext>) | undefined;
  description?: string | undefined;
  layers?: Layer[] | undefined;
  name?: string | undefined;
  onResult?: ((ctx: ActionResultContext) => Promise<void>) | undefined;
  presets?: CliFlag[][] | undefined;
  resolveInput?: InputResolver | undefined;
  version?: string | undefined;
}

// ---------------------------------------------------------------------------
// blaze
// ---------------------------------------------------------------------------

/**
 * Wire an App to Commander and parse argv in one call.
 *
 * ```ts
 * import { topo } from "@ontrails/core";
 * import { blaze } from "@ontrails/cli/commander";
 * import * as entity from "./trails/entity.ts";
 *
 * const app = topo("myapp", entity);
 * blaze(app);
 * ```
 */
export const blaze = (app: Topo, options: BlazeCliOptions = {}): void => {
  const commands = buildCliCommands(app, {
    createContext: options.createContext,
    layers: options.layers,
    onResult: options.onResult ?? defaultOnResult,
    presets: options.presets,
    resolveInput: options.resolveInput,
  });

  const commanderOpts: ToCommanderOptions = {
    name: options.name ?? app.name,
  };
  if (options.version !== undefined) {
    commanderOpts.version = options.version;
  }
  if (options.description !== undefined) {
    commanderOpts.description = options.description;
  }

  const program = toCommander(commands, commanderOpts);
  program.parse();
};
