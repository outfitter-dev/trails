/**
 * Types for topo graphs, diffing, and lock files.
 */

import type {
  CliCommandRoute,
  OverlayProvenance,
  StructuredSignalExample,
  StructuredTrailExample,
  Topo,
  TrailVersionStatus,
} from '@ontrails/core';
import { z } from 'zod';

export const TOPO_GRAPH_SCHEMA_VERSION = 4;
export const LOCK_MANIFEST_SCHEMA_VERSION = 4;
export const TRAILS_LOCK_SCHEMA_VERSION = 5;

export type TopoGraphExample = StructuredSignalExample | StructuredTrailExample;

// ---------------------------------------------------------------------------
// JSON Schema (lightweight alias)
// ---------------------------------------------------------------------------

/** A JSON Schema object produced by zodToJsonSchema. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface TopoGraphEntityReference {
  readonly entity: string;
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
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
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
  readonly kind: 'entity' | 'trail' | 'signal' | 'resource';
  readonly reason?: string | undefined;
  readonly severity: 'breaking';
  readonly source: 'trails compile --force';
}

export interface TopoGraphTrailheadEntry {
  readonly id: string;
  readonly description: string;
  readonly memberIds: readonly string[];
  readonly memberSetHash: string;
  readonly surfaces: readonly string[];
  readonly visibility?: 'public' | 'internal' | undefined;
  readonly descriptionStableThrough?: string | undefined;
  readonly visibilityWideningAccepted?: true | undefined;
}

export type TopoGraphLibraryExportSource =
  | 'derived'
  | 'trail-hint'
  | 'package-config';

export interface TopoGraphLibraryExport {
  readonly description?: string | undefined;
  readonly exportName: string;
  readonly input?: JsonSchema | undefined;
  readonly intent: 'read' | 'write' | 'destroy';
  readonly nameSource: TopoGraphLibraryExportSource;
  readonly output?: JsonSchema | undefined;
  readonly resources: readonly string[];
  readonly trailId: string;
  readonly version?: number | undefined;
}

export type TopoGraphLibraryExclusionReason =
  | 'activation'
  | 'draft'
  | 'internal';

export interface TopoGraphLibraryExclusion {
  readonly reason: TopoGraphLibraryExclusionReason;
  readonly trailId: string;
}

export interface TopoGraphLibraryCollision {
  readonly exportName: string;
  readonly trailIds: readonly string[];
}

export interface TopoGraphLibraryProjection {
  readonly app: string;
  readonly collisions: readonly TopoGraphLibraryCollision[];
  readonly excluded: readonly TopoGraphLibraryExclusion[];
  readonly exports: readonly TopoGraphLibraryExport[];
}

// ---------------------------------------------------------------------------
// TopoGraph
// ---------------------------------------------------------------------------

/**
 * Namespaced fact overlays embedded on a topo graph, keyed by contribution
 * namespace. Values are overlay-owned JSON-plain facts; readers that do not
 * recognize a namespace preserve it verbatim.
 */
export type TopoGraphOverlays = Readonly<Record<string, unknown>>;

/**
 * A namespaced overlay contribution consumed by the topo graph derivers as
 * data. Each registration owns one namespace and supplies the schema its
 * derived facts must satisfy before they enter the graph.
 */
export interface TopoGraphOverlayRegistration {
  /** Unique dotted-kebab namespace, e.g. "cloudflare" or "cloudflare.workers". */
  readonly namespace: string;
  /**
   * Who authored the registration. Absent means adapter-derived. The
   * reserved `surfaces` namespace requires `'app-authored'` provenance.
   */
  readonly provenance?: OverlayProvenance | undefined;
  /** Zod schema the derived facts must satisfy before they enter the graph. */
  readonly schema: z.ZodType;
  /** Derive the namespace's facts from the topo. Must be deterministic. */
  readonly derive: (topo: Topo) => unknown;
}

export interface TopoGraphEntry {
  readonly id: string;
  readonly kind: 'entity' | 'trail' | 'signal' | 'resource';
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
  readonly entities?: readonly string[] | undefined;
  readonly schema?: JsonSchema | undefined;
  readonly identity?: string | undefined;
  readonly references?: readonly TopoGraphEntityReference[] | undefined;
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
  /**
   * Wallclock provenance for in-memory derivations only. The committed
   * `trails.lock` omits it so recompiles are byte-identical; it is always
   * excluded from the graph hash.
   */
  readonly generatedAt?: string | undefined;
  readonly entries: readonly TopoGraphEntry[];
  readonly trailheads?: readonly TopoGraphTrailheadEntry[] | undefined;
  readonly forces?: readonly TopoGraphForceEntry[] | undefined;
  readonly library?: TopoGraphLibraryProjection | undefined;
  /**
   * Namespaced fact overlays contributed by registered overlay contributions
   * (adapters). Unknown namespaces are preserved verbatim by every reader
   * (tolerant reader) and covered by the canonical graph hash.
   */
  readonly overlays?: TopoGraphOverlays | undefined;
  readonly workspace?: WorkspaceTopoMetadata | undefined;
}

export interface DeriveTopoGraphOptions {
  readonly overlays?: readonly TopoGraphOverlayRegistration[] | undefined;
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
    kind: z.enum(['entity', 'trail', 'signal', 'resource']),
    reason: z.string().optional(),
    severity: z.literal('breaking'),
    source: z.literal('trails compile --force'),
  })
  .strict();

export const topoGraphTrailheadEntrySchema = z
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

const topoGraphLibraryExportSourceSchema = z.enum([
  'derived',
  'package-config',
  'trail-hint',
]);

const topoGraphLibraryExportSchema = z
  .object({
    description: z.string().optional(),
    exportName: z.string(),
    input: z.record(z.string(), z.unknown()).optional(),
    intent: z.enum(['destroy', 'read', 'write']),
    nameSource: topoGraphLibraryExportSourceSchema,
    output: z.record(z.string(), z.unknown()).optional(),
    resources: z.array(z.string()),
    trailId: z.string(),
    version: z.number().int().positive().optional(),
  })
  .strict();

const topoGraphLibraryExclusionSchema = z
  .object({
    reason: z.enum(['activation', 'draft', 'internal']),
    trailId: z.string(),
  })
  .strict();

const topoGraphLibraryCollisionSchema = z
  .object({
    exportName: z.string(),
    trailIds: z.array(z.string()),
  })
  .strict();

export const topoGraphLibraryProjectionSchema = z
  .object({
    app: z.string(),
    collisions: z.array(topoGraphLibraryCollisionSchema),
    excluded: z.array(topoGraphLibraryExclusionSchema),
    exports: z.array(topoGraphLibraryExportSchema),
  })
  .strict();

const topoGraphEntityReferenceSchema = z
  .object({
    entity: z.string(),
    field: z.string(),
    identity: z.string(),
  })
  .strict();

const openFactBagSchema = z.record(z.string(), z.unknown());

const topoGraphWhereSchema = z
  .object({
    predicate: z.literal(true),
  })
  .strict();

const topoGraphActivationSourceSchema = z
  .object({
    cron: z.string().optional(),
    hasParse: z.literal(true).optional(),
    hasPayloadSchema: z.literal(true).optional(),
    hasVerify: z.literal(true).optional(),
    id: z.string(),
    input: z.unknown().optional(),
    inputSchema: openFactBagSchema.optional(),
    key: z.string(),
    kind: z.string(),
    meta: openFactBagSchema.optional(),
    method: z.string().optional(),
    parseOutputSchema: openFactBagSchema.optional(),
    path: z.string().optional(),
    payloadSchema: openFactBagSchema.optional(),
    timezone: z.string().optional(),
  })
  .passthrough();

const topoGraphActivationEdgeSchema = z
  .object({
    hasWhere: z.boolean(),
    meta: openFactBagSchema.optional(),
    sourceId: z.string(),
    sourceKey: z.string(),
    sourceKind: z.string(),
    trailId: z.string(),
    where: topoGraphWhereSchema.optional(),
  })
  .passthrough();

const topoGraphActivationGraphSchema = z
  .object({
    edgeCount: z.number().int().nonnegative(),
    edges: z.array(topoGraphActivationEdgeSchema),
    sourceCount: z.number().int().nonnegative(),
    sourceKeys: z.array(z.string()),
    trailIds: z.array(z.string()),
  })
  .strict();

const topoGraphActivationEntrySchema = z
  .object({
    meta: openFactBagSchema.optional(),
    source: topoGraphActivationSourceSchema,
    where: topoGraphWhereSchema.optional(),
  })
  .strict();

const topoGraphCliRouteSchema = z
  .object({
    kind: z.enum(['alias', 'canonical']),
    path: z.array(z.string()),
    source: z.enum(['derived', 'surface', 'trail']),
    target: z.string(),
  })
  .strict();

const topoGraphCliSchema = z
  .object({
    path: z.array(z.string()),
    routes: z.array(topoGraphCliRouteSchema).optional(),
  })
  .strict();

const structuredTrailExampleSignalAssertionSchema = z
  .object({
    payload: z.unknown().optional(),
    payloadMatch: z.unknown().optional(),
    signalId: z.string(),
    times: z.number().optional(),
  })
  .strict();

const structuredTrailExampleSchema = z
  .object({
    description: z.string().optional(),
    error: z.string().optional(),
    expected: z.unknown().optional(),
    expectedMatch: z.unknown().optional(),
    input: z.unknown(),
    kind: z.enum(['error', 'success']),
    name: z.string(),
    provenance: z
      .object({
        source: z.enum(['trail.examples', 'trail.versions.examples']),
      })
      .strict(),
    signals: z.array(structuredTrailExampleSignalAssertionSchema).optional(),
  })
  .strict();

const structuredSignalExampleSchema = z
  .object({
    kind: z.literal('payload'),
    payload: z.unknown(),
    provenance: z
      .object({
        source: z.literal('signal.examples'),
      })
      .strict(),
  })
  .strict();

const topoGraphExampleSchema = z.union([
  structuredSignalExampleSchema,
  structuredTrailExampleSchema,
]);

const trailVersionStatusSchema = z.discriminatedUnion('state', [
  z
    .object({
      migration: z.array(z.string()).optional(),
      note: z.string().optional(),
      state: z.literal('deprecated'),
      successor: z.number().int().positive().optional(),
    })
    .passthrough(),
  z
    .object({
      reason: z.string().optional(),
      state: z.literal('archived'),
    })
    .passthrough(),
]);

const topoGraphVersionDetourSchema = z
  .object({
    maxAttempts: z.number().int().positive(),
    on: z.string(),
  })
  .strict();

const topoGraphVersionEntrySchema = z
  .object({
    composes: z.array(z.string()).optional(),
    detours: z.array(topoGraphVersionDetourSchema).optional(),
    exampleCount: z.number().int().nonnegative(),
    examples: z.array(structuredTrailExampleSchema).optional(),
    input: openFactBagSchema,
    kind: z.enum(['fork', 'revision']),
    marker: z.string(),
    output: openFactBagSchema,
    resources: z.array(z.string()).optional(),
    status: trailVersionStatusSchema.optional(),
  })
  .strict();

const topoGraphPermitRequirementSchema = z
  .object({
    scopes: z.array(z.string()),
  })
  .strict();

const topoGraphFieldOverrideSchema = z
  .object({
    field: z.string(),
    overrides: z.array(z.enum(['hint', 'label', 'message', 'options'])),
    provenance: z
      .object({
        source: z.literal('trail.fields'),
      })
      .strict(),
  })
  .strict();

const topoGraphLayerReferenceSchema = z
  .object({
    input: openFactBagSchema.optional(),
    name: z.string(),
    scope: z.enum(['topo', 'trail']),
  })
  .strict();

const topoGraphEntrySchema = z
  .object({
    activationSources: z.array(topoGraphActivationEntrySchema).optional(),
    cli: topoGraphCliSchema.optional(),
    composes: z.array(z.string()).optional(),
    consumers: z.array(z.string()).optional(),
    deprecated: z.boolean().optional(),
    description: z.string().optional(),
    detours: z.array(topoGraphVersionDetourSchema).optional(),
    diagnostics: openFactBagSchema.optional(),
    dryRunCapable: z.boolean().optional(),
    entities: z.array(z.string()).optional(),
    exampleCount: z.number().int().nonnegative(),
    examples: z.array(topoGraphExampleSchema).optional(),
    fieldOverrides: z.array(topoGraphFieldOverrideSchema).optional(),
    fires: z.array(z.string()).optional(),
    forces: z.array(topoGraphForceEntrySchema).optional(),
    from: z.array(z.string()).optional(),
    governance: openFactBagSchema.optional(),
    healthcheck: z.boolean().optional(),
    id: z.string(),
    idempotent: z.boolean().optional(),
    identity: z.string().optional(),
    input: openFactBagSchema.optional(),
    intent: z.enum(['destroy', 'read', 'write']).optional(),
    kind: z.enum(['entity', 'trail', 'signal', 'resource']),
    layers: z.array(topoGraphLayerReferenceSchema).optional(),
    marker: z.string().optional(),
    meta: openFactBagSchema.optional(),
    on: z.array(z.string()).optional(),
    output: openFactBagSchema.optional(),
    pattern: z.string().optional(),
    payload: openFactBagSchema.optional(),
    permit: z
      .union([z.literal('public'), topoGraphPermitRequirementSchema])
      .optional(),
    producers: z.array(z.string()).optional(),
    references: z.array(topoGraphEntityReferenceSchema).optional(),
    replacedBy: z.string().optional(),
    resources: z.array(z.string()).optional(),
    schema: openFactBagSchema.optional(),
    supports: z.array(z.number().int().positive()).optional(),
    surfaces: z.array(z.string()),
    version: z.number().int().positive().optional(),
    versions: z.record(z.string(), topoGraphVersionEntrySchema).optional(),
  })
  .strict();

export const topoGraphSchema = z
  .object({
    activationGraph: topoGraphActivationGraphSchema,
    activationSources: z.record(z.string(), topoGraphActivationSourceSchema),
    entries: z.array(topoGraphEntrySchema),
    forces: z.array(topoGraphForceEntrySchema).optional(),
    generatedAt: z.string().optional(),
    library: topoGraphLibraryProjectionSchema.optional(),
    overlays: z.record(z.string(), z.unknown()).optional(),
    topoGraphSchemaVersion: z.literal(TOPO_GRAPH_SCHEMA_VERSION),
    trailheads: z.array(topoGraphTrailheadEntrySchema).optional(),
    workspace: workspaceTopoMetadataSchema.optional(),
  })
  .strict();

/**
 * Lock v4 manifest artifact pointer.
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
    entities: z.number().int().nonnegative(),
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
    version: z.literal(LOCK_MANIFEST_SCHEMA_VERSION),
  })
  .strict();

export type LockManifestArtifact = z.infer<typeof lockManifestArtifactSchema>;
export type LockManifestSummary = z.infer<typeof lockManifestSummarySchema>;
export type LockManifest = z.infer<typeof lockManifestSchema>;

export const trailsLockSchema = z
  .object({
    scope: z.record(z.string(), z.string()),
    summary: lockManifestSummarySchema,
    topoGraph: topoGraphSchema,
    topoGraphHash: z.string().regex(/^[0-9a-f]{64}$/),
    version: z.literal(TRAILS_LOCK_SCHEMA_VERSION),
  })
  .strict();

export type TrailsLock = z.infer<typeof trailsLockSchema>;

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface DiffEntry {
  readonly id: string;
  readonly kind: 'entity' | 'trail' | 'signal' | 'resource' | 'trailhead';
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
