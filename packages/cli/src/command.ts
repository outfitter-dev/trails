/**
 * Framework-agnostic CLI command model.
 *
 * These interfaces are the intermediate representation that
 * `buildCliCommands()` produces and framework connectors consume.
 * No Commander (or any other framework) imports here.
 */

import type { Layer, Result, Trail, TrailContext } from '@ontrails/core';

// ---------------------------------------------------------------------------
// AnyTrail -- type-erased trail for the CLI boundary
// ---------------------------------------------------------------------------

/**
 * Type-erased trail reference. At the CLI connector boundary we lose
 * generic type information since flags/args are parsed as strings.
 * Using `any` here is intentional -- the Zod schema validates at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTrail = Trail<any, any, any>;

// ---------------------------------------------------------------------------
// CliFlag
// ---------------------------------------------------------------------------

/** A single CLI flag derived from a Zod schema field or preset. */
export interface CliFlag {
  readonly name: string;
  readonly short?: string | undefined;
  readonly description?: string | undefined;
  readonly type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]';
  readonly required: boolean;
  readonly default?: unknown | undefined;
  readonly choices?: string[] | undefined;
  readonly variadic: boolean;
}

// ---------------------------------------------------------------------------
// CliArg
// ---------------------------------------------------------------------------

/** A positional CLI argument. */
export interface CliArg {
  readonly name: string;
  readonly description?: string | undefined;
  readonly required: boolean;
  readonly variadic: boolean;
}

// ---------------------------------------------------------------------------
// CliCommand
// ---------------------------------------------------------------------------

/** A framework-agnostic representation of a CLI command. */
export interface CliCommand {
  readonly path: readonly string[];
  readonly description?: string | undefined;
  readonly flags: CliFlag[];
  readonly args: CliArg[];
  readonly trail: AnyTrail;
  readonly layers?: readonly Layer[] | undefined;
  readonly intent: 'read' | 'write' | 'destroy';
  readonly idempotent?: boolean | undefined;

  /**
   * Validate input, compose layers, and execute the trail implementation.
   *
   * The caller is responsible for parsing raw args and flags from the CLI
   * invocation and mapping the Result to a process exit. This function is
   * framework-agnostic.
   *
   * @param parsedArgs - Positional arguments parsed from argv, keyed by field name.
   * @param parsedFlags - Named flags parsed from argv, keyed by camelCase field name.
   * @param ctxOverrides - Optional per-invocation overrides merged into the
   *   TrailContext before execution. The CLI trailhead marker is always
   *   applied on top of these overrides.
   */
  execute(
    parsedArgs: Record<string, unknown>,
    parsedFlags: Record<string, unknown>,
    ctxOverrides?: Partial<TrailContext>
  ): Promise<Result<unknown, Error>>;
}
