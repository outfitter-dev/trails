/**
 * Surface-binding consumption for topo graph derivation.
 *
 * Both derivation pipelines — `deriveTopoGraph` and the store-side
 * `buildTopoGraph` — resolve the app-authored `surfaces` overlay's `cli`
 * bindings into per-trail CLI alias inputs through this single helper, so
 * compiled locks and fresh derivations cannot diverge from the runtime CLI's
 * reading of the same bindings.
 */

import {
  expandCliSurfaceBindings,
  resolveSurfaceOverlayBindings,
} from '@ontrails/core';
import type { CliSurfaceBindingAliases, Topo } from '@ontrails/core';

import type { TopoGraphOverlayRegistration } from './types.js';

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
