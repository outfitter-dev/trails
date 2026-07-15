/**
 * Surface-binding consumption for topo graph derivation.
 *
 * Both derivation pipelines — `deriveTopoGraph` and the store-side
 * `buildTopoGraph` — resolve the app-authored `surfaces` overlay's `cli`
 * bindings into per-trail CLI alias inputs and its `mcp` list bindings into
 * derived trailhead entries through this single helper module, so compiled
 * locks and fresh derivations cannot diverge from the runtime surfaces'
 * reading of the same bindings.
 */

import {
  deriveMcpTrailheadDescription,
  expandCliSurfaceBindings,
  expandMcpSurfaceBindings,
  resolveSurfaceOverlayBindings,
} from '@ontrails/core';
import type { CliSurfaceBindingAliases, Topo } from '@ontrails/core';

import { deriveStableHash } from './hash.js';
import type {
  TopoGraphOverlayRegistration,
  TopoGraphTrailheadEntry,
} from './types.js';

/**
 * Resolve per-trail CLI alias inputs from overlay registrations.
 *
 * Finds the app-authored `surfaces` overlay among the registrations (the
 * provenance gate rejects adapter-derived claimants), takes its `cli`
 * bindings, and expands them against the topo's trail ids: a scalar binding
 * is a synonym command path for exactly one trail, a list binding is a
 * command group whose members get group-prefixed alias routes. Throws a
 * `ValidationError` for bindings that resolve to no trail, scalar bindings
 * that match more than one, or an ill-formed `surfaces` envelope. Returns
 * `undefined` when no registrations carry `cli` bindings.
 *
 * @example
 * ```ts
 * import { resolveCliAliasInputsFromOverlays } from './surface-bindings.js';
 *
 * const aliases = resolveCliAliasInputsFromOverlays(app, overlays);
 * // => { 'gear.list': [['gear', 'ls']] } for surfaceOverlay({ cli: { 'gear.ls': 'gear.list' } })
 * ```
 */
export const resolveCliAliasInputsFromOverlays = (
  topo: Topo,
  registrations: readonly TopoGraphOverlayRegistration[] | undefined
): CliSurfaceBindingAliases | undefined => {
  const bindings = resolveSurfaceOverlayBindings(registrations);
  if (bindings?.cli === undefined) {
    return undefined;
  }
  return expandCliSurfaceBindings(bindings.cli, [...topo.trails.keys()]);
};

/**
 * Resolve derived trailhead entries from overlay registrations.
 *
 * Finds the app-authored `surfaces` overlay among the registrations and
 * derives each `mcp` list binding into one `TopoGraphTrailheadEntry`: the
 * binding name becomes the trailhead id, the sorted expanded member trail
 * ids become `memberIds`, the surfaces list is `['mcp']`, and the
 * description is the deterministic derived default shared with the MCP
 * surface. Scalar `mcp` bindings are tool synonyms, not grouped entries, so
 * they render no trailhead. Throws a `ValidationError` for group bindings
 * whose member union is empty or synonym bindings that violate the shared
 * expansion rules. Returns `undefined` when no `mcp` list bindings exist.
 *
 * @example
 * ```ts
 * import { resolveTrailheadEntriesFromOverlays } from './surface-bindings.js';
 *
 * const trailheads = resolveTrailheadEntriesFromOverlays(app, overlays);
 * // => [{ id: 'gear', memberIds: ['gear.create', 'gear.list'], surfaces: ['mcp'], ... }]
 * ```
 */
export const resolveTrailheadEntriesFromOverlays = (
  topo: Topo,
  registrations: readonly TopoGraphOverlayRegistration[] | undefined
): readonly TopoGraphTrailheadEntry[] | undefined => {
  const bindings = resolveSurfaceOverlayBindings(registrations);
  const expansion = expandMcpSurfaceBindings(bindings?.mcp, [
    ...topo.trails.keys(),
  ]);
  if (expansion === undefined) {
    return undefined;
  }
  const entries = Object.entries(expansion.groups)
    .map(
      ([id, memberIds]): TopoGraphTrailheadEntry => ({
        description: deriveMcpTrailheadDescription(memberIds),
        id,
        memberIds,
        memberSetHash: deriveStableHash(memberIds),
        surfaces: ['mcp'],
      })
    )
    .toSorted((a, b) => a.id.localeCompare(b.id));
  return entries.length > 0 ? entries : undefined;
};
