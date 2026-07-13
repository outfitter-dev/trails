/**
 * Framework-owned argv normalization for CLI adapters.
 *
 * Adapters remain responsible for parsing argv. This module normalizes the
 * small amount of syntax Trails promises across adapters before that parser
 * runs.
 */

import type { CliCommand, CliFlag } from './command.js';

interface CommandNode {
  readonly children: Map<string, CommandNode>;
  readonly parent?: CommandNode | undefined;
  command?: CliCommand | undefined;
}

interface FlagMatch {
  readonly flag: CliFlag;
  readonly inlineValue: boolean;
}

const commandRoutes = (command: CliCommand): readonly (readonly string[])[] =>
  command.routes?.map((route) => route.path) ?? [command.path];

const buildCommandTree = (commands: readonly CliCommand[]): CommandNode => {
  const root: CommandNode = { children: new Map() };
  for (const command of commands) {
    for (const route of commandRoutes(command)) {
      let node = root;
      for (const segment of route) {
        let child = node.children.get(segment);
        if (child === undefined) {
          child = { children: new Map(), parent: node };
          node.children.set(segment, child);
        }
        node = child;
      }
      node.command = command;
    }
  }
  return root;
};

const visibleFlags = (node: CommandNode): readonly CliFlag[] => {
  const commands: CliCommand[] = [];
  let current: CommandNode | undefined = node;
  while (current !== undefined) {
    if (current.command !== undefined) {
      commands.push(current.command);
    }
    current = current.parent;
  }
  return commands.toReversed().flatMap((command) => command.flags);
};

const matchFlag = (
  flags: readonly CliFlag[],
  token: string
): FlagMatch | undefined => {
  const nearestFlags = flags.toReversed();
  for (const flag of nearestFlags) {
    if (
      token === `--${flag.name}` ||
      (flag.short !== undefined && token === `-${flag.short}`)
    ) {
      return { flag, inlineValue: false };
    }
    if (token.startsWith(`--${flag.name}=`)) {
      return { flag, inlineValue: true };
    }
    if (flag.valueAliases?.some((alias) => token === `--${alias.name}`)) {
      return { flag: { ...flag, type: 'boolean' }, inlineValue: false };
    }
  }

  if (token.length <= 2 || token[0] !== '-' || token[1] === '-') {
    return undefined;
  }

  let group = token.slice(1);
  while (group.length > 0) {
    let flag: CliFlag | undefined;
    for (const candidate of nearestFlags) {
      if (candidate.short === group[0]) {
        flag = candidate;
        break;
      }
    }
    if (flag === undefined) {
      return undefined;
    }
    if (flag.type !== 'boolean') {
      return { flag, inlineValue: group.length > 1 };
    }
    group = group.slice(1);
  }
  return undefined;
};

const isBoundedMultiselect = (flag: CliFlag): boolean =>
  flag.type === 'string[]' &&
  !flag.variadic &&
  flag.choices !== undefined &&
  flag.choices.length > 0;

const isNegativeNumber = (token: string): boolean =>
  /^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/.test(token);

const hasDigitShortFlag = (flags: readonly CliFlag[]): boolean =>
  flags.some((flag) => /^\d$/.test(flag.short ?? ''));

const consumesValue = (
  flag: CliFlag,
  token: string | undefined,
  flags: readonly CliFlag[]
): boolean =>
  flag.type !== 'boolean' &&
  token !== undefined &&
  (flag.required ||
    !token.startsWith('-') ||
    ((flag.type === 'number' || flag.type === 'number[]') &&
      isNegativeNumber(token) &&
      !hasDigitShortFlag(flags)));

const continuesVariadicValue = (
  flag: CliFlag,
  token: string | undefined,
  flags: readonly CliFlag[]
): boolean =>
  token !== undefined &&
  (!token.startsWith('-') ||
    ((flag.type === 'number' || flag.type === 'number[]') &&
      isNegativeNumber(token) &&
      !hasDigitShortFlag(flags)));

const appendBoundedValues = (
  normalized: string[],
  argv: readonly string[],
  optionIndex: number,
  match: FlagMatch,
  activeNode: CommandNode
): number => {
  const choices = new Set(match.flag.choices);
  let index = optionIndex;
  if (!match.inlineValue) {
    const firstValue = argv[index + 1];
    if (firstValue !== undefined && choices.has(firstValue)) {
      normalized.push(firstValue);
      index += 1;
    }
  }

  while (index + 1 < argv.length) {
    const nextValue = argv[index + 1];
    if (
      nextValue === undefined ||
      activeNode.children.has(nextValue) ||
      !choices.has(nextValue)
    ) {
      break;
    }
    normalized.push(`--${match.flag.name}`, nextValue);
    index += 1;
  }
  return index;
};

/**
 * Normalize framework-owned CLI syntax before an adapter parses argv.
 *
 * Bounded multiselect flags accept both contiguous values and repeated flags.
 * After the first option value, additional contiguous consumption stops at a
 * known child route or the first token outside the declared choice set.
 *
 * @example
 * ```ts
 * import { normalizeCliArgv, type CliCommand } from '@ontrails/cli';
 *
 * const commands: CliCommand[] = [];
 * const argv = normalizeCliArgv(commands, process.argv.slice(2));
 * ```
 */
export const normalizeCliArgv = (
  commands: readonly CliCommand[],
  argv: readonly string[]
): readonly string[] => {
  const root = buildCommandTree(commands);
  const normalized: string[] = [];
  let activeNode = root;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    normalized.push(token);

    if (token === '--') {
      normalized.push(...argv.slice(index + 1));
      break;
    }

    const flags = visibleFlags(activeNode);
    const match = matchFlag(flags, token);
    if (match !== undefined) {
      if (isBoundedMultiselect(match.flag)) {
        index = appendBoundedValues(normalized, argv, index, match, activeNode);
        continue;
      }

      if (match.flag.variadic && !match.inlineValue) {
        let consumedFirstValue = false;
        while (
          consumedFirstValue
            ? continuesVariadicValue(match.flag, argv[index + 1], flags)
            : consumesValue(match.flag, argv[index + 1], flags)
        ) {
          const value = argv[index + 1];
          if (value !== undefined) {
            normalized.push(value);
          }
          index += 1;
          consumedFirstValue = true;
        }
      } else if (
        !match.inlineValue &&
        consumesValue(match.flag, argv[index + 1], flags)
      ) {
        const value = argv[index + 1];
        if (value !== undefined) {
          normalized.push(value);
          index += 1;
        }
      }
      continue;
    }

    const child = activeNode.children.get(token);
    if (child !== undefined) {
      activeNode = child;
    }
  }

  return normalized;
};
