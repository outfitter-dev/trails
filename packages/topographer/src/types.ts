/**
 * Types for surface maps, diffing, and lock files.
 */

import type {
  StructuredSignalExample,
  StructuredTrailExample,
} from '@ontrails/core';
import { z } from 'zod';

export type SurfaceMapExample =
  | StructuredSignalExample
  | StructuredTrailExample;

// ---------------------------------------------------------------------------
// JSON Schema (lightweight alias)
// ---------------------------------------------------------------------------

/** A JSON Schema object produced by zodToJsonSchema. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface SurfaceMapContourReference {
  readonly contour: string;
  readonly field: string;
  readonly identity: string;
}

export type SurfaceMapFieldOverrideKey =
  | 'hint'
  | 'label'
  | 'message'
  | 'options';

export interface SurfaceMapFieldOverride {
  readonly field: string;
  readonly overrides: readonly SurfaceMapFieldOverrideKey[];
  readonly provenance: {
    readonly source: 'trail.fields';
  };
}

export interface SurfaceMapLayerReference {
  readonly input?: JsonSchema | undefined;
  readonly name: string;
  readonly scope: 'topo' | 'trail';
}

export interface SurfaceMapActivationSource extends Readonly<
  Record<string, unknown>
> {
  readonly cron?: string | undefined;
  readonly hasParse?: true | undefined;
  readonly hasPayloadSchema?: true | undefined;
  readonly id: string;
  readonly input?: unknown;
  readonly inputSchema?: JsonSchema | undefined;
  readonly kind: string;
  readonly key: string;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly parseOutputSchema?: JsonSchema | undefined;
  readonly payloadSchema?: JsonSchema | undefined;
  readonly timezone?: string | undefined;
}

export interface SurfaceMapActivationEdge extends Readonly<
  Record<string, unknown>
> {
  readonly hasWhere: boolean;
  readonly sourceId: string;
  readonly sourceKey: string;
  readonly sourceKind: string;
  readonly trailId: string;
  readonly where?: { readonly predicate: true } | undefined;
}

export interface SurfaceMapActivationGraph {
  readonly edgeCount: number;
  readonly edges: readonly SurfaceMapActivationEdge[];
  readonly sourceCount: number;
  readonly sourceKeys: readonly string[];
  readonly trailIds: readonly string[];
}

export interface SurfaceMapActivationEntry {
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly source: SurfaceMapActivationSource;
  readonly where?: { readonly predicate: true } | undefined;
}

export interface SurfaceMapPermitRequirement {
  readonly scopes: readonly string[];
}

// ---------------------------------------------------------------------------
// Surface Map
// ---------------------------------------------------------------------------

export interface SurfaceMapEntry {
  readonly id: string;
  readonly kind: 'contour' | 'trail' | 'signal' | 'resource';
  readonly surfaces: readonly string[];
  readonly cli?:
    | {
        readonly path: readonly string[];
      }
    | undefined;
  readonly input?: JsonSchema | undefined;
  readonly payload?: JsonSchema | undefined;
  readonly output?: JsonSchema | undefined;
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  readonly idempotent?: boolean | undefined;
  readonly dryRunCapable?: boolean | undefined;
  readonly permit?: 'public' | SurfaceMapPermitRequirement | undefined;
  readonly pattern?: string | undefined;
  readonly deprecated?: boolean | undefined;
  readonly replacedBy?: string | undefined;
  readonly activationSources?: readonly SurfaceMapActivationEntry[] | undefined;
  readonly crosses?: readonly string[] | undefined;
  readonly contours?: readonly string[] | undefined;
  readonly schema?: JsonSchema | undefined;
  readonly identity?: string | undefined;
  readonly references?: readonly SurfaceMapContourReference[] | undefined;
  readonly resources?: readonly string[] | undefined;
  readonly fires?: readonly string[] | undefined;
  readonly on?: readonly string[] | undefined;
  readonly from?: readonly string[] | undefined;
  readonly producers?: readonly string[] | undefined;
  readonly consumers?: readonly string[] | undefined;
  readonly diagnostics?: Readonly<Record<string, unknown>> | undefined;
  readonly governance?: Readonly<Record<string, unknown>> | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly fieldOverrides?: readonly SurfaceMapFieldOverride[] | undefined;
  readonly layers?: readonly SurfaceMapLayerReference[] | undefined;
  readonly detours?:
    | readonly { readonly on: string; readonly maxAttempts: number }[]
    | undefined;
  readonly healthcheck?: boolean | undefined;
  readonly exampleCount: number;
  readonly examples?: readonly SurfaceMapExample[] | undefined;
  readonly description?: string | undefined;
}

export interface SurfaceMap {
  readonly version: string;
  readonly activationGraph: SurfaceMapActivationGraph;
  readonly activationSources: Readonly<
    Record<string, SurfaceMapActivationSource>
  >;
  readonly generatedAt: string;
  readonly entries: readonly SurfaceMapEntry[];
}

// ---------------------------------------------------------------------------
// Surface Lock
// ---------------------------------------------------------------------------

/** Workspace-owned trail entry serialized into a workspace lock. */
export const workspaceTrailEntrySchema = z.object({
  appName: z.string(),
  modulePath: z.string(),
  trailId: z.string(),
});

export type WorkspaceTrailEntry = z.infer<typeof workspaceTrailEntrySchema>;

/**
 * Workspace-wide trail-id index serialized into a workspace lock.
 *
 * Each key is a fully-qualified trail identifier. Each value carries the app
 * that owns it plus the app module path used by consumers that need to load
 * the owning topo without re-walking workspace manifests.
 *
 * @see SurfaceLock for the lock envelope that may carry this index.
 */
export const workspaceTrailIndexSchema = z.record(
  z.string(),
  workspaceTrailEntrySchema
);

export type WorkspaceTrailIndex = z.infer<typeof workspaceTrailIndexSchema>;

/**
 * Normalized lock data read from `trails.lock`.
 *
 * The file may be stored as structured JSON or legacy single-line text.
 * The normalized shape always exposes the committed hash and preserves any
 * extra structured metadata.
 *
 * @remarks
 * **Migration story.** Historical locks may be a single line containing a hash
 * or a JSON string hash. Structured lock envelopes authored by Topographer use
 * `version: '2'` and parse through {@link surfaceLockSchema}. Future lockfile
 * versions should update this schema and add an explicit migration path.
 */
export const surfaceLockSchema = z.object({
  hash: z.string(),
  version: z.literal('2').optional(),
  workspaceTrails: workspaceTrailIndexSchema.optional(),
});

export type SurfaceLock = z.infer<typeof surfaceLockSchema>;

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface DiffEntry {
  readonly id: string;
  readonly kind: 'contour' | 'trail' | 'signal' | 'resource';
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
