import { ValidationError } from '@ontrails/core';

import type { CliCommand, CliFlag } from './command.js';

const renderPath = (path: readonly string[]): string => path.join(' ');

const keyPath = (path: readonly string[]): string => path.join('\0');

const toOptionKey = (name: string): string =>
  name.replaceAll(/-([a-zA-Z0-9])/g, (_, ch: string) => ch.toUpperCase());

interface SeenOptionNames {
  readonly keys: Set<string>;
  readonly names: Set<string>;
}

const validateCommandPath = (command: CliCommand): void => {
  if (command.path.length === 0) {
    throw new ValidationError('CLI command path cannot be empty');
  }

  for (const segment of command.path) {
    if (segment.trim().length === 0) {
      throw new ValidationError(
        'CLI command path cannot contain empty segments'
      );
    }
  }
};

const validateUniquePaths = (commands: readonly CliCommand[]): void => {
  const seen = new Set<string>();

  for (const command of commands) {
    const key = keyPath(command.path);
    if (seen.has(key)) {
      throw new ValidationError(
        `Duplicate CLI path: ${renderPath(command.path)}`
      );
    }
    seen.add(key);
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
};
