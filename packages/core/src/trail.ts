import type { z } from 'zod';

import { ValidationError } from './errors.js';
import type {
  ActivationEntry,
  ActivationEntrySpec,
  ActivationSource,
  ActivationSourceRef,
} from './activation-source.js';
import {
  isActivationEntrySpec,
  isActivationSource,
} from './activation-source.js';
import type { AnyContour } from './contour.js';
import type { FieldOverride } from './derive.js';
import type { Layer } from './layer.js';
import type { Result } from './result.js';
import type { AnyResource } from './resource.js';
import type { AnySignal } from './signal.js';
import {
  createLateBoundSignalMarker,
  getLateBoundSignalRef,
} from './signal-ref.js';
import type { TrailsError } from './errors.js';
import type {
  Detour,
  Implementation,
  PermitRequirement,
  TrailContext,
} from './types.js';
import { zodToJsonSchema } from './validation.js';

// ---------------------------------------------------------------------------
// Trail example
// ---------------------------------------------------------------------------

export interface TrailExampleSignalAssertion {
  /** Signal contract object or stable signal ID expected during the example. */
  readonly signal: AnySignal | string;
  /** Exact payload assertion for the fired signal. */
  readonly payload?: unknown | undefined;
  /** Partial payload assertion; declared fields must match, extras ignored. */
  readonly payloadMatch?: unknown | undefined;
  /** Number of matching fired signals expected. Defaults to one. */
  readonly times?: number | undefined;
}

/**
 * A named example for documentation and testing.
 *
 * The `input` field accepts `Partial<I>` so that fields with schema defaults
 * (e.g. `z.number().default(20)`) can be omitted from examples. The schema
 * fills in defaults at validation time.
 */
export interface TrailExample<I, O> {
  /** Human-readable name */
  readonly name: string;
  /** Optional description of what this example demonstrates */
  readonly description?: string | undefined;
  /** The input value — fields with schema defaults may be omitted */
  readonly input: Partial<I>;
  /** Expected output for success-path examples (deep equality) */
  readonly expected?: O | undefined;
  /** Partial output assertion — declared fields must match, others ignored */
  readonly expectedMatch?: Partial<O> | undefined;
  /** Error class name for error-path examples */
  readonly error?: string | undefined;
  /** Signal fires expected while executing this example. */
  readonly signals?: readonly TrailExampleSignalAssertion[] | undefined;
}

// ---------------------------------------------------------------------------
// Blaze input — merges crossInput when declared
// ---------------------------------------------------------------------------

/**
 * The input type received by a trail's blaze function.
 *
 * When a trail declares `crossInput`, the runtime merges those fields into
 * the input object before calling blaze. This type makes the compiler aware
 * of the merged shape so developers can access crossInput fields without a
 * cast. Falls back to plain `I` when `CI` is `never` (the default).
 */
export type BlazeInput<I, CI> = [CI] extends [never] ? I : I & CI;

// ---------------------------------------------------------------------------
// Trail versioning
// ---------------------------------------------------------------------------

/** Contract pair represented by a version entry. */
export interface VersionContract<I = unknown, O = unknown> {
  readonly input: I;
  readonly output: O;
}

/** Shared lifecycle metadata for historical version entries. */
export interface TrailVersionStatus {
  readonly state: 'deprecated' | 'archived';
  readonly [key: string]: unknown;
}

/** Shared base for version entries. Historical entries never inherit schemas. */
export interface VersionEntry<
  TContract extends VersionContract = VersionContract,
> {
  readonly input: z.ZodType<TContract['input']>;
  readonly marker?: never;
  readonly output: z.ZodType<TContract['output']>;
  readonly status?: TrailVersionStatus | undefined;
}

export type TrailVersionTransposeInput<VersionInput, CurrentInput> = (value: {
  readonly input: VersionInput;
}) => CurrentInput | Promise<CurrentInput>;

export type TrailVersionTransposeOutput<CurrentOutput, VersionOutput> =
  (value: {
    readonly output: CurrentOutput;
  }) => VersionOutput | Promise<VersionOutput>;

export interface TrailVersionTranspose<
  VersionInput,
  VersionOutput,
  CurrentInput,
  CurrentOutput,
> {
  readonly input: TrailVersionTransposeInput<VersionInput, CurrentInput>;
  readonly output: TrailVersionTransposeOutput<CurrentOutput, VersionOutput>;
}

export interface TrailVersionRevisionEntry<
  VersionInput = unknown,
  VersionOutput = unknown,
  CurrentInput = unknown,
  CurrentOutput = unknown,
> extends VersionEntry<VersionContract<VersionInput, VersionOutput>> {
  readonly blaze?: never;
  readonly crossInput?: never;
  readonly crosses?: never;
  readonly detours?: never;
  readonly kind?: never;
  readonly resources?: never;
  readonly transpose?:
    | TrailVersionTranspose<
        VersionInput,
        VersionOutput,
        CurrentInput,
        CurrentOutput
      >
    | undefined;
}

export interface TrailVersionForkEntry<
  VersionInput = unknown,
  VersionOutput = unknown,
  CrossInput = never,
> extends VersionEntry<VersionContract<VersionInput, VersionOutput>> {
  readonly blaze: Implementation<
    BlazeInput<VersionInput, CrossInput>,
    VersionOutput
  >;
  readonly crosses?: readonly (string | AnyTrail)[] | undefined;
  readonly crossInput?: z.ZodType<CrossInput> | undefined;
  readonly detours?:
    | readonly Detour<VersionInput, VersionOutput, TrailsError>[]
    | undefined;
  readonly kind?: never;
  readonly resources?: readonly AnyResource[] | undefined;
  readonly transpose?: never;
}

export type TrailVersionEntry<
  VersionInput = unknown,
  VersionOutput = unknown,
  CurrentInput = unknown,
  CurrentOutput = unknown,
  CrossInput = never,
> =
  | TrailVersionRevisionEntry<
      VersionInput,
      VersionOutput,
      CurrentInput,
      CurrentOutput
    >
  | TrailVersionForkEntry<VersionInput, VersionOutput, CrossInput>;

export type TrailVersionEntryKind = 'revision' | 'fork';

export type TrailVersions<
  CurrentInput = unknown,
  CurrentOutput = unknown,
> = Readonly<
  Record<
    number,
    TrailVersionEntry<unknown, unknown, CurrentInput, CurrentOutput>
  >
>;

export const getTrailVersionEntryKind = (
  entry: TrailVersionEntry
): TrailVersionEntryKind => {
  const raw = entry as unknown as Record<string, unknown>;
  return typeof raw['blaze'] === 'function' ? 'fork' : 'revision';
};

export const isArchivedTrailVersionEntry = (
  entry: Pick<TrailVersionEntry, 'status'>
): boolean => entry.status?.state === 'archived';

export const deriveSupportedTrailVersions = (
  trail: Pick<AnyTrail, 'version' | 'versions'>
): readonly number[] => {
  if (trail.version === undefined) {
    return [];
  }

  const supported = new Set<number>([trail.version]);
  for (const [rawVersion, entry] of Object.entries(trail.versions ?? {})) {
    if (!isArchivedTrailVersionEntry(entry)) {
      supported.add(Number(rawVersion));
    }
  }

  return Object.freeze([...supported].toSorted((a, b) => a - b));
};

// ---------------------------------------------------------------------------
// Trail spec
// ---------------------------------------------------------------------------

/** Everything needed to define a trail (minus the id) */
export interface TrailSpec<I, O, CI = never> {
  /** Zod schema for validating input */
  readonly input: z.ZodType<I>;
  /** Zod schema for validating output (optional — some trails are fire-and-forget) */
  readonly output?: z.ZodType<O> | undefined;
  /** The pure function that does the work (sync or async authoring) */
  readonly blaze: Implementation<BlazeInput<I, CI>, O>;
  /** Human-readable description */
  readonly description?: string | undefined;
  /** Declared operational shape for governance, derivation, and agent guidance. */
  readonly pattern?: string | undefined;
  /** Named examples for docs and testing */
  readonly examples?: readonly TrailExample<I, O>[] | undefined;
  /** What this trail does to the world: read, write (default), or destroy */
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  /** Trail is idempotent (safe to retry) */
  readonly idempotent?: boolean | undefined;
  /**
   * Trail explicitly supports dry-run execution semantics.
   *
   * This is a declaration for governance, derivation, and surface tooling. It
   * does not change runtime behavior by itself; the active invocation signal is
   * `TrailContext.dryRun`.
   */
  readonly dryRun?: boolean | undefined;
  /** Whether surfaces expose this trail by default. */
  readonly visibility?: TrailVisibility | undefined;
  /** Arbitrary meta for tooling and filtering */
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  /** Recovery paths activated when blaze fails with a matching error class. */
  readonly detours?: readonly Detour<I, O, TrailsError>[] | undefined;
  /**
   * Typed layers attached at trail scope.
   *
   * Layers declared here wrap this trail's implementation on every execution,
   * regardless of which surface invokes it. The execution pipeline composes
   * trail-scope layers innermost — closer to the blaze than surface-scope
   * or topo-scope layers — so the final order is
   * `topo → surface → trail → blaze` (outermost-first).
   *
   * Layers are typed and inspectable. Omit `input` for surface-invisible
   * wrappers that do not project any fields.
   */
  readonly layers?: readonly Layer[] | undefined;
  /** Per-field overrides for deriveFields() (labels, hints, options) */
  readonly fields?: Readonly<Record<string, FieldOverride>> | undefined;
  /** Contours this trail operates on. */
  readonly contours?: readonly AnyContour[] | undefined;
  /** IDs or trail objects of downstream trails this trail may invoke via ctx.cross() */
  readonly crosses?: readonly (string | AnyTrail)[] | undefined;
  /**
   * Composition-only input schema — merged with `input` for `ctx.cross()` calls,
   * invisible to public surfaces (CLI, MCP, HTTP).
   *
   * Fields here are available in the blaze but are not derived into CLI flags,
   * MCP tool parameters, or HTTP request bodies. Use for data that only makes
   * sense when one trail crosses another (e.g. `forkedFrom`).
   */
  readonly crossInput?: z.ZodType<CI> | undefined;
  /** Resources this trail may access via resource.from(ctx) */
  readonly resources?: readonly AnyResource[] | undefined;
  /**
   * Signals this trail fires via `ctx.fire()`.
   *
   * Accepts either a string id or a `Signal` value. Both forms are
   * normalized to the signal's id at trail definition time, so
   * `trail.fires` is always `readonly string[]`.
   *
   * Note: `crosses` also accepts trail objects (normalized to IDs),
   * following the same pattern as signal references here.
   */
  readonly fires?: readonly (string | AnySignal)[] | undefined;
  /**
   * Activation sources that can invoke this trail.
   *
   * Bare strings and `Signal` values are signal-source shorthand. Object form
   * preserves the source kind and per-source metadata for the activation graph.
   */
  readonly on?:
    | readonly (ActivationEntrySpec | ActivationSourceRef)[]
    | undefined;
  /** Auth requirement: scopes object, 'public', or omitted (undeclared) */
  readonly permit?: PermitRequirement | undefined;
  /** Primary input fields and their order. CLI projects as positional args. */
  readonly args?: readonly string[] | false | undefined;
  /** Current trail version number. Omit for current-only unversioned trails. */
  readonly version?: number | undefined;
  /** Explicit historical trail versions. Current stays top-level. */
  readonly versions?: TrailVersions<I, O> | undefined;
  /** Version markers are projected into the resolved graph, not authored. */
  readonly marker?: never;
}

// ---------------------------------------------------------------------------
// Trail (the frozen runtime object)
// ---------------------------------------------------------------------------

/** Intent describes what a trail does to the world. */
export const intentValues = Object.freeze([
  'read',
  'write',
  'destroy',
] as const);

export type Intent = (typeof intentValues)[number];

/** Whether surfaces expose a trail by default. */
export type TrailVisibility = 'public' | 'internal';

/** A fully-defined trail — the unit of work in the Trails system */
export interface Trail<I, O, CI = never> extends Omit<
  TrailSpec<I, O, CI>,
  | 'args'
  | 'blaze'
  | 'contours'
  | 'crosses'
  | 'crossInput'
  | 'detours'
  | 'fires'
  | 'intent'
  | 'layers'
  | 'on'
  | 'resources'
> {
  readonly kind: 'trail';
  readonly id: string;
  readonly blaze: Implementation<BlazeInput<I, CI>, O>;
  /** Contours this trail operates on (always present, default []). */
  readonly contours: readonly AnyContour[];
  /** IDs of downstream trails this trail may invoke via ctx.cross() (always present, default []) */
  readonly crosses: readonly string[];
  /** Composition-only input schema, merged with `input` for ctx.cross() calls (optional) */
  readonly crossInput?: z.ZodType<CI> | undefined;
  /** Recovery paths activated when blaze fails with a matching error (always present, default []). */
  readonly detours: readonly Detour<I, O, TrailsError>[];
  /**
   * Typed layers attached at trail scope (always present, default []).
   *
   * Composed innermost in the layer chain — closest to the blaze. The final
   * composition order is `topo → surface → trail → blaze` (outermost-first).
   */
  readonly layers: readonly Layer[];
  /** Resources this trail may access via resource.from(ctx) (always present, default []) */
  readonly resources: readonly AnyResource[];
  /** IDs of signals this trail fires via ctx.fire() (always present, default []) */
  readonly fires: readonly string[];
  /**
   * IDs of signal sources that activate this trail (always present, default []).
   * Non-signal activation sources live in `activationSources`.
   */
  readonly on: readonly string[];
  /** Normalized activation source entries declared through `on` (always present, default []). */
  readonly activationSources: readonly ActivationEntry[];
  /** What this trail does to the world (always present, default 'write') */
  readonly intent: Intent;
  /** Whether surfaces expose this trail by default (always present, default 'public'). */
  readonly visibility: TrailVisibility;
  /** Primary input fields and their order (always present, default undefined) */
  readonly args?: readonly string[] | false | undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Canonical scoped-signal id shape: `<scope>:<table>.<event>`.
 *
 * Matches exactly one `:` separating a non-empty scope from a non-empty
 * dotted tail of at least two segments (e.g. `identity:users.created`).
 * The scope forbids only `:` and whitespace so resource ids may contain
 * dots for namespacing (e.g. `demo.store:gists.created`). Tail segments
 * forbid both `:` and `.` so strings like `foo:bar` (no dot) or
 * `a:b.c.d` stay unambiguous.
 */
const SCOPED_SIGNAL_ID = /^[^:\s]+:[^:.\s]+(?:\.[^:.\s]+)+$/;

const normalizeSignalRef = (entry: string | AnySignal): string => {
  if (typeof entry === 'string') {
    return entry;
  }

  const ref = getLateBoundSignalRef(entry);
  if (!ref) {
    return entry.id;
  }

  // Already-scoped canonical ids (e.g. "identity:users.created") must pass
  // through unchanged. Rewriting them to a bare marker token collapses
  // multi-binding cases where the same store definition is bound under two
  // separate resources: both bindings share the late-bound token, so the
  // caller's explicit choice of scope would be lost and topo resolution
  // would throw an ambiguity error.
  //
  // Use a strict predicate that matches the canonical scoped shape
  // `<scope>:<table>.<event>` (exactly one `:` separating a non-empty scope
  // from a non-empty dotted tail of at least two segments). A looser
  // `includes(':')` check would let unscoped ids that happen to contain `:`
  // slip past markerization and then fail to resolve at topo finalization.
  if (SCOPED_SIGNAL_ID.test(entry.id)) {
    return entry.id;
  }

  return createLateBoundSignalMarker(ref, entry.id);
};

const freezeActivationSource = (source: ActivationSource): ActivationSource =>
  Object.freeze({
    ...source,
    ...(source.meta === undefined
      ? {}
      : { meta: Object.freeze({ ...source.meta }) }),
  });

const shouldPreserveSignalSource = (source: ActivationSource): boolean =>
  source.kind === 'signal' &&
  (!('payload' in source) ||
    'input' in source ||
    'parse' in source ||
    'cron' in source ||
    'timezone' in source);

const normalizeActivationSource = (
  source: ActivationSourceRef
): ActivationSource => {
  if (typeof source === 'string') {
    return freezeActivationSource({ id: source, kind: 'signal' });
  }

  if (isActivationSource(source) && shouldPreserveSignalSource(source)) {
    return freezeActivationSource({
      ...source,
      id: normalizeSignalRef(source.id),
      kind: 'signal',
    });
  }

  if (isActivationSource(source) && source.kind !== 'signal') {
    return freezeActivationSource(source);
  }

  return freezeActivationSource({
    id: normalizeSignalRef(source as string | AnySignal),
    kind: 'signal',
  });
};

const normalizeActivationEntry = (
  entry: ActivationEntrySpec | ActivationSourceRef
): ActivationEntry => {
  const source = isActivationEntrySpec(entry) ? entry.source : entry;
  const normalized: ActivationEntry = {
    source: normalizeActivationSource(source),
    ...(isActivationEntrySpec(entry) && entry.meta !== undefined
      ? { meta: Object.freeze({ ...entry.meta }) }
      : {}),
    ...(isActivationEntrySpec(entry) && entry.where !== undefined
      ? { where: entry.where }
      : {}),
  };

  return Object.freeze(normalized);
};

const normalizeActivationSources = (
  entries: readonly (ActivationEntrySpec | ActivationSourceRef)[]
): readonly ActivationEntry[] =>
  Object.freeze(entries.map((entry) => normalizeActivationEntry(entry)));

const extractSignalActivationIds = (
  activations: readonly ActivationEntry[]
): readonly string[] =>
  Object.freeze(
    activations
      .filter((entry) => entry.source.kind === 'signal')
      .map((entry) => entry.source.id)
  );

/** Normalize a crosses entry — trail objects are reduced to their id. */
const normalizeCrossRef = (entry: string | AnyTrail): string =>
  typeof entry === 'string' ? entry : entry.id;

const assertVersionNumber = (
  trailId: string,
  label: string,
  version: number
): void => {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new ValidationError(
      `Trail "${trailId}" ${label} must be a positive integer`
    );
  }
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(value, key);

const ORDER_INSENSITIVE_SCHEMA_ARRAY_KEYS = new Set([
  'allOf',
  'anyOf',
  'enum',
  'oneOf',
  'required',
  'type',
]);

const canonicalizeVersionSchema = (
  value: unknown,
  parentKey?: string
): unknown => {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeVersionSchema(item));
    return parentKey !== undefined &&
      ORDER_INSENSITIVE_SCHEMA_ARRAY_KEYS.has(parentKey)
      ? items.toSorted((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right))
        )
      : items;
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = canonicalizeVersionSchema(
        (value as Record<string, unknown>)[key],
        key
      );
    }
    return sorted;
  }
  return value;
};

const schemasMatch = (left: z.ZodType, right: z.ZodType): boolean =>
  JSON.stringify(canonicalizeVersionSchema(zodToJsonSchema(left))) ===
  JSON.stringify(canonicalizeVersionSchema(zodToJsonSchema(right)));

const assertZodSchema = (
  trailId: string,
  version: number,
  entry: Record<string, unknown>,
  field: 'input' | 'output'
): void => {
  if (!hasOwn(entry, field) || entry[field] === undefined) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} must declare explicit ${field}`
    );
  }
};

const normalizeVersionStatus = (
  trailId: string,
  version: number,
  status: unknown
): TrailVersionStatus | undefined => {
  if (status === undefined) {
    return undefined;
  }
  if (typeof status !== 'object' || status === null || Array.isArray(status)) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} status must be an object`
    );
  }

  const raw = status as Record<string, unknown>;
  if (raw['state'] !== 'deprecated' && raw['state'] !== 'archived') {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} status.state must be "deprecated" or "archived"`
    );
  }

  return Object.freeze({ ...raw, state: raw['state'] }) as TrailVersionStatus;
};

const normalizeTranspose = (
  trailId: string,
  version: number,
  transpose: unknown
): TrailVersionTranspose<unknown, unknown, unknown, unknown> | undefined => {
  if (transpose === undefined) {
    return undefined;
  }
  if (
    typeof transpose !== 'object' ||
    transpose === null ||
    Array.isArray(transpose)
  ) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} transpose must be an object`
    );
  }

  const raw = transpose as Record<string, unknown>;
  if (
    typeof raw['input'] !== 'function' ||
    typeof raw['output'] !== 'function'
  ) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} transpose must define input and output functions`
    );
  }

  return Object.freeze({
    input: raw['input'],
    output: raw['output'],
  }) as TrailVersionTranspose<unknown, unknown, unknown, unknown>;
};

const assertRevisionOwnsNoRuntimeFields = (
  trailId: string,
  version: number,
  entry: Record<string, unknown>
): void => {
  const forbidden = ['crossInput', 'crosses', 'resources', 'detours'];
  const declared = forbidden.filter((field) => hasOwn(entry, field));
  if (declared.length > 0) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} is a revision and cannot declare ${declared.join(', ')}`
    );
  }
};

const normalizeVersionEntry = <CurrentInput, CurrentOutput>(
  trailId: string,
  version: number,
  currentInput: z.ZodType<CurrentInput>,
  currentOutput: z.ZodType<CurrentOutput> | undefined,
  entry: TrailVersionEntry<unknown, unknown, CurrentInput, CurrentOutput>
): TrailVersionEntry<unknown, unknown, CurrentInput, CurrentOutput> => {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} must be an object`
    );
  }

  const raw = entry as unknown as Record<string, unknown>;
  assertZodSchema(trailId, version, raw, 'input');
  assertZodSchema(trailId, version, raw, 'output');

  if (hasOwn(raw, 'kind')) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} must not author kind; it is projected`
    );
  }
  if (hasOwn(raw, 'marker')) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} must not author marker; it is projected`
    );
  }

  const hasBlaze = typeof raw['blaze'] === 'function';
  const hasTranspose = raw['transpose'] !== undefined;
  if (hasBlaze && hasTranspose) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} cannot declare both blaze and transpose`
    );
  }

  const base = {
    input: raw['input'],
    output: raw['output'],
    ...(raw['status'] === undefined
      ? {}
      : { status: normalizeVersionStatus(trailId, version, raw['status']) }),
  };

  if (hasBlaze) {
    return Object.freeze({
      ...base,
      blaze: async (input: unknown, ctx: TrailContext) =>
        await (raw['blaze'] as Implementation<unknown, unknown>)(input, ctx),
      ...(raw['crossInput'] === undefined
        ? {}
        : { crossInput: raw['crossInput'] }),
      crosses: Object.freeze(
        (
          (raw['crosses'] as readonly (string | AnyTrail)[] | undefined) ?? []
        ).map(normalizeCrossRef)
      ),
      detours: Object.freeze([
        ...(((raw['detours'] as readonly Detour<
          unknown,
          unknown,
          TrailsError
        >[]) ?? []) as readonly Detour<unknown, unknown, TrailsError>[]),
      ]),
      resources: Object.freeze([
        ...(((raw['resources'] as readonly AnyResource[]) ??
          []) as readonly AnyResource[]),
      ]),
    }) as TrailVersionEntry<unknown, unknown, CurrentInput, CurrentOutput>;
  }

  assertRevisionOwnsNoRuntimeFields(trailId, version, raw);
  const inputMatchesCurrent = schemasMatch(
    raw['input'] as z.ZodType,
    currentInput
  );
  const outputMatchesCurrent =
    currentOutput === undefined ||
    schemasMatch(raw['output'] as z.ZodType, currentOutput);
  if (!hasTranspose && (!inputMatchesCurrent || !outputMatchesCurrent)) {
    throw new ValidationError(
      `Trail "${trailId}" version ${version} changes schema and must declare transpose`
    );
  }

  return Object.freeze({
    ...base,
    ...(hasTranspose
      ? { transpose: normalizeTranspose(trailId, version, raw['transpose']) }
      : {}),
  }) as TrailVersionEntry<unknown, unknown, CurrentInput, CurrentOutput>;
};

const normalizeTrailVersions = <CurrentInput, CurrentOutput>(
  trailId: string,
  currentInput: z.ZodType<CurrentInput>,
  currentOutput: z.ZodType<CurrentOutput> | undefined,
  currentVersion: number | undefined,
  versions: TrailVersions<CurrentInput, CurrentOutput> | undefined
): TrailVersions<CurrentInput, CurrentOutput> | undefined => {
  if (currentVersion === undefined) {
    if (versions !== undefined) {
      throw new ValidationError(
        `Trail "${trailId}" declares versions without a current version`
      );
    }
    return undefined;
  }

  assertVersionNumber(trailId, 'version', currentVersion);

  if (versions === undefined) {
    return undefined;
  }
  if (
    typeof versions !== 'object' ||
    versions === null ||
    Array.isArray(versions)
  ) {
    throw new ValidationError(`Trail "${trailId}" versions must be an object`);
  }

  const normalized: Record<
    number,
    TrailVersionEntry<unknown, unknown, CurrentInput, CurrentOutput>
  > = {};
  for (const [rawVersion, entry] of Object.entries(versions)) {
    const historicalVersion = Number(rawVersion);
    if (`${historicalVersion}` !== rawVersion) {
      throw new ValidationError(
        `Trail "${trailId}" versions key "${rawVersion}" must be a positive integer`
      );
    }
    assertVersionNumber(trailId, `versions.${rawVersion}`, historicalVersion);
    if (historicalVersion === currentVersion) {
      throw new ValidationError(
        `Trail "${trailId}" version ${historicalVersion} is current and must stay top-level`
      );
    }
    if (historicalVersion > currentVersion) {
      throw new ValidationError(
        `Trail "${trailId}" version ${historicalVersion} must be less than the current version (${currentVersion})`
      );
    }
    normalized[historicalVersion] = normalizeVersionEntry(
      trailId,
      historicalVersion,
      currentInput,
      currentOutput,
      entry
    );
  }

  return Object.freeze(normalized);
};

/** Freeze and normalize all collection fields from a trail spec. */
const normalizeCollections = <I, O, CI>(
  spec: TrailSpec<I, O, CI>
): {
  readonly args: readonly string[] | false | undefined;
  readonly activationSources: readonly ActivationEntry[];
  readonly contours: readonly AnyContour[];
  readonly detours: readonly Detour<I, O, TrailsError>[];
  readonly fires: readonly string[];
  readonly layers: readonly Layer[];
  readonly on: readonly string[];
  readonly resources: readonly AnyResource[];
} => {
  const activationSources = normalizeActivationSources(spec.on ?? []);
  return {
    activationSources,
    args: Array.isArray(spec.args) ? Object.freeze([...spec.args]) : spec.args,
    contours: Object.freeze([...(spec.contours ?? [])]),
    detours: Object.freeze([...(spec.detours ?? [])]),
    fires: Object.freeze((spec.fires ?? []).map(normalizeSignalRef)),
    layers: Object.freeze([...(spec.layers ?? [])]),
    on: extractSignalActivationIds(activationSources),
    resources: Object.freeze([...(spec.resources ?? [])]),
  };
};

/**
 * Create a trail definition.
 *
 * Returns a frozen object with `kind: "trail"` and all spec fields.
 * The trail is inert until handed to a runner.
 *
 * @example
 * ```typescript
 * // ID as first argument (recommended for human authoring)
 * const show = trail("entity.show", {
 *   input: z.object({ name: z.string() }),
 *   blaze: (input) => Result.ok(entity),
 * });
 *
 * // Full spec object (for programmatic generation)
 * const show = trail({
 *   id: "entity.show",
 *   input: z.object({ name: z.string() }),
 *   blaze: (input) => Result.ok(entity),
 * });
 * ```
 */
export function trail<I, O, CI = never>(
  id: string,
  spec: TrailSpec<I, O, CI>
): Trail<I, O, CI>;
export function trail<I, O, CI = never>(
  spec: TrailSpec<I, O, CI> & { readonly id: string }
): Trail<I, O, CI>;
export function trail<I, O, CI = never>(
  idOrSpec: string | (TrailSpec<I, O, CI> & { readonly id: string }),
  maybeSpec?: TrailSpec<I, O, CI>
): Trail<I, O, CI> {
  const resolved =
    typeof idOrSpec === 'string'
      ? { id: idOrSpec, spec: maybeSpec }
      : { id: idOrSpec.id, spec: idOrSpec };

  if (!resolved.spec) {
    throw new TypeError('trail() requires a spec when an id is provided');
  }
  if (hasOwn(resolved.spec as unknown as Record<string, unknown>, 'marker')) {
    throw new ValidationError(
      `Trail "${resolved.id}" must not author marker; it is projected`
    );
  }

  const {
    blaze,
    crossInput,
    crosses: rawCrosses,
    intent: rawIntent,
    visibility: rawVisibility,
    // Destructure away fields handled by normalizeCollections
    args: _a,
    contours: _c,
    detours: _d,
    fires: _f,
    layers: _l,
    on: _o,
    resources: _r,
    version: rawVersion,
    versions: rawVersions,
    ...spec
  } = resolved.spec;
  const collections = normalizeCollections(resolved.spec);
  const versions = normalizeTrailVersions<I, O>(
    resolved.id,
    resolved.spec.input,
    resolved.spec.output,
    rawVersion,
    rawVersions
  );

  return Object.freeze({
    ...spec,
    ...collections,
    blaze: async (input: BlazeInput<I, CI>, ctx: TrailContext) =>
      await blaze(input, ctx),
    crossInput,
    crosses: Object.freeze((rawCrosses ?? []).map(normalizeCrossRef)),
    id: resolved.id,
    intent: rawIntent ?? 'write',
    kind: 'trail' as const,
    ...(rawVersion === undefined ? {} : { version: rawVersion }),
    ...(versions === undefined ? {} : { versions }),
    visibility: rawVisibility ?? 'public',
  });
}

// Re-export types that callers of trail() will need
// The Omit+override avoids a TypeScript limitation where BlazeInput's conditional type
// makes Trail<any, any, any> structurally incompatible with Trail<I, O, never>.
/* oxlint-disable no-explicit-any -- existential type for heterogeneous collections */
export type AnyTrail = Omit<Trail<any, any, any>, 'blaze'> & {
  readonly blaze: Implementation<any, any>;
};
/* oxlint-enable no-explicit-any */

export type { Implementation, TrailContext, Result };
