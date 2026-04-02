/**
 * Shared types for @ontrails/testing.
 */

import type { Logger, Topo } from '@ontrails/core';
import type { LogLevel, LogRecord } from '@ontrails/logging';

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
// Follow Scenario (for testFollows)
// ---------------------------------------------------------------------------

/** A test scenario for a trail's composition graph. */
export interface FollowScenario extends TestScenario {
  /** Assert these trail IDs were followed, in order. */
  readonly expectFollowed?: readonly string[] | undefined;
  /** Assert follow counts per trail ID. */
  readonly expectFollowedCount?: Readonly<Record<string, number>> | undefined;
  /** Inject failure from a followed trail's example by description. */
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
}

// ---------------------------------------------------------------------------
// CLI Harness
// ---------------------------------------------------------------------------

/** Options for creating a CLI harness. */
export interface CliHarnessOptions {
  readonly app: Topo;
}

/** A test harness for CLI commands. */
export interface CliHarness {
  /** Execute a CLI command string and capture output. */
  run(command: string): Promise<CliHarnessResult>;
}

/** The result of a CLI harness command execution. */
export interface CliHarnessResult {
  readonly exitCode: number;
  /** Parsed JSON output if --output json was used. */
  readonly json?: unknown | undefined;
  readonly stderr: string;
  readonly stdout: string;
}

// ---------------------------------------------------------------------------
// MCP Harness
// ---------------------------------------------------------------------------

/** Options for creating an MCP harness. */
export interface McpHarnessOptions {
  readonly app: Topo;
}

/** A test harness for MCP tools. */
export interface McpHarness {
  /** Call an MCP tool by name with arguments. */
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<McpHarnessResult>;
}

/** The result of an MCP harness tool invocation. */
export interface McpHarnessResult {
  readonly content: unknown;
  readonly isError: boolean;
}
