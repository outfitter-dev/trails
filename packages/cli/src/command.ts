/**
 * Framework-agnostic CLI command model.
 *
 * These interfaces are the intermediate representation that
 * `deriveCliCommands()` produces and framework adapters consume.
 * No Commander (or any other framework) imports here.
 */

import type {
  AnyTrail,
  Layer,
  Result,
  CliCommandRoute,
  SurfaceTrailVersionRendering,
  TrailContext,
} from '@ontrails/core';

export type { AnyTrail } from '@ontrails/core';

// ---------------------------------------------------------------------------
// CliFlag
// ---------------------------------------------------------------------------

/** A standalone boolean alias that maps to a canonical enum flag value. */
export interface CliFlagValueAlias {
  readonly name: string;
  readonly value: string;
  readonly description?: string | undefined;
}

/** A single CLI flag derived from a Zod schema field or preset. */
export interface CliFlag {
  readonly name: string;
  /** Framework-owned behavior that adapters may need to distinguish. */
  readonly role?: 'structured-input' | undefined;
  readonly short?: string | undefined;
  readonly description?: string | undefined;
  readonly type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]';
  readonly required: boolean;
  readonly default?: unknown | undefined;
  readonly choices?: string[] | undefined;
  readonly valueAliases?: readonly CliFlagValueAlias[] | undefined;
  /**
   * Whether one flag occurrence consumes an unbounded value sequence.
   *
   * Bounded multiselects remain non-variadic so a parser does not greedily
   * consume every following token. CLI adapters should pass argv through
   * `normalizeCliArgv` to support both contiguous and repeated bounded-choice
   * syntax while preserving child routes after the first explicit value.
   */
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

export interface CliCommandExecuteOptions {
  /**
   * CamelCase or kebab-case parsed flag keys that came directly from argv.
   *
   * Adapters that preserve framework-defaulted parsed flag values should pass
   * this set so default-valued but explicitly supplied flags keep normal flag
   * precedence over structured input.
   */
  readonly userSuppliedFlagKeys?: ReadonlySet<string> | undefined;
}

/** A framework-agnostic representation of a CLI command. */
export interface CliCommand {
  readonly path: readonly string[];
  readonly routes?: readonly CliCommandRoute[] | undefined;
  readonly description?: string | undefined;
  readonly flags: CliFlag[];
  readonly args: CliArg[];
  readonly trail: AnyTrail;
  readonly versions?: readonly SurfaceTrailVersionRendering[] | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly intent: 'read' | 'write' | 'destroy';
  readonly idempotent?: boolean | undefined;

  /**
   * Validate input, compose layers, and run the trail implementation.
   *
   * The caller is responsible for parsing raw args and flags from the CLI
   * invocation and mapping the Result to a process exit. This function is
   * framework-agnostic.
   *
   * @param parsedArgs - Positional arguments parsed from argv, keyed by field name.
   * @param parsedFlags - Named flags parsed from argv, keyed by camelCase field name.
   * @param ctxOverrides - Optional per-invocation overrides merged into the
   *   TrailContext before execution. The CLI surface marker is always
   *   applied on top of these overrides.
   * @param executeOptions - Optional adapter metadata about parsed argv
   *   provenance. Callers may omit it when parsed flags contain only explicit
   *   values.
   */
  execute(
    parsedArgs: Record<string, unknown>,
    parsedFlags: Record<string, unknown>,
    ctxOverrides?: Partial<TrailContext>,
    executeOptions?: CliCommandExecuteOptions
  ): Promise<Result<unknown, Error>>;
}
