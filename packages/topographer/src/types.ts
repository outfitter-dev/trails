/**
 * Types for topo graphs, diffing, and lock files.
 */

import type {
  CliCommandRoute,
  StructuredSignalExample,
  StructuredTrailExample,
  TrailVersionStatus,
} from '@ontrails/core';
import { z } from 'zod';

export const TOPO_GRAPH_SCHEMA_VERSION = 2;

export type TopoGraphExample = StructuredSignalExample | StructuredTrailExample;

// ---------------------------------------------------------------------------
// JSON Schema (lightweight alias)
// ---------------------------------------------------------------------------

/** A JSON Schema object produced by zodToJsonSchema. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface TopoGraphContourReference {
  readonly contour: string;
  readonly field: string;
  readonly identity: string;
}

export type TopoGraphFieldOverrideKey =
  | 'hint'
  | 'label'
  | 'message'
  | 'options';

export interface TopoGraphFieldOverride {
  readonly field: string;
  readonly overrides: readonly TopoGraphFieldOverrideKey[];
  readonly provenance: {
    readonly source: 'trail.fields';
  };
}

export interface TopoGraphLayerReference {
  readonly input?: JsonSchema | undefined;
  readonly name: string;
  readonly scope: 'topo' | 'trail';
}

export interface TopoGraphActivationSource extends Readonly<
  Record<string, unknown>
> {
  readonly cron?: string | undefined;
  readonly hasParse?: true | undefined;
  readonly hasPayloadSchema?: true | undefined;
  readonly hasVerify?: true | undefined;
  readonly id: string;
  readonly input?: unknown;
  readonly inputSchema?: JsonSchema | undefined;
  readonly kind: string;
  readonly key: string;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly method?: string | undefined;
  readonly parseOutputSchema?: JsonSchema | undefined;
  readonly path?: string | undefined;
  readonly payloadSchema?: JsonSchema | undefined;
  readonly timezone?: string | undefined;
}

export interface TopoGraphActivationEdge extends Readonly<
  Record<string, unknown>
> {
  readonly hasWhere: boolean;
  readonly sourceId: string;
  readonly sourceKey: string;
  readonly sourceKind: string;
  readonly trailId: string;
  readonly where?: { readonly predicate: true } | undefined;
}

export interface TopoGraphActivationGraph {
  readonly edgeCount: number;
  readonly edges: readonly TopoGraphActivationEdge[];
  readonly sourceCount: number;
  readonly sourceKeys: readonly string[];
  readonly trailIds: readonly string[];
}

export interface TopoGraphActivationEntry {
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly source: TopoGraphActivationSource;
  readonly where?: { readonly predicate: true } | undefined;
}

export interface TopoGraphPermitRequirement {
  readonly scopes: readonly string[];
}

export interface TopoGraphVersionDetour {
  readonly maxAttempts: number;
  readonly on: string;
}

export interface TopoGraphVersionEntry {
  readonly exampleCount: number;
  readonly examples?: readonly StructuredTrailExample[] | undefined;
  readonly kind: 'revision' | 'fork';
  readonly input: JsonSchema;
  readonly marker: string;
  readonly output: JsonSchema;
  readonly status?: TrailVersionStatus | undefined;
  readonly composes?: readonly string[] | undefined;
  readonly detours?: readonly TopoGraphVersionDetour[] | undefined;
  readonly resources?: readonly string[] | undefined;
}

export interface TopoGraphForceEntry {
  readonly acceptedAt: string;
  readonly change: 'modified' | 'removed';
  readonly detail: string;
  readonly id: string;
  readonly kind: 'contour' | 'trail' | 'signal' | 'resource';
  readonly reason?: string | undefined;
  readonly severity: 'breaking';
  readonly source: 'trails compile --force';
}

export type TopoGraphFacetTrailSelector = string | readonly string[];

export interface TopoGraphFacetDeclaration {
  readonly id: string;
  readonly trails: TopoGraphFacetTrailSelector;
  readonly description: string;
  readonly surfaces?: readonly string[] | undefined;
  readonly visibility?: 'public' | 'internal' | undefined;
  readonly descriptionStableThrough?: string | undefined;
  readonly visibilityWideningAccepted?: true | undefined;
}

export interface TopoGraphFacetEntry {
  readonly id: string;
  readonly description: string;
  readonly memberIds: readonly string[];
  readonly memberSetHash: string;
  readonly surfaces: readonly string[];
  readonly visibility?: 'public' | 'internal' | undefined;
  readonly descriptionStableThrough?: string | undefined;
  readonly visibilityWideningAccepted?: true | undefined;
}

// ---------------------------------------------------------------------------
// TopoGraph
// ---------------------------------------------------------------------------

export interface TopoGraphEntry {
  readonly id: string;
  readonly kind: 'contour' | 'trail' | 'signal' | 'resource';
  readonly surfaces: readonly string[];
  readonly cli?:
    | {
        readonly path: readonly string[];
        readonly routes?: readonly CliCommandRoute[] | undefined;
      }
    | undefined;
  readonly input?: JsonSchema | undefined;
  readonly marker?: string | undefined;
  readonly payload?: JsonSchema | undefined;
  readonly output?: JsonSchema | undefined;
  readonly version?: number | undefined;
  readonly versions?:
    | Readonly<Record<string, TopoGraphVersionEntry>>
    | undefined;
  readonly supports?: readonly number[] | undefined;
  readonly forces?: readonly TopoGraphForceEntry[] | undefined;
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  readonly idempotent?: boolean | undefined;
  readonly dryRunCapable?: boolean | undefined;
  readonly permit?: 'public' | TopoGraphPermitRequirement | undefined;
  readonly pattern?: string | undefined;
  readonly deprecated?: boolean | undefined;
  readonly replacedBy?: string | undefined;
  readonly activationSources?: readonly TopoGraphActivationEntry[] | undefined;
  readonly composes?: readonly string[] | undefined;
  readonly contours?: readonly string[] | undefined;
  readonly schema?: JsonSchema | undefined;
  readonly identity?: string | undefined;
  readonly references?: readonly TopoGraphContourReference[] | undefined;
  readonly resources?: readonly string[] | undefined;
  readonly fires?: readonly string[] | undefined;
  readonly on?: readonly string[] | undefined;
  readonly from?: readonly string[] | undefined;
  readonly producers?: readonly string[] | undefined;
  readonly consumers?: readonly string[] | undefined;
  readonly diagnostics?: Readonly<Record<string, unknown>> | undefined;
  readonly governance?: Readonly<Record<string, unknown>> | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly fieldOverrides?: readonly TopoGraphFieldOverride[] | undefined;
  readonly layers?: readonly TopoGraphLayerReference[] | undefined;
  readonly detours?:
    | readonly { readonly on: string; readonly maxAttempts: number }[]
    | undefined;
  readonly healthcheck?: boolean | undefined;
  readonly exampleCount: number;
  readonly examples?: readonly TopoGraphExample[] | undefined;
  readonly description?: string | undefined;
}

export interface TopoGraph {
  readonly topoGraphSchemaVersion: typeof TOPO_GRAPH_SCHEMA_VERSION;
  readonly activationGraph: TopoGraphActivationGraph;
  readonly activationSources: Readonly<
    Record<string, TopoGraphActivationSource>
  >;
  readonly generatedAt: string;
  readonly entries: readonly TopoGraphEntry[];
  readonly facets?: readonly TopoGraphFacetEntry[] | undefined;
  readonly forces?: readonly TopoGraphForceEntry[] | undefined;
  readonly workspace?: WorkspaceTopoMetadata | undefined;
}

export interface DeriveTopoGraphOptions {
  readonly facets?: readonly TopoGraphFacetDeclaration[] | undefined;
}

// ---------------------------------------------------------------------------
// Lock Manifest
// ---------------------------------------------------------------------------

/** Workspace-owned trail entry serialized into a workspace topo graph. */
export const workspaceTrailEntrySchema = z
  .object({
    appName: z.string(),
    modulePath: z.string(),
    trailId: z.string(),
  })
  .strict();

export type WorkspaceTrailEntry = z.infer<typeof workspaceTrailEntrySchema>;

/**
 * Workspace-wide trail-id index serialized into a workspace topo graph.
 *
 * Each key is a fully-qualified trail identifier. Each value carries the app
 * that owns it plus the app module path used by consumers that need to load
 * the owning topo without re-walking workspace manifests.
 *
 * @see TopoGraph for the artifact envelope that may carry this index.
 */
export const workspaceTrailIndexSchema = z.record(
  z.string(),
  workspaceTrailEntrySchema
);

export type WorkspaceTrailIndex = z.infer<typeof workspaceTrailIndexSchema>;

/** A trail id exported by more than one app in a workspace topo graph. */
export const workspaceTrailCollisionSchema = z
  .object({
    apps: z.array(z.string()).min(2),
    owners: z.array(workspaceTrailEntrySchema).min(2),
    trailId: z.string(),
  })
  .strict();

export type WorkspaceTrailCollision = z.infer<
  typeof workspaceTrailCollisionSchema
>;

/** Workspace metadata serialized into a workspace-scope TopoGraph. */
export const workspaceTopoMetadataSchema = z
  .object({
    collisions: z.array(workspaceTrailCollisionSchema).optional(),
    trails: workspaceTrailIndexSchema,
  })
  .strict();

export type WorkspaceTopoMetadata = z.infer<typeof workspaceTopoMetadataSchema>;

const topoGraphForceEntrySchema = z
  .object({
    acceptedAt: z.string(),
    change: z.enum(['modified', 'removed']),
    detail: z.string(),
    id: z.string(),
    kind: z.enum(['contour', 'trail', 'signal', 'resource']),
    reason: z.string().optional(),
    severity: z.literal('breaking'),
    source: z.literal('trails compile --force'),
  })
  .strict();

export const topoGraphFacetEntrySchema = z
  .object({
    description: z.string(),
    descriptionStableThrough: z.string().optional(),
    id: z.string(),
    memberIds: z.array(z.string()),
    memberSetHash: z.string().regex(/^[0-9a-f]{64}$/),
    surfaces: z.array(z.string()),
    visibility: z.enum(['public', 'internal']).optional(),
    visibilityWideningAccepted: z.literal(true).optional(),
  })
  .strict();

export const topoGraphSchema = z
  .object({
    activationGraph: z
      .object({
        edgeCount: z.number().int().nonnegative(),
        edges: z.array(z.unknown()),
        sourceCount: z.number().int().nonnegative(),
        sourceKeys: z.array(z.string()),
        trailIds: z.array(z.string()),
      })
      .strict(),
    activationSources: z.record(z.string(), z.unknown()),
    entries: z.array(
      z
        .object({
          exampleCount: z.number().int().nonnegative(),
          id: z.string(),
          kind: z.enum(['contour', 'trail', 'signal', 'resource']),
          surfaces: z.array(z.string()),
        })
        .passthrough()
    ),
    facets: z.array(topoGraphFacetEntrySchema).optional(),
    forces: z.array(topoGraphForceEntrySchema).optional(),
    generatedAt: z.string(),
    topoGraphSchemaVersion: z.literal(TOPO_GRAPH_SCHEMA_VERSION),
    workspace: workspaceTopoMetadataSchema.optional(),
  })
  .strict();

/**
 * Lock v3 manifest artifact pointer.
 */
export const lockManifestArtifactSchema = z
  .object({
    path: z.string(),
    role: z.literal('topo'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const lockManifestSummarySchema = z
  .object({
    contours: z.number().int().nonnegative(),
    resources: z.number().int().nonnegative(),
    signals: z.number().int().nonnegative(),
    trails: z.number().int().nonnegative(),
  })
  .strict();

export const lockManifestSchema = z
  .object({
    artifacts: z.array(lockManifestArtifactSchema).min(1),
    scope: z.record(z.string(), z.string()),
    summary: lockManifestSummarySchema,
    version: z.literal(3),
  })
  .strict();

export type LockManifestArtifact = z.infer<typeof lockManifestArtifactSchema>;
export type LockManifestSummary = z.infer<typeof lockManifestSummarySchema>;
export type LockManifest = z.infer<typeof lockManifestSchema>;

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface DiffEntry {
  readonly id: string;
  readonly kind: 'contour' | 'trail' | 'signal' | 'resource' | 'facet';
  readonly change: 'added' | 'removed' | 'modified';
  readonly severity: 'info' | 'warning' | 'breaking';
  readonly details: readonly string[];
}

export interface DiffResult {
  readonly entries: readonly DiffEntry[];
  readonly breaking: readonly DiffEntry[];
  readonly warnings: readonly DiffEntry[];
  readonly info: readonly DiffEntry[];
  readonly hasBreaking: boolean;
}

// ---------------------------------------------------------------------------
// I/O options
// ---------------------------------------------------------------------------

export interface WriteOptions {
  /** Directory to write to. Defaults to ".trails/" */
  readonly dir?: string | undefined;
}

export interface ReadOptions {
  /** Directory to read from. Defaults to ".trails/" */
  readonly dir?: string | undefined;
}
