/**
 * Build framework-agnostic CliCommand[] from a graph topology.
 */

import type {
  BasePermit,
  BaseSurfaceOptions,
  Field,
  Layer,
  LayerInputSchema,
  ResourceOverrideMap,
  TrailVersionReference,
  Topo,
  TrailContext,
  TrailContextInit,
} from '@ontrails/core';
import {
  Result,
  ValidationError,
  basePermitSchema,
  collectAttachedTypedLayers as collectTypedLayers,
  deriveCliPath,
  deriveFields,
  deriveSurfaceTrailVersionProjections,
  executeTrail,
  filterSurfaceTrails,
  LAYER_FIELD_RESERVED_NAMES,
  LAYER_FIELD_RESERVED_NAMES_KEBAB,
  projectLayerFieldName,
  validateSurfaceTopo,
  withSurfaceLayerNames,
} from '@ontrails/core';

import type { AnyTrail, CliArg, CliCommand, CliFlag } from './command.js';
import {
  detectDateFieldKinds,
  detectDateFields,
  expandDateShortcuts,
} from './date-shortcuts.js';
import type { DateShortcutKind } from './date-shortcuts.js';
import { dryRunPreset, toFlags, trailVersionPreset } from './flags.js';
import {
  inputHasCursorField,
  isPaginatedOutput,
  iteratePages,
  writeJsonLine,
} from './pagination.js';
import type { InputResolver } from './prompt.js';
import {
  STRUCTURED_INPUT_HINT,
  hasStructuredOnlyFields,
  kebabToCamel,
  normalizeParsedFlags,
  resolveStructuredInput,
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
  /**
   * True when the executor already streamed the trail's items to stdout
   * (e.g. paginated `--all --jsonl`). Result handlers should skip writing
   * the result value to avoid duplicate output.
   */
  readonly streamed?: boolean | undefined;
}

export interface ResolveCliPermitFromTokenInput {
  readonly configValues?: BaseSurfaceOptions['configValues'] | undefined;
  readonly graph: Topo;
  readonly requestId: string;
  readonly resources?: ResourceOverrideMap | undefined;
  readonly token: string;
}

export type ResolveCliPermitFromToken = (
  input: ResolveCliPermitFromTokenInput
) => Promise<Result<BasePermit, Error>> | Result<BasePermit, Error>;

/** Options for CLI command projection. */
export interface DeriveCliCommandsOptions extends BaseSurfaceOptions {
  createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  layers?: readonly Layer[] | undefined;
  onResult?: ((ctx: ActionResultContext) => Promise<void>) | undefined;
  presets?: readonly (readonly CliFlag[])[] | undefined;
  resources?: ResourceOverrideMap | undefined;
  resolvePermitFromToken?: ResolveCliPermitFromToken | undefined;
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

const RESERVED_STRUCTURED_INPUT_META_FLAGS = new Set(['input']);

const mergeStructuredInputFlags = (derived: CliFlag[]): CliFlag[] => {
  const filteredDerived = derived.filter(
    (flag) => !RESERVED_STRUCTURED_INPUT_META_FLAGS.has(kebabToCamel(flag.name))
  );
  return mergeFlags(structuredInputPreset(), filteredDerived);
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
const STRUCTURED_INLINE_JSON_ARG_NAME = 'inline-json';

const STRUCTURED_INLINE_JSON_ARG: CliArg = {
  description: 'Inline JSON object to merge before explicit flags',
  name: STRUCTURED_INLINE_JSON_ARG_NAME,
  required: false,
  variadic: false,
};

/**
 * Parse and validate the `--permit '<json>'` flag value.
 *
 * Returns `Result.err(ValidationError)` for non-string inputs, JSON parse
 * failures, or schema mismatches. Returns `Result.ok(undefined)` when the
 * flag is unset so callers can avoid clobbering an inherited permit.
 */
const parsePermitFlag = (
  raw: unknown
): Result<BasePermit | undefined, ValidationError> => {
  if (raw === undefined) {
    return Result.ok();
  }
  if (typeof raw !== 'string') {
    return Result.err(
      new ValidationError('--permit expects a JSON string value')
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return Result.err(
      new ValidationError(`--permit value is not valid JSON: ${detail}`)
    );
  }
  const validated = basePermitSchema.safeParse(parsed);
  if (!validated.success) {
    return Result.err(
      new ValidationError(
        `--permit JSON does not match the BasePermit shape ({ id: string; scopes: string[] }): ${validated.error.message}`
      )
    );
  }
  return Result.ok(validated.data);
};

// ---------------------------------------------------------------------------
// --token resolution
// ---------------------------------------------------------------------------

/**
 * Parse and validate the `--token <value>` flag.
 *
 * Returns `Result.ok(undefined)` when the flag is unset so callers can skip
 * the configured permit resolver.
 */
const parseTokenFlag = (
  raw: unknown
): Result<string | undefined, ValidationError> => {
  if (raw === undefined) {
    return Result.ok();
  }
  if (typeof raw !== 'string') {
    return Result.err(new ValidationError('--token expects a string value'));
  }
  if (raw.length === 0) {
    return Result.err(new ValidationError('--token must not be empty'));
  }
  return Result.ok(raw);
};

/** Auto-derived flag for paginated trails: --all triggers iteration. */
const paginatePreset = (): CliFlag[] => [
  {
    default: false,
    description: 'Iterate all pages and aggregate results',
    name: 'all',
    required: false,
    type: 'boolean',
    variadic: false,
  },
];

/** Merge parsed args and flags into a camelCase input record. */
const mergeArgsAndFlags = (
  metaFlagNames: ReadonlySet<string>,
  structuredInput: Record<string, unknown>,
  parsedArgs: Record<string, unknown>,
  parsedFlags: Record<string, unknown>
): Record<string, unknown> => {
  const mergedInput: Record<string, unknown> = { ...structuredInput };
  // Only merge defined positional args — undefined means the user omitted it.
  for (const [key, value] of Object.entries(parsedArgs)) {
    if (value === undefined) {
      continue;
    }
    mergedInput[key] = value;
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

const splitStructuredInlineJsonArg = (
  parsedArgs: Record<string, unknown>
): {
  readonly positionalInlineJson: unknown;
  readonly trailArgs: Record<string, unknown>;
} => {
  const {
    [STRUCTURED_INLINE_JSON_ARG_NAME]: positionalInlineJson,
    ...trailArgs
  } = parsedArgs;
  return { positionalInlineJson, trailArgs };
};

/**
 * Apply date-shortcut expansion in place over a merged-input record.
 *
 * Throws a `ValidationError` when any field carries a malformed
 * shortcut-shaped value so the surrounding `safeMergeInput` can route
 * the failure through the standard onResult path.
 */
const applyDateShortcutsInPlace = (
  mergedInput: Record<string, unknown>,
  dateFields: readonly string[],
  dateFieldKinds: Readonly<Record<string, DateShortcutKind>>
): void => {
  if (dateFields.length === 0) {
    return;
  }
  const expansion = expandDateShortcuts(
    mergedInput,
    dateFields,
    new Date(),
    dateFieldKinds
  );
  if (!expansion.ok) {
    throw new ValidationError(expansion.message, {
      context: { field: expansion.field },
    });
  }
  for (const field of dateFields) {
    if (field in expansion.value) {
      mergedInput[field] = expansion.value[field];
    }
  }
};

const resolveMergedInput = async (
  fields: readonly Field[],
  metaFlagNames: ReadonlySet<string>,
  dateFields: readonly string[],
  dateFieldKinds: Readonly<Record<string, DateShortcutKind>>,
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
  const { positionalInlineJson, trailArgs } =
    splitStructuredInlineJsonArg(parsedArgs);

  const structuredInput = await resolveStructuredInput(
    structuredInputFlags,
    positionalInlineJson
  );
  const mergedInput = mergeArgsAndFlags(
    metaFlagNames,
    structuredInput.payload ?? {},
    trailArgs,
    normalizedFlags
  );
  await applyPrompting(fields, mergedInput, options);
  applyDateShortcutsInPlace(mergedInput, dateFields, dateFieldKinds);
  return {
    mergedInput,
    usedStructuredInput: structuredInput.used,
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
  dateFields: readonly string[],
  dateFieldKinds: Readonly<Record<string, DateShortcutKind>>,
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
        dateFields,
        dateFieldKinds,
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

/** Strip the --all meta flag from input so the trail's blaze never sees it. */
const stripAllFlag = (
  input: Record<string, unknown>
): Record<string, unknown> => {
  if (!('all' in input)) {
    return input;
  }
  const { all: _ignored, ...rest } = input;
  return rest;
};

/**
 * Run the trail once via `executeTrail`, returning the trail's Result.
 * Used both for non-paginated commands and as the per-page runner for
 * paginated `--all` iteration.
 */
const runTrailOnce = async (
  graph: Topo,
  t: AnyTrail,
  ctxOverrides: Partial<TrailContext> | undefined,
  options: DeriveCliCommandsOptions | undefined,
  input: Record<string, unknown>,
  dryRun: boolean | undefined,
  permit: BasePermit | undefined,
  version: TrailVersionReference | undefined,
  layerInputs: Readonly<Record<string, unknown>> | undefined
): Promise<Result<unknown, Error>> =>
  await executeTrail(t, input, {
    configValues: options?.configValues,
    createContext: options?.createContext,
    ctx: withSurfaceLayerNames('cli', options?.layers ?? [], ctxOverrides),
    dryRun,
    ...(layerInputs === undefined || Object.keys(layerInputs).length === 0
      ? {}
      : { layerInputs }),
    ...(permit === undefined ? {} : { permit }),
    resources: options?.resources,
    surfaceLayers: options?.layers,
    topo: graph,
    topoLayers: graph.layers,
    ...(version === undefined ? {} : { version }),
  });

/**
 * Read the parsed `--dry-run` flag value.
 *
 * Accepts both the kebab-case (`'dry-run'`) and camelCase (`'dryRun'`)
 * forms so callers don't have to normalize before invoking `execute`.
 * Returns `undefined` when the flag is absent so custom context factories can
 * provide their own `ctx.dryRun` default.
 */
const readDryRunFlag = (
  parsedFlags: Record<string, unknown>,
  metaFlagNames: ReadonlySet<string>
): boolean | undefined => {
  if (!metaFlagNames.has('dryRun')) {
    return undefined;
  }
  if (parsedFlags['dryRun'] === true || parsedFlags['dry-run'] === true) {
    return true;
  }
  if (parsedFlags['dryRun'] === false || parsedFlags['dry-run'] === false) {
    return false;
  }
  return undefined;
};

const readTrailVersionFlag = (
  parsedFlags: Record<string, unknown>,
  metaFlagNames: ReadonlySet<string>
): TrailVersionReference | undefined => {
  if (!metaFlagNames.has('trailVersion')) {
    return undefined;
  }
  const value = parsedFlags['trailVersion'] ?? parsedFlags['trail-version'];
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : undefined;
};

/**
 * Decide whether the executor should iterate this invocation.
 *
 * Iteration kicks in when the trail's output schema matches the paginated
 * shape AND the user passed `--all`.
 */
const shouldIteratePages = (
  t: AnyTrail,
  parsedFlags: Record<string, unknown>,
  metaFlagNames: ReadonlySet<string>
): boolean =>
  metaFlagNames.has('all') &&
  isPaginatedOutput(t) &&
  parsedFlags['all'] === true;

const isJsonlMode = (parsedFlags: Record<string, unknown>): boolean =>
  parsedFlags['jsonl'] === true ||
  (typeof parsedFlags['output'] === 'string' &&
    parsedFlags['output'] === 'jsonl');

interface IterationOutcome {
  readonly result: Result<unknown, Error>;
  readonly streamed: boolean;
}

/**
 * Drain a paginated trail across pages and return the aggregated/streamed
 * outcome. The base input is what the user provided (after merging args +
 * flags); the iteration helper rewrites the cursor field per page.
 */
const runPaginatedIteration = async (
  graph: Topo,
  t: AnyTrail,
  ctxOverrides: Partial<TrailContext> | undefined,
  options: DeriveCliCommandsOptions | undefined,
  baseInput: Record<string, unknown>,
  jsonl: boolean,
  dryRun: boolean | undefined,
  permit: BasePermit | undefined,
  version: TrailVersionReference | undefined,
  layerInputs: Readonly<Record<string, unknown>> | undefined
): Promise<IterationOutcome> => {
  if (!inputHasCursorField(t)) {
    return {
      result: Result.err(
        new ValidationError(
          `Trail '${t.id}' has paginated output but no 'cursor' field on its input schema; cannot iterate with --all.`,
          { context: { trailId: t.id } }
        )
      ),
      streamed: false,
    };
  }
  const result = await iteratePages({
    baseInput: stripAllFlag(baseInput),
    cursorField: 'cursor',
    onItem: jsonl ? writeJsonLine : undefined,
    runPage: (input) =>
      runTrailOnce(
        graph,
        t,
        ctxOverrides,
        options,
        input,
        dryRun,
        permit,
        version,
        layerInputs
      ),
  });
  return { result, streamed: jsonl && result.isOk() };
};

/**
 * Synthetic permit identifier injected by `--dev-permit`. Distinctive on
 * purpose so accidental production use shows up clearly in trace records
 * and audit logs.
 */
const DEV_PERMIT_ID = 'dev-permit';

/**
 * Read the `--dev-permit` boolean flag, accepting either the kebab-case
 * (`'dev-permit'`) or camelCase (`'devPermit'`) form so callers don't
 * have to normalize.
 */
const readDevPermitFlag = (parsedFlags: Record<string, unknown>): boolean =>
  parsedFlags['devPermit'] === true || parsedFlags['dev-permit'] === true;

/**
 * Collect every scope declared by any trail on the resolved topo.
 *
 * The synthetic dev permit needs to satisfy every permit-protected trail
 * the user might invoke. Because `findMissingScopes` does literal string
 * matching (no wildcard recognition), the synthetic permit's `scopes`
 * array enumerates the union of declared scopes across the topo.
 */
const collectAllDeclaredScopes = (graph: Topo): readonly string[] => {
  const scopes = new Set<string>();
  for (const trail of graph.list()) {
    const requirement = trail.permit;
    if (requirement === undefined || requirement === 'public') {
      continue;
    }
    for (const scope of requirement.scopes) {
      scopes.add(scope);
    }
  }
  return [...scopes];
};

/**
 * Build the synthetic full-access permit injected by `--dev-permit`.
 *
 * Returns a `BasePermit` whose `scopes` enumerate every scope declared
 * across the topo. The id is the literal string `'dev-permit'` so trace
 * records and audit logs make accidental production use obvious.
 *
 * @remarks Scope coverage is bounded by `topo.list()`. Trails on a child or
 * mounted topo (Phase 7) won't contribute scopes here; that case will need
 * to walk the mounted hierarchy when cross-app composition lands. Trails
 * filtered out of `topo.list()` (e.g. by a future tier filter) are likewise
 * not represented in the synthesized permit.
 */
const synthesizeDevPermit = (graph: Topo): BasePermit => ({
  id: DEV_PERMIT_ID,
  scopes: collectAllDeclaredScopes(graph),
});

/**
 * Reconcile `--permit`, `--token`, and `--dev-permit` into a single
 * `BasePermit | undefined` for the execution pipeline.
 *
 * The three flags are pairwise mutually exclusive: passing any
 * combination surfaces a `ValidationError` (exit 1). When only `--token`
 * is supplied the auth adapter resolves it into a permit; failures map
 * to `AuthError` (exit 9). When `--dev-permit` is supplied, a synthetic
 * permit covering every scope declared on the topo is injected. When
 * none of the three registered meta flags are supplied the call returns
 * `Result.ok(undefined)` so callers preserve any inherited permit. Parsed
 * values with the same names are ignored when the command did not project the
 * corresponding meta flag, allowing trails to own fields such as `token`.
 */
const resolvePermitForExecution = async (
  graph: Topo,
  parsedFlags: Record<string, unknown>,
  metaFlagNames: ReadonlySet<string>,
  options: DeriveCliCommandsOptions | undefined
): Promise<Result<BasePermit | undefined, Error>> => {
  const permitParsed = metaFlagNames.has('permit')
    ? parsePermitFlag(parsedFlags['permit'])
    : Result.ok<BasePermit | undefined>();
  if (permitParsed.isErr()) {
    return permitParsed;
  }
  const tokenParsed = metaFlagNames.has('token')
    ? parseTokenFlag(parsedFlags['token'])
    : Result.ok<string | undefined>();
  if (tokenParsed.isErr()) {
    return tokenParsed;
  }
  const devPermit =
    metaFlagNames.has('devPermit') && readDevPermitFlag(parsedFlags);

  const conflicts: string[] = [];
  if (permitParsed.value !== undefined) {
    conflicts.push('--permit');
  }
  if (tokenParsed.value !== undefined) {
    conflicts.push('--token');
  }
  if (devPermit) {
    conflicts.push('--dev-permit');
  }
  if (conflicts.length > 1) {
    return Result.err(
      new ValidationError(
        `${conflicts.join(', ')} are mutually exclusive; pass only one.`
      )
    );
  }

  if (devPermit) {
    return Result.ok(synthesizeDevPermit(graph));
  }
  if (tokenParsed.value === undefined) {
    return Result.ok(permitParsed.value);
  }
  if (options?.resolvePermitFromToken === undefined) {
    return Result.err(
      new ValidationError(
        '--token requires a CLI permit resolver supplied via resolvePermitFromToken.'
      )
    );
  }
  const requestId = Bun.randomUUIDv7();
  return await options.resolvePermitFromToken({
    configValues: options.configValues,
    graph,
    requestId,
    resources: options.resources,
    token: tokenParsed.value,
  });
};

// ---------------------------------------------------------------------------
// Layer flag projection (TRL-473)
// ---------------------------------------------------------------------------

/**
 * Per-layer flag projection: the rendered flags plus the routing map that
 * sends parsed flag values back into the layer's runtime input slot.
 */
interface LayerFlagProjection {
  /** The rendered `CliFlag` set contributed by this layer. */
  readonly flags: readonly CliFlag[];
  /** The layer input schema, kept so omitted CLI flags can still materialize defaults. */
  readonly input: LayerInputSchema;
  /**
   * Map from camelCase parsed-flag key to the layer-input field name the
   * value should be assigned to. Used by the executor to rebuild the
   * per-layer input record before calling `executeTrail`.
   */
  readonly routing: ReadonlyMap<string, string>;
  readonly layerName: string;
}

/**
 * Collect every typed layer attached to a trail, in the same composition
 * order the executor uses (topo → surface → trail). Layers without an
 * `input` schema are skipped — they have nothing to project.
 *
 * Thin adapter over the surface-agnostic `collectAttachedTypedLayers`
 * helper from `@ontrails/core` so the CLI continues to operate on a flat
 * `readonly Layer[]` while every surface shares one collection rule.
 */
const collectAttachedTypedLayers = (
  graph: Topo,
  t: AnyTrail,
  options?: DeriveCliCommandsOptions
): readonly Layer[] =>
  collectTypedLayers(graph, t, options?.layers).map(({ layer }) => layer);

/**
 * Convert a `Layer.name` (typically camelCase) into a kebab-case prefix
 * usable in flag names. Mirrors `flags.ts` `toKebab` so the prefix stays
 * consistent with derived flag names.
 */
const layerNameToKebab = (name: string): string =>
  name.replaceAll(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`).replace(/^-/, '');

/**
 * Emit the deprecation-style stderr warning fired when a layer flag is
 * renamed because of a collision. Using `process.stderr.write` follows
 * the same boundary used elsewhere in the CLI surface.
 */
const warnLayerFlagRenamed = (
  layerName: string,
  originalName: string,
  renamedName: string,
  reason: string
): void => {
  process.stderr.write(
    `[trails] layer "${layerName}" flag --${originalName} renamed to --${renamedName} (${reason})\n`
  );
};

/**
 * Project a single layer's `input` schema onto a CLI flag set, applying
 * the deterministic collision rename rule.
 *
 * Collision rule: if the layer's derived flag name (after kebab-casing)
 * conflicts with an already-claimed flag name (trail-derived flag,
 * meta flag, or a previous layer's flag), the field is renamed to
 * `<layerNameKebab>-<fieldKebab>`. Renames emit a one-line warning to
 * stderr so the operator can see the projected name.
 */
const projectSingleLayerFlags = (
  layer: Layer,
  claimedFlagNames: Set<string>
): LayerFlagProjection => {
  if (layer.input === undefined) {
    throw new Error(
      `Cannot project CLI flags for layer '${layer.name}' without an input schema.`
    );
  }
  const layerInput = layer.input;
  const layerFields = deriveFields(layer.input);
  const layerKebab = layerNameToKebab(layer.name);
  const flags: CliFlag[] = [];
  const routing = new Map<string, string>();

  for (const flag of toFlags(layerFields)) {
    const projection = projectLayerFieldName(
      layer.name,
      flag.name,
      flag.name,
      `${layerKebab}-${flag.name}`,
      claimedFlagNames,
      LAYER_FIELD_RESERVED_NAMES_KEBAB
    );
    const claimedKebab = projection.claimedName;
    const claimedCamel = kebabToCamel(claimedKebab);
    const originalCamel = kebabToCamel(projection.routingTarget);
    if (projection.renamed) {
      const reason =
        projection.reason === 'reserved-name'
          ? `--${projection.originalName} collides with a CLI meta flag`
          : `--${projection.originalName} collides with another flag`;
      warnLayerFlagRenamed(
        layer.name,
        projection.originalName,
        projection.claimedName,
        reason
      );
      flags.push({ ...flag, name: claimedKebab });
    } else {
      flags.push(flag);
    }
    routing.set(claimedCamel, originalCamel);
  }

  return { flags, input: layerInput, layerName: layer.name, routing };
};

/**
 * Project every attached layer's input schema onto the command's flag set.
 *
 * Returns the full list of layer-derived flags (in composition order) plus
 * the per-layer routing maps the executor needs to partition parsed flag
 * values back into per-layer input objects.
 */
const projectLayerFlags = (
  attachedLayers: readonly Layer[],
  trailDerivedFlagNames: ReadonlySet<string>
): {
  readonly flags: readonly CliFlag[];
  readonly projections: readonly LayerFlagProjection[];
} => {
  const claimed = new Set<string>(trailDerivedFlagNames);
  const allFlags: CliFlag[] = [];
  const projections: LayerFlagProjection[] = [];
  for (const layer of attachedLayers) {
    const projection = projectSingleLayerFlags(layer, claimed);
    if (projection.flags.length === 0) {
      continue;
    }
    allFlags.push(...projection.flags);
    projections.push(projection);
  }
  return { flags: allFlags, projections };
};

/**
 * Build the `layerInputs` map from parsed flags using each layer's
 * projection routing table. Only includes layers that actually received
 * at least one parsed value, so tests can assert presence cleanly.
 */
const buildLayerInputs = (
  projections: readonly LayerFlagProjection[],
  parsedFlags: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const projection of projections) {
    const layerInput: Record<string, unknown> = {};
    let received = false;
    for (const [parsedKey, fieldName] of projection.routing) {
      const value = parsedFlags[parsedKey];
      if (value === undefined) {
        continue;
      }
      layerInput[fieldName] = value;
      received = true;
    }
    if (received) {
      result[projection.layerName] = layerInput;
      continue;
    }
    if (projection.input.safeParse({}).success) {
      result[projection.layerName] = {};
    }
  }
  return result;
};

/**
 * Collect every camelCase key that any layer projection routes through —
 * those are flag names the executor must keep out of the trail's input
 * record (alongside the existing meta flags).
 */
const collectLayerRoutedKeys = (
  projections: readonly LayerFlagProjection[]
): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const projection of projections) {
    for (const key of projection.routing.keys()) {
      keys.add(key);
    }
  }
  return keys;
};

/** Create the execute function for a CLI command. */
const createExecute =
  (
    graph: Topo,
    t: AnyTrail,
    fields: readonly Field[],
    trailInputExcludeKeys: ReadonlySet<string>,
    dateFields: readonly string[],
    dateFieldKinds: Readonly<Record<string, DateShortcutKind>>,
    shouldHintStructuredInput: boolean,
    layerProjections: readonly LayerFlagProjection[],
    options?: DeriveCliCommandsOptions
  ) =>
  async (
    parsedArgs: Record<string, unknown>,
    parsedFlags: Record<string, unknown>,
    ctxOverrides?: Partial<TrailContext>
  ): Promise<Result<unknown, Error>> => {
    const merged = await safeMergeInput(
      fields,
      trailInputExcludeKeys,
      dateFields,
      dateFieldKinds,
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

    const permitResolution = await resolvePermitForExecution(
      graph,
      parsedFlags,
      trailInputExcludeKeys,
      options
    );
    if (permitResolution.isErr()) {
      const errResult: Result<unknown, Error> = Result.err(
        permitResolution.error
      );
      await reportResult(options, {
        args: parsedArgs,
        flags: parsedFlags,
        input: mergedInput,
        result: errResult,
        topoName: graph.name,
        trail: t,
      });
      return errResult;
    }
    const permit = permitResolution.value;

    // Partition parsed flags into per-layer input objects via the
    // projection routing tables. Projected camelCase keys are normalized
    // first because Commander emits camelCase-looking keys, but tests and
    // adapters may pass either kebab- or camelCase.
    const normalizedFlags = normalizeParsedFlags(parsedFlags);
    const layerInputs = buildLayerInputs(layerProjections, normalizedFlags);

    const dryRun = readDryRunFlag(parsedFlags, trailInputExcludeKeys);
    const trailVersion = readTrailVersionFlag(
      parsedFlags,
      trailInputExcludeKeys
    );
    let result: Result<unknown, Error>;
    let streamed = false;
    if (shouldIteratePages(t, parsedFlags, trailInputExcludeKeys)) {
      const outcome = await runPaginatedIteration(
        graph,
        t,
        ctxOverrides,
        options,
        mergedInput,
        isJsonlMode(parsedFlags),
        dryRun,
        permit,
        trailVersion,
        layerInputs
      );
      ({ result } = outcome);
      ({ streamed } = outcome);
    } else {
      result = await runTrailOnce(
        graph,
        t,
        ctxOverrides,
        options,
        trailInputExcludeKeys.has('all')
          ? stripAllFlag(mergedInput)
          : mergedInput,
        dryRun,
        permit,
        trailVersion,
        layerInputs
      );
    }

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
      streamed,
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
  let flags = toFlags(fields, t.fields);
  if (supportsStructuredInput(t.input)) {
    flags = mergeStructuredInputFlags(flags);
  }
  if (isPaginatedOutput(t) && inputHasCursorField(t)) {
    flags = mergeFlags(paginatePreset(), flags);
  }
  if (options?.presets) {
    flags = mergeFlags(options.presets.flat(), flags);
  }
  if (t.version !== undefined) {
    flags = mergeFlags(trailVersionPreset(), flags);
  }
  if (intent === 'destroy' || intent === 'write') {
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
    return {
      args: [fieldToArg(candidates[0])],
    };
  }

  return { args: [] };
};

const addStructuredInlineJsonArg = (
  args: readonly CliArg[],
  shouldAdd: boolean
): CliArg[] => (shouldAdd ? [...args, STRUCTURED_INLINE_JSON_ARG] : [...args]);

/** Convert a trail or route into a CLI command when it is publicly exposed. */
const toCliCommand = (
  graph: Topo,
  t: AnyTrail,
  options?: DeriveCliCommandsOptions
): CliCommand => {
  const fields = deriveFields(t.input, t.fields);
  // All fields generate flags — positional fields keep their --flag alias
  const trailFlags = buildFlags(t, fields, t.intent, options);
  const structuredInputReservedNames = supportsStructuredInput(t.input)
    ? RESERVED_STRUCTURED_INPUT_META_FLAGS
    : new Set<string>();
  const derivedFlagNames = new Set(
    toFlags(fields)
      .map((flag) => kebabToCamel(flag.name))
      .filter((name) => !structuredInputReservedNames.has(name))
  );
  const metaFlagNames = new Set(
    trailFlags
      .map((flag) => kebabToCamel(flag.name))
      .filter(
        (name) =>
          LAYER_FIELD_RESERVED_NAMES.has(name) && !derivedFlagNames.has(name)
      )
  );

  // Project each typed layer's `input` schema onto the command's flag set,
  // applying the deterministic collision rename rule. The routing map
  // returned per layer is consumed at execute time to rebuild a per-layer
  // input object from parsed flags. (TRL-473)
  const attachedTypedLayers = collectAttachedTypedLayers(graph, t, options);
  const claimedFlagKebabs = new Set<string>(trailFlags.map((f) => f.name));
  const layerProjection = projectLayerFlags(
    attachedTypedLayers,
    claimedFlagKebabs
  );
  const flags = [...trailFlags, ...layerProjection.flags];
  const layerRoutedKeys = collectLayerRoutedKeys(layerProjection.projections);
  // The executor strips both meta flags and layer-routed flag values from
  // the trail input so layer-only flags never reach trail validation.
  const trailInputExcludeKeys = new Set<string>([
    ...metaFlagNames,
    ...layerRoutedKeys,
  ]);

  const shouldHintStructuredInput = hasStructuredOnlyFields(
    t.input,
    fields.length
  );
  const { args: derivedArgs } = derivePositionalArgs(t, fields);
  const args = addStructuredInlineJsonArg(
    derivedArgs,
    shouldHintStructuredInput
  );
  const dateFields = detectDateFields(t.input);
  const dateFieldKinds = detectDateFieldKinds(t.input);
  const versions = deriveSurfaceTrailVersionProjections(t);

  return {
    args,
    description: t.description,
    execute: createExecute(
      graph,
      t,
      fields,
      trailInputExcludeKeys,
      dateFields,
      dateFieldKinds,
      shouldHintStructuredInput,
      layerProjection.projections,
      options
    ),
    flags,
    idempotent: t.idempotent,
    intent: t.intent,
    layers: options?.layers,
    path: deriveCliPath(t.id),
    trail: t,
    ...(versions === undefined ? {} : { versions }),
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

/**
 * Build an array of framework-agnostic CLI commands from a graph.
 *
 * @example
 * ```ts
 * import { deriveCliCommands } from '@ontrails/cli';
 *
 * const commands = deriveCliCommands(graph, { include: ['entity.**'] });
 * if (commands.isErr()) throw commands.error;
 *
 * for (const command of commands.value) {
 *   console.log(command.path.join(' '));
 * }
 * ```
 */
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
