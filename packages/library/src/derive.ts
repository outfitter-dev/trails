/**
 * `deriveLibraryApi` — the pure rendering from a topo to a `LibraryRenderingPlan`.
 *
 * This is the single semantic authority for the library surface: trail
 * selection, export naming, collision resolution, and the per-export contract
 * data the emitter renders all live here. The in-memory surface and the package
 * emitter both consume the rendering; neither re-reads the topo nor reinvents
 * selection. Pure — no fs/network/db reads (derive* purity contract).
 */
import { filterSurfaceTrails, isDraftId } from '@ontrails/core';
import type { Layer, Topo, Trail } from '@ontrails/core';
import type { ZodType } from 'zod';

import { renderLibraryInput } from './layer-input.js';
import type { LibraryLayerInputRendering } from './layer-input.js';

type AnyTrail = Trail<unknown, unknown, unknown>;

/** Where a rendered export name came from. */
export type LibraryExportSource = 'derived' | 'trail-hint' | 'package-config';

/** A single rendered export: one trail rendered as a library entrypoint. */
export interface LibraryExport {
  /** Consumer-native export name (camelCased trail id by default). */
  readonly exportName: string;
  /** The trail id this export renders (the source of truth). */
  readonly trailId: string;
  /** How `exportName` was chosen. v0 derives; hints/config override later. */
  readonly nameSource: LibraryExportSource;
  /**
   * Authored intent, carried for safety presets and docs. Always present —
   * core resolves an unset intent to `'write'`, so there is no fallback here.
   */
  readonly intent: 'read' | 'write' | 'destroy';
  /** Current version for versioned trails; undefined when unversioned. */
  readonly version: number | undefined;
  /** Trail description — the JSDoc source the emitter carries forward. */
  readonly description: string | undefined;
  /**
   * Input schema reference: the emitter's method-signature and `/schemas`
   * source. An in-memory Zod reference here; it serializes to JSON Schema when
   * the rendering is persisted to the artifact family.
   */
  readonly input: ZodType;
  /** Layer input routing rendered onto this export's public library input. */
  readonly layerInputs: readonly LibraryLayerInputRendering[];
  /** Output schema reference, when the trail declares one. */
  readonly output: ZodType | undefined;
  /**
   * Resource ids this export depends on. Empty means a stateless function
   * export; non-empty means the emitter renders the export behind a
   * `createX()` factory/client, grouped by shared resources. Carrying ids (not
   * just a boolean) keeps the factory-grouping decision in this authority.
   */
  readonly resources: readonly string[];
}

/** Why a trail did not render into the library (doctrinally-meaningful only). */
export type LibraryExclusionReason = 'internal' | 'draft' | 'activation';

/**
 * A trail deliberately excluded from the rendering, recorded for legibility.
 * `reason` is the primary (first-matched) reason in precedence order
 * draft > activation > internal; a trail may technically satisfy more than one.
 */
export interface LibraryExclusion {
  readonly trailId: string;
  readonly reason: LibraryExclusionReason;
}

/** Two or more trails deriving the same export name. */
export interface LibraryCollision {
  readonly exportName: string;
  readonly trailIds: readonly string[];
}

/** The resolved library rendering — the story of a topo as a TypeScript library. */
export interface LibraryRenderingPlan {
  /** The topo name. */
  readonly app: string;
  /** Rendered exports, in stable (trail-id-sorted) order. */
  readonly exports: readonly LibraryExport[];
  /** Trails excluded by visibility, draft state, or activation. */
  readonly excluded: readonly LibraryExclusion[];
  /** Export-name collisions; first-by-id wins in `exports`, all recorded here. */
  readonly collisions: readonly LibraryCollision[];
}

/**
 * Options for narrowing the rendering. Selectors reuse the trail-filter
 * grammar (exact ids, `*`, `**`). v0 exposes include/exclude only; intent-based
 * filtering is deferred (the packet promises the filter grammar, not intent
 * narrowing, for the library surface).
 */
export interface DeriveLibraryApiOptions {
  /** Narrowing include patterns. Never widens drafts/internal. */
  readonly include?: readonly string[];
  /** Exclude patterns. */
  readonly exclude?: readonly string[];
  /** Surface-scope layers to render alongside each trail's own input. */
  readonly layers?: readonly Layer[] | undefined;
}

/**
 * Derive a consumer-native export name from a trail id: camelCase across `.`
 * and `-` segments, preserving the full path so distinct trails stay distinct.
 * `widget.get` -> `widgetGet`, `entity.list-all` -> `entityListAll`.
 */
const deriveExportName = (trailId: string): string => {
  const words = trailId.split(/[.-]/u).filter((word) => word.length > 0);
  return words
    .map((word, index) =>
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('');
};

/**
 * Whether a trail is surface-internal. Mirrors `effectiveVisibility` in
 * `@ontrails/core` `surface-filter.ts`, which is not exported — so this is a
 * deliberate local copy. Selection still routes through `filterSurfaceTrails`
 * (authoritative); this duplication only labels exclusion reasons. If core's
 * visibility rule gains a case, update this in lockstep.
 */
const isInternal = (trail: AnyTrail): boolean =>
  trail.visibility === 'internal' || trail.meta?.['internal'] === true;

/**
 * Derive a topo into a `LibraryRenderingPlan`. Selection composes
 * `filterSurfaceTrails` (visibility, activation, intent, include/exclude) and
 * adds draft exclusion. Established public, current-version trails become
 * exports; drafts, internal, and activation-driven trails are excluded.
 *
 * @example
 * const rendering = deriveLibraryApi(app);
 * for (const entry of rendering.exports) {
 *   console.log(entry.exportName, '->', entry.trailId);
 * }
 */
export const deriveLibraryApi = (
  graph: Topo,
  options: DeriveLibraryApiOptions = {}
): LibraryRenderingPlan => {
  const all = graph.list();

  const selected = filterSurfaceTrails(all, {
    exclude: options.exclude,
    include: options.include,
  }).filter((trail) => !isDraftId(trail.id));
  const selectedIds = new Set(selected.map((trail) => trail.id));

  const excluded: LibraryExclusion[] = [];
  for (const trail of all) {
    if (selectedIds.has(trail.id)) {
      continue;
    }
    // Precedence: draft > activation > internal. A trail may satisfy more than
    // one; the first match is recorded as the primary reason.
    if (isDraftId(trail.id)) {
      excluded.push({ reason: 'draft', trailId: trail.id });
    } else if (trail.activationSources.length > 0) {
      excluded.push({ reason: 'activation', trailId: trail.id });
    } else if (isInternal(trail)) {
      excluded.push({ reason: 'internal', trailId: trail.id });
    }
    // Trails dropped purely by an explicit include/exclude filter are not
    // surprising exclusions and are not recorded.
  }

  const sorted = selected.toSorted((left, right) =>
    left.id.localeCompare(right.id)
  );
  const namesToTrailIds = new Map<string, string[]>();
  const collisionNames = new Set<string>();
  const exports: LibraryExport[] = [];

  for (const trail of sorted) {
    const exportName = deriveExportName(trail.id);
    const existing = namesToTrailIds.get(exportName);
    if (existing) {
      existing.push(trail.id);
      collisionNames.add(exportName);
      continue;
    }
    namesToTrailIds.set(exportName, [trail.id]);
    const inputRendering = renderLibraryInput(graph, trail, options.layers);
    exports.push({
      description: trail.description,
      exportName,
      input: inputRendering.input,
      intent: trail.intent,
      layerInputs: inputRendering.layers,
      nameSource: 'derived',
      output: trail.output,
      resources: trail.resources.map((resource) => resource.id),
      trailId: trail.id,
      version: trail.version,
    });
  }

  const collisions: LibraryCollision[] = [...collisionNames].map((name) => ({
    exportName: name,
    trailIds: namesToTrailIds.get(name) ?? [],
  }));

  return { app: graph.name, collisions, excluded, exports };
};
