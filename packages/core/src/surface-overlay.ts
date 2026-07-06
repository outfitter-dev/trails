/**
 * The app-authored `surfaces` overlay.
 *
 * `surfaceOverlay()` authors named bindings from a surface's namespace onto
 * trails — the shared vocabulary that subsumes CLI aliases and MCP trailheads.
 * A scalar binding is a synonym for one trail selector; a list binding is a
 * grouped entry over several selectors. The overlay lands in `trails.lock`
 * under the well-known `surfaces` namespace, and consumption helpers enforce
 * the provenance boundary: surfaces obey app-authored overlays only, so an
 * adapter can never inject a binding a surface obeys.
 */

import { z } from 'zod';

import type { CliCommandAliasInput } from './derive.js';
import { ValidationError } from './errors.js';
import type { Topo } from './topo.js';
import { matchesTrailIdGlob } from './trail-id-glob.js';

/**
 * The well-known lock overlay namespace owned by app-authored surface
 * bindings.
 *
 * @example
 * ```ts
 * import { SURFACES_OVERLAY_NAMESPACE } from '@ontrails/core';
 *
 * const facts = lock.topoGraph.overlays?.[SURFACES_OVERLAY_NAMESPACE];
 * ```
 */
export const SURFACES_OVERLAY_NAMESPACE = 'surfaces' as const;

/**
 * Who authored an overlay envelope.
 *
 * `'adapter-derived'` marks facts an adapter projects from the topo;
 * `'app-authored'` marks bindings the app wrote by hand. Surfaces obey
 * app-authored overlays only — adapters contribute facts, never bindings.
 *
 * @example
 * ```ts
 * import type { OverlayProvenance } from '@ontrails/core';
 *
 * const provenance: OverlayProvenance = 'app-authored';
 * ```
 */
export type OverlayProvenance = 'adapter-derived' | 'app-authored';

/**
 * One trail selector inside a surface binding: an exact trail id
 * (`'gear.list'`) or a dotted trail-id glob (`'snippet.*'`).
 *
 * @example
 * ```ts
 * import type { SurfaceBindingRef } from '@ontrails/core';
 *
 * const exact: SurfaceBindingRef = 'gear.list';
 * const glob: SurfaceBindingRef = 'snippet.*';
 * ```
 */
export type SurfaceBindingRef = string;

/**
 * The authored value of one surface binding. A scalar ref is a synonym for
 * one trail selector; a list of refs is a grouped entry. Value shape is the
 * discriminator — a singleton list is still a group.
 *
 * @example
 * ```ts
 * import type { SurfaceBindingValue } from '@ontrails/core';
 *
 * const synonym: SurfaceBindingValue = 'gear.list';
 * const group: SurfaceBindingValue = ['gear.create', 'gear.list'];
 * ```
 */
export type SurfaceBindingValue =
  | SurfaceBindingRef
  | readonly SurfaceBindingRef[];

/**
 * Named bindings for one surface: binding name to trail selector(s).
 *
 * @example
 * ```ts
 * import type { SurfaceBindings } from '@ontrails/core';
 *
 * const cli: SurfaceBindings = {
 *   gear: ['gear.create', 'gear.list'],
 *   ls: 'gear.list',
 * };
 * ```
 */
export type SurfaceBindings = Readonly<Record<string, SurfaceBindingValue>>;

/**
 * The full `surfaces` overlay payload: per-surface binding maps keyed by the
 * surfaces that can obey bindings today (`cli`, `http`, `mcp`, `ws`).
 *
 * @example
 * ```ts
 * import type { SurfaceOverlayBindings } from '@ontrails/core';
 *
 * const bindings: SurfaceOverlayBindings = {
 *   cli: { ls: 'gear.list' },
 *   mcp: { snippets: ['snippet.create', 'snippet.get'] },
 * };
 * ```
 */
export interface SurfaceOverlayBindings {
  readonly cli?: SurfaceBindings | undefined;
  readonly http?: SurfaceBindings | undefined;
  readonly mcp?: SurfaceBindings | undefined;
  readonly ws?: SurfaceBindings | undefined;
}

const surfaceBindingRefSchema = z.string().min(1);

const surfaceBindingValueSchema = z.union([
  surfaceBindingRefSchema,
  z.array(surfaceBindingRefSchema).min(1).readonly(),
]);

const surfaceBindingsRecordSchema = z.record(
  z.string().min(1),
  surfaceBindingValueSchema
);

/**
 * Schema for the `surfaces` overlay payload.
 *
 * Strict: only the `cli`, `http`, `mcp`, and `ws` surface keys are accepted.
 * Each surface maps non-empty binding names to a non-empty selector string or
 * a non-empty list of non-empty selector strings — a group with zero members
 * is rejected because it promises an entry that binds nothing.
 *
 * @example
 * ```ts
 * import { surfaceOverlayBindingsSchema } from '@ontrails/core';
 *
 * const parsed = surfaceOverlayBindingsSchema.safeParse({
 *   cli: { ls: 'gear.list' },
 * });
 * // parsed.success === true
 * ```
 */
export const surfaceOverlayBindingsSchema = z
  .object({
    cli: surfaceBindingsRecordSchema.optional(),
    http: surfaceBindingsRecordSchema.optional(),
    mcp: surfaceBindingsRecordSchema.optional(),
    ws: surfaceBindingsRecordSchema.optional(),
  })
  .strict();

const summarizeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.map(String).join('.')}: ${issue.message}`
    )
    .join('; ');

const parseSurfaceOverlayBindings = (
  value: unknown,
  remediation: string
): SurfaceOverlayBindings => {
  const parsed = surfaceOverlayBindingsSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      `The "${SURFACES_OVERLAY_NAMESPACE}" overlay bindings are invalid (${summarizeIssues(parsed.error)}). ${remediation}`
    );
  }
  return parsed.data;
};

/**
 * The classified shape of one surface binding value.
 *
 * Value shape is the discriminator, not cardinality: a scalar ref is a
 * synonym, and any list — including a singleton list — is a group.
 *
 * @example
 * ```ts
 * import type { SurfaceBindingShape } from '@ontrails/core';
 *
 * const shape: SurfaceBindingShape = { kind: 'synonym', trail: 'gear.list' };
 * ```
 */
export type SurfaceBindingShape =
  | { readonly kind: 'synonym'; readonly trail: SurfaceBindingRef }
  | { readonly kind: 'group'; readonly members: readonly SurfaceBindingRef[] };

/**
 * Classify a surface binding value by its authored shape.
 *
 * A scalar ref classifies as a synonym. A list classifies as a group — a
 * singleton list stays a group, because value shape (not member count) is
 * the discriminator between "another name for this trail" and "a grouped
 * entry over these trails".
 *
 * @example
 * ```ts
 * import { classifySurfaceBinding } from '@ontrails/core';
 *
 * classifySurfaceBinding('gear.list');
 * // => { kind: 'synonym', trail: 'gear.list' }
 * classifySurfaceBinding(['gear.list']);
 * // => { kind: 'group', members: ['gear.list'] }
 * ```
 */
export const classifySurfaceBinding = (
  value: SurfaceBindingValue
): SurfaceBindingShape =>
  typeof value === 'string'
    ? { kind: 'synonym', trail: value }
    : { kind: 'group', members: value };

/**
 * The app-authored `surfaces` overlay envelope.
 *
 * Structurally compatible with the adapter-kit `Overlay` contract — the
 * compile path collects it like any other overlay registration — while also
 * exposing {@link SurfaceOverlay.bindings} for direct reads without a derive
 * round-trip.
 *
 * @example
 * ```ts
 * import type { SurfaceOverlay } from '@ontrails/core';
 * import { surfaceOverlay } from '@ontrails/core';
 *
 * const overlay: SurfaceOverlay = surfaceOverlay({
 *   cli: { ls: 'gear.list' },
 * });
 * ```
 */
export interface SurfaceOverlay {
  /** Always the well-known `surfaces` namespace. */
  readonly namespace: typeof SURFACES_OVERLAY_NAMESPACE;
  /** Always app-authored — the provenance surfaces obey. */
  readonly provenance: 'app-authored';
  /** The bindings schema, enforced again on the compile path. */
  readonly schema: z.ZodType;
  /**
   * Project the overlay facts. Ignores the topo — bindings are authored —
   * so the parameter is optional; the signature stays structurally
   * assignable to the adapter-kit `Overlay` contract's `(topo) => unknown`.
   */
  readonly derive: (topo?: Topo) => SurfaceOverlayBindings;
  /** The validated bindings, for direct reads. */
  readonly bindings: SurfaceOverlayBindings;
}

/**
 * Author the `surfaces` overlay from per-surface bindings.
 *
 * Validates the bindings eagerly and throws a `ValidationError` with the
 * schema issues when they are invalid, so a bad binding fails where it was
 * authored instead of at compile time. The returned envelope's `derive`
 * returns the validated bindings and ignores the topo.
 *
 * @example
 * ```ts
 * import { surfaceOverlay } from '@ontrails/core';
 *
 * export const trailsOverlays = [
 *   surfaceOverlay({
 *     cli: { gear: ['gear.create', 'gear.list'], ls: 'gear.list' },
 *     mcp: { snippets: ['snippet.create', 'snippet.get', 'snippet.fork'] },
 *   }),
 * ];
 * ```
 */
export const surfaceOverlay = (
  bindings: SurfaceOverlayBindings
): SurfaceOverlay => {
  const validated = parseSurfaceOverlayBindings(
    bindings,
    'Fix the bindings passed to surfaceOverlay() and rerun `trails compile`.'
  );
  return {
    bindings: validated,
    derive: () => validated,
    namespace: SURFACES_OVERLAY_NAMESPACE,
    provenance: 'app-authored',
    schema: surfaceOverlayBindingsSchema,
  };
};

/**
 * The minimal structural shape of an overlay envelope the surface-overlay
 * consumption helpers can inspect.
 *
 * `derive` is declared with an optional topo because app-authored surface
 * overlays derive independently of the topo; adapter envelopes whose derive
 * requires the topo still match structurally, and the provenance gate
 * rejects them before their derive is ever invoked.
 *
 * @example
 * ```ts
 * import type { OverlayEnvelopeLike } from '@ontrails/core';
 * import { resolveSurfaceOverlayBindings } from '@ontrails/core';
 *
 * const bindings = resolveSurfaceOverlayBindings(
 *   trailsOverlays as readonly OverlayEnvelopeLike[]
 * );
 * ```
 */
export interface OverlayEnvelopeLike {
  /** The lock overlay namespace the envelope owns. */
  readonly namespace: string;
  /** Who authored the envelope. Absent means adapter-derived. */
  readonly provenance?: OverlayProvenance | undefined;
  /** The envelope's fact schema. */
  readonly schema: z.ZodType;
  /** Project the envelope's facts. */
  derive(topo?: Topo): unknown;
  /**
   * Static surface bindings, when the envelope carries them directly.
   *
   * `surfaceOverlay()` envelopes expose their validated bindings here;
   * consumption prefers this over invoking {@link derive}, so a `surfaces`
   * envelope must never derive facts that differ from its authored bindings.
   */
  readonly bindings?: unknown;
}

/**
 * Resolve the `surfaces` bindings from a collection of overlay envelopes.
 *
 * This is the provenance boundary: surfaces obey app-authored overlays only —
 * adapters contribute facts, never bindings. A `surfaces` envelope without
 * `provenance: 'app-authored'` (absent provenance is adapter-derived) throws
 * a `ValidationError` naming `surfaceOverlay()` as the fix, as does a
 * duplicate `surfaces` namespace or a derive result that fails the bindings
 * schema. Returns `undefined` when no `surfaces` envelope is present.
 *
 * @example
 * ```ts
 * import { resolveSurfaceOverlayBindings, surfaceOverlay } from '@ontrails/core';
 *
 * const bindings = resolveSurfaceOverlayBindings([
 *   surfaceOverlay({ cli: { ls: 'gear.list' } }),
 * ]);
 * // => { cli: { ls: 'gear.list' } }
 * ```
 */
export const resolveSurfaceOverlayBindings = (
  overlays: readonly OverlayEnvelopeLike[] | undefined
): SurfaceOverlayBindings | undefined => {
  const matches = (overlays ?? []).filter(
    (overlay) => overlay.namespace === SURFACES_OVERLAY_NAMESPACE
  );
  const [first] = matches;
  if (first === undefined) {
    return undefined;
  }
  if (matches.length > 1) {
    throw new ValidationError(
      `Duplicate "${SURFACES_OVERLAY_NAMESPACE}" overlay namespace. Author one surfaceOverlay() in the app module and remove the duplicate registration.`
    );
  }
  if (first.provenance !== 'app-authored') {
    throw new ValidationError(
      `The "${SURFACES_OVERLAY_NAMESPACE}" namespace obeys app-authored overlays only — adapters contribute facts, never bindings. Author the bindings with surfaceOverlay() in the app module.`
    );
  }
  return parseSurfaceOverlayBindings(
    first.bindings ?? first.derive(),
    'Author the bindings with surfaceOverlay() in the app module.'
  );
};

/**
 * Per-trail CLI alias inputs expanded from the `surfaces` overlay's `cli`
 * bindings: trail id to the absolute command paths that alias it.
 *
 * @example
 * ```ts
 * import type { CliSurfaceBindingAliases } from '@ontrails/core';
 *
 * const aliases: CliSurfaceBindingAliases = {
 *   'gear.list': [['gear', 'ls']],
 * };
 * ```
 */
export type CliSurfaceBindingAliases = Readonly<
  Record<string, readonly CliCommandAliasInput[]>
>;

const CLI_BINDING_FIX =
  'Fix the binding in surfaceOverlay({ cli }) in the app module.';

const assertCliBindingName = (name: string): readonly string[] => {
  const segments = name.split('.');
  if (segments.some((segment) => segment.length === 0 || /\s/.test(segment))) {
    throw new ValidationError(
      `The "${SURFACES_OVERLAY_NAMESPACE}" overlay cli binding "${name}" is not a valid command path — every dot-separated segment must be non-empty and contain no whitespace. ${CLI_BINDING_FIX}`
    );
  }
  return segments;
};

const expandSelector = (
  trailIds: readonly string[],
  selector: SurfaceBindingRef
): readonly string[] =>
  trailIds
    .filter((trailId) => matchesTrailIdGlob(trailId, selector))
    .toSorted();

const expandSynonymBinding = (
  trailIds: readonly string[],
  name: string,
  selector: SurfaceBindingRef
): string => {
  const matches = expandSelector(trailIds, selector);
  const [first] = matches;
  if (first === undefined) {
    throw new ValidationError(
      `The "${SURFACES_OVERLAY_NAMESPACE}" overlay cli binding "${name}" resolves to no trails: selector "${selector}" matched none. ${CLI_BINDING_FIX}`
    );
  }
  if (matches.length > 1) {
    throw new ValidationError(
      `The "${SURFACES_OVERLAY_NAMESPACE}" overlay cli binding "${name}" resolves to ${matches.length} trails (${matches.join(', ')}). A scalar binding is a synonym for exactly one trail — use a list value to expose a command group instead. ${CLI_BINDING_FIX}`
    );
  }
  return first;
};

const expandGroupBinding = (
  trailIds: readonly string[],
  name: string,
  selectors: readonly SurfaceBindingRef[]
): readonly string[] => {
  const members = [
    ...new Set(
      selectors.flatMap((selector) => expandSelector(trailIds, selector))
    ),
  ].toSorted();
  if (members.length === 0) {
    throw new ValidationError(
      `The "${SURFACES_OVERLAY_NAMESPACE}" overlay cli group binding "${name}" resolves to no trails: selectors ${selectors.map((selector) => `"${selector}"`).join(', ')} matched none. ${CLI_BINDING_FIX}`
    );
  }
  return members;
};

/**
 * Expand the `surfaces` overlay's `cli` bindings into per-trail CLI alias
 * inputs, validating every binding against the topo's trail ids.
 *
 * A scalar binding is a transparent synonym: its name splits on `.` into an
 * absolute command path aliasing exactly one trail — zero or multiple matches
 * are a `ValidationError` naming the binding and its matches. A list binding
 * is a command group: each expanded member trail gets an alias route at
 * `[...groupName.split('.'), ...memberTrailId.split('.')]`, and a group whose
 * member union is empty is a `ValidationError`. Binding names and member ids
 * are processed in sorted order so the expansion is deterministic. Returns
 * `undefined` when there are no `cli` bindings.
 *
 * @example
 * ```ts
 * import { expandCliSurfaceBindings } from '@ontrails/core';
 *
 * expandCliSurfaceBindings(
 *   { 'gear.ls': 'gear.list', gear: ['gear.create', 'gear.list'] },
 *   ['gear.create', 'gear.list']
 * );
 * // => {
 * //   'gear.create': [['gear', 'gear', 'create']],
 * //   'gear.list': [['gear', 'gear', 'list'], ['gear', 'ls']],
 * // }
 * ```
 */
export const expandCliSurfaceBindings = (
  bindings: SurfaceBindings | undefined,
  trailIds: readonly string[]
): CliSurfaceBindingAliases | undefined => {
  if (bindings === undefined) {
    return undefined;
  }
  const names = Object.keys(bindings).toSorted();
  if (names.length === 0) {
    return undefined;
  }

  const aliasesByTrail = new Map<string, (readonly string[])[]>();
  const addAlias = (trailId: string, path: readonly string[]): void => {
    const existing = aliasesByTrail.get(trailId);
    if (existing === undefined) {
      aliasesByTrail.set(trailId, [path]);
      return;
    }
    existing.push(path);
  };

  for (const name of names) {
    const value = bindings[name];
    if (value === undefined) {
      continue;
    }
    const pathSegments = assertCliBindingName(name);
    const shape = classifySurfaceBinding(value);
    if (shape.kind === 'synonym') {
      addAlias(expandSynonymBinding(trailIds, name, shape.trail), pathSegments);
      continue;
    }
    for (const member of expandGroupBinding(trailIds, name, shape.members)) {
      addAlias(member, [...pathSegments, ...member.split('.')]);
    }
  }

  return Object.fromEntries(aliasesByTrail);
};

/**
 * Read and validate the `surfaces` bindings from a lock's overlays record.
 *
 * The compile-side gate guarantees only app-authored envelopes can own the
 * `surfaces` namespace in a committed lock, so this reader validates shape
 * only — provenance was already enforced before the facts were embedded.
 * Returns `undefined` when the record has no `surfaces` key; throws a
 * `ValidationError` when the embedded facts fail the bindings schema.
 *
 * @example
 * ```ts
 * import { surfaceBindingsFromLockOverlays } from '@ontrails/core';
 *
 * const bindings = surfaceBindingsFromLockOverlays(lock.topoGraph.overlays);
 * ```
 */
export const surfaceBindingsFromLockOverlays = (
  overlays: Readonly<Record<string, unknown>> | undefined
): SurfaceOverlayBindings | undefined => {
  const facts = overlays?.[SURFACES_OVERLAY_NAMESPACE];
  if (facts === undefined) {
    return undefined;
  }
  return parseSurfaceOverlayBindings(
    facts,
    'Regenerate the lock with `trails compile` from the authored surfaceOverlay() bindings.'
  );
};
