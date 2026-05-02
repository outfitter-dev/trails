/**
 * Application entry point — scans module exports to build a topology graph.
 */

import type { AnyContour } from './contour.js';
import { ValidationError } from './errors.js';
import type { ActivationEntry } from './activation-source.js';
import {
  getLateBoundSignalRef,
  parseLateBoundSignalMarker,
} from './internal/signal-ref.js';
import {
  hasObserveCapabilities,
  isLogger,
  isLogSink,
  isObserveConfig,
  isObserveInput,
  isTraceSink,
  normalizeObserve,
} from './observe.js';
import type { ObserveConfig, TopoOptions } from './observe.js';
import type { AnySignal } from './signal.js';
import type { AnyResource } from './resource.js';
import { isResource } from './resource.js';
import type { AnyTrail } from './trail.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TopoIdentity {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
}

export interface Topo {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly contours: ReadonlyMap<string, AnyContour>;
  readonly trails: ReadonlyMap<string, AnyTrail>;
  readonly signals: ReadonlyMap<string, AnySignal>;
  readonly resources: ReadonlyMap<string, AnyResource>;
  readonly observe?: ObserveConfig | undefined;
  readonly count: number;
  readonly contourCount: number;
  readonly resourceCount: number;
  getContour(name: string): AnyContour | undefined;
  get(id: string): AnyTrail | undefined;
  getResource(id: string): AnyResource | undefined;
  hasContour(name: string): boolean;
  has(id: string): boolean;
  hasResource(id: string): boolean;
  contourIds(): string[];
  ids(): string[];
  resourceIds(): string[];
  listContours(): AnyContour[];
  list(): AnyTrail[];
  listSignals(): AnySignal[];
  listResources(): AnyResource[];
}

// ---------------------------------------------------------------------------
// Kind discriminant check
// ---------------------------------------------------------------------------

type Registrable = AnyContour | AnyTrail | AnySignal | AnyResource;

const isRegistrable = (value: unknown): value is Registrable => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { kind } = value as Record<string, unknown>;
  return kind === 'contour' || kind === 'trail' || kind === 'signal';
};

// ---------------------------------------------------------------------------
// Topo implementation
// ---------------------------------------------------------------------------

const createTopo = (
  identity: TopoIdentity,
  contours: ReadonlyMap<string, AnyContour>,
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>,
  resources: ReadonlyMap<string, AnyResource>,
  observe: ObserveConfig | undefined
): Topo => ({
  contourCount: contours.size,
  contourIds(): string[] {
    return [...contours.keys()];
  },
  contours,
  count: trails.size,
  get(id: string): AnyTrail | undefined {
    return trails.get(id);
  },
  getContour(contourName: string): AnyContour | undefined {
    return contours.get(contourName);
  },
  getResource(id: string): AnyResource | undefined {
    return resources.get(id);
  },
  has(id: string): boolean {
    return trails.has(id);
  },
  hasContour(contourName: string): boolean {
    return contours.has(contourName);
  },
  hasResource(id: string): boolean {
    return resources.has(id);
  },
  ids(): string[] {
    return [...trails.keys()];
  },

  list(): AnyTrail[] {
    return [...trails.values()];
  },
  listContours(): AnyContour[] {
    return [...contours.values()];
  },
  listResources(): AnyResource[] {
    return [...resources.values()];
  },

  listSignals(): AnySignal[] {
    return [...signals.values()];
  },

  name: identity.name,
  ...(identity.version !== undefined && { version: identity.version }),
  ...(identity.description !== undefined && {
    description: identity.description,
  }),
  ...(observe !== undefined && { observe }),
  resourceCount: resources.size,
  resourceIds(): string[] {
    return [...resources.keys()];
  },
  resources,
  signals,
  trails,
});

// ---------------------------------------------------------------------------
// topo()
// ---------------------------------------------------------------------------

const registerUnique = <T>(
  collection: Map<string, T>,
  id: string,
  value: T,
  duplicateMessage: string
): void => {
  const existing = collection.get(id);
  if (existing === value) {
    return;
  }
  if (existing !== undefined) {
    throw new ValidationError(duplicateMessage);
  }
  collection.set(id, value);
};

const registerContour = (
  contour: AnyContour,
  contours: Map<string, AnyContour>
): void => {
  registerUnique(
    contours,
    contour.name,
    contour,
    `Duplicate contour name: "${contour.name}"`
  );
};

const registerResourceValue = (
  resource: AnyResource,
  resources: Map<string, AnyResource>
): void => {
  registerUnique(
    resources,
    resource.id,
    resource,
    `Duplicate resource ID: "${resource.id}"`
  );
};

const registerSignal = (
  signal: AnySignal,
  signals: Map<string, AnySignal>
): void => {
  registerUnique(
    signals,
    signal.id,
    signal,
    `Duplicate signal ID: "${signal.id}"`
  );
};

const registerResourceSignals = (
  resource: AnyResource,
  signals: Map<string, AnySignal>
): void => {
  for (const derived of resource.signals ?? []) {
    registerSignal(derived, signals);
  }
};

const registerTrail = (
  trail: AnyTrail,
  trails: Map<string, AnyTrail>
): void => {
  registerUnique(trails, trail.id, trail, `Duplicate trail ID: "${trail.id}"`);
};

const registerLateBoundSignalId = (
  byToken: Map<string, Set<string>>,
  signal: AnySignal
): void => {
  const ref = getLateBoundSignalRef(signal);
  if (!ref) {
    return;
  }

  const ids = byToken.get(ref.token) ?? new Set<string>();
  ids.add(signal.id);
  byToken.set(ref.token, ids);
};

const collectLateBoundSignalIdsByToken = (
  resources: ReadonlyMap<string, AnyResource>
): ReadonlyMap<string, readonly string[]> => {
  const byToken = new Map<string, Set<string>>();

  for (const resource of resources.values()) {
    for (const signal of resource.signals ?? []) {
      registerLateBoundSignalId(byToken, signal);
    }
  }

  return new Map(
    [...byToken.entries()].map(([token, ids]) => [token, [...ids]])
  );
};

const resolveLateBoundSignalId = (
  trailId: string,
  signalId: string,
  lateBoundSignalIdsByToken: ReadonlyMap<string, readonly string[]>
): string => {
  const marker = parseLateBoundSignalMarker(signalId);
  if (!marker) {
    return signalId;
  }

  const matches = lateBoundSignalIdsByToken.get(marker.token) ?? [];
  if (matches.length === 1) {
    return matches[0] ?? signalId;
  }

  if (matches.length === 0) {
    // Intentional throw: split-topo composition (where a trail and the
    // store that backs its signals live in different topos) is not yet
    // supported. Failing loudly here surfaces the case at assembly time
    // instead of silently producing a trail with an unresolved store
    // reference that would misbehave at runtime.
    throw new ValidationError(
      `Trail "${trailId}" references store-derived signal "${marker.displayId}", but no resource bound in this topo exposes it. ` +
        'This usually means the store that backs this signal is not bound in this topo. ' +
        `Bind the store via resource() in the same topo() call as "${trailId}", or compose this topo with the topo that binds the store. ` +
        'Splitting a trail and its backing store across independent topos is not yet supported.'
    );
  }

  throw new ValidationError(
    `Trail "${trailId}" references late-bound signal "${marker.displayId}" but it resolves to multiple bound resource signals: ${matches.join(', ')}. Use canonical scoped ids when the same store definition is bound more than once.`
  );
};

const resolveTrailSignalIds = (
  trailId: string,
  signalIds: readonly string[],
  lateBoundSignalIdsByToken: ReadonlyMap<string, readonly string[]>
): { changed: boolean; ids: readonly string[] } => {
  let changed = false;
  const ids = Object.freeze(
    signalIds.map((signalId) => {
      const resolved = resolveLateBoundSignalId(
        trailId,
        signalId,
        lateBoundSignalIdsByToken
      );
      changed ||= resolved !== signalId;
      return resolved;
    })
  );

  return { changed, ids };
};

const resolveTrailActivationSources = (
  trailId: string,
  activations: readonly ActivationEntry[],
  lateBoundSignalIdsByToken: ReadonlyMap<string, readonly string[]>
): { changed: boolean; activations: readonly ActivationEntry[] } => {
  let changed = false;
  const resolved = Object.freeze(
    activations.map((entry) => {
      if (entry.source.kind !== 'signal') {
        return entry;
      }

      const resolvedId = resolveLateBoundSignalId(
        trailId,
        entry.source.id,
        lateBoundSignalIdsByToken
      );
      if (resolvedId === entry.source.id) {
        return entry;
      }

      changed = true;
      return Object.freeze({
        ...entry,
        source: Object.freeze({ ...entry.source, id: resolvedId }),
      });
    })
  );

  return { activations: resolved, changed };
};

const finalizeTrailSignals = (
  trails: ReadonlyMap<string, AnyTrail>,
  resources: ReadonlyMap<string, AnyResource>
): Map<string, AnyTrail> => {
  const lateBoundSignalIdsByToken = collectLateBoundSignalIdsByToken(resources);
  const finalized = new Map<string, AnyTrail>();

  for (const trail of trails.values()) {
    const resolvedFires = resolveTrailSignalIds(
      trail.id,
      trail.fires ?? [],
      lateBoundSignalIdsByToken
    );
    const resolvedOn = resolveTrailSignalIds(
      trail.id,
      trail.on ?? [],
      lateBoundSignalIdsByToken
    );
    const resolvedActivationSources = resolveTrailActivationSources(
      trail.id,
      trail.activationSources ?? [],
      lateBoundSignalIdsByToken
    );

    if (
      !resolvedFires.changed &&
      !resolvedOn.changed &&
      !resolvedActivationSources.changed
    ) {
      finalized.set(trail.id, trail);
      continue;
    }

    finalized.set(
      trail.id,
      Object.freeze({
        ...trail,
        activationSources: resolvedActivationSources.activations,
        fires: resolvedFires.ids,
        on: resolvedOn.ids,
      })
    );
  }

  return finalized;
};

/** Register a single registrable value into the appropriate map. */
const register = (
  value: Registrable,
  contours: Map<string, AnyContour>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyResource>
): void => {
  switch (value.kind) {
    case 'contour': {
      registerContour(value as AnyContour, contours);
      break;
    }
    case 'resource': {
      registerResourceValue(value as AnyResource, resources);
      break;
    }
    case 'signal': {
      registerSignal(value as AnySignal, signals);
      break;
    }
    case 'trail': {
      registerTrail(value as AnyTrail, trails);
      break;
    }
    default: {
      throw new ValidationError('Unsupported registrable value in topo()');
    }
  }
};

const registerTrailContours = (
  trail: AnyTrail,
  contours: Map<string, AnyContour>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyResource>
): void => {
  for (const contour of trail.contours ?? []) {
    register(contour, contours, trails, signals, resources);
  }
};

const markUniqueObject = (
  value: unknown,
  seenValues: WeakSet<object>
): boolean => {
  if (typeof value !== 'object' || value === null) {
    return true;
  }
  if (seenValues.has(value)) {
    return false;
  }
  seenValues.add(value);
  return true;
};

const registerModuleValue = (
  value: unknown,
  contours: Map<string, AnyContour>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyResource>
): void => {
  if (isResource(value) || isRegistrable(value)) {
    register(value, contours, trails, signals, resources);
  }

  if (isResource(value)) {
    registerResourceSignals(value, signals);
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'trail'
  ) {
    registerTrailContours(
      value as AnyTrail,
      contours,
      trails,
      signals,
      resources
    );
  }
};

const registerModuleValues = (
  mod: Record<string, unknown>,
  contours: Map<string, AnyContour>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyResource>
): void => {
  const seenValues = new WeakSet<object>();
  for (const value of Object.values(mod)) {
    if (!markUniqueObject(value, seenValues)) {
      continue;
    }
    registerModuleValue(value, contours, trails, signals, resources);
  }
};

const TOPO_OPTION_KEYS = ['observe'] as const;
const TOPO_OPTION_KEY_SET: ReadonlySet<string> = new Set(TOPO_OPTION_KEYS);

/**
 * Brand symbol applied by `topo.options()`. The presence of this symbol
 * marks an object as an explicit `TopoOptions` payload, which is the
 * unambiguous way to disambiguate a trailing options object from a
 * trailing module export. Use `topo.options()` whenever a module might
 * legitimately export only fields whose names collide with topo options
 * (for example a module whose sole export is `observe`).
 */
const TOPO_OPTIONS_BRAND: unique symbol = Symbol('trails.topo.options');

const hasOptionsBrand = (value: object): boolean =>
  (value as { [TOPO_OPTIONS_BRAND]?: true })[TOPO_OPTIONS_BRAND] === true;

const looksLikeTopoOptionsShape = (value: object): boolean => {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  return keys.every((key) => TOPO_OPTION_KEY_SET.has(key));
};

const detectUnknownOptionKeys = (value: object): readonly string[] => {
  const unknown: string[] = [];
  for (const key of Object.keys(value)) {
    if (!TOPO_OPTION_KEY_SET.has(key)) {
      unknown.push(key);
    }
  }
  return unknown;
};

const hasRegistrableKind = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { kind } = value as { kind?: unknown };
  return (
    kind === 'contour' ||
    kind === 'trail' ||
    kind === 'signal' ||
    kind === 'resource'
  );
};

/**
 * When a branded `topo.options()` payload carries a bare `LogSink` in the
 * `observe` slot, rewrite it to the explicit `{ log: sink }` form. The brand
 * already signals "this is options, not a module"; once that is settled, a
 * bare `LogSink` unambiguously names a log target and should not be rejected
 * as ambiguous downstream.
 *
 * Bare `TraceSink` values (no `name` field) are left untouched — they already
 * round-trip through `normalizeObserve` via the `isTraceSink` fallthrough.
 * Already-disambiguated shapes (`{ log }`, `{ trace }`, `Logger`,
 * `ObserveCapable`, etc.) are also left untouched.
 */
const disambiguateBrandedObserve = (options: TopoOptions): TopoOptions => {
  const { observe } = options;
  if (
    observe === undefined ||
    isLogger(observe) ||
    isObserveConfig(observe) ||
    hasObserveCapabilities(observe)
  ) {
    return options;
  }
  if (isLogSink(observe)) {
    return { ...options, observe: { log: observe } };
  }
  return options;
};

/**
 * Decide whether the trailing argument should be treated as a
 * `TopoOptions` payload, a module export, or rejected as ambiguous.
 *
 * Resolution rules (in order):
 *   1. Branded via `topo.options()` → always options. Unknown option
 *      keys throw, and downstream `normalizeObserve` rejects malformed
 *      values. A bare `LogSink` (`{ name, write }`) in the `observe`
 *      slot is auto-routed to `{ log: sink }` so the brand is the
 *      complete escape hatch the docs promise.
 *   2. The shape does not look like `TopoOptions` (mixed keys or no
 *      keys) → module.
 *   3. The trailing arg is a registrable module export
 *      (`kind: 'trail' | 'contour' | …`) under a known option key →
 *      module. Preserves the "module exporting a single trail named
 *      `observe`" case that the warden and existing apps rely on.
 *   4. The `observe` value is a bare `LogSink` or `TraceSink` (a sink
 *      shape that could equally plausibly be a module export named
 *      `observe`) → throw, since the call is genuinely ambiguous.
 *      `topo.options()` exists to disambiguate.
 *   5. The `observe` value is otherwise a recognizable `ObserveInput`
 *      (`Logger`, `ObserveConfig`, or `ObserveCapable`) → options.
 *      Those shapes carry enough structure that they cannot be
 *      mistaken for a generic module export.
 *   6. Otherwise (non-sink helper object, function, primitive, etc.)
 *      → module. The non-registrable export is silently ignored, the
 *      same as any other unrecognized value in a module record.
 */
const classifyTrailingArgument = (
  value: unknown
):
  | { readonly kind: 'options'; readonly options: TopoOptions }
  | { readonly kind: 'module' }
  | { readonly kind: 'invalid'; readonly message: string } => {
  if (typeof value !== 'object' || value === null) {
    return { kind: 'module' };
  }

  if (hasOptionsBrand(value)) {
    const unknown = detectUnknownOptionKeys(value);
    if (unknown.length > 0) {
      return {
        kind: 'invalid',
        message: `topo.options() received unknown option keys: ${unknown
          .map((key) => `"${key}"`)
          .join(', ')}. Expected one of: ${TOPO_OPTION_KEYS.map(
          (key) => `"${key}"`
        ).join(', ')}.`,
      };
    }
    // Branding via `topo.options()` is the documented escape hatch for
    // disambiguating bare-sink shorthand. Route a bare `LogSink` into the
    // explicit `{ log: sink }` slot before handing off to `normalizeObserve`,
    // which would otherwise reject it as ambiguous (a LogSink shape matches
    // both `isLogSink` and `isTraceSink`). A bare TraceSink (no `name`) does
    // not need rewriting because `normalizeObserve` already routes it via
    // the `isTraceSink` fallthrough.
    return {
      kind: 'options',
      options: disambiguateBrandedObserve(value as TopoOptions),
    };
  }

  if (!looksLikeTopoOptionsShape(value)) {
    return { kind: 'module' };
  }

  // The shape matches `TopoOptions`. Decide whether the values are
  // valid options, a registrable module export, or a non-registrable
  // helper that should be treated as a (silently ignored) module
  // export.
  const observeValue = (value as TopoOptions).observe;
  if (hasRegistrableKind(observeValue)) {
    return { kind: 'module' };
  }
  // Unambiguous option shapes: `Logger`, `ObserveConfig`, and
  // `ObserveCapable` carry enough structure that they cannot be
  // confused with a generic module export. Check these first so the
  // sink-ambiguity guard below does not accidentally reject an
  // `ObserveCapable` whose underlying shape happens to also satisfy
  // `isLogSink` / `isTraceSink`.
  if (
    isLogger(observeValue) ||
    isObserveConfig(observeValue) ||
    hasObserveCapabilities(observeValue)
  ) {
    return { kind: 'options', options: value as TopoOptions };
  }
  // Bare sink shapes (`{ write }` / `{ name, write }`) are genuinely
  // ambiguous — they may equally plausibly be a module export named
  // `observe`. Refuse to guess; require `topo.options()` to make the
  // intent explicit.
  if (isLogSink(observeValue) || isTraceSink(observeValue)) {
    return {
      kind: 'invalid',
      message:
        'topo() received a trailing argument shaped like `{ observe: sink }` that is ambiguous: ' +
        'the value matches both a TopoOptions sink and a non-registrable module export. ' +
        'Wrap the options with `topo.options({ observe: sink })` to disambiguate.',
    };
  }
  if (isObserveInput(observeValue)) {
    // Catch-all for any future `ObserveInput` variant added to the
    // type. Today this branch is unreachable given the guards above.
    return { kind: 'options', options: value as TopoOptions };
  }
  // Non-registrable, non-sink helper. Treat as a module export; the
  // unrecognized value is silently ignored during registration, matching
  // the behavior of any other non-registrable export.
  return { kind: 'module' };
};

const splitTopoArguments = (
  modulesOrOptions: readonly (Record<string, unknown> | TopoOptions)[]
): {
  readonly modules: readonly Record<string, unknown>[];
  readonly options: TopoOptions | undefined;
} => {
  // A branded `topo.options(...)` payload is an explicit user signal and must
  // appear last. If it shows up in a non-trailing position the caller almost
  // certainly intended it as options but lost the configuration silently.
  // Reject it so the misconfiguration is visible at construction.
  for (let i = 0; i < modulesOrOptions.length - 1; i += 1) {
    const arg = modulesOrOptions[i];
    if (typeof arg === 'object' && arg !== null && hasOptionsBrand(arg)) {
      throw new ValidationError(
        `topo.options(...) must be the final argument to topo(); received at position ${i + 2} of ${modulesOrOptions.length + 1}.`
      );
    }
  }

  const last = modulesOrOptions.at(-1);
  const classification = classifyTrailingArgument(last);

  if (classification.kind === 'invalid') {
    throw new ValidationError(classification.message);
  }
  if (classification.kind === 'options') {
    return {
      modules: modulesOrOptions.slice(0, -1) as Record<string, unknown>[],
      options: classification.options,
    };
  }
  return {
    modules: modulesOrOptions as readonly Record<string, unknown>[],
    options: undefined,
  };
};

/**
 * Brand a plain `TopoOptions` payload so `topo()` treats the trailing
 * argument as options unambiguously, regardless of which keys it
 * contains. Useful when a module export shape would otherwise collide
 * with the inline shorthand (e.g. a module exporting only `observe`).
 *
 * @example
 * ```ts
 * topo('app', userTrails, topo.options({ observe: traceSink }));
 * ```
 */
const describeNonPlainObject = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
};

const brandTopoOptions = (options: TopoOptions): TopoOptions => {
  // Reject non-plain-object inputs up front. `{ ...options }` happily
  // accepts `null`, `undefined`, primitives, and arrays, silently
  // producing an empty branded payload that callers would then assume
  // carried real options. Throwing here mirrors the strict handling
  // applied to other malformed options elsewhere in the classifier.
  if (
    typeof options !== 'object' ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new ValidationError(
      `topo.options() expects a plain options object; received ${describeNonPlainObject(
        options
      )}`
    );
  }
  // Return a fresh object rather than mutating the caller's payload.
  // Mutating in place breaks frozen / non-extensible inputs (for example
  // `topo.options(Object.freeze({ observe: sink }))`), which would throw
  // a `TypeError` from `Object.defineProperty` even though the value is
  // a valid `TopoOptions` shape.
  const branded = { ...options };
  Object.defineProperty(branded, TOPO_OPTIONS_BRAND, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return branded;
};

interface TopoFn {
  (
    nameOrIdentity: string | TopoIdentity,
    ...modulesOrOptions: (Record<string, unknown> | TopoOptions)[]
  ): Topo;
  /**
   * Brand a plain `TopoOptions` payload so `topo()` treats the trailing
   * argument as options unambiguously, regardless of key shape. Use this
   * when a module export shape might otherwise collide with the inline
   * options shorthand.
   */
  readonly options: (options: TopoOptions) => TopoOptions;
}

const topoImpl = (
  nameOrIdentity: string | TopoIdentity,
  ...modulesOrOptions: (Record<string, unknown> | TopoOptions)[]
): Topo => {
  const identity: TopoIdentity =
    typeof nameOrIdentity === 'string'
      ? { name: nameOrIdentity }
      : nameOrIdentity;
  const { modules, options } = splitTopoArguments(modulesOrOptions);
  const observe = normalizeObserve(options?.observe);

  const contours = new Map<string, AnyContour>();
  const trails = new Map<string, AnyTrail>();
  const signals = new Map<string, AnySignal>();
  const resources = new Map<string, AnyResource>();

  for (const mod of modules) {
    registerModuleValues(mod, contours, trails, signals, resources);
  }

  return createTopo(
    identity,
    contours,
    finalizeTrailSignals(trails, resources),
    signals,
    resources,
    observe
  );
};

export const topo: TopoFn = Object.assign(topoImpl, {
  options: brandTopoOptions,
});
