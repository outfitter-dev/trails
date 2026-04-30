import { ValidationError } from '@ontrails/core';

import type { CliCommand } from './command.js';

const renderPath = (path: readonly string[]): string => path.join(' ');

const keyPath = (path: readonly string[]): string => path.join('\0');

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

export const validateCliCommands = (commands: readonly CliCommand[]): void => {
  for (const command of commands) {
    validateCommandPath(command);
  }

  validateUniquePaths(commands);
};
