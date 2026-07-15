import { AmbiguousError, Result } from '@ontrails/core';
import { z } from 'zod';

import type { DiffResult, TopoGraph, TopoGraphEntry } from '../types.js';
import { listWayfinderEntityRefs } from './filters.js';
import type { WayfinderEntityKind, WayfinderEntityRef } from './filters.js';

export const relationKindSchema = z.enum([
  'composed-by',
  'consumed-by',
  'entity-referenced-by',
  'trailhead-groups',
  'fired-by',
  'has-version',
  'surface-renders',
  'used-by',
]);

export const relationRefSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'entity',
    'trailhead',
    'resource',
    'signal',
    'surface',
    'trail',
    'version',
  ]),
  trailId: z.string().optional(),
  versionKey: z.string().optional(),
});

export const relationEdgeSchema = z.object({
  from: relationRefSchema,
  relation: relationKindSchema,
  to: relationRefSchema,
});

export const relationGroupSchema = z.object({
  direction: z.enum(['incoming', 'outgoing']),
  refs: z.array(relationRefSchema).readonly(),
  relation: relationKindSchema,
});

export const impactNodeSchema = relationRefSchema.extend({
  depth: z.number(),
  from: relationRefSchema.optional(),
  via: relationKindSchema.optional(),
});

export type RelationKind = z.output<typeof relationKindSchema>;
export type RelationRef = z.output<typeof relationRefSchema>;
export type RelationEdge = z.output<typeof relationEdgeSchema>;
export type ImpactDirection = 'downstream' | 'upstream' | 'both';

export interface ImpactOptions {
  readonly direction: ImpactDirection;
  readonly limit: number;
  readonly maxDepth: number;
}

const entryRef = (entry: TopoGraphEntry): WayfinderEntityRef => ({
  entry,
  id: entry.id,
  kind: entry.kind,
});

const refFor = (
  graph: TopoGraph,
  id: string,
  kind: WayfinderEntityKind
): WayfinderEntityRef =>
  listWayfinderEntityRefs(graph).find(
    (ref) => ref.id === id && ref.kind === kind
  ) ?? { id, kind };

export const refSummary = (ref: WayfinderEntityRef): RelationRef => ({
  id: ref.id,
  kind: ref.kind,
  ...(ref.trailId === undefined ? {} : { trailId: ref.trailId }),
  ...(ref.versionKey === undefined ? {} : { versionKey: ref.versionKey }),
});

const signalUses = (
  entry: TopoGraphEntry
): readonly {
  readonly relation: Extract<RelationKind, 'consumed-by' | 'fired-by'>;
  readonly signalId: string;
}[] => [
  ...(entry.fires ?? []).map((signalId) => ({
    relation: 'fired-by' as const,
    signalId,
  })),
  ...[
    ...(entry.on ?? []),
    ...(entry.from ?? []),
    ...(entry.consumers ?? []),
  ].map((signalId) => ({
    relation: 'consumed-by' as const,
    signalId,
  })),
  ...(entry.producers ?? []).map((signalId) => ({
    relation: 'fired-by' as const,
    signalId,
  })),
];

const relationEdge = (
  from: WayfinderEntityRef,
  relation: RelationKind,
  to: WayfinderEntityRef
): RelationEdge => ({
  from: refSummary(from),
  relation,
  to: refSummary(to),
});

const relationKey = (edge: RelationEdge): string =>
  `${edge.from.kind}:${edge.from.id}:${edge.relation}:${edge.to.kind}:${edge.to.id}`;

export const relationEdges = (graph: TopoGraph): readonly RelationEdge[] => {
  const edges: RelationEdge[] = [];
  const add = (
    from: WayfinderEntityRef,
    relation: RelationKind,
    to: WayfinderEntityRef
  ) => edges.push(relationEdge(from, relation, to));

  for (const entry of graph.entries) {
    const target = entryRef(entry);
    for (const composedId of entry.composes ?? []) {
      add(refFor(graph, composedId, 'trail'), 'composed-by', target);
    }
    for (const entityId of entry.entities ?? []) {
      add(refFor(graph, entityId, 'entity'), 'entity-referenced-by', target);
    }
    for (const resourceId of entry.resources ?? []) {
      add(refFor(graph, resourceId, 'resource'), 'used-by', target);
    }
    for (const { relation, signalId } of signalUses(entry)) {
      add(refFor(graph, signalId, 'signal'), relation, target);
    }
    for (const surfaceId of entry.surfaces) {
      add(refFor(graph, surfaceId, 'surface'), 'surface-renders', target);
    }
    if (entry.kind === 'trail' && entry.version !== undefined) {
      add(target, 'has-version', {
        entry,
        id: `${entry.id}@${entry.version}`,
        kind: 'version',
        trailId: entry.id,
        versionKey: String(entry.version),
      });
    }
    for (const [versionKey, version] of Object.entries(entry.versions ?? {})) {
      add(target, 'has-version', {
        entry,
        id: `${entry.id}@${versionKey}`,
        kind: 'version',
        trailId: entry.id,
        version,
        versionKey,
      });
    }
  }

  for (const trailhead of graph.trailheads ?? []) {
    const trailheadRef = refFor(graph, trailhead.id, 'trailhead');
    const surfaceRefs = trailhead.surfaces.map((surfaceId) =>
      refFor(graph, surfaceId, 'surface')
    );
    for (const memberId of trailhead.memberIds) {
      const memberRef = refFor(graph, memberId, 'trail');
      add(trailheadRef, 'trailhead-groups', memberRef);
      for (const surfaceRef of surfaceRefs) {
        add(surfaceRef, 'surface-renders', memberRef);
      }
    }
  }

  return [
    ...new Map(edges.map((edge) => [relationKey(edge), edge])).values(),
  ].toSorted((left, right) =>
    relationKey(left).localeCompare(relationKey(right))
  );
};

const refMatches = (ref: RelationRef, target: RelationRef): boolean =>
  ref.id === target.id && ref.kind === target.kind;

export const groupNearbyEdges = (
  edges: readonly RelationEdge[],
  target: RelationRef
) => {
  const groups = new Map<string, z.output<typeof relationGroupSchema>>();
  for (const edge of edges) {
    const direction = refMatches(edge.from, target) ? 'outgoing' : 'incoming';
    const ref = direction === 'outgoing' ? edge.to : edge.from;
    const key = `${direction}:${edge.relation}`;
    const group = groups.get(key) ?? {
      direction,
      refs: [],
      relation: edge.relation,
    };
    groups.set(key, {
      ...group,
      refs: [...group.refs, ref].toSorted((left, right) =>
        `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)
      ),
    });
  }
  return [...groups.values()].toSorted((left, right) =>
    `${left.direction}:${left.relation}`.localeCompare(
      `${right.direction}:${right.relation}`
    )
  );
};

export const edgeTouches = (edge: RelationEdge, target: RelationRef): boolean =>
  refMatches(edge.from, target) || refMatches(edge.to, target);

const ambiguousRefId = (
  id: string,
  refs: readonly WayfinderEntityRef[]
): AmbiguousError =>
  new AmbiguousError(
    `Wayfinder id "${id}" matched multiple entity kinds: ${refs
      .map((ref) => ref.kind)
      .join(', ')}. Pass kind to disambiguate.`
  );

export const resolveEntityRef = (
  graph: TopoGraph,
  input: {
    readonly id: string;
    readonly kind?: WayfinderEntityKind | undefined;
  }
): Result<WayfinderEntityRef | undefined, AmbiguousError> => {
  const refs = listWayfinderEntityRefs(graph).filter(
    (ref) =>
      ref.id === input.id &&
      (input.kind === undefined || ref.kind === input.kind)
  );
  if (input.kind === undefined) {
    const uniqueKinds = new Set(refs.map((ref) => ref.kind));
    if (uniqueKinds.size > 1) {
      return Result.err(ambiguousRefId(input.id, refs));
    }
  }
  return Result.ok(refs[0]);
};

const edgesForDirection = (
  edges: readonly RelationEdge[],
  current: RelationRef,
  direction: ImpactDirection
): readonly {
  readonly edge: RelationEdge;
  readonly node: RelationRef;
}[] => {
  const outgoing =
    direction === 'downstream' || direction === 'both'
      ? edges
          .filter((edge) => refMatches(edge.from, current))
          .map((edge) => ({ edge, node: edge.to }))
      : [];
  const incoming =
    direction === 'upstream' || direction === 'both'
      ? edges
          .filter((edge) => refMatches(edge.to, current))
          .map((edge) => ({ edge, node: edge.from }))
      : [];
  return [...outgoing, ...incoming].toSorted((left, right) =>
    relationKey(left.edge).localeCompare(relationKey(right.edge))
  );
};

export const impactFor = (
  graph: TopoGraph,
  input: ImpactOptions,
  target: RelationRef
) => {
  const edges = relationEdges(graph);
  const seen = new Set([`${target.kind}:${target.id}`]);
  const queue: {
    readonly depth: number;
    readonly ref: RelationRef;
  }[] = [{ depth: 0, ref: target }];
  const nodes: z.output<typeof impactNodeSchema>[] = [];
  const includedEdges = new Map<string, RelationEdge>();

  for (
    let index = 0;
    index < queue.length && nodes.length < input.limit;
    index += 1
  ) {
    const current = queue[index];
    if (current === undefined) {
      break;
    }
    if (current.depth >= input.maxDepth) {
      continue;
    }
    for (const { edge, node } of edgesForDirection(
      edges,
      current.ref,
      input.direction
    )) {
      includedEdges.set(relationKey(edge), edge);
      const key = `${node.kind}:${node.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const reached = {
        ...node,
        depth: current.depth + 1,
        from: current.ref,
        via: edge.relation,
      };
      nodes.push(reached);
      queue.push({ depth: reached.depth, ref: node });
      if (nodes.length >= input.limit) {
        break;
      }
    }
  }

  return {
    edges: [...includedEdges.values()].toSorted((left, right) =>
      relationKey(left).localeCompare(relationKey(right))
    ),
    nodes,
  };
};

export const diffResult = (diff: DiffResult): DiffResult => ({
  breaking: diff.breaking,
  entries: diff.entries,
  hasBreaking: diff.hasBreaking,
  info: diff.info,
  warnings: diff.warnings,
});
