/**
 * Types for trailhead maps, diffing, and lock files.
 */

// ---------------------------------------------------------------------------
// JSON Schema (lightweight alias)
// ---------------------------------------------------------------------------

/** A JSON Schema object produced by zodToJsonSchema. */
export type JsonSchema = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Trailhead Map
// ---------------------------------------------------------------------------

export interface TrailheadMapEntry {
  readonly id: string;
  readonly kind: 'trail' | 'signal' | 'provision';
  readonly trailheads: readonly string[];
  readonly input?: JsonSchema | undefined;
  readonly output?: JsonSchema | undefined;
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  readonly idempotent?: boolean | undefined;
  readonly deprecated?: boolean | undefined;
  readonly replacedBy?: string | undefined;
  readonly crosses?: readonly string[] | undefined;
  readonly provisions?: readonly string[] | undefined;
  readonly detours?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly healthcheck?: boolean | undefined;
  readonly exampleCount: number;
  readonly description?: string | undefined;
}

export interface TrailheadMap {
  readonly version: string;
  readonly generatedAt: string;
  readonly entries: readonly TrailheadMapEntry[];
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface DiffEntry {
  readonly id: string;
  readonly kind: 'trail' | 'signal' | 'provision';
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
