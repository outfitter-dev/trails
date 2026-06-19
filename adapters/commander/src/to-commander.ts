/**
 * Adapt framework-agnostic CliCommand[] to a Commander program.
 */

import {
  isTrailsError,
  projectPublicSurfaceError,
  redactErrorContext,
  redactErrorString,
  ValidationError,
} from '@ontrails/core';
import type { SurfaceErrorProjection } from '@ontrails/core';
import type { CliCommand, CliFlag } from '@ontrails/cli';
import {
  applyCliFlagValueAliases,
  deriveOutputMode,
  validateCliCommands,
} from '@ontrails/cli';
import { Command, InvalidArgumentError, Option } from 'commander';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options used when constructing a Commander program from trail metadata.
 */
export interface ToCommanderOptions {
  description?: string | undefined;
  name?: string | undefined;
  topoName?: string | undefined;
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

const validateChoiceValue = (flag: CliFlag, value: string): void => {
  if (flag.choices && !flag.choices.includes(value)) {
    throw new InvalidArgumentError(
      `Allowed choices are ${flag.choices.join(', ')}.`
    );
  }
};

const isRepeatableArrayFlag = (flag: CliFlag): boolean =>
  !flag.variadic && (flag.type === 'number[]' || flag.type === 'string[]');

const buildRepeatableArrayParser =
  (flag: CliFlag) =>
  (value: string, previous: unknown): readonly (number | string)[] => {
    const parsed = flag.type === 'number[]' ? strictParseNumber(value) : value;
    validateChoiceValue(flag, String(parsed));
    return [...(Array.isArray(previous) ? previous : []), parsed];
  };

/** Apply common modifiers (choices, default, arg parser) to a Commander Option. */
const applyOptionModifiers = (opt: Option, flag: CliFlag): void => {
  if (isRepeatableArrayFlag(flag)) {
    opt.argParser(buildRepeatableArrayParser(flag));
    if (flag.default !== undefined) {
      opt.default(flag.default);
    }
    return;
  }
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
  const valueAliasOptions = (flag.valueAliases ?? []).map(
    (alias) =>
      new Option(
        `--${alias.name}`,
        alias.description ?? `Shorthand for --${flag.name} ${alias.value}`
      )
  );
  if (flag.type === 'boolean') {
    const negation = new Option(
      `--no-${flag.name}`,
      flag.description ? `Negate ${flag.description}` : undefined
    );
    return [opt, negation, ...valueAliasOptions];
  }
  return [opt, ...valueAliasOptions];
};

/** Add positional args to a Commander subcommand. */
const buildArgTemplate = (
  arg: CliCommand['args'][number],
  required = arg.required
): string => {
  if (arg.variadic) {
    return required ? `<${arg.name}...>` : `[${arg.name}...]`;
  }
  return required ? `<${arg.name}>` : `[${arg.name}]`;
};

const addArgs = (
  sub: Command,
  cmd: CliCommand,
  options?: { readonly forceOptionalFirstArg?: boolean } | undefined
): void => {
  for (const [index, arg] of cmd.args.entries()) {
    const template = buildArgTemplate(
      arg,
      options?.forceOptionalFirstArg === true && index === 0 ? false : undefined
    );
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

const isUserSuppliedOption = (command: Command, name: string): boolean => {
  const source = command.getOptionValueSource(name);
  return source !== undefined && source !== 'default' && source !== 'implied';
};

const getCommandOptionNames = (command: Command): Set<string> =>
  new Set(command.options.map((option) => option.attributeName()));

const renderCommandPath = (command: Command): string => {
  const segments: string[] = [];
  let current: Command | null = command;
  while (current !== null && current.parent !== null) {
    segments.push(current.name());
    current = current.parent;
  }
  return segments.toReversed().join(' ');
};

const renderOptionName = (option: Option): string =>
  option.long ?? `--${option.attributeName()}`;

const INHERITED_SURFACE_OPTION_KEYS = new Set([
  'cwd',
  'devPermit',
  'json',
  'jsonl',
  'output',
  'permit',
  'quiet',
  'token',
  'trace',
  'watch',
]);

const hasUserSuppliedOptionOutside = (
  sourceCommand: Command,
  allowedCommand: Command
): boolean => {
  const allowedOptionNames = getCommandOptionNames(allowedCommand);
  return sourceCommand.options.some((option) => {
    const name = option.attributeName();
    return (
      isUserSuppliedOption(sourceCommand, name) && !allowedOptionNames.has(name)
    );
  });
};

const hasAnyPositionalValue = (
  cmd: CliCommand,
  parsedArgs: Readonly<Record<string, unknown>>
): boolean => cmd.args.some((arg) => parsedArgs[arg.name] !== undefined);

const getActionTarget = (fallbackTarget: Command, actionArgs: unknown[]) => {
  const candidate = actionArgs.at(-1);
  return candidate instanceof Command ? candidate : fallbackTarget;
};

const getParsedFlags = (command: Command): Record<string, unknown> => {
  const flags = command.optsWithGlobals() as Record<string, unknown>;
  const commandOptionNames = getCommandOptionNames(command);
  let { parent } = command;
  while (parent !== null) {
    for (const option of parent.options) {
      const name = option.attributeName();
      if (commandOptionNames.has(name)) {
        continue;
      }
      if (
        INHERITED_SURFACE_OPTION_KEYS.has(name) &&
        isUserSuppliedOption(parent, name)
      ) {
        flags[name] = parent.getOptionValue(name);
      } else {
        Reflect.deleteProperty(flags, name);
      }
    }
    ({ parent } = parent);
  }
  for (const option of command.options) {
    const name = option.attributeName();
    if (command.getOptionValueSource(name) !== undefined) {
      flags[name] = command.getOptionValue(name);
    }
  }
  return flags;
};

const toOptionKey = (name: string): string =>
  name.replaceAll(/-([a-zA-Z0-9])/g, (_, ch: string) => ch.toUpperCase());

const getFlagOptionKeys = (flags: readonly CliCommand['flags'][number][]) =>
  new Set(
    flags.flatMap((flag) => [
      toOptionKey(flag.name),
      ...(flag.valueAliases ?? []).map((alias) => toOptionKey(alias.name)),
    ])
  );

const getCanonicalUserSuppliedFlagKeys = (
  flags: readonly CliCommand['flags'][number][],
  userSuppliedFlagKeys: ReadonlySet<string>
): ReadonlySet<string> => {
  const canonicalKeys = new Set(userSuppliedFlagKeys);
  for (const flag of flags) {
    const flagKey = toOptionKey(flag.name);
    const aliasSelected = (flag.valueAliases ?? []).some((alias) =>
      userSuppliedFlagKeys.has(toOptionKey(alias.name))
    );
    if (aliasSelected) {
      canonicalKeys.add(flagKey);
    }
  }
  return canonicalKeys;
};

const getUserSuppliedFlagKeys = (
  command: Command,
  flags: readonly CliCommand['flags'][number][]
): ReadonlySet<string> => {
  const userSupplied = new Set<string>();
  for (const key of getFlagOptionKeys(flags)) {
    if (isUserSuppliedOption(command, key)) {
      userSupplied.add(key);
    }
  }
  return userSupplied;
};

const getFallbackParsedFlags = (
  parentTarget: Command,
  target: Command
): Record<string, unknown> => {
  const flags = { ...getParsedFlags(parentTarget) };
  const parentOptionNames = getCommandOptionNames(parentTarget);
  for (const option of target.options) {
    const name = option.attributeName();
    if (parentOptionNames.has(name) && isUserSuppliedOption(target, name)) {
      flags[name] = target.getOptionValue(name);
    }
  }
  return flags;
};

const getFallbackUserSuppliedFlagKeys = (
  parentTarget: Command,
  target: Command,
  flags: readonly CliCommand['flags'][number][]
): ReadonlySet<string> => {
  const userSupplied = new Set<string>();
  for (const key of getFlagOptionKeys(flags)) {
    if (
      isUserSuppliedOption(parentTarget, key) ||
      isUserSuppliedOption(target, key)
    ) {
      userSupplied.add(key);
    }
  }
  return userSupplied;
};

const collectValidationIssueLines = (
  context: Readonly<Record<string, unknown>>
): readonly string[] => {
  const { issues } = context;
  if (!Array.isArray(issues)) {
    return [];
  }
  return issues.flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null) {
      return [];
    }
    const { message, trailId } = issue as {
      message?: unknown;
      trailId?: unknown;
    };
    if (typeof message !== 'string') {
      return [];
    }
    const suffix = typeof trailId === 'string' ? ` (${trailId})` : '';
    return [`- ${redactErrorString(message)}${suffix}`];
  });
};

const collectPermitScopeLines = (
  context: Readonly<Record<string, unknown>>
): readonly string[] => {
  const candidate = [context['required'], context['missing']].find((value) =>
    Array.isArray(value)
  );
  const scopes = (Array.isArray(candidate) ? candidate : [])
    .filter((scope): scope is string => typeof scope === 'string')
    .map((scope) => redactErrorString(scope));
  if (scopes.length === 0) {
    return [];
  }
  const scopeJson = scopes.map((scope) => JSON.stringify(scope)).join(',');
  return [
    `Required scopes: ${scopes.join(', ')}`,
    `Grant with: --permit '{"id":"<caller-id>","scopes":[${scopeJson}]}'`,
  ];
};

/**
 * Collect operator-facing detail lines for an execution error.
 *
 * The public surface projection intentionally drops structured context, but
 * the CLI is an operator surface: validation issues and permit scope
 * requirements are what the operator needs to act, so they are re-rendered
 * here (through the shared redactor) for non-internal Trails errors.
 */
const collectErrorDetailLines = (error: Error): readonly string[] => {
  if (!isTrailsError(error) || error.category === 'internal') {
    return [];
  }
  const context = error.context ?? {};
  if (error.category === 'validation') {
    return collectValidationIssueLines(context);
  }
  if (error.category === 'permission') {
    return collectPermitScopeLines(context);
  }
  return [];
};

const collectErrorContext = (
  error: Error
): Record<string, unknown> | undefined => {
  if (!isTrailsError(error) || error.category === 'internal') {
    return undefined;
  }
  return redactErrorContext(error.context);
};

interface CliErrorEnvelope {
  readonly ok: false;
  readonly context?: Record<string, unknown> | undefined;
  readonly error: SurfaceErrorProjection;
  readonly details?: readonly string[] | undefined;
}

type StructuredErrorMode = 'json' | 'jsonl';

const structuredErrorMode = (
  flags: Readonly<Record<string, unknown>>,
  topoName: string,
  userSuppliedFlagKeys: ReadonlySet<string>
): StructuredErrorMode | undefined => {
  const modeFlags = { ...flags };
  if (!userSuppliedFlagKeys.has('output')) {
    delete modeFlags['output'];
  }
  const { mode } = deriveOutputMode(modeFlags, topoName);
  return mode === 'text' ? undefined : mode;
};

const writeStructuredError = (
  envelope: CliErrorEnvelope,
  mode: StructuredErrorMode
): void => {
  process.stderr.write(
    mode === 'json'
      ? `${JSON.stringify(envelope, null, 2)}\n`
      : `${JSON.stringify(envelope)}\n`
  );
};

/** Handle execution errors with appropriate exit codes. */
const handleError = (
  error: unknown,
  flags: Readonly<Record<string, unknown>>,
  topoName: string,
  userSuppliedFlagKeys: ReadonlySet<string>
): void => {
  const err = error instanceof Error ? error : new Error(String(error));
  const projection = projectPublicSurfaceError('cli', err);
  const context = collectErrorContext(err);
  const details = collectErrorDetailLines(err);
  const mode = structuredErrorMode(flags, topoName, userSuppliedFlagKeys);
  if (mode === undefined) {
    process.stderr.write(`Error: ${projection.message}\n`);
    for (const line of details) {
      process.stderr.write(`  ${line}\n`);
    }
  } else {
    writeStructuredError(
      {
        ...(context === undefined ? {} : { context }),
        error: projection,
        ...(details.length === 0 ? {} : { details }),
        ok: false,
      },
      mode
    );
  }
  process.exit(projection.code);
};

const collectDisallowedAncestorOptions = (
  target: Command,
  allowedFlags: readonly CliCommand['flags'][number][]
): readonly string[] => {
  const allowedKeys = getFlagOptionKeys(allowedFlags);
  const childPath = renderCommandPath(target);
  const disallowed: string[] = [];
  let { parent } = target;

  while (parent !== null) {
    const parentPath = renderCommandPath(parent);
    for (const option of parent.options) {
      const name = option.attributeName();
      if (
        isUserSuppliedOption(parent, name) &&
        !allowedKeys.has(name) &&
        !INHERITED_SURFACE_OPTION_KEYS.has(name)
      ) {
        disallowed.push(
          `${renderOptionName(option)} belongs to "${parentPath}" and is not supported by "${childPath}".`
        );
      }
    }
    ({ parent } = parent);
  }

  return disallowed;
};

interface BareChildFallback {
  readonly argName: string;
  readonly argValue: string;
  readonly parentCommand: CliCommand;
  readonly parentTarget: Command;
  readonly requiresParentSignal: boolean;
}

const maybeUseBareChildFallback = (
  target: Command,
  cmd: CliCommand,
  parsedArgs: Readonly<Record<string, unknown>>,
  fallback?: BareChildFallback | undefined
): {
  readonly command: CliCommand;
  readonly parsedArgs: Record<string, unknown>;
  readonly parsedFlags: Record<string, unknown>;
  readonly userSuppliedFlagKeys: ReadonlySet<string>;
} => {
  const hasParentOnlySignal = fallback
    ? hasUserSuppliedOptionOutside(fallback.parentTarget, target)
    : false;
  if (
    !fallback ||
    hasAnyPositionalValue(cmd, parsedArgs) ||
    hasUserSuppliedOptionOutside(target, fallback.parentTarget) ||
    (fallback.requiresParentSignal && !hasParentOnlySignal)
  ) {
    return {
      command: cmd,
      parsedArgs: { ...parsedArgs },
      parsedFlags: getParsedFlags(target),
      userSuppliedFlagKeys: getUserSuppliedFlagKeys(target, cmd.flags),
    };
  }

  return {
    command: fallback.parentCommand,
    parsedArgs: { [fallback.argName]: fallback.argValue },
    parsedFlags: getFallbackParsedFlags(fallback.parentTarget, target),
    userSuppliedFlagKeys: getFallbackUserSuppliedFlagKeys(
      fallback.parentTarget,
      target,
      fallback.parentCommand.flags
    ),
  };
};

/** Wire a CliCommand's action to a Commander subcommand. */
const wireAction = (
  target: Command,
  cmd: CliCommand,
  topoName: string,
  fallback?: BareChildFallback | undefined
): void => {
  target.action(async (...actionArgs: unknown[]) => {
    const actionTarget = getActionTarget(target, actionArgs);
    const parsedArgs = collectPositionalArgs(cmd, actionArgs);
    const action = maybeUseBareChildFallback(
      actionTarget,
      cmd,
      parsedArgs,
      fallback === undefined
        ? undefined
        : {
            ...fallback,
            parentTarget: actionTarget.parent ?? fallback.parentTarget,
          }
    );
    let { parsedFlags } = action;
    try {
      const disallowedAncestorOptions = collectDisallowedAncestorOptions(
        actionTarget,
        action.command.flags
      );
      if (disallowedAncestorOptions.length > 0) {
        throw new ValidationError('Unsupported option for this CLI command.', {
          context: {
            issues: disallowedAncestorOptions.map((message) => ({
              message,
              trailId: action.command.trail.id,
            })),
          },
        });
      }
      parsedFlags = applyCliFlagValueAliases(
        action.command.flags,
        action.parsedFlags,
        action.userSuppliedFlagKeys
      );
      await action.command.execute(action.parsedArgs, parsedFlags);
    } catch (error: unknown) {
      handleError(
        error,
        parsedFlags,
        topoName,
        getCanonicalUserSuppliedFlagKeys(
          action.command.flags,
          action.userSuppliedFlagKeys
        )
      );
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
  cliCommand?: CliCommand | undefined;
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

const createBareChildFallback = (
  cmd: CliCommand,
  path: readonly string[],
  parentState?: CommandNodeState | undefined
): BareChildFallback | undefined => {
  if (!parentState?.cliCommand || path.length < 2) {
    return undefined;
  }

  const [parentArg] = parentState.cliCommand.args;
  const [childArg] = cmd.args;
  const childSegment = path.at(-1);
  if (
    parentArg === undefined ||
    parentArg.required ||
    parentArg.variadic ||
    (childArg !== undefined &&
      (childArg.variadic || childArg.name !== parentArg.name)) ||
    childSegment === undefined
  ) {
    return undefined;
  }

  return {
    argName: parentArg.name,
    argValue: childSegment,
    parentCommand: parentState.cliCommand,
    parentTarget: parentState.command,
    requiresParentSignal: childArg === undefined,
  };
};

const applyCliCommand = (
  state: CommandNodeState,
  cmd: CliCommand,
  path: readonly string[],
  topoName: string,
  fallback?: BareChildFallback | undefined
): void => {
  if (state.executable) {
    throw new Error(`Duplicate CLI path: ${path.join(' ')}`);
  }

  if (cmd.description) {
    state.command.description(cmd.description);
  }
  for (const flag of cmd.flags) {
    for (const opt of buildOptions(flag)) {
      state.command.addOption(opt);
    }
  }
  addArgs(state.command, cmd, {
    forceOptionalFirstArg: fallback !== undefined,
  });
  wireAction(state.command, cmd, topoName, fallback);
  state.cliCommand = cmd;
  state.executable = true;
};

const commandRoutes = (cmd: CliCommand) =>
  cmd.routes ?? [
    {
      kind: 'canonical' as const,
      path: cmd.path,
      source: 'derived' as const,
      target: cmd.trail.id,
    },
  ];

const commandRouteEntries = (commands: readonly CliCommand[]) =>
  commands.flatMap((cmd) =>
    commandRoutes(cmd).map((route) => ({ cmd, path: route.path }))
  );

/**
 * Convert framework-agnostic CLI commands into a Commander program.
 *
 * @example
 * ```ts
 * import { deriveCliCommands } from '@ontrails/cli';
 * import { toCommander } from '@ontrails/commander';
 *
 * const commands = deriveCliCommands(graph);
 * if (commands.isErr()) throw commands.error;
 *
 * const program = toCommander(commands.value, {
 *   name: 'demo',
 *   topoName: 'demo',
 * });
 * ```
 */
export const toCommander = (
  commands: CliCommand[],
  options?: ToCommanderOptions
): Command => {
  validateCliCommands(commands);
  const program = new Command();
  applyOptions(program, options);
  const topoName = options?.topoName ?? options?.name ?? program.name();
  const nodes = new Map<string, CommandNodeState>();

  for (const { cmd, path } of commandRouteEntries(commands).toSorted((a, b) =>
    a.path.length === b.path.length
      ? a.path.join('.').localeCompare(b.path.join('.'))
      : a.path.length - b.path.length
  )) {
    const state = ensureCommandNode(path, program, nodes);
    const parentKey = pathKey(path.slice(0, -1));
    const fallback = createBareChildFallback(cmd, path, nodes.get(parentKey));
    applyCliCommand(state, cmd, path, topoName, fallback);
  }

  return program;
};
