/**
 * Build framework-agnostic CliCommand[] from a graph topology.
 */

import type {
  BaseSurfaceOptions,
  Field,
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContext,
  TrailContextInit,
} from '@ontrails/core';
import {
  Result,
  ValidationError,
  deriveCliPath,
  deriveFields,
  executeTrail,
  filterSurfaceTrails,
  validateSurfaceTopo,
  withSurfaceMarker,
} from '@ontrails/core';

import type { AnyTrail, CliArg, CliCommand, CliFlag } from './command.js';
import { dryRunPreset, toFlags } from './flags.js';
import type { InputResolver } from './prompt.js';
import {
  STRUCTURED_INPUT_HINT,
  hasStructuredOnlyFields,
  kebabToCamel,
  normalizeParsedFlags,
  readStructuredInput,
  structuredInputPreset,
  supportsStructuredInput,
} from './structured-input.js';
import { validateCliCommands } from './validate.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Context passed to the onResult callback. */
export interface ActionResultContext {
  readonly args: Record<string, unknown>;
  readonly flags: Record<string, unknown>;
  readonly input: unknown;
  readonly result: Result<unknown, Error>;
  readonly topoName: string;
  readonly trail: AnyTrail;
}

/** Options for CLI command projection. */
export interface DeriveCliCommandsOptions extends BaseSurfaceOptions {
  createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  layers?: readonly Layer[] | undefined;
  onResult?: ((ctx: ActionResultContext) => Promise<void>) | undefined;
  presets?: readonly (readonly CliFlag[])[] | undefined;
  resources?: ResourceOverrideMap | undefined;
  resolveInput?: InputResolver | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const validateCliCommandBuild = (
  graph: Topo,
  options?: DeriveCliCommandsOptions
): Result<void, Error> => validateSurfaceTopo(graph, options);

// ---------------------------------------------------------------------------
// deriveCliCommands
// ---------------------------------------------------------------------------

/**
 * Build an array of framework-agnostic CLI commands from a graph.
 *
 * Iterates the topo, derives flags from input schemas, groups by
 * dot-notation, and wires up the execute function with validation,
 * layer composition, and onResult handling.
 */
const META_FLAG_CANDIDATES = new Set([
  'inputFile',
  'inputJson',
  'json',
  'jsonl',
  'output',
  'stdin',
]);

/** Merge parsed args and flags into a camelCase input record. */
const mergeArgsAndFlags = (
  metaFlagNames: ReadonlySet<string>,
  structuredInput: Record<string, unknown>,
  parsedArgs: Record<string, unknown>,
  parsedFlags: Record<string, unknown>
): Record<string, unknown> => {
  const mergedInput: Record<string, unknown> = { ...structuredInput };
  // Only merge defined positional args — undefined means the user omitted it
  for (const [key, value] of Object.entries(parsedArgs)) {
    if (value !== undefined) {
      mergedInput[key] = value;
    }
  }
  for (const [key, value] of Object.entries(parsedFlags)) {
    if (!metaFlagNames.has(key) && value !== undefined) {
      mergedInput[key] = value;
    }
  }
  return mergedInput;
};

/** Apply interactive prompting and merge results. */
const applyPrompting = async (
  fields: readonly Field[],
  mergedInput: Record<string, unknown>,
  options?: DeriveCliCommandsOptions
): Promise<void> => {
  if (!options?.resolveInput) {
    return;
  }
  const resolved = await options.resolveInput(fields, mergedInput);
  for (const [key, value] of Object.entries(resolved)) {
    if (value !== undefined && mergedInput[key] === undefined) {
      mergedInput[key] = value;
    }
  }
};

/** Report a result via onResult callback if provided. */
const reportResult = async (
  options: DeriveCliCommandsOptions | undefined,
  ctx: ActionResultContext
): Promise<void> => {
  if (options?.onResult) {
    await options.onResult(ctx);
  }
};

const selectStructuredInputFlags = (
  normalizedFlags: Record<string, unknown>,
  metaFlagNames: ReadonlySet<string>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(normalizedFlags).filter(([key]) => metaFlagNames.has(key))
  );

const usesStructuredInput = (
  structuredInputFlags: Record<string, unknown>
): boolean =>
  structuredInputFlags['inputJson'] !== undefined ||
  structuredInputFlags['inputFile'] !== undefined ||
  structuredInputFlags['stdin'] === true;

const resolveMergedInput = async (
  fields: readonly Field[],
  metaFlagNames: ReadonlySet<string>,
  parsedArgs: Record<string, unknown>,
  parsedFlags: Record<string, unknown>,
  options?: DeriveCliCommandsOptions
): Promise<{
  readonly mergedInput: Record<string, unknown>;
  readonly usedStructuredInput: boolean;
}> => {
  const normalizedFlags = normalizeParsedFlags(parsedFlags);
  const structuredInputFlags = selectStructuredInputFlags(
    normalizedFlags,
    metaFlagNames
  );
  const structuredInput = await readStructuredInput(structuredInputFlags);
  const mergedInput = mergeArgsAndFlags(
    metaFlagNames,
    structuredInput,
    parsedArgs,
    normalizedFlags
  );
  await applyPrompting(fields, mergedInput, options);
  return {
    mergedInput,
    usedStructuredInput: usesStructuredInput(structuredInputFlags),
  };
};

const maybeAddStructuredInputHint = (
  result: Result<unknown, Error>,
  shouldHintStructuredInput: boolean,
  usedStructuredInput: boolean
): Result<unknown, Error> => {
  if (
    !shouldHintStructuredInput ||
    result.isOk() ||
    !(result.error instanceof ValidationError) ||
    usedStructuredInput ||
    result.error.message.includes(STRUCTURED_INPUT_HINT)
  ) {
    return result;
  }

  return Result.err(
    new ValidationError(`${result.error.message}. ${STRUCTURED_INPUT_HINT}`, {
      cause: result.error,
      ...(result.error.context === undefined
        ? {}
        : { context: result.error.context }),
    })
  );
};

const safeMergeInput = async (
  fields: readonly Field[],
  metaFlagNames: ReadonlySet<string>,
  parsedArgs: Record<string, unknown>,
  parsedFlags: Record<string, unknown>,
  options?: DeriveCliCommandsOptions
): Promise<
  Result<
    { mergedInput: Record<string, unknown>; usedStructuredInput: boolean },
    Error
  >
> => {
  try {
    return Result.ok(
      await resolveMergedInput(
        fields,
        metaFlagNames,
        parsedArgs,
        parsedFlags,
        options
      )
    );
  } catch (error: unknown) {
    return Result.err(
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

/** Create the execute function for a CLI command. */
const createExecute =
  (
    graph: Topo,
    t: AnyTrail,
    fields: readonly Field[],
    metaFlagNames: ReadonlySet<string>,
    shouldHintStructuredInput: boolean,
    options?: DeriveCliCommandsOptions
  ) =>
  async (
    parsedArgs: Record<string, unknown>,
    parsedFlags: Record<string, unknown>,
    ctxOverrides?: Partial<TrailContext>
  ): Promise<Result<unknown, Error>> => {
    const merged = await safeMergeInput(
      fields,
      metaFlagNames,
      parsedArgs,
      parsedFlags,
      options
    );
    if (merged.isErr()) {
      await reportResult(options, {
        args: parsedArgs,
        flags: parsedFlags,
        input: { ...parsedArgs, ...parsedFlags },
        result: merged,
        topoName: graph.name,
        trail: t,
      });
      return merged;
    }
    const { mergedInput, usedStructuredInput } = merged.value;

    const result = await executeTrail(t, mergedInput, {
      configValues: options?.configValues,
      createContext: options?.createContext,
      ctx: withSurfaceMarker('cli', ctxOverrides),
      layers: options?.layers,
      resources: options?.resources,
      topo: graph,
    });
    const finalResult = maybeAddStructuredInputHint(
      result,
      shouldHintStructuredInput,
      usedStructuredInput
    );

    // Pass validated (coerced/transformed) input to onResult on success,
    // raw merged input on validation failure.
    const reportInput = finalResult.isOk()
      ? (t.input.safeParse(mergedInput).data ?? mergedInput)
      : mergedInput;

    await reportResult(options, {
      args: parsedArgs,
      flags: parsedFlags,
      input: reportInput,
      result: finalResult,
      topoName: graph.name,
      trail: t,
    });
    return finalResult;
  };

/** Derive and merge flags for a trail. */
const buildFlags = (
  t: AnyTrail,
  fields: readonly Field[],
  intent: 'read' | 'write' | 'destroy',
  options?: DeriveCliCommandsOptions
): CliFlag[] => {
  let flags = toFlags(fields);
  if (supportsStructuredInput(t.input)) {
    flags = mergeFlags(structuredInputPreset(), flags);
  }
  if (options?.presets) {
    flags = mergeFlags(options.presets.flat(), flags);
  }
  if (intent === 'destroy') {
    flags = mergeFlags(dryRunPreset(), flags);
  }
  return flags;
};

/** Convert a field to a positional CliArg. */
/** Convert a field to a positional CliArg. Always optional because the flag alias is an alternative. */
const fieldToArg = (field: Field): CliArg => ({
  description: field.label,
  name: field.name,
  required: false,
  variadic: false,
});

/**
 * Derive positional args from a trail's `args` declaration and fields.
 *
 * - `args: false` — explicit suppression, no positional args.
 * - `args: string[]` — use the declared order; only string fields are kept.
 * - `args: undefined` — heuristic: if exactly one required string field with
 *   no default exists, auto-promote it to positional.
 *
 * Positional args preserve `trail.args` order (not alphabetical) because
 * position is semantically meaningful in CLI usage.
 */
const derivePositionalArgs = (
  trail: AnyTrail,
  fields: readonly Field[]
): { readonly args: CliArg[] } => {
  // Explicit suppression (false or empty array)
  if (
    trail.args === false ||
    (Array.isArray(trail.args) && trail.args.length === 0)
  ) {
    return { args: [] };
  }

  // Explicit args declaration — use the order from the array
  if (trail.args !== undefined && trail.args.length > 0) {
    const stringFieldNames = new Set(
      fields.filter((f) => f.type === 'string').map((f) => f.name)
    );
    const validArgs = trail.args
      .filter((name) => stringFieldNames.has(name))
      .map((name) => fields.find((f) => f.name === name))
      .filter((f): f is Field => f !== undefined)
      .map(fieldToArg);
    return { args: validArgs };
  }

  // Heuristic: single required string with no default
  const candidates = fields.filter(
    (f) => f.type === 'string' && f.required && f.default === undefined
  );
  if (candidates.length === 1 && candidates[0]) {
    return { args: [fieldToArg(candidates[0])] };
  }

  return { args: [] };
};

/** Convert a trail or route into a CLI command when it is publicly exposed. */
const toCliCommand = (
  graph: Topo,
  t: AnyTrail,
  options?: DeriveCliCommandsOptions
): CliCommand => {
  const fields = deriveFields(t.input, t.fields);
  const { args } = derivePositionalArgs(t, fields);
  // All fields generate flags — positional fields keep their --flag alias
  const flags = buildFlags(t, fields, t.intent, options);
  const derivedFlagNames = new Set(
    toFlags(fields).map((flag) => kebabToCamel(flag.name))
  );
  const metaFlagNames = new Set(
    flags
      .map((flag) => kebabToCamel(flag.name))
      .filter(
        (name) => META_FLAG_CANDIDATES.has(name) && !derivedFlagNames.has(name)
      )
  );
  const shouldHintStructuredInput = hasStructuredOnlyFields(
    t.input,
    fields.length
  );

  return {
    args,
    description: t.description,
    execute: createExecute(
      graph,
      t,
      fields,
      metaFlagNames,
      shouldHintStructuredInput,
      options
    ),
    flags,
    idempotent: t.idempotent,
    intent: t.intent,
    layers: options?.layers,
    path: deriveCliPath(t.id),
    trail: t,
  };
};

const collectCommands = (
  graph: Topo,
  options?: DeriveCliCommandsOptions
): CliCommand[] =>
  filterSurfaceTrails(graph.list(), {
    exclude: options?.exclude,
    include: options?.include,
    intent: options?.intent,
  }).map((trail) => toCliCommand(graph, trail, options));

export const deriveCliCommands = (
  graph: Topo,
  options?: DeriveCliCommandsOptions
): Result<CliCommand[], Error> => {
  const validation = validateCliCommandBuild(graph, options);
  if (validation.isErr()) {
    return validation;
  }

  const commands = collectCommands(graph, options);
  try {
    validateCliCommands(commands);
    return Result.ok(commands);
  } catch (error: unknown) {
    return Result.err(
      error instanceof Error ? error : new Error(String(error))
    );
  }
};
