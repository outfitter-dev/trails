/**
 * Types for surface maps, diffing, and lock files.
 */

// ---------------------------------------------------------------------------
// JSON Schema (lightweight alias)
// ---------------------------------------------------------------------------

/** A JSON Schema object produced by zodToJsonSchema. */
export type JsonSchema = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Surface Map
// ---------------------------------------------------------------------------

export interface SurfaceMapEntry {
  readonly id: string;
  readonly kind: 'trail' | 'event';
  readonly surfaces: readonly string[];
  readonly input?: JsonSchema | undefined;
  readonly output?: JsonSchema | undefined;
  readonly readOnly?: boolean | undefined;
  readonly destructive?: boolean | undefined;
  readonly idempotent?: boolean | undefined;
  readonly deprecated?: boolean | undefined;
  readonly replacedBy?: string | undefined;
  readonly follow?: readonly string[] | undefined;
  readonly detours?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly exampleCount: number;
  readonly description?: string | undefined;
}

export interface SurfaceMap {
  readonly version: string;
  readonly generatedAt: string;
  readonly entries: readonly SurfaceMapEntry[];
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface DiffEntry {
  readonly id: string;
  readonly kind: 'trail' | 'event';
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
