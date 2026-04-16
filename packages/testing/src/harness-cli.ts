/**
 * CLI integration test harness.
 *
 * Builds CLI commands from an App, executes them in-process,
 * and captures stdout/stderr.
 */

import { deriveCliCommands } from '@ontrails/cli';
import type { CliCommand } from '@ontrails/cli';

import { createTestContext } from './context.js';
import type {
  CliHarness,
  CliHarnessOptions,
  CliHarnessResult,
} from './types.js';

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
// Flag parsing
// ---------------------------------------------------------------------------

/** Parse a value flag (--key value) and return new index. */
const parseValueFlag = (
  key: string,
  next: string,
  flags: Record<string, unknown>
): void => {
  const num = Number(next);
  flags[key] = Number.isNaN(num) ? next : num;
};

/** Parse a single flag token and advance the index. */
const parseSingleFlag = (
  tokens: string[],
  i: number,
  flags: Record<string, unknown>
): number => {
  const token = tokens[i];
  if (token === undefined || !token.startsWith('--')) {
    return i + 1;
  }

  const key = token.slice(2);
  const next = tokens[i + 1];

  if (next !== undefined && !next.startsWith('-')) {
    parseValueFlag(key, next, flags);
    return i + 2;
  }

  flags[key] = true;
  return i + 1;
};

/** Parse flag tokens into a record. */
const parseFlagTokens = (tokens: string[]): Record<string, unknown> => {
  const flags: Record<string, unknown> = {};
  let i = 0;

  while (i < tokens.length) {
    i = parseSingleFlag(tokens, i, flags);
  }

  return flags;
};

// ---------------------------------------------------------------------------
// Stream capture
// ---------------------------------------------------------------------------

interface CapturedStreams {
  readonly getStderr: () => string;
  readonly getStdout: () => string;
  readonly restore: () => void;
  readonly writeStdout: (text: string) => void;
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
    writeStdout: (text: string) => {
      stdout += text;
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
  streams: CapturedStreams
): CliHarnessResult => {
  const outputMode =
    flags['output'] ?? (flags['json'] === true ? 'json' : 'text');

  if (outputMode === 'json') {
    const jsonStr = `${JSON.stringify(value, null, 2)}\n`;
    streams.writeStdout(jsonStr);
    return {
      exitCode: 0,
      json: tryParseJson(jsonStr),
      stderr: streams.getStderr(),
      stdout: streams.getStdout(),
    };
  }

  const formatted =
    typeof value === 'string'
      ? `${value}\n`
      : `${JSON.stringify(value, null, 2)}\n`;
  streams.writeStdout(formatted);

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
  const message = error instanceof Error ? error.message : String(error);
  return {
    exitCode: 1,
    stderr: streams.getStderr() || message,
    stdout: streams.getStdout(),
  };
};

/** Execute a resolved command and return the result. */
const executeCommand = async (
  command: CliCommand,
  flags: Record<string, unknown>,
  streams: CapturedStreams
): Promise<CliHarnessResult> => {
  const ctx = createTestContext();
  const result = await command.execute({}, flags, ctx);
  streams.restore();

  if (result.isErr()) {
    return {
      exitCode: 1,
      stderr: streams.getStderr() || result.error.message,
      stdout: streams.getStdout(),
    };
  }

  return formatSuccessResult(result.value, flags, streams);
};

/** Run the full command pipeline: resolve, parse, execute. */
const runCommand = async (
  commands: CliCommand[],
  commandString: string
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
  const flags = parseFlagTokens(flagTokens);
  const streams = captureStreams();

  try {
    return await executeCommand(command, flags, streams);
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
 * Builds commands from the app's topo and provides a `run()` method
 * that parses command strings and executes them in-process.
 *
 * ```ts
 * const harness = createCliHarness({ app });
 * const result = await harness.run("entity show --name Alpha --output json");
 * expect(result.exitCode).toBe(0);
 * ```
 */
export const createCliHarness = (options: CliHarnessOptions): CliHarness => {
  const commandsResult = deriveCliCommands(options.app);
  if (commandsResult.isErr()) {
    throw commandsResult.error;
  }
  const commands = commandsResult.value;

  return {
    run: (commandString: string) => runCommand(commands, commandString),
  };
};
