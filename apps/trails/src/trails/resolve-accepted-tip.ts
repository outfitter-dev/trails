import { isDeepStrictEqual } from 'node:util';

import {
  deriveTopoGraphDiff,
  deriveTopoGraphForceEntries,
  deriveTopoGraphForceIdentity,
  stripTopoGraphForces,
} from '@ontrails/topography';
import type {
  DiffEntry,
  TopoGraph,
  TopoGraphEntry,
  TopoGraphForceEntry,
  TrailsLock,
} from '@ontrails/topography';

const entryEndpoint = (
  graph: TopoGraph,
  diff: DiffEntry
): TopoGraphEntry | undefined | null => {
  if (diff.kind === 'trailhead') {
    return null;
  }
  const matches = stripTopoGraphForces(graph).entries.filter(
    (entry) => entry.kind === diff.kind && entry.id === diff.id
  );
  return matches.length > 1 ? null : matches[0];
};

const sameEndpoint = (
  left: TopoGraph,
  right: TopoGraph,
  diff: DiffEntry
): boolean => {
  const before = entryEndpoint(left, diff);
  const after = entryEndpoint(right, diff);
  return before !== null && after !== null && isDeepStrictEqual(before, after);
};

const forceEvents = (graph: TopoGraph): readonly TopoGraphForceEntry[] => [
  ...(graph.forces ?? []),
  ...graph.entries.flatMap((entry) => entry.forces ?? []),
];

/**
 * Recognize an unchanged, already recorded transition on a verified parent tip.
 * Both complete entry endpoints must match; coarse diff text is insufficient.
 */
export const isRecordedTipTransition = (
  diff: DiffEntry,
  origin: TrailsLock,
  fresh: TopoGraph,
  tips: readonly TrailsLock[],
  base: TrailsLock | undefined
): boolean => {
  if (
    base === undefined ||
    !sameEndpoint(origin.topoGraph, base.topoGraph, diff)
  ) {
    return false;
  }
  const inherited = new Set(
    forceEvents(base.topoGraph).map(deriveTopoGraphForceIdentity)
  );
  return tips.some((tip) => {
    if (!sameEndpoint(fresh, tip.topoGraph, diff)) {
      return false;
    }
    const changes = deriveTopoGraphDiff(
      stripTopoGraphForces(base.topoGraph),
      stripTopoGraphForces(tip.topoGraph)
    ).breaking;
    const recorded = forceEvents(tip.topoGraph).filter(
      (event) => !inherited.has(deriveTopoGraphForceIdentity(event))
    );
    return (
      diff.details.length > 0 &&
      diff.details.every((detail) => {
        const matching = changes.find(
          (change) =>
            change.kind === diff.kind &&
            change.id === diff.id &&
            change.change === diff.change &&
            change.details.includes(detail)
        );
        return (
          matching !== undefined &&
          recorded.some((event) =>
            deriveTopoGraphForceEntries(
              { ...matching, details: [detail] },
              {
                acceptedAt: event.acceptedAt,
                reason: event.reason,
              }
            ).some(
              (required) =>
                deriveTopoGraphForceIdentity(required) ===
                deriveTopoGraphForceIdentity(event)
            )
          )
        );
      })
    );
  });
};
