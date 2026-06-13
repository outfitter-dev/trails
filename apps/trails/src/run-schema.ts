import type { CliCommand } from '@ontrails/cli';
import { deriveCliSchema, findCliSchemaCommand } from '@ontrails/cli';
import type { Command } from 'commander';

const normalizeCommandPath = (path: readonly string[] | undefined): string[] =>
  (path ?? []).flatMap((segment) =>
    segment
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0)
  );

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export const attachSchemaCommand = (
  program: Command,
  commands: readonly CliCommand[]
): void => {
  const schema = deriveCliSchema(commands);
  program
    .command('schema [command...]')
    .description('Inspect accepted CLI command contracts as JSON')
    .action((commandPath: string[] | undefined) => {
      const path = normalizeCommandPath(commandPath);
      if (path.length === 0) {
        writeJson(schema);
        return;
      }

      const command = findCliSchemaCommand(schema, path);
      if (command === undefined) {
        process.stderr.write(`Unknown CLI command: ${path.join(' ')}\n`);
        process.exitCode = 1;
        return;
      }

      writeJson({ command });
    });
};
