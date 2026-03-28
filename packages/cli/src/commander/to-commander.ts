/**
 * Adapt framework-agnostic CliCommand[] to a Commander program.
 */

import { exitCodeMap, isTrailsError } from '@ontrails/core';
import { Command, InvalidArgumentError, Option } from 'commander';

import type { CliCommand, CliFlag } from '../command.js';

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
      process.exit(exitCodeMap[error.category]);
    }
  } else {
    process.stderr.write(`Error: ${String(error)}\n`);
  }
  process.exit(8);
};

/** Wire a CliCommand's action to a Commander subcommand. */
const wireAction = (sub: Command, cmd: CliCommand): void => {
  sub.action(async (...actionArgs: unknown[]) => {
    const opts = sub.opts() as Record<string, unknown>;
    const parsedArgs = collectPositionalArgs(cmd, actionArgs);
    try {
      await cmd.execute(parsedArgs, opts);
    } catch (error: unknown) {
      handleError(error);
    }
  });
};

/** Attach a subcommand to its group or to the top-level program. */
const attachToGroup = (
  sub: Command,
  cmd: CliCommand,
  program: Command,
  groups: Map<string, Command>
): void => {
  if (cmd.group) {
    let groupCmd = groups.get(cmd.group);
    if (!groupCmd) {
      groupCmd = new Command(cmd.group);
      groups.set(cmd.group, groupCmd);
      program.addCommand(groupCmd);
    }
    groupCmd.addCommand(sub);
  } else {
    program.addCommand(sub);
  }
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
 * Groups commands by their `group` field into parent/subcommand structure.
 * Wires each command's `.action()` to call `execute()` and handle errors.
 */
/** Build a Commander subcommand from a CliCommand. */
const buildSubcommand = (cmd: CliCommand): Command => {
  const sub = new Command(cmd.name);
  if (cmd.description) {
    sub.description(cmd.description);
  }
  for (const flag of cmd.flags) {
    for (const opt of buildOptions(flag)) {
      sub.addOption(opt);
    }
  }
  addArgs(sub, cmd);
  wireAction(sub, cmd);
  return sub;
};

export const toCommander = (
  commands: CliCommand[],
  options?: ToCommanderOptions
): Command => {
  const program = new Command();
  applyOptions(program, options);
  const groups = new Map<string, Command>();

  for (const cmd of commands) {
    const sub = buildSubcommand(cmd);
    attachToGroup(sub, cmd, program, groups);
  }

  return program;
};
