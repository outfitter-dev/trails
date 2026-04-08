/**
 * Build framework-agnostic CliCommand[] from an App's topology.
 */

import type {
  Field,
  Layer,
  ResourceOverrideMap,
  Topo,
  TrailContext,
  TrailContextInit,
} from '@ontrails/core';
import {
  Result,
  TRAILHEAD_KEY,
  ValidationError,
  deriveCliPath,
  deriveFields,
  executeTrail,
  validateEstablishedTopo,
} from '@ontrails/core';

import type { AnyTrail, CliCommand, CliFlag } from './command.js';
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
  readonly trail: AnyTrail;
}

/** Options for buildCliCommands. */
export interface BuildCliCommandsOptions {
  /** Config values for resources that declare a `config` schema, keyed by resource ID. */
  configValues?: Readonly<Record<string, Record<string, unknown>>> | undefined;
  createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  layers?: Layer[] | undefined;
  onResult?: ((ctx: ActionResultContext) => Promise<void>) | undefined;
  presets?: CliFlag[][] | undefined;
  resources?: ResourceOverrideMap | undefined;
  resolveInput?: InputResolver | undefined;
  /** Set to `false` to skip topo validation while building commands. */
  validate?: boolean | undefined;
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

const assertValidCliTopo = (
  app: Topo,
  options?: BuildCliCommandsOptions
): void => {
  if (options?.validate === false) {
    return;
  }

  const validated = validateEstablishedTopo(app);
  if (validated.isErr()) {
    throw validated.error;
  }
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
  const mergedInput: Record<string, unknown> = {
    ...structuredInput,
    ...parsedArgs,
  };
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
  options?: BuildCliCommandsOptions
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
  options: BuildCliCommandsOptions | undefined,
  ctx: ActionResultContext
): Promise<void> => {
  if (options?.onResult) {
    await options.onResult(ctx);
  }
};

/** Merge context overrides with the CLI trailhead marker. */
const withCliTrailhead = (
  ctxOverrides: Partial<TrailContext> | undefined
): Partial<TrailContext> => ({
  ...ctxOverrides,
  extensions: {
    ...ctxOverrides?.extensions,
    [TRAILHEAD_KEY]: 'cli' as const,
  },
});

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
  options?: BuildCliCommandsOptions
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
  options?: BuildCliCommandsOptions
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
    t: AnyTrail,
    fields: readonly Field[],
    metaFlagNames: ReadonlySet<string>,
    shouldHintStructuredInput: boolean,
    options?: BuildCliCommandsOptions
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
        trail: t,
      });
      return merged;
    }
    const { mergedInput, usedStructuredInput } = merged.value;

    const result = await executeTrail(t, mergedInput, {
      configValues: options?.configValues,
      createContext: options?.createContext,
      ctx: withCliTrailhead(ctxOverrides),
      layers: options?.layers,
      resources: options?.resources,
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
      trail: t,
    });
    return finalResult;
  };

/** Derive and merge flags for a trail. */
const buildFlags = (
  t: AnyTrail,
  fields: readonly Field[],
  intent: 'read' | 'write' | 'destroy',
  options?: BuildCliCommandsOptions
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

/** Convert a trail or route into a CLI command when it is publicly exposed. */
const toCliCommand = (
  t: AnyTrail,
  options?: BuildCliCommandsOptions
): CliCommand => {
  const fields = deriveFields(t.input, t.fields);
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
    args: [],
    description: t.description,
    execute: createExecute(
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
  app: Topo,
  options?: BuildCliCommandsOptions
): CliCommand[] =>
  app
    .list()
    .filter((trail) => trail.meta?.['internal'] !== true)
    .map((trail) => toCliCommand(trail, options));

export const buildCliCommands = (
  app: Topo,
  options?: BuildCliCommandsOptions
): CliCommand[] => {
  assertValidCliTopo(app, options);
  const commands = collectCommands(app, options);
  validateCliCommands(commands);
  return commands;
};
