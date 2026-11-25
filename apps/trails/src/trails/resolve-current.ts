import { ConflictError, Result, ValidationError } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import {
  annotateTopoGraphForces,
  carryForwardTopoGraphForces,
  deriveTopoGraphDiff,
  deriveTopoGraphHash,
  stripTopoGraphForces,
  trailsLockSchema,
  TRAILS_LOCK_SCHEMA_VERSION,
} from '@ontrails/topography';
import type {
  DiffEntry,
  LockManifest,
  TopoGraph,
  TopoGraphOverlayRegistration,
  TrailsLock,
} from '@ontrails/topography';

import { deriveCurrentTopoExport } from './topo-store-support.js';
import { isConvergedRecovery } from './resolve-convergence.js';
import { isRecordedTipTransition } from './resolve-accepted-tip.js';

const breakingChanges = (
  parents: readonly TrailsLock[],
  next: TopoGraph,
  base: TrailsLock | undefined
): readonly DiffEntry[] => {
  const changes = new Map<string, DiffEntry>();
  const nextContract = stripTopoGraphForces(next);
  for (const parent of parents) {
    for (const entry of deriveTopoGraphDiff(
      stripTopoGraphForces(parent.topoGraph),
      nextContract
    ).breaking) {
      if (isRecordedTipTransition(entry, parent, next, parents, base)) {
        continue;
      }
      changes.set(
        JSON.stringify([entry.kind, entry.id, entry.change, entry.details]),
        entry
      );
    }
  }
  return [...changes.values()];
};

/** Derive a recovered lock in memory before any selected artifact is written. */
export const deriveResolvedLock = (
  app: Topo,
  parents: readonly TrailsLock[],
  options: {
    readonly rootDir: string;
    readonly tips: readonly TrailsLock[];
    readonly base?: TrailsLock | undefined;
    readonly force?: boolean | undefined;
    readonly overlays?: readonly TopoGraphOverlayRegistration[] | undefined;
    readonly worktreeLock?: TrailsLock | undefined;
  }
): Result<TrailsLock, Error> => {
  try {
    if (parents.length === 0) {
      return Result.err(
        new ValidationError(
          'Resolve requires verified existing lock evidence. Use trails compile for a first compile.'
        )
      );
    }
    const derived = deriveCurrentTopoExport(app, options);
    if (derived.isErr()) {
      return derived;
    }
    const manifest = JSON.parse(derived.value.lockManifestJson) as LockManifest;
    let graph = JSON.parse(derived.value.topoGraphJson) as TopoGraph;
    for (const parent of [
      ...parents,
      ...(options.worktreeLock ? [options.worktreeLock] : []),
    ]) {
      if (
        Object.keys(parent.scope).length !==
          Object.keys(manifest.scope).length ||
        Object.entries(manifest.scope).some(
          ([key, value]) => parent.scope[key] !== value
        )
      ) {
        return Result.err(
          new ValidationError(
            'Lock evidence belongs to a different app scope. Restore the selected app lock before resolving.'
          )
        );
      }
      for (const namespace of Object.keys(parent.topoGraph.overlays ?? {})) {
        if (!(namespace in (graph.overlays ?? {}))) {
          return Result.err(
            new ValidationError(
              `Lock overlay "${namespace}" has no loaded source. Restore its app-module registration before resolving.`
            )
          );
        }
      }
    }
    const breaking = breakingChanges(options.tips, graph, options.base);
    if (options.worktreeLock !== undefined) {
      graph = carryForwardTopoGraphForces(
        options.worktreeLock.topoGraph,
        graph
      );
    }
    for (const parent of parents) {
      graph = carryForwardTopoGraphForces(parent.topoGraph, graph);
    }
    const { generatedAt: _generatedAt, ...committedGraph } = graph;
    const candidate = trailsLockSchema.parse({
      scope: manifest.scope,
      summary: manifest.summary,
      topoGraph: committedGraph,
      topoGraphHash: deriveTopoGraphHash(graph),
      version: TRAILS_LOCK_SCHEMA_VERSION,
    });
    if (
      breaking.length === 0 ||
      (options.worktreeLock !== undefined &&
        isConvergedRecovery(parents, options.worktreeLock, candidate, breaking))
    ) {
      return Result.ok(candidate);
    }
    if (!options.force) {
      return Result.err(
        new ConflictError(
          `Resolved sources contain ${breaking.length} breaking change(s) against retained lock evidence. Add version entries, restore the sources, or rerun trails resolve with --force and the existing topo:write permit.`
        )
      );
    }
    const annotated = annotateTopoGraphForces(candidate.topoGraph, breaking);
    return Result.ok(
      trailsLockSchema.parse({
        ...candidate,
        topoGraph: annotated,
        topoGraphHash: deriveTopoGraphHash(annotated),
      })
    );
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? error
        : new ValidationError('Unable to derive the recovered lock.', {
            context: { detail: String(error) },
          })
    );
  }
};
