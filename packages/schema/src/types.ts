/**
 * Types for surface maps, diffing, and lock files.
 */

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

// ---------------------------------------------------------------------------
// Surface Map
// ---------------------------------------------------------------------------

export interface SurfaceMapEntry {
  readonly id: string;
  readonly kind: 'contour' | 'trail' | 'signal' | 'resource';
  readonly trailheads: readonly string[];
  readonly cli?:
    | {
        readonly path: readonly string[];
      }
    | undefined;
  readonly input?: JsonSchema | undefined;
  readonly output?: JsonSchema | undefined;
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  readonly idempotent?: boolean | undefined;
  readonly pattern?: string | undefined;
  readonly deprecated?: boolean | undefined;
  readonly replacedBy?: string | undefined;
  readonly crosses?: readonly string[] | undefined;
  readonly contours?: readonly string[] | undefined;
  readonly schema?: JsonSchema | undefined;
  readonly identity?: string | undefined;
  readonly references?: readonly SurfaceMapContourReference[] | undefined;
  readonly resources?: readonly string[] | undefined;
  readonly detours?:
    | readonly { readonly on: string; readonly maxAttempts: number }[]
    | undefined;
  readonly healthcheck?: boolean | undefined;
  readonly exampleCount: number;
  readonly description?: string | undefined;
}

export interface SurfaceMap {
  readonly version: string;
  readonly generatedAt: string;
  readonly entries: readonly SurfaceMapEntry[];
}

// ---------------------------------------------------------------------------
// Surface Lock
// ---------------------------------------------------------------------------

/**
 * Normalized lock data read from `trails.lock`.
 *
 * The file may be stored as structured JSON or legacy single-line text.
 * The normalized shape always exposes the committed hash and preserves any
 * extra structured metadata.
 */
export type SurfaceLock = Readonly<Record<string, unknown>> & {
  readonly hash: string;
};

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
