import type {
  DiffEntry,
  TopoGraph,
  TopoGraphEntry,
  TopoGraphForceEntry,
} from './types.js';

export interface TopoGraphForceOptions {
  readonly acceptedAt?: string | undefined;
  readonly reason?: string | undefined;
}

const toForceEntry = (
  diff: DiffEntry,
  detail: string,
  acceptedAt: string,
  reason?: string | undefined
): TopoGraphForceEntry => ({
  acceptedAt,
  change: diff.change === 'removed' ? 'removed' : 'modified',
  detail,
  id: diff.id,
  kind: diff.kind,
  ...(reason === undefined ? {} : { reason }),
  severity: 'breaking',
  source: 'trails compile --force',
});

export const deriveTopoGraphForceEntries = (
  diff: DiffEntry,
  options?: TopoGraphForceOptions
): readonly TopoGraphForceEntry[] => {
  if (diff.severity !== 'breaking') {
    return [];
  }

  const acceptedAt = options?.acceptedAt ?? new Date().toISOString();
  return diff.details.map((detail) =>
    toForceEntry(diff, detail, acceptedAt, options?.reason)
  );
};

export const annotateTopoGraphForces = (
  graph: TopoGraph,
  breaking: readonly DiffEntry[],
  options?: TopoGraphForceOptions
): TopoGraph => {
  if (breaking.length === 0) {
    return graph;
  }

  const removedForces = breaking
    .filter((entry) => entry.change === 'removed')
    .flatMap((entry) => deriveTopoGraphForceEntries(entry, options));
  const byId = new Map(
    breaking
      .filter((entry) => entry.change !== 'removed')
      .map((entry) => [entry.id, entry])
  );
  const entries: TopoGraphEntry[] = graph.entries.map((entry) => {
    const diff = byId.get(entry.id);
    if (diff === undefined) {
      return entry;
    }

    const forces = deriveTopoGraphForceEntries(diff, options);
    return forces.length === 0
      ? entry
      : { ...entry, forces: [...(entry.forces ?? []), ...forces] };
  });

  return {
    ...graph,
    entries,
    ...(removedForces.length === 0
      ? {}
      : { forces: [...(graph.forces ?? []), ...removedForces] }),
  };
};

export const carryForwardTopoGraphForces = (
  previous: TopoGraph,
  next: TopoGraph
): TopoGraph => {
  const previousEntryForces = new Map(
    previous.entries
      .filter((entry) => entry.forces !== undefined && entry.forces.length > 0)
      .map((entry) => [entry.id, entry.forces ?? []])
  );
  const entries = next.entries.map((entry) => {
    const carriedForces = previousEntryForces.get(entry.id);
    if (carriedForces === undefined || carriedForces.length === 0) {
      return entry;
    }
    return {
      ...entry,
      forces: [...carriedForces, ...(entry.forces ?? [])],
    };
  });
  return {
    ...next,
    entries,
    ...(previous.forces === undefined || previous.forces.length === 0
      ? {}
      : { forces: [...previous.forces, ...(next.forces ?? [])] }),
  };
};

export const stripTopoGraphForces = (graph: TopoGraph): TopoGraph => {
  const { forces: _graphForces, ...rest } = graph;
  return {
    ...rest,
    entries: graph.entries.map((entry) => {
      const { forces: _entryForces, ...entryRest } = entry;
      return entryRest;
    }),
  };
};
