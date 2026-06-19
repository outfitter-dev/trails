import { Result } from '@ontrails/core';
import type { AmbiguousError } from '@ontrails/core';
import type { TopoGraph } from '@ontrails/topographer';
import { z } from 'zod';

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
  'where',
  'file',
  'from',
  'to',
  'around',
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

export type WayfinderRelationResolver = Extract<
  WayfinderResolver,
  'around' | 'from' | 'to'
>;

export interface WayfinderResolvedRelationInput {
  readonly id: string;
  readonly kind?: WayfinderEntityKind | undefined;
  readonly limit: number;
  readonly maxDepth: number;
  readonly resolver: WayfinderRelationResolver;
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

const relationDirection = (
  resolver: WayfinderRelationResolver
): ImpactDirection => {
  switch (resolver) {
    case 'around': {
      return 'both';
    }
    case 'from': {
      return 'downstream';
    }
    case 'to': {
      return 'upstream';
    }
    default: {
      resolver satisfies never;
      return 'both';
    }
  }
};

const relationOptions = (
  input: WayfinderResolvedRelationInput
): ImpactOptions => ({
  direction: relationDirection(input.resolver),
  limit: input.limit,
  maxDepth: input.maxDepth,
});

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
  if (input.resolver === 'around' && input.view === 'groups') {
    const edges = relationEdges(graph).filter((edge) =>
      edgeTouches(edge, summary)
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
  return Result.ok({
    direction: relationDirection(input.resolver),
    edges: resolved.edges,
    groups: [],
    nodes: resolved.nodes,
    target: summary,
  });
};
