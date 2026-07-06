/**
 * Coach the app-authored `surfaces` overlay toward coherent bindings.
 *
 * Reads the `surfaces` namespace from the serialized graph overlays and
 * checks, per surface key, that every binding selector matches at least one
 * trail, that grouped bindings do not overlap on expanded members, and that
 * binding names do not shadow real surface entries (single-segment CLI
 * routes, derived MCP tool names).
 *
 * Activation note: standard `trails warden` runs fire this rule. Warden's
 * fresh topo loading collects the app-module overlays export through the
 * shared `resolveTrailsOverlays` channel compile uses (TRL-1209 drift
 * symmetry), so the topo-aware rule context graph carries the same overlays
 * the committed lock embeds. Callers that supply a precomputed graph
 * (committed locks, tests, the rule trail) keep working unchanged.
 */

import {
  SURFACES_OVERLAY_NAMESPACE,
  classifySurfaceBinding,
  deriveMcpToolName,
  matchesTrailPattern,
  surfaceBindingsFromLockOverlays,
} from '@ontrails/core';
import type {
  SurfaceBindings,
  SurfaceOverlayBindings,
  Topo,
} from '@ontrails/core';
import type { TopoGraph } from '@ontrails/topographer';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'surface-overlay-coherence';
const TOPO_FILE = '<topo>';

const SURFACE_KEYS = ['cli', 'http', 'mcp', 'ws'] as const;
type SurfaceKey = (typeof SURFACE_KEYS)[number];

const warn = (message: string): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message,
  rule: RULE_NAME,
  severity: 'warn',
});

const memberRefs = (value: SurfaceBindings[string]): readonly string[] => {
  const shape = classifySurfaceBinding(value);
  return shape.kind === 'synonym' ? [shape.trail] : shape.members;
};

const expandRefs = (
  refs: readonly string[],
  trailIds: readonly string[]
): ReadonlySet<string> => {
  const matched = new Set<string>();
  for (const ref of refs) {
    for (const trailId of trailIds) {
      if (matchesTrailPattern(trailId, ref)) {
        matched.add(trailId);
      }
    }
  }
  return matched;
};

const zeroMatchDiagnostics = (
  surfaceKey: SurfaceKey,
  bindings: SurfaceBindings,
  trailIds: readonly string[]
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  for (const [name, value] of Object.entries(bindings)) {
    for (const ref of memberRefs(value)) {
      if (!trailIds.some((trailId) => matchesTrailPattern(trailId, ref))) {
        diagnostics.push(
          warn(
            `Surface overlay binding "${name}" on "${surfaceKey}" references "${ref}", which matches no trails in the topo. Point the binding at an existing trail id or dotted trail-id glob.`
          )
        );
      }
    }
  }
  return diagnostics;
};

interface ExpandedGroup {
  readonly name: string;
  readonly trailIds: ReadonlySet<string>;
}

const groupOverlapDiagnostics = (
  surfaceKey: SurfaceKey,
  bindings: SurfaceBindings,
  trailIds: readonly string[]
): readonly WardenDiagnostic[] => {
  const groups: ExpandedGroup[] = [];
  for (const [name, value] of Object.entries(bindings)) {
    const shape = classifySurfaceBinding(value);
    if (shape.kind === 'group') {
      groups.push({ name, trailIds: expandRefs(shape.members, trailIds) });
    }
  }

  const diagnostics: WardenDiagnostic[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const first = groups[i];
    if (!first) {
      continue;
    }
    for (let j = i + 1; j < groups.length; j += 1) {
      const second = groups[j];
      if (!second) {
        continue;
      }
      const [sharedId] = [...second.trailIds]
        .filter((trailId) => first.trailIds.has(trailId))
        .toSorted();
      if (sharedId !== undefined) {
        diagnostics.push(
          warn(
            `Surface overlay group "${second.name}" on "${surfaceKey}" overlaps group "${first.name}" on trail "${sharedId}". Narrow one group so each trail has one grouped owner per surface.`
          )
        );
      }
    }
  }
  return diagnostics;
};

const cliCollisionDiagnostics = (
  bindings: SurfaceBindings,
  graph: TopoGraph
): readonly WardenDiagnostic[] => {
  const routeByName = new Map<
    string,
    { readonly kind: string; readonly trailId: string }
  >();
  for (const entry of graph.entries) {
    if (entry.kind !== 'trail') {
      continue;
    }
    const path = entry.cli?.path;
    const segment = path?.length === 1 ? path[0] : undefined;
    if (segment !== undefined) {
      routeByName.set(segment, { kind: 'canonical', trailId: entry.id });
    }
    for (const route of entry.cli?.routes ?? []) {
      const routeSegment = route.path.length === 1 ? route.path[0] : undefined;
      if (routeSegment !== undefined && !routeByName.has(routeSegment)) {
        routeByName.set(routeSegment, {
          kind: route.kind,
          trailId: entry.id,
        });
      }
    }
  }

  const diagnostics: WardenDiagnostic[] = [];
  for (const name of Object.keys(bindings)) {
    const route = routeByName.get(name);
    if (route !== undefined) {
      diagnostics.push(
        warn(
          `Surface overlay binding "${name}" on "cli" shadows the ${route.kind} CLI route "${name}" for trail "${route.trailId}". Rename the binding so it does not shadow a real entry.`
        )
      );
    }
  }
  return diagnostics;
};

const mcpCollisionDiagnostics = (
  bindings: SurfaceBindings,
  appName: string,
  graph: TopoGraph
): readonly WardenDiagnostic[] => {
  const trailIdByToolName = new Map<string, string>();
  for (const entry of graph.entries) {
    if (entry.kind === 'trail') {
      trailIdByToolName.set(deriveMcpToolName(appName, entry.id), entry.id);
    }
  }

  const diagnostics: WardenDiagnostic[] = [];
  for (const name of Object.keys(bindings)) {
    const trailId = trailIdByToolName.get(name);
    if (trailId !== undefined) {
      diagnostics.push(
        warn(
          `Surface overlay binding "${name}" on "mcp" shadows the derived MCP tool name "${name}" for trail "${trailId}". Rename the binding so it does not shadow a real entry.`
        )
      );
    }
  }
  return diagnostics;
};

const collectSurfaceDiagnostics = (
  topo: Topo,
  graph: TopoGraph,
  overlayBindings: SurfaceOverlayBindings
): readonly WardenDiagnostic[] => {
  const trailIds = [...topo.trails.keys()];
  const diagnostics: WardenDiagnostic[] = [];
  for (const surfaceKey of SURFACE_KEYS) {
    const bindings = overlayBindings[surfaceKey];
    if (bindings === undefined) {
      continue;
    }
    diagnostics.push(
      ...zeroMatchDiagnostics(surfaceKey, bindings, trailIds),
      ...groupOverlapDiagnostics(surfaceKey, bindings, trailIds)
    );
    if (surfaceKey === 'cli') {
      diagnostics.push(...cliCollisionDiagnostics(bindings, graph));
    }
    if (surfaceKey === 'mcp') {
      diagnostics.push(...mcpCollisionDiagnostics(bindings, topo.name, graph));
    }
  }
  return diagnostics;
};

export const surfaceOverlayCoherence: TopoAwareWardenRule = {
  checkTopo(topo, context) {
    const graph = context?.graph;
    if (graph?.overlays === undefined) {
      return [];
    }

    let overlayBindings: SurfaceOverlayBindings | undefined;
    try {
      overlayBindings = surfaceBindingsFromLockOverlays(graph.overlays);
    } catch (error: unknown) {
      return [
        warn(
          `The "${SURFACES_OVERLAY_NAMESPACE}" overlay in the serialized graph is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
      ];
    }
    if (overlayBindings === undefined) {
      return [];
    }

    return collectSurfaceDiagnostics(topo, graph, overlayBindings);
  },
  description:
    'Keep app-authored surface overlay bindings pointed at real trails without group overlap or canonical-entry shadowing.',
  name: RULE_NAME,
  severity: 'warn',
};
