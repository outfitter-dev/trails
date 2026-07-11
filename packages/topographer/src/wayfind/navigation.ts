import { Result } from '@ontrails/core';
import type { AmbiguousError } from '@ontrails/core';
import { z } from 'zod';

import type { TopoGraph } from '../types.js';
import {
  filterWayfinderEntityRefs,
  wayfinderEntityFilterSchema,
} from './filters.js';
import type {
  WayfinderEntityFilterInput,
  WayfinderEntityKind,
  WayfinderEntityRef,
} from './filters.js';
import {
  edgeTouches,
  groupNearbyEdges,
  impactFor,
  refSummary,
  relationEdges,
  resolveEntityRef,
} from './relations.js';
import type {
  ImpactDirection,
  ImpactOptions,
  RelationEdge,
  RelationRef,
} from './relations.js';

export const wayfinderSourceModeSchema = z.enum(['locked', 'live']);

export type WayfinderSourceMode = z.output<typeof wayfinderSourceModeSchema>;

export const wayfinderResolverSchema = z.enum([
  'id',
  'pattern',
  'query',
  'file',
]);

export type WayfinderResolver = z.output<typeof wayfinderResolverSchema>;

export const wayfinderViewSchema = z.enum([
  'overview',
  'list',
  'summary',
  'describe',
  'contract',
  'outline',
  'map',
]);

export type WayfinderView = z.output<typeof wayfinderViewSchema>;

export const wayfinderIncludeSchema = z.enum([
  'adapters',
  'errors',
  'examples',
  'surfaces',
  'versions',
]);

export type WayfinderInclude = z.output<typeof wayfinderIncludeSchema>;

export const wayfinderDriftStatusSchema = z.enum([
  'absent',
  'aligned',
  'drifted',
]);

export type WayfinderDriftStatus = z.output<typeof wayfinderDriftStatusSchema>;

export const wayfinderNavigationPlanSchema = z.object({
  filters: wayfinderEntityFilterSchema.optional(),
  include: z.array(wayfinderIncludeSchema).readonly().default([]),
  limit: z.number().int().positive().max(500).default(100),
  resolver: wayfinderResolverSchema,
  source: wayfinderSourceModeSchema.default('locked'),
  view: wayfinderViewSchema.default('list'),
});

export type WayfinderNavigationPlan = z.output<
  typeof wayfinderNavigationPlanSchema
>;

export interface WayfinderPopulationInput {
  readonly filters?: WayfinderEntityFilterInput | undefined;
  readonly kind?: WayfinderEntityKind | undefined;
  readonly limit: number;
}

export const resolveWayfinderPopulation = (
  graph: TopoGraph,
  input: WayfinderPopulationInput
): readonly WayfinderEntityRef[] =>
  filterWayfinderEntityRefs(graph, {
    ...input.filters,
    ...(input.kind === undefined ? {} : { kind: input.kind }),
  }).slice(0, input.limit);

export const wayfinderRelationModeSchema = z.enum([
  'related',
  'deps',
  'impact',
]);

export type WayfinderRelationMode = z.output<
  typeof wayfinderRelationModeSchema
>;

/** @deprecated Use WayfinderRelationMode. */
export type WayfinderRelationResolver = WayfinderRelationMode;

export interface WayfinderResolvedRelationInput {
  readonly id: string;
  readonly filters?: WayfinderEntityFilterInput | undefined;
  readonly kind?: WayfinderEntityKind | undefined;
  readonly limit: number;
  readonly maxDepth: number;
  readonly mode: WayfinderRelationMode;
  readonly view?: 'groups' | 'impact' | undefined;
}

export interface WayfinderResolvedRelations {
  readonly direction: ImpactDirection;
  readonly edges: readonly RelationEdge[];
  readonly groups: ReturnType<typeof groupNearbyEdges>;
  readonly nodes:
    | ReturnType<typeof impactFor>['nodes']
    | readonly RelationRef[];
  readonly target: RelationRef;
}

const relationDirection = (mode: WayfinderRelationMode): ImpactDirection => {
  switch (mode) {
    case 'related': {
      return 'both';
    }
    case 'deps': {
      return 'upstream';
    }
    case 'impact': {
      return 'downstream';
    }
    default: {
      mode satisfies never;
      return 'both';
    }
  }
};

const relationOptions = (
  input: WayfinderResolvedRelationInput
): ImpactOptions => ({
  direction: relationDirection(input.mode),
  limit: input.limit,
  maxDepth: input.maxDepth,
});

const refKey = (ref: RelationRef): string => `${ref.kind}:${ref.id}`;

const filterRelationRefs = (
  graph: TopoGraph,
  refs: readonly RelationRef[],
  filters: WayfinderEntityFilterInput | undefined
): readonly RelationRef[] => {
  if (filters === undefined || Object.keys(filters).length === 0) {
    return refs;
  }
  const allowed = new Set(
    filterWayfinderEntityRefs(graph, filters).map(refKey)
  );
  return refs.filter((ref) => allowed.has(refKey(ref)));
};

const edgeOtherRef = (
  edge: RelationEdge,
  target: RelationRef
): RelationRef | undefined => {
  if (edge.from.id === target.id && edge.from.kind === target.kind) {
    return edge.to;
  }
  if (edge.to.id === target.id && edge.to.kind === target.kind) {
    return edge.from;
  }
  return undefined;
};

const filterRelationEdges = (
  graph: TopoGraph,
  edges: readonly RelationEdge[],
  target: RelationRef,
  filters: WayfinderEntityFilterInput | undefined
): readonly RelationEdge[] => {
  if (filters === undefined || Object.keys(filters).length === 0) {
    return edges;
  }
  const allowed = new Set(
    filterWayfinderEntityRefs(graph, filters).map(refKey)
  );
  return edges.filter((edge) => {
    const other = edgeOtherRef(edge, target);
    return other !== undefined && allowed.has(refKey(other));
  });
};

const filterImpactEdges = (
  edges: readonly RelationEdge[],
  target: RelationRef,
  nodes: readonly RelationRef[],
  filters: WayfinderEntityFilterInput | undefined
): readonly RelationEdge[] => {
  if (filters === undefined || Object.keys(filters).length === 0) {
    return edges;
  }
  const allowed = new Set([refKey(target), ...nodes.map(refKey)]);
  return edges.filter(
    (edge) => allowed.has(refKey(edge.from)) && allowed.has(refKey(edge.to))
  );
};

export const resolveWayfinderRelations = (
  graph: TopoGraph,
  input: WayfinderResolvedRelationInput
): Result<WayfinderResolvedRelations | undefined, AmbiguousError> => {
  const target = resolveEntityRef(graph, input);
  if (target.isErr()) {
    return target;
  }
  if (target.value === undefined) {
    return Result.ok();
  }
  const summary = refSummary(target.value);
  if (input.mode === 'related' && input.view === 'groups') {
    const edges = filterRelationEdges(
      graph,
      relationEdges(graph).filter((edge) => edgeTouches(edge, summary)),
      summary,
      input.filters
    );
    const groups = groupNearbyEdges(edges, summary);
    return Result.ok({
      direction: 'both',
      edges,
      groups,
      nodes: groups.flatMap((group) => group.refs),
      target: summary,
    });
  }
  const resolved = impactFor(graph, relationOptions(input), summary);
  const nodes = filterRelationRefs(graph, resolved.nodes, input.filters);
  const edges = filterImpactEdges(
    resolved.edges,
    summary,
    nodes,
    input.filters
  );
  return Result.ok({
    direction: relationDirection(input.mode),
    edges,
    groups: [],
    nodes,
    target: summary,
  });
};
