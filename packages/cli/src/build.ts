/**
 * Build framework-agnostic CliCommand[] from an App's topology.
 */

import type { Field, Layer, Topo, TrailContext } from '@ontrails/core';
import {
  Result,
  composeLayers,
  createTrailContext,
  deriveFields,
  validateInput,
} from '@ontrails/core';

import type { AnyTrail, CliCommand, CliFlag } from './command.js';
import { dryRunPreset, toFlags } from './flags.js';
import type { InputResolver } from './prompt.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Context passed to the onResult callback. */
export interface ActionResultContext {
  readonly args: Record<string, unknown>;
  readonly flags: Record<string, unknown>;
  readonly input: unknown;
  readonly result: Result<unknown, Error>;
  readonly trail: AnyTrail;
}

/** Options for buildCliCommands. */
export interface BuildCliCommandsOptions {
  createContext?: (() => TrailContext | Promise<TrailContext>) | undefined;
  layers?: Layer[] | undefined;
  onResult?: ((ctx: ActionResultContext) => Promise<void>) | undefined;
  presets?: CliFlag[][] | undefined;
  resolveInput?: InputResolver | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert kebab-case flag name back to camelCase for input merging. */
const toCamel = (str: string): string =>
  str.replaceAll(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());

/**
 * Parse a trail ID into group + command name.
 * "entity.show" -> { group: "entity", name: "show" }
 * "search" -> { group: undefined, name: "search" }
 */
const parseTrailId = (
  id: string
): { group: string | undefined; name: string } => {
  const dotIndex = id.indexOf('.');
  if (dotIndex === -1) {
    return { group: undefined, name: id };
  }
  return {
    group: id.slice(0, dotIndex),
    name: id.slice(dotIndex + 1),
  };
};

/**
 * Merge preset flags with schema-derived flags.
 * Schema-derived flags take precedence on name collision.
 */
const mergeFlags = (presets: CliFlag[], derived: CliFlag[]): CliFlag[] => {
  const derivedNames = new Set(derived.map((f) => f.name));
  const merged = [...derived];
  for (const preset of presets) {
    if (!derivedNames.has(preset.name)) {
      merged.push(preset);
    }
  }
  return merged;
};

// ---------------------------------------------------------------------------
// buildCliCommands
// ---------------------------------------------------------------------------

/**
 * Build an array of framework-agnostic CLI commands from an App.
 *
 * Iterates the topo, derives flags from input schemas, groups by
 * dot-notation, and wires up the execute function with validation,
 * layer composition, and onResult handling.
 */
const META_FLAGS = new Set(['json', 'jsonl', 'output']);

/** Merge parsed args and flags into a camelCase input record. */
const mergeArgsAndFlags = (
  parsedArgs: Record<string, unknown>,
  parsedFlags: Record<string, unknown>
): Record<string, unknown> => {
  const mergedInput: Record<string, unknown> = { ...parsedArgs };
  for (const [key, value] of Object.entries(parsedFlags)) {
    if (!META_FLAGS.has(key)) {
      mergedInput[toCamel(key)] = value;
    }
  }
  return mergedInput;
};

/** Apply interactive prompting and merge results. */
const applyPrompting = async (
  fields: readonly Field[],
  mergedInput: Record<string, unknown>,
  options?: BuildCliCommandsOptions
): Promise<void> => {
  if (!options?.resolveInput) {
    return;
  }
  const resolved = await options.resolveInput(fields, mergedInput);
  for (const [key, value] of Object.entries(resolved)) {
    if (value !== undefined) {
      mergedInput[key] = value;
    }
  }
};

/** Resolve a TrailContext from overrides, factory, or default. */
const resolveContext = (
  ctxOverrides: Partial<TrailContext> | undefined,
  options?: BuildCliCommandsOptions
): Promise<TrailContext> => {
  if (ctxOverrides) {
    return Promise.resolve(createTrailContext(ctxOverrides));
  }
  if (options?.createContext) {
    return Promise.resolve(options.createContext());
  }
  return Promise.resolve(createTrailContext());
};

/** Report a result via onResult callback if provided. */
const reportResult = async (
  options: BuildCliCommandsOptions | undefined,
  ctx: ActionResultContext
): Promise<void> => {
  if (options?.onResult) {
    await options.onResult(ctx);
  }
};

/** Execute a trail with validated input. */
const executeTrail = async (
  t: AnyTrail,
  validatedInput: unknown,
  ctxOverrides: Partial<TrailContext> | undefined,
  options?: BuildCliCommandsOptions
): Promise<Result<unknown, Error>> => {
  const ctx = await resolveContext(ctxOverrides, options);
  const layers = options?.layers ?? [];
  const impl = composeLayers(layers, t, t.implementation);
  return impl(validatedInput, ctx);
};

/** Create the execute function for a CLI command. */
const createExecute =
  (
    t: AnyTrail,
    fields: readonly Field[],
    _flags: CliFlag[],
    options?: BuildCliCommandsOptions
  ) =>
  async (
    parsedArgs: Record<string, unknown>,
    parsedFlags: Record<string, unknown>,
    ctxOverrides?: Partial<TrailContext>
  ): Promise<Result<unknown, Error>> => {
    const mergedInput = mergeArgsAndFlags(parsedArgs, parsedFlags);
    await applyPrompting(fields, mergedInput, options);

    const validated = validateInput(t.input, mergedInput);
    if (validated.isErr()) {
      const errorResult: Result<unknown, Error> = Result.err(validated.error);
      await reportResult(options, {
        args: parsedArgs,
        flags: parsedFlags,
        input: mergedInput,
        result: errorResult,
        trail: t,
      });
      return errorResult;
    }

    const result = await executeTrail(
      t,
      validated.value,
      ctxOverrides,
      options
    );
    await reportResult(options, {
      args: parsedArgs,
      flags: parsedFlags,
      input: validated.value,
      result,
      trail: t,
    });
    return result;
  };

/** Derive and merge flags for a trail. */
const buildFlags = (
  fields: readonly Field[],
  destructive: boolean | undefined,
  options?: BuildCliCommandsOptions
): CliFlag[] => {
  let flags = toFlags(fields);
  if (options?.presets) {
    flags = mergeFlags(options.presets.flat(), flags);
  }
  if (destructive) {
    flags = mergeFlags(dryRunPreset(), flags);
  }
  return flags;
};

/** Convert a trail or route into a CLI command when it is publicly exposed. */
const toCliCommand = (
  t: AnyTrail,
  options?: BuildCliCommandsOptions
): CliCommand => {
  const { group, name } = parseTrailId(t.id);
  const fields = deriveFields(t.input, t.fields);
  const flags = buildFlags(fields, t.destructive, options);

  return {
    args: [],
    description: t.description,
    destructive: t.destructive,
    execute: createExecute(t, fields, flags, options),
    flags,
    group,
    idempotent: t.idempotent,
    layers: options?.layers,
    name,
    readOnly: t.readOnly,
    trail: t,
  };
};

export const buildCliCommands = (
  app: Topo,
  options?: BuildCliCommandsOptions
): CliCommand[] => {
  const commands: CliCommand[] = [];

  for (const item of app.list()) {
    if (item.kind !== 'trail') {
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = item as AnyTrail;
    if (t.markers?.['internal'] === true) {
      continue;
    }
    commands.push(toCliCommand(t, options));
  }

  return commands;
};
