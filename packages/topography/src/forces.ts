import { ValidationError } from '@ontrails/core';

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

type ForceableDiffEntry = DiffEntry & {
  readonly kind: TopoGraphForceEntry['kind'];
};

const isForceableDiffEntry = (diff: DiffEntry): diff is ForceableDiffEntry =>
  diff.kind !== 'trailhead';

const containerKey = (entry: {
  readonly id: string;
  readonly kind: TopoGraphForceEntry['kind'];
}): string => JSON.stringify([entry.kind, entry.id]);

/**
 * Derive the stable identity of one serialized v5 force event.
 *
 * Identity includes every persisted event fact, so events with different
 * timestamps or reasons remain distinct during audit-history union.
 *
 * @example
 * ```ts
 * const identity = deriveTopoGraphForceIdentity(force);
 * ```
 */
export const deriveTopoGraphForceIdentity = (
  force: TopoGraphForceEntry
): string =>
  JSON.stringify([
    force.acceptedAt,
    force.change,
    force.detail,
    force.id,
    force.kind,
    force.reason !== undefined,
    force.reason,
    force.severity,
    force.source,
  ]);

const uniqueForces = (
  forces: readonly TopoGraphForceEntry[]
): readonly TopoGraphForceEntry[] => {
  const seen = new Set<string>();
  return forces.filter((force) => {
    const identity = deriveTopoGraphForceIdentity(force);
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
};

const assertEntryForceOwnership = (graph: TopoGraph): void => {
  const seenContainers = new Set<string>();
  for (const entry of graph.entries) {
    const key = containerKey(entry);
    if (seenContainers.has(key)) {
      throw new ValidationError(
        `Topo graph contains more than one ${entry.kind} "${entry.id}" container. Resolve the ambiguous entry identity before regenerating the topo graph.`
      );
    }
    seenContainers.add(key);

    const mismatched = entry.forces?.find(
      (force) => force.id !== entry.id || force.kind !== entry.kind
    );
    if (mismatched !== undefined) {
      throw new ValidationError(
        `Force event ${mismatched.kind} "${mismatched.id}" is attached to ${entry.kind} "${entry.id}". Restore the event to its original container before regenerating the topo graph.`
      );
    }
  }
};

const withForces = <
  T extends {
    readonly forces?: readonly TopoGraphForceEntry[] | undefined;
  },
>(
  value: T,
  forces: readonly TopoGraphForceEntry[]
): T => {
  if (forces.length > 0) {
    return { ...value, forces };
  }
  const { forces: _forces, ...withoutForces } = value;
  return withoutForces as T;
};

const toForceEntry = (
  diff: ForceableDiffEntry,
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
  if (diff.severity !== 'breaking' || !isForceableDiffEntry(diff)) {
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

  const forceOptions: TopoGraphForceOptions = {
    acceptedAt: options?.acceptedAt ?? new Date().toISOString(),
    ...(options?.reason === undefined ? {} : { reason: options.reason }),
  };
  const removedForces = breaking
    .filter((entry) => entry.change === 'removed')
    .flatMap((entry) => deriveTopoGraphForceEntries(entry, forceOptions));
  const graphForces = uniqueForces([...(graph.forces ?? []), ...removedForces]);
  const graphForceIdentities = new Set(
    graphForces.map(deriveTopoGraphForceIdentity)
  );
  const byContainer = new Map<string, ForceableDiffEntry[]>();
  for (const diff of breaking) {
    if (diff.change === 'removed' || !isForceableDiffEntry(diff)) {
      continue;
    }
    const key = containerKey(diff);
    byContainer.set(key, [...(byContainer.get(key) ?? []), diff]);
  }
  const entries: TopoGraphEntry[] = graph.entries.map((entry) => {
    const diffs = byContainer.get(containerKey(entry));
    if (diffs === undefined) {
      return entry;
    }

    const forces = uniqueForces([
      ...(entry.forces ?? []),
      ...diffs.flatMap((diff) =>
        deriveTopoGraphForceEntries(diff, forceOptions)
      ),
    ]).filter(
      (force) => !graphForceIdentities.has(deriveTopoGraphForceIdentity(force))
    );
    return withForces(entry, forces);
  });

  return withForces({ ...graph, entries }, graphForces);
};

export const carryForwardTopoGraphForces = (
  previous: TopoGraph,
  next: TopoGraph
): TopoGraph => {
  assertEntryForceOwnership(previous);
  assertEntryForceOwnership(next);

  const nextContainers = new Set(next.entries.map(containerKey));
  const orphanedPreviousForces = previous.entries
    .filter((entry) => !nextContainers.has(containerKey(entry)))
    .flatMap((entry) => entry.forces ?? []);
  const graphForces = uniqueForces([
    ...(next.forces ?? []),
    ...(previous.forces ?? []),
    ...orphanedPreviousForces,
  ]);
  const graphForceIdentities = new Set(
    graphForces.map(deriveTopoGraphForceIdentity)
  );
  const previousEntryForces = new Map(
    previous.entries.map((entry) => [containerKey(entry), entry.forces ?? []])
  );
  const entries = next.entries.map((entry) => {
    const carriedForces = previousEntryForces.get(containerKey(entry)) ?? [];
    const forces = uniqueForces([
      ...(entry.forces ?? []),
      ...carriedForces,
    ]).filter(
      (force) => !graphForceIdentities.has(deriveTopoGraphForceIdentity(force))
    );
    return withForces(entry, forces);
  });
  return withForces(
    {
      ...next,
      entries,
    },
    graphForces
  );
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
