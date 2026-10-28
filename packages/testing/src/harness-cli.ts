/**
 * CLI integration test harness.
 *
 * Builds CLI commands from a graph, executes them in-process,
 * and captures stdout/stderr.
 */

import { deriveCliCommands, deriveOutputMode, output } from '@ontrails/cli';
import type { CliCommand, DeriveCliCommandsOptions } from '@ontrails/cli';
import type { Topo, TrailContext } from '@ontrails/core';
import { renderPublicSurfaceError } from '@ontrails/core';

import { mergeTestContext } from './context.js';
import { parseCliHarnessFlags } from './harness-cli-argv.js';

/** Options for creating a CLI harness. */
export interface CliHarnessOptions extends Omit<
  DeriveCliCommandsOptions,
  'onResult' | 'resolveInput'
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
  /** Parsed JSON when stdout contains a single JSON value. */
  readonly json?: unknown | undefined;
  readonly stderr: string;
  readonly stdout: string;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/** Parse a command string into tokens (simple split, no quoting support). */
const parseCommandString = (input: string): string[] =>
  input
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);

// ---------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------

const matchesPath = (
  path: readonly string[],
  tokens: readonly string[]
): boolean =>
  path.length <= tokens.length &&
  path.every((segment, index) => tokens[index] === segment);

/** Resolve a command from tokens using the longest matching command path. */
const resolveCommand = (
  commands: CliCommand[],
  tokens: string[]
): { command: CliCommand; flagTokens: string[] } | undefined => {
  if (tokens.length === 0) {
    return undefined;
  }

  const [match] = commands
    .filter((command) => matchesPath(command.path, tokens))
    .toSorted((a, b) => b.path.length - a.path.length);

  if (match === undefined) {
    return undefined;
  }

  return { command: match, flagTokens: tokens.slice(match.path.length) };
};

// ---------------------------------------------------------------------------
// Stream capture
// ---------------------------------------------------------------------------

interface CapturedStreams {
  readonly getStderr: () => string;
  readonly getStdout: () => string;
  readonly restore: () => void;
}

/** Create interceptors for stdout/stderr capture. */
const captureStreams = (): CapturedStreams => {
  let stdout = '';
  let stderr = '';
  const origStdoutWrite = process.stdout.write;
  const origStderrWrite = process.stderr.write;

  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout +=
      typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderr +=
      typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;

  return {
    getStderr: () => stderr,
    getStdout: () => stdout,
    restore: () => {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
    },
  };
};

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/** Try to parse a string as JSON, returning undefined on failure. */
const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Format result value into stdout and build the CLI result. */
const formatSuccessResult = (
  value: unknown,
  flags: Record<string, unknown>,
  streams: CapturedStreams,
  topoName: string
): CliHarnessResult => {
  output(value, deriveOutputMode(flags, topoName).mode);
  return {
    exitCode: 0,
    json: tryParseJson(streams.getStdout().trim()),
    stderr: streams.getStderr(),
    stdout: streams.getStdout(),
  };
};

// ---------------------------------------------------------------------------
// Execute command
// ---------------------------------------------------------------------------

/** Build an error result from a caught exception. */
const buildErrorResult = (
  error: unknown,
  streams: CapturedStreams
): CliHarnessResult => {
  streams.restore();
  const actualError = error instanceof Error ? error : new Error(String(error));
  const rendering = renderPublicSurfaceError('cli', actualError);
  return {
    error: {
      category: rendering.category,
      code: rendering.name,
      message: rendering.message,
    },
    exitCode: 1,
    stderr: streams.getStderr() || rendering.message,
    stdout: streams.getStdout(),
  };
};

/** Execute a resolved command and return the result. */
const executeCommand = async (
  command: CliCommand,
  flags: Record<string, unknown>,
  streams: CapturedStreams,
  topoName: string,
  ctxOverrides?: Partial<TrailContext>
): Promise<CliHarnessResult> => {
  const ctx = mergeTestContext(ctxOverrides);
  const result = await command.execute({}, flags, ctx);
  if (result.isErr()) {
    streams.restore();
    const rendering = renderPublicSurfaceError('cli', result.error);
    return {
      error: {
        category: rendering.category,
        code: rendering.name,
        message: rendering.message,
      },
      exitCode: 1,
      stderr: streams.getStderr() || rendering.message,
      stdout: streams.getStdout(),
    };
  }

  const formatted = formatSuccessResult(result.value, flags, streams, topoName);
  streams.restore();
  return formatted;
};

/** Run the full command pipeline: resolve, parse, execute. */
const runCommand = async (
  commands: CliCommand[],
  commandString: string,
  topoName: string,
  ctxOverrides?: Partial<TrailContext>
): Promise<CliHarnessResult> => {
  const parts = parseCommandString(commandString);
  const resolved = resolveCommand(commands, parts);
  if (resolved === undefined) {
    return {
      exitCode: 1,
      stderr: `Unknown command: ${commandString}`,
      stdout: '',
    };
  }

  const { command, flagTokens } = resolved;
  const streams = captureStreams();

  try {
    const flags = parseCliHarnessFlags(command, flagTokens);
    return await executeCommand(
      command,
      flags,
      streams,
      topoName,
      ctxOverrides
    );
  } catch (error: unknown) {
    return buildErrorResult(error, streams);
  }
};

// ---------------------------------------------------------------------------
// createCliHarness
// ---------------------------------------------------------------------------

/**
 * Create a CLI harness for integration testing.
 *
 * Builds commands from the graph's topo and provides a `run()` method
 * that parses command strings and executes them in-process.
 *
 * ```ts
 * import { outputModePreset } from '@ontrails/cli';
 * import { createCliHarness } from '@ontrails/testing/cli';
 *
 * const harness = createCliHarness({ graph, presets: [outputModePreset()] });
 * const result = await harness.run("entity show --name Alpha --output json");
 * expect(result.exitCode).toBe(0);
 * ```
 */
export const createCliHarness = (options: CliHarnessOptions): CliHarness => {
  const { ctx, graph, ...deriveOptions } = options;
  const commandsResult = deriveCliCommands(graph, deriveOptions);
  if (commandsResult.isErr()) {
    throw commandsResult.error;
  }
  const commands = commandsResult.value;

  return {
    run: (commandString: string) =>
      runCommand(commands, commandString, graph.name, ctx),
  };
};
