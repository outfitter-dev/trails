import { ValidationError } from '@ontrails/core';

import type { CliCommand, CliFlag } from './command.js';

const renderPath = (path: readonly string[]): string => path.join(' ');

const keyPath = (path: readonly string[]): string => path.join('\0');

const commandRoutes = (command: CliCommand) =>
  command.routes ?? [
    {
      kind: 'canonical' as const,
      path: command.path,
      source: 'derived' as const,
      target: command.trail.id,
    },
  ];

const toOptionKey = (name: string): string =>
  name.replaceAll(/-([a-zA-Z0-9])/g, (_, ch: string) => ch.toUpperCase());

interface SeenOptionNames {
  readonly keys: Set<string>;
  readonly names: Set<string>;
}

const validateCommandPath = (command: CliCommand): void => {
  for (const route of commandRoutes(command)) {
    if (route.path.length === 0) {
      throw new ValidationError('CLI command path cannot be empty');
    }

    if (route.target !== command.trail.id) {
      throw new ValidationError(
        `CLI command route ${renderPath(route.path)} targets "${route.target}" but command belongs to "${command.trail.id}"`
      );
    }

    for (const segment of route.path) {
      if (segment.trim().length === 0) {
        throw new ValidationError(
          'CLI command path cannot contain empty segments'
        );
      }
    }
  }
};

const validateUniquePaths = (commands: readonly CliCommand[]): void => {
  const seen = new Set<string>();

  for (const command of commands) {
    for (const route of commandRoutes(command)) {
      const key = keyPath(route.path);
      if (seen.has(key)) {
        throw new ValidationError(
          `Duplicate CLI path: ${renderPath(route.path)}`
        );
      }
      seen.add(key);
    }
  }
};

const validateFlagAlias = ({
  aliasName,
  command,
  flag,
  seen,
}: {
  readonly aliasName: string;
  readonly command: CliCommand;
  readonly flag: CliFlag;
  readonly seen: SeenOptionNames;
}): void => {
  if (aliasName.trim().length === 0) {
    throw new ValidationError(
      `CLI flag alias for --${flag.name} on command ${renderPath(command.path)} cannot be empty`
    );
  }
  if (seen.names.has(aliasName) || seen.keys.has(toOptionKey(aliasName))) {
    throw new ValidationError(
      `CLI flag alias --${aliasName} for --${flag.name} collides on command ${renderPath(command.path)}`
    );
  }
};

const validateFlagValueAliases = (
  command: CliCommand,
  flag: CliFlag,
  seen: SeenOptionNames
): void => {
  const aliases = flag.valueAliases ?? [];
  if (aliases.length === 0) {
    return;
  }

  if (flag.choices === undefined || flag.choices.length === 0) {
    throw new ValidationError(
      `CLI flag --${flag.name} on command ${renderPath(command.path)} cannot define value aliases without choices`
    );
  }

  for (const alias of aliases) {
    validateFlagAlias({
      aliasName: alias.name,
      command,
      flag,
      seen,
    });
    if (!flag.choices.includes(alias.value)) {
      throw new ValidationError(
        `CLI flag alias --${alias.name} for --${flag.name} targets unknown value "${alias.value}" on command ${renderPath(command.path)}`
      );
    }
    seen.names.add(alias.name);
    seen.keys.add(toOptionKey(alias.name));
  }
};

const addSeenFlagOption = (
  command: CliCommand,
  flag: CliFlag,
  seen: SeenOptionNames,
  name = flag.name
): void => {
  if (seen.names.has(name) || seen.keys.has(toOptionKey(name))) {
    throw new ValidationError(
      `Duplicate CLI flag --${flag.name} on command ${renderPath(command.path)}`
    );
  }
  seen.names.add(name);
  seen.keys.add(toOptionKey(name));
};

const validateCommandFlags = (command: CliCommand): void => {
  const seen: SeenOptionNames = { keys: new Set(), names: new Set() };

  for (const flag of command.flags) {
    if (flag.name.trim().length === 0) {
      throw new ValidationError(
        `CLI flag name on command ${renderPath(command.path)} cannot be empty`
      );
    }
    addSeenFlagOption(command, flag, seen);
    if (flag.type === 'boolean') {
      addSeenFlagOption(command, flag, seen, `no-${flag.name}`);
    }
  }

  for (const flag of command.flags) {
    validateFlagValueAliases(command, flag, seen);
  }
};

const isStrictPathPrefix = (
  prefix: readonly string[],
  path: readonly string[]
): boolean =>
  prefix.length < path.length &&
  prefix.every((segment, index) => path[index] === segment);

const sortedStrings = (values: readonly string[] | undefined): string[] =>
  [...(values ?? [])].toSorted();

const sortedAliases = (flag: CliFlag): readonly string[] =>
  (flag.valueAliases ?? [])
    .map((alias) => `${alias.name}\0${alias.value}`)
    .toSorted();

const sameParsingSemantics = (left: CliFlag, right: CliFlag): boolean =>
  left.name === right.name &&
  left.short === right.short &&
  left.type === right.type &&
  left.required === right.required &&
  left.variadic === right.variadic &&
  left.role === right.role &&
  JSON.stringify(left.default) === JSON.stringify(right.default) &&
  JSON.stringify(sortedStrings(left.choices)) ===
    JSON.stringify(sortedStrings(right.choices)) &&
  JSON.stringify(sortedAliases(left)) === JSON.stringify(sortedAliases(right));

const isBoundedMultiselect = (flag: CliFlag): boolean =>
  flag.type === 'string[]' &&
  !flag.variadic &&
  flag.choices !== undefined &&
  flag.choices.length > 0;

const findConflictingInheritedFlag = (
  ancestor: CliCommand,
  descendant: CliCommand
):
  | { readonly ancestorFlag: CliFlag; readonly descendantFlag: CliFlag }
  | undefined => {
  for (const descendantFlag of descendant.flags) {
    for (const ancestorFlag of ancestor.flags) {
      const sharesLong = ancestorFlag.name === descendantFlag.name;
      const sharesShort =
        ancestorFlag.short !== undefined &&
        ancestorFlag.short === descendantFlag.short;
      if (
        (sharesLong || sharesShort) &&
        (isBoundedMultiselect(ancestorFlag) ||
          isBoundedMultiselect(descendantFlag)) &&
        !sameParsingSemantics(ancestorFlag, descendantFlag)
      ) {
        return { ancestorFlag, descendantFlag };
      }
    }
  }
  return undefined;
};

const validateInheritedFlagSemantics = (
  commands: readonly CliCommand[]
): void => {
  for (const descendant of commands) {
    for (const descendantRoute of commandRoutes(descendant)) {
      for (const ancestor of commands) {
        if (ancestor === descendant) {
          continue;
        }
        for (const ancestorRoute of commandRoutes(ancestor)) {
          if (!isStrictPathPrefix(ancestorRoute.path, descendantRoute.path)) {
            continue;
          }
          const conflict = findConflictingInheritedFlag(ancestor, descendant);
          if (conflict !== undefined) {
            throw new ValidationError(
              `CLI flag --${conflict.descendantFlag.name} on command ${renderPath(descendantRoute.path)} conflicts with inherited parsing semantics from command ${renderPath(ancestorRoute.path)}`
            );
          }
        }
      }
    }
  }
};

/**
 * Validate command paths and flag collisions before wiring a CLI adapter.
 *
 * @example
 * ```ts
 * import { validateCliCommands, type CliCommand } from '@ontrails/cli';
 *
 * const commands = [
 *   {
 *     args: [],
 *     flags: [],
 *     intent: 'read',
 *     path: ['greet'],
 *     trail: { id: 'demo.greet', kind: 'trail' } as CliCommand['trail'],
 *   },
 * ] satisfies CliCommand[];
 *
 * validateCliCommands(commands);
 * ```
 */
export const validateCliCommands = (commands: readonly CliCommand[]): void => {
  for (const command of commands) {
    validateCommandPath(command);
    validateCommandFlags(command);
  }

  validateUniquePaths(commands);
  validateInheritedFlagSemantics(commands);
};
