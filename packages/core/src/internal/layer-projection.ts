/**
 * Shared, surface-agnostic helpers for projecting typed layer `input` schemas
 * onto a surface's native idiom.
 *
 * Layer projection has two halves:
 *   1. **Collection** — walk the trail's effective layers (topo → surface →
 *      trail) and keep only the ones that declare an `input` schema. These
 *      are the layers a surface needs to project.
 *   2. **Naming/collision policy** — when a layer field's projected name
 *      collides with a name already claimed by the trail, by another layer,
 *      or by a surface-reserved name, the field is renamed using the
 *      deterministic `<layerName>-<originalField>` rule. The collision-detection
 *      logic itself is surface-agnostic; the *shape* of the projected name
 *      (kebab-case CLI flag, camelCase MCP parameter, HTTP request field)
 *      stays per-surface.
 *
 * This module owns the surface-agnostic half. CLI/MCP/HTTP each layer their
 * own projection on top: see `@ontrails/cli/build`, `@ontrails/mcp/build`,
 * and `@ontrails/http/build`.
 *
 * @see TRL-473 for the CLI projection that introduced this contract.
 * @see TRL-474 for the MCP and HTTP projections that lifted these helpers.
 */

import type { Layer } from '../layer.js';
import type { Topo } from '../topo.js';
import type { AnyTrail } from '../trail.js';

export const LAYER_FIELD_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'all',
  'devPermit',
  'dryRun',
  'input',
  'inputJson',
  'json',
  'jsonl',
  'output',
  'permit',
  'quiet',
  'token',
  'trace',
  'watch',
]);

const toKebabCase = (name: string): string =>
  name.replaceAll(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

export const LAYER_FIELD_RESERVED_NAMES_KEBAB: ReadonlySet<string> = new Set(
  [...LAYER_FIELD_RESERVED_NAMES].map(toKebabCase)
);

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Source of a typed layer attached to a trail.
 *
 * Surfaces may want to know whether a layer came from topo-, surface-, or
 * trail-scope (e.g. for descriptive errors). The collection helper preserves
 * this information so callers don't have to recompute it.
 */
export type AttachedLayerScope = 'topo' | 'surface' | 'trail';

export interface AttachedTypedLayer {
  readonly layer: Layer;
  readonly scope: AttachedLayerScope;
}

/**
 * Collect every typed layer attached to a trail in the same composition order
 * the executor uses (topo → surface → trail). Layers without an `input`
 * schema are skipped — they have nothing to project onto a surface.
 *
 * @param graph - The topo carrying topo-scope layers.
 * @param trail - The trail whose effective layers we are projecting.
 * @param surfaceLayers - Layers attached at surface scope (`options.layers`
 *   on the surface builder).
 */
export const collectAttachedTypedLayers = (
  graph: Topo,
  trail: AnyTrail,
  surfaceLayers?: readonly Layer[] | undefined
): readonly AttachedTypedLayer[] => {
  const layers: AttachedTypedLayer[] = [];
  for (const layer of graph.layers) {
    if (layer.input !== undefined) {
      layers.push({ layer, scope: 'topo' });
    }
  }
  if (surfaceLayers !== undefined) {
    for (const layer of surfaceLayers) {
      if (layer.input !== undefined) {
        layers.push({ layer, scope: 'surface' });
      }
    }
  }
  for (const layer of trail.layers) {
    if (layer.input !== undefined) {
      layers.push({ layer, scope: 'trail' });
    }
  }
  return layers;
};

// ---------------------------------------------------------------------------
// Collision rename rule
// ---------------------------------------------------------------------------

/**
 * Reason a layer field was renamed during projection.
 *
 * Surfaces map this onto their own warning/error idiom. CLI emits a stderr
 * warning, while MCP/HTTP rely on the projected schema as the source of truth.
 */
export type LayerFieldRenameReason = 'reserved-name' | 'flag-collision';

/**
 * Outcome of projecting a single layer field's name.
 *
 * `claimedName` is the name the surface will publish to consumers; it is the
 * field name when no collision was detected, or `<layerName>-<fieldName>` (or
 * an analogous transformed form, depending on the surface's convention) when
 * a collision required a rename. `routingTarget` is the original field name
 * the value should be assigned back to inside the layer's runtime input.
 */
export interface LayerFieldProjection {
  readonly claimedName: string;
  readonly routingTarget: string;
  readonly renamed: false;
}

export interface RenamedLayerFieldProjection {
  readonly claimedName: string;
  readonly routingTarget: string;
  readonly renamed: true;
  readonly originalName: string;
  readonly reason: LayerFieldRenameReason;
}

export type ProjectedLayerField =
  | LayerFieldProjection
  | RenamedLayerFieldProjection;

/**
 * Apply the deterministic collision rename rule to a single projected layer
 * field name.
 *
 * @param layerName - The layer's logical name (used as the rename prefix).
 * @param originalName - The layer field's name as authored on its schema.
 * @param projectedName - The candidate name in the surface's native idiom
 *   (e.g. kebab-case for CLI, camelCase for MCP, request field for HTTP).
 * @param renamedName - The fallback name applied when a collision is detected.
 *   Surfaces compute this with their own casing rule.
 * @param claimedNames - Names already taken by the trail's input or by
 *   previous layer projections. Updated in place when a name is claimed.
 * @param reservedNames - Framework-owned names that force a rename across
 *   surface projections.
 */
export const projectLayerFieldName = (
  _layerName: string,
  originalName: string,
  projectedName: string,
  renamedName: string,
  claimedNames: Set<string>,
  reservedNames: ReadonlySet<string>
): ProjectedLayerField => {
  const collidesWithClaimed = claimedNames.has(projectedName);
  const collidesWithReserved = reservedNames.has(projectedName);

  if (!collidesWithClaimed && !collidesWithReserved) {
    claimedNames.add(projectedName);
    return {
      claimedName: projectedName,
      renamed: false,
      routingTarget: originalName,
    };
  }

  let claimedName = renamedName;
  for (let suffix = 2; claimedNames.has(claimedName); suffix += 1) {
    claimedName = `${renamedName}${suffix}`;
  }
  claimedNames.add(claimedName);
  return {
    claimedName,
    originalName: projectedName,
    reason: collidesWithReserved ? 'reserved-name' : 'flag-collision',
    renamed: true,
    routingTarget: originalName,
  };
};
