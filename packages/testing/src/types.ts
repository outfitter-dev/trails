/**
 * Shared types for @ontrails/testing.
 */

import type { DeriveCliCommandsOptions } from '@ontrails/cli';
import type {
  DeriveHttpRoutesOptions,
  HttpHeaderSource,
  HttpMethod,
} from '@ontrails/http';
import type { McpExtra, DeriveMcpToolsOptions } from '@ontrails/mcp';
import type {
  AnyTrail,
  Logger,
  ResourceOverrideMap,
  Topo,
  TraceFn,
  TrailContext,
} from '@ontrails/core';
import type { LogLevel, LogRecord } from '@ontrails/observe';

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
// Cross Scenario (for testCrosses)
// ---------------------------------------------------------------------------

/** A test scenario for a trail's crossing graph. */
export interface CrossScenario extends TestScenario {
  /** Assert these trail IDs were crossed, in order. */
  readonly expectCrossed?: readonly string[] | undefined;
  /** Assert crossing counts per trail ID. */
  readonly expectCrossedCount?: Readonly<Record<string, number>> | undefined;
  /** Inject failure from a crossed trail's example by description. */
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
// CLI Harness
// ---------------------------------------------------------------------------

/** Options for creating a CLI harness. */
export interface CliHarnessOptions extends Omit<
  DeriveCliCommandsOptions,
  'onResult' | 'presets' | 'resolveInput'
> {
  readonly ctx?: Partial<TrailContext> | undefined;
  readonly graph: Topo;
}

/** A test harness for CLI commands. */
export interface CliHarness {
  /** Execute a CLI command string and capture output. */
  run(command: string): Promise<CliHarnessResult>;
}

/** The result of a CLI harness command execution. */
export interface CliHarnessResult {
  readonly error?:
    | {
        readonly category: string;
        readonly code: string;
        readonly message: string;
      }
    | undefined;
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
export interface McpHarnessOptions extends DeriveMcpToolsOptions {
  readonly extra?: Partial<McpExtra> | undefined;
  readonly graph: Topo;
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
  readonly meta?: Record<string, unknown> | undefined;
  readonly structuredContent?: Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// HTTP Harness
// ---------------------------------------------------------------------------

/** Options for creating an HTTP harness. */
export interface HttpHarnessOptions extends DeriveHttpRoutesOptions {
  readonly ctx?: Partial<TrailContext> | undefined;
  readonly graph: Topo;
}

export interface HttpHarnessRequest {
  readonly abortSignal?: AbortSignal | undefined;
  readonly body?: unknown | undefined;
  readonly headers?: HttpHeaderSource | undefined;
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Record<string, unknown> | undefined;
  readonly requestId?: string | undefined;
}

export interface HttpHarnessRequestOptions extends Omit<
  HttpHarnessRequest,
  'body' | 'method' | 'path' | 'query'
> {
  readonly query?: Record<string, unknown> | undefined;
}

/** A test harness for HTTP route projections. */
export interface HttpHarness {
  /** Execute a raw HTTP-style harness request. */
  request(request: HttpHarnessRequest): Promise<HttpHarnessResult>;
  /** Execute a GET request, reading input from query params. */
  get(
    path: string,
    query?: Record<string, unknown>,
    options?: HttpHarnessRequestOptions
  ): Promise<HttpHarnessResult>;
  /** Execute a POST request, reading input from the JSON-like body value. */
  post(
    path: string,
    body?: unknown,
    options?: HttpHarnessRequestOptions
  ): Promise<HttpHarnessResult>;
  /** Execute a PUT request. */
  put(
    path: string,
    body?: unknown,
    options?: HttpHarnessRequestOptions
  ): Promise<HttpHarnessResult>;
  /** Execute a PATCH request. */
  patch(
    path: string,
    body?: unknown,
    options?: HttpHarnessRequestOptions
  ): Promise<HttpHarnessResult>;
  /** Execute a DELETE request. */
  delete(
    path: string,
    body?: unknown,
    options?: HttpHarnessRequestOptions
  ): Promise<HttpHarnessResult>;
}

export interface HttpHarnessErrorBody {
  readonly error: {
    readonly category: string;
    readonly code: string;
    readonly message: string;
  };
}

export interface HttpHarnessSuccessBody {
  readonly data: unknown;
}

/** The result of an HTTP harness request. */
export interface HttpHarnessResult {
  readonly body: HttpHarnessErrorBody | HttpHarnessSuccessBody;
  readonly data?: unknown | undefined;
  readonly error?: HttpHarnessErrorBody['error'] | undefined;
  readonly ok: boolean;
  readonly status: number;
}

// ---------------------------------------------------------------------------
// Surface parity
// ---------------------------------------------------------------------------

export type SurfaceParitySurface = 'cli' | 'mcp' | 'http';

export interface SurfaceParityExclusion {
  /** Optional example name. Omit to exclude every example for the trail. */
  readonly example?: string | undefined;
  /** Human-readable reason shown in the skipped test name. */
  readonly reason: string;
  /** Trail ID to exclude. */
  readonly trailId: string;
}

export interface SurfaceParityOptions extends TestAllEstablishedOptions {
  readonly createResources?:
    | (() => ResourceOverrideMap | Promise<ResourceOverrideMap>)
    | undefined;
  readonly exclusions?: readonly SurfaceParityExclusion[] | undefined;
}

export type NormalizedSurfaceParityResult =
  | {
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly error: {
        readonly category: string;
        readonly code: string;
      };
      readonly ok: false;
    };

// ---------------------------------------------------------------------------
// Established verification
// ---------------------------------------------------------------------------

export interface TestAllEstablishedOptions {
  readonly cli?: Omit<CliHarnessOptions, 'graph'> | undefined;
  readonly createPermit?:
    | ((trail: {
        readonly permit?:
          | { readonly scopes: readonly string[] }
          | 'public'
          | undefined;
      }) =>
        | {
            readonly id: string;
            readonly scopes: readonly string[];
          }
        | undefined)
    | undefined;
  readonly ctx?: Partial<TrailContext> | undefined;
  readonly http?: Omit<HttpHarnessOptions, 'graph'> | undefined;
  readonly mcp?: Omit<McpHarnessOptions, 'graph'> | undefined;
  readonly resources?: Record<string, unknown> | undefined;
  readonly strictPermits?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Scenario (for composition testing)
// ---------------------------------------------------------------------------

/** Marker for cross-step references in scenario inputs. */
export interface RefToken {
  readonly __ref: true;
  readonly path: string;
}

/** A single step in a scenario. */
export interface ScenarioStep {
  readonly cross: AnyTrail;
  readonly input: Record<string, unknown>;
  readonly as?: string | undefined;
  readonly expected?: unknown | undefined;
  readonly expectedMatch?: unknown | undefined;
}
