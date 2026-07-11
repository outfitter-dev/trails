/**
 * Namespaced overlay collection for topo graphs.
 *
 * Both derivation pipelines — `deriveTopoGraph` and the store-side
 * `buildTopoGraph` — consume overlay registrations through this single
 * collection path so compiled locks and fresh derivations cannot diverge.
 */

import { SURFACES_OVERLAY_NAMESPACE, ValidationError } from '@ontrails/core';
import type { Topo } from '@ontrails/core';

import type {
  TopoGraphOverlayRegistration,
  TopoGraphOverlays,
} from './types.js';

const OVERLAY_NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/u;

const DERIVE_REMEDIATION =
  "Fix the contribution's derive output and rerun `trails compile`.";

/** Sort object keys recursively for deterministic overlay serialization. */
const deepSortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(deepSortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = deepSortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

const summarizeIssuePath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? '(root)' : path.map(String).join('.');

/**
 * Canonicalize schema-parsed facts into JSON-plain, deterministically ordered
 * data: a JSON round-trip strips non-JSON residue, then a deep key-sort makes
 * serialization order stable.
 */
const canonicalizeOverlayFacts = (
  namespace: string,
  parsed: unknown
): unknown => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(parsed);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) {
    throw new ValidationError(
      `Overlay namespace "${namespace}" derived facts are not JSON-serializable. ${DERIVE_REMEDIATION}`
    );
  }
  return deepSortKeys(JSON.parse(serialized));
};

const assertValidNamespace = (namespace: string): void => {
  if (!OVERLAY_NAMESPACE_PATTERN.test(namespace)) {
    throw new ValidationError(
      `Overlay namespace "${namespace}" must be dotted kebab-case (matching ${OVERLAY_NAMESPACE_PATTERN.source}). Fix the contribution's namespace and rerun \`trails compile\`.`
    );
  }
};

/**
 * Enforce the reserved `surfaces` namespace: surfaces obey app-authored
 * overlays only, so an adapter-derived registration (absent provenance is
 * adapter-derived) can never own it.
 */
const assertSurfacesProvenance = (
  registration: TopoGraphOverlayRegistration
): void => {
  if (
    registration.namespace === SURFACES_OVERLAY_NAMESPACE &&
    registration.provenance !== 'app-authored'
  ) {
    throw new ValidationError(
      `Adapter-derived overlays cannot own the "${SURFACES_OVERLAY_NAMESPACE}" namespace. Author bindings with \`surfaceOverlay()\` in the app module and rerun \`trails compile\`.`
    );
  }
};

const deriveOverlayFacts = (
  topo: Topo,
  registration: TopoGraphOverlayRegistration
): unknown => {
  const derived = registration.derive(topo);
  const parsed = registration.schema.safeParse(derived);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${summarizeIssuePath(issue.path)}: ${issue.message}`)
      .join('; ');
    throw new ValidationError(
      `Overlay namespace "${registration.namespace}" derived facts failed schema validation (${issues}). ${DERIVE_REMEDIATION}`
    );
  }
  return canonicalizeOverlayFacts(registration.namespace, parsed.data);
};

/**
 * Collect namespaced fact overlays from overlay registrations.
 *
 * Each registration owns one dotted-kebab namespace; its derived facts are
 * validated against the registration's schema, canonicalized into JSON-plain
 * deep-key-sorted data, and assembled with namespaces sorted
 * lexicographically. Returns `undefined` when no registrations are supplied
 * so graphs without overlays stay byte-identical to pre-overlays locks.
 *
 * @example
 * ```ts
 * const overlays = collectTopoGraphOverlays(app, [
 *   {
 *     derive: (topo) => ({ trailCount: topo.trails.size }),
 *     namespace: 'cloudflare',
 *     schema: z.object({ trailCount: z.number() }),
 *   },
 * ]);
 * // => { cloudflare: { trailCount: 3 } }
 * ```
 */
export const collectTopoGraphOverlays = (
  topo: Topo,
  registrations: readonly TopoGraphOverlayRegistration[] | undefined
): TopoGraphOverlays | undefined => {
  if (registrations === undefined || registrations.length === 0) {
    return undefined;
  }

  const collected = new Map<string, unknown>();
  for (const registration of registrations) {
    assertValidNamespace(registration.namespace);
    assertSurfacesProvenance(registration);
    if (collected.has(registration.namespace)) {
      throw new ValidationError(
        `Duplicate overlay namespace "${registration.namespace}". Each contribution owns one namespace; remove the duplicate registration and rerun \`trails compile\`.`
      );
    }
    collected.set(
      registration.namespace,
      deriveOverlayFacts(topo, registration)
    );
  }

  const overlays: Record<string, unknown> = {};
  for (const namespace of [...collected.keys()].toSorted()) {
    overlays[namespace] = collected.get(namespace);
  }
  return overlays;
};
