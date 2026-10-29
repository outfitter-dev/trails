import {
  deriveTopoGraphForceEntries,
  deriveTopoGraphForceIdentity,
  deriveTopoGraphHash,
  stripTopoGraphForces,
} from '@ontrails/topography';
import type {
  DiffEntry,
  TopoGraphForceEntry,
  TrailsLock,
} from '@ontrails/topography';

const forceEvents = (lock: TrailsLock): readonly TopoGraphForceEntry[] => [
  ...(lock.topoGraph.forces ?? []),
  ...lock.topoGraph.entries.flatMap((entry) => entry.forces ?? []),
];

/**
 * Recognize an already recovered current artifact while old Git stages remain.
 * This is local evidence continuity, not proof of a previous actor's permit.
 */
export const isConvergedRecovery = (
  parents: readonly TrailsLock[],
  current: TrailsLock,
  candidate: TrailsLock,
  breaking: readonly DiffEntry[]
): boolean => {
  if (
    deriveTopoGraphHash(stripTopoGraphForces(current.topoGraph)) !==
      deriveTopoGraphHash(stripTopoGraphForces(candidate.topoGraph)) ||
    JSON.stringify(current) !== JSON.stringify(candidate)
  ) {
    return false;
  }
  const inherited = new Set(
    parents.flatMap(forceEvents).map(deriveTopoGraphForceIdentity)
  );
  const recorded = forceEvents(current).filter(
    (event) => !inherited.has(deriveTopoGraphForceIdentity(event))
  );
  // Inherited matching detail alone cannot prove a newly recovered break.
  return breaking.every((diff) =>
    diff.details.every((detail) =>
      recorded.some((event) => {
        const required = deriveTopoGraphForceEntries(
          { ...diff, details: [detail] },
          { acceptedAt: event.acceptedAt, reason: event.reason }
        );
        return (
          required.length === 1 &&
          deriveTopoGraphForceIdentity(required[0] as TopoGraphForceEntry) ===
            deriveTopoGraphForceIdentity(event)
        );
      })
    )
  );
};
