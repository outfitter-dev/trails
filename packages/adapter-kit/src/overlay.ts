/**
 * The adapter overlay contract.
 *
 * Adapters export an overlay object describing one namespaced fact
 * overlay; the app module re-exports it (conventionally as
 * `trailsOverlays`), and the compile path validates `derive(topo)`
 * output against the overlay's schema before embedding the facts as
 * `overlays.<namespace>` in `trails.lock`. The lock schema and graph type
 * never change — unknown namespaces are preserved byte-for-byte by older
 * toolchains (tolerant reader).
 */

import { ValidationError } from '@ontrails/core';
import type { OverlayProvenance, Topo } from '@ontrails/core';
import type { z } from 'zod';

/**
 * One adapter-owned namespaced fact overlay for `trails.lock`.
 *
 * An overlay is authored by an adapter package and opted into by the
 * app: the app module exports `trailsOverlays` next to its topo export,
 * and `trails compile` runs each overlay's {@link derive} over the
 * compiled topo, validates the result against {@link schema}, and embeds it
 * as `overlays.<namespace>` in the committed lock.
 *
 * @example
 * ```ts
 * import type { Overlay } from '@ontrails/adapter-kit';
 * import { z } from 'zod';
 *
 * const factsSchema = z.object({ regions: z.array(z.string()) }).strict();
 *
 * export const overlay = {
 *   namespace: 'acme',
 *   schema: factsSchema,
 *   derive: (topo) => ({
 *     regions: topo
 *       .listResources()
 *       .map((definition) => definition.id)
 *       .toSorted(),
 *   }),
 * } satisfies Overlay;
 *
 * // In the app module, next to the topo export:
 * // export const trailsOverlays = [overlay];
 * // `trails compile` then embeds the facts as `overlays.acme`.
 * ```
 */
export interface Overlay {
  /**
   * The lock overlay this overlay owns.
   *
   * Dotted kebab-case: `/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/`. Each
   * overlay owns exactly one namespace, and the facts land at
   * `overlays.<namespace>` in `trails.lock`. Unknown namespaces are
   * preserved byte-for-byte by older toolchains, so new overlays never
   * break existing lock readers.
   */
  readonly namespace: string;
  /**
   * Who authored this overlay. Absent means adapter-derived.
   *
   * Surfaces obey app-authored overlays only: the well-known `surfaces`
   * namespace requires `provenance: 'app-authored'` (authored via
   * `surfaceOverlay()` in the app module), and the compile path rejects
   * adapter-derived envelopes that claim it. Adapter overlays contribute
   * facts, never bindings, and can leave this field absent.
   */
  readonly provenance?: OverlayProvenance | undefined;
  /**
   * The elevated fact schema.
   *
   * The compile path enforces this schema against every {@link derive}
   * output before embedding the facts, so a drifting derive function fails
   * `trails compile` instead of committing invalid facts.
   */
  readonly schema: z.ZodType;
  /**
   * Derive the topo into this overlay's facts.
   *
   * Must be deterministic — the same topo always yields the same facts
   * (sort any collections) — and must return JSON-plain data, because the
   * result is embedded verbatim in the committed lock.
   */
  readonly derive: (topo: Topo) => unknown;
}

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === 'function';

/**
 * Structurally recognize an {@link Overlay}.
 *
 * Used by the compile-side collector when scanning an app module's
 * `trailsOverlays` export — adapters never import this at runtime. The
 * check is hand-rolled (string `namespace`, schema object exposing a
 * `safeParse` function, function `derive`) so recognizing overlays
 * needs no zod runtime dependency.
 *
 * @example
 * ```ts
 * import { isOverlay } from '@ontrails/adapter-kit';
 *
 * const recognized = candidates.filter(isOverlay);
 * ```
 */
export const isOverlay = (value: unknown): value is Overlay => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Overlay, unknown>>;
  return (
    typeof candidate.namespace === 'string' &&
    typeof candidate.schema === 'object' &&
    candidate.schema !== null &&
    isFunction((candidate.schema as { safeParse?: unknown }).safeParse) &&
    isFunction(candidate.derive)
  );
};

/**
 * Read an app module's `trailsOverlays` export as validated overlays.
 *
 * This is the one shared collection channel for app-module overlays: the
 * compile path's fresh app lease and Warden's fresh topo loading both read
 * the export through this function, so every fresh derivation carries the
 * same overlays the committed lock embeds. An absent export returns
 * `undefined`; a present export that is not an array of {@link Overlay}
 * values throws a fix-forward `ValidationError` naming `sourceLabel`.
 *
 * @example
 * ```ts
 * import { resolveTrailsOverlays } from '@ontrails/adapter-kit';
 *
 * const mod = await import(appModulePath);
 * const overlays = resolveTrailsOverlays(
 *   mod as Record<string, unknown>,
 *   appModulePath
 * );
 * // => readonly Overlay[] | undefined
 * ```
 */
export const resolveTrailsOverlays = (
  moduleExports: Record<string, unknown>,
  sourceLabel: string
): readonly Overlay[] | undefined => {
  const value = moduleExports['trailsOverlays'];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every(isOverlay)) {
    throw new ValidationError(
      `trailsOverlays export in "${sourceLabel}" must be an array of overlays ({ namespace, schema, derive }). Fix the app module export and rerun \`trails compile\`.`
    );
  }

  return value;
};
