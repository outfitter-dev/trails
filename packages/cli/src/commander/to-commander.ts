/**
 * Adapt framework-agnostic CliCommand[] to a Commander program.
 */

import { isTrailsError, mapTransportError } from '@ontrails/core';
import { Command, InvalidArgumentError, Option } from 'commander';

import type { CliCommand, CliFlag } from '../command.js';
import { validateCliCommands } from '../validate.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ToCommanderOptions {
  description?: string | undefined;
  name?: string | undefined;
  version?: string | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the flag string portion of a Commander Option. */
const buildFlagArgument = (flag: CliFlag): string => {
  if (flag.variadic) {
    return flag.required ? '<values...>' : '[values...]';
  }
  return flag.required ? '<value>' : '[value]';
};

const buildFlagString = (flag: CliFlag): string => {
  const long = `--${flag.name}`;
  const short = flag.short ? `-${flag.short}` : undefined;

  if (flag.type === 'boolean') {
    return short ? `${short}, ${long}` : long;
  }

  const argPart = buildFlagArgument(flag);
  return short ? `${short}, ${long} ${argPart}` : `${long} ${argPart}`;
};

/** Strict number parser that rejects partial parses and non-finite values. */
const strictParseNumber = (value: string): number => {
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    throw new InvalidArgumentError(`"${value}" is not a valid number`);
  }
  return n;
};

/** Apply common modifiers (choices, default, arg parser) to a Commander Option. */
const applyOptionModifiers = (opt: Option, flag: CliFlag): void => {
  if (flag.choices) {
    opt.choices(flag.choices);
  }
  if (flag.default !== undefined) {
    opt.default(flag.default);
  }
  if (flag.type === 'number' || flag.type === 'number[]') {
    opt.argParser(strictParseNumber);
  }
};

/** Build Commander Option(s) from a CliFlag. Returns one or two options. */
const buildOptions = (flag: CliFlag): Option[] => {
  const opt = new Option(buildFlagString(flag), flag.description);
  applyOptionModifiers(opt, flag);
  if (flag.type === 'boolean') {
    const negation = new Option(
      `--no-${flag.name}`,
      flag.description ? `Negate ${flag.description}` : undefined
    );
    return [opt, negation];
  }
  return [opt];
};

/** Add positional args to a Commander subcommand. */
const buildArgTemplate = (arg: CliCommand['args'][number]): string => {
  if (arg.variadic) {
    return arg.required ? `<${arg.name}...>` : `[${arg.name}...]`;
  }
  return arg.required ? `<${arg.name}>` : `[${arg.name}]`;
};

const addArgs = (sub: Command, cmd: CliCommand): void => {
  for (const arg of cmd.args) {
    const template = buildArgTemplate(arg);
    sub.argument(template, arg.description);
  }
};

/** Collect positional args from Commander's action callback into a record. */
const collectPositionalArgs = (
  cmd: CliCommand,
  actionArgs: unknown[]
): Record<string, unknown> => {
  const parsedArgs: Record<string, unknown> = {};
  for (let i = 0; i < cmd.args.length; i += 1) {
    const argDef = cmd.args[i];
    if (argDef) {
      parsedArgs[argDef.name] = actionArgs[i];
    }
  }
  return parsedArgs;
};

/** Handle execution errors with appropriate exit codes. */
const handleError = (error: unknown): void => {
  if (error instanceof Error) {
    process.stderr.write(`Error: ${error.message}\n`);
    if (isTrailsError(error)) {
      process.exit(mapTransportError('cli', error));
    }
  } else {
    process.stderr.write(`Error: ${String(error)}\n`);
  }
  process.exit(8);
};

/** Wire a CliCommand's action to a Commander subcommand. */
const wireAction = (target: Command, cmd: CliCommand): void => {
  target.action(async (...actionArgs: unknown[]) => {
    const opts = target.opts() as Record<string, unknown>;
    const parsedArgs = collectPositionalArgs(cmd, actionArgs);
    try {
      await cmd.execute(parsedArgs, opts);
    } catch (error: unknown) {
      handleError(error);
    }
  });
};

/** Apply options to a Commander program. */
const applyOptions = (program: Command, options?: ToCommanderOptions): void => {
  if (options?.name) {
    program.name(options.name);
  }
  if (options?.version) {
    program.version(options.version);
  }
  if (options?.description) {
    program.description(options.description);
  }
};

// ---------------------------------------------------------------------------
// toCommander
// ---------------------------------------------------------------------------

/**
 * Convert CliCommand[] into a configured Commander program.
 *
 * Builds a nested command tree from each command's full ordered path.
 * Wires each command's `.action()` to call `execute()` and handle errors.
 */
const pathKey = (path: readonly string[]): string => path.join('\0');

interface CommandNodeState {
  readonly command: Command;
  executable: boolean;
}

const getPathSegment = (path: readonly string[], index: number): string => {
  const segment = path[index];
  if (segment === undefined) {
    throw new Error('CLI command path contains an undefined segment');
  }
  return segment;
};

const getOrCreateCommandNode = (
  key: string,
  segment: string,
  parent: Command,
  nodes: Map<string, CommandNodeState>
): CommandNodeState => {
  const existing = nodes.get(key);
  if (existing) {
    return existing;
  }

  const command = new Command(segment);
  const state = { command, executable: false };
  nodes.set(key, state);
  parent.addCommand(command);
  return state;
};

const ensureCommandNode = (
  path: readonly string[],
  program: Command,
  nodes: Map<string, CommandNodeState>
): CommandNodeState => {
  let parent = program;
  let state: CommandNodeState | undefined;

  for (let index = 0; index < path.length; index += 1) {
    const segment = getPathSegment(path, index);
    const key = pathKey(path.slice(0, index + 1));
    state = getOrCreateCommandNode(key, segment, parent, nodes);
    parent = state.command;
  }

  if (!state) {
    throw new Error('CLI command path cannot be empty');
  }

  return state;
};

const applyCliCommand = (state: CommandNodeState, cmd: CliCommand): void => {
  if (state.executable) {
    throw new Error(`Duplicate CLI path: ${cmd.path.join(' ')}`);
  }

  if (cmd.description) {
    state.command.description(cmd.description);
  }
  for (const flag of cmd.flags) {
    for (const opt of buildOptions(flag)) {
      state.command.addOption(opt);
    }
  }
  addArgs(state.command, cmd);
  wireAction(state.command, cmd);
  state.executable = true;
};

export const toCommander = (
  commands: CliCommand[],
  options?: ToCommanderOptions
): Command => {
  validateCliCommands(commands);
  const program = new Command();
  applyOptions(program, options);
  const nodes = new Map<string, CommandNodeState>();

  for (const cmd of commands.toSorted((a, b) =>
    a.path.length === b.path.length
      ? a.path.join('.').localeCompare(b.path.join('.'))
      : a.path.length - b.path.length
  )) {
    const state = ensureCommandNode(cmd.path, program, nodes);
    applyCliCommand(state, cmd);
  }

  return program;
};
