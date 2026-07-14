/**
 * Shared types for @ontrails/testing.
 */

import type { AnyTrail, Logger, TraceFn } from '@ontrails/core';
import type { LogLevel, LogRecord } from '@ontrails/observability';

// ---------------------------------------------------------------------------
// Test Scenario (for testTrail)
// ---------------------------------------------------------------------------

/** A custom test scenario for a single trail. */
export interface TestScenario {
  /** Description shown in test output. */
  readonly description?: string | undefined;
  /** Assert the result error has this message (substring match). */
  readonly expectErrMessage?: string | undefined;
  /** Assert the result is an error of this type. */
  readonly expectErr?: (new (...args: never[]) => Error) | undefined;
  /** Assert the result is ok. */
  readonly expectOk?: boolean | undefined;
  /** Assert the result value equals this. */
  readonly expectValue?: unknown | undefined;
  /** Input to pass to the implementation. */
  readonly input: unknown;
}

// ---------------------------------------------------------------------------
// Compose Scenario (for testComposes)
// ---------------------------------------------------------------------------

/** A test scenario for a trail's composing graph. */
export interface ComposeScenario extends TestScenario {
  /** Assert these trail IDs were composed, in order. */
  readonly expectComposed?: readonly string[] | undefined;
  /** Assert composing counts per trail ID. */
  readonly expectComposedCount?: Readonly<Record<string, number>> | undefined;
  /** Inject failure from a composed trail's example by description. */
  readonly injectFromExample?: Readonly<Record<string, string>> | undefined;
}

// ---------------------------------------------------------------------------
// Test Logger
// ---------------------------------------------------------------------------

/** A logger that captures entries for assertion in tests. */
export interface TestLogger extends Logger {
  /** All log records captured during the test. */
  readonly entries: readonly LogRecord[];
  /** Clear captured entries. */
  clear(): void;
  /** Find entries matching a predicate. */
  find(predicate: (record: LogRecord) => boolean): readonly LogRecord[];
  /** Assert that at least one entry matches. */
  assertLogged(level: LogLevel, messageSubstring: string): void;
}

// ---------------------------------------------------------------------------
// Test Trail Context Options
// ---------------------------------------------------------------------------

/** Options for creating a test trail context. */
export interface TestTrailContextOptions {
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly logger?: Logger | undefined;
  readonly requestId?: string | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly trace?: TraceFn | undefined;
}

// ---------------------------------------------------------------------------
// Scenario (for composition testing)
// ---------------------------------------------------------------------------

/** Marker for compose-step references in scenario inputs. */
export interface RefToken {
  readonly __ref: true;
  readonly path: string;
}

/** A single step in a scenario. */
export interface ScenarioStep {
  readonly compose: AnyTrail;
  readonly input: Record<string, unknown>;
  readonly as?: string | undefined;
  readonly expected?: unknown | undefined;
  readonly expectedMatch?: unknown | undefined;
}
