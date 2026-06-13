import { deriveTrailCliCommandProjection } from '@ontrails/core';
import type { CliCommandRoute, Topo } from '@ontrails/core';
import type { TopoGraph } from '@ontrails/topographer';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'cli-command-route-coherence';
const TOPO_FILE = '<topo>';

interface RouteClaim {
  readonly kind: CliCommandRoute['kind'];
  readonly path: readonly string[];
  readonly source: CliCommandRoute['source'];
  readonly trailId: string;
}

const routeKey = (path: readonly string[]): string => path.join('\0');

const renderPath = (path: readonly string[]): string => path.join(' ');

const claimLabel = (claim: RouteClaim): string =>
  `${claim.kind} route for trail "${claim.trailId}" (${claim.source})`;

const buildProjectionDiagnostic = (
  trailId: string,
  error: unknown
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `CLI command route projection for trail "${trailId}" is invalid: ${
    error instanceof Error ? error.message : String(error)
  }`,
  rule: RULE_NAME,
  severity: 'error',
});

const buildCollisionDiagnostic = (
  path: readonly string[],
  claims: readonly RouteClaim[]
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `CLI command route collision on "${renderPath(path)}": ${claims
    .toSorted((a, b) => a.trailId.localeCompare(b.trailId))
    .map(claimLabel)
    .join(
      ', '
    )}. Rename or remove one CLI alias so every accepted command path normalizes into exactly one trail contract.`,
  rule: RULE_NAME,
  severity: 'error',
});

const buildGraphTargetDiagnostic = (
  entryId: string,
  route: CliCommandRoute,
  knownTrailIds: ReadonlySet<string>
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: knownTrailIds.has(route.target)
    ? `Serialized CLI command route "${renderPath(route.path)}" is stored under trail "${entryId}" but targets "${route.target}". Route facts must stay attached to their owning trail.`
    : `Serialized CLI command route "${renderPath(route.path)}" targets unknown trail "${route.target}". Surface-owned aliases must target existing trail IDs.`,
  rule: RULE_NAME,
  severity: 'error',
});

const collectTopoClaims = (
  topo: Topo
): {
  readonly claims: readonly RouteClaim[];
  readonly diagnostics: readonly WardenDiagnostic[];
} => {
  const claims: RouteClaim[] = [];
  const diagnostics: WardenDiagnostic[] = [];

  for (const trail of topo.list()) {
    try {
      const projection = deriveTrailCliCommandProjection(trail);
      for (const route of projection.routes) {
        claims.push({
          kind: route.kind,
          path: route.path,
          source: route.source,
          trailId: trail.id,
        });
      }
    } catch (error: unknown) {
      diagnostics.push(buildProjectionDiagnostic(trail.id, error));
    }
  }

  return { claims, diagnostics };
};

const collectGraphClaims = (
  graph: TopoGraph | undefined
): readonly RouteClaim[] => {
  if (graph === undefined) {
    return [];
  }

  const claims: RouteClaim[] = [];
  for (const entry of graph.entries) {
    if (entry.kind !== 'trail') {
      continue;
    }
    for (const route of entry.cli?.routes ?? []) {
      claims.push({
        kind: route.kind,
        path: route.path,
        source: route.source,
        trailId: entry.id,
      });
    }
  }
  return claims;
};

const collectCollisionDiagnostics = (
  claims: readonly RouteClaim[]
): readonly WardenDiagnostic[] => {
  const claimsByRoute = new Map<string, RouteClaim[]>();
  for (const claim of claims) {
    const key = routeKey(claim.path);
    const current = claimsByRoute.get(key) ?? [];
    current.push(claim);
    claimsByRoute.set(key, current);
  }

  return [...claimsByRoute.values()]
    .filter((grouped) => grouped.length > 1)
    .map((grouped) =>
      buildCollisionDiagnostic(grouped[0]?.path ?? [], grouped)
    );
};

const collectGraphTargetDiagnostics = (
  graph: TopoGraph | undefined,
  knownTrailIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (graph === undefined) {
    return [];
  }

  const diagnostics: WardenDiagnostic[] = [];
  for (const entry of graph.entries) {
    if (entry.kind !== 'trail') {
      continue;
    }
    for (const route of entry.cli?.routes ?? []) {
      if (route.target !== entry.id || !knownTrailIds.has(route.target)) {
        diagnostics.push(
          buildGraphTargetDiagnostic(entry.id, route, knownTrailIds)
        );
      }
    }
  }
  return diagnostics;
};

export const cliCommandRouteCoherence: TopoAwareWardenRule = {
  checkTopo(topo, context) {
    const { claims, diagnostics } = collectTopoClaims(topo);
    const knownTrailIds = new Set(topo.trails.keys());
    const routeClaims =
      context?.graph === undefined ? claims : collectGraphClaims(context.graph);
    return [
      ...diagnostics,
      ...collectCollisionDiagnostics(routeClaims),
      ...collectGraphTargetDiagnostics(context?.graph, knownTrailIds),
    ];
  },
  description:
    'Ensure CLI command routes and aliases resolve to one coherent trail contract.',
  name: RULE_NAME,
  severity: 'error',
};
