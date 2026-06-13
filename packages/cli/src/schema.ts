import type { CliCommand } from './command.js';
import { zodToJsonSchema } from '@ontrails/core';

export interface CliCommandSchemaRoute {
  readonly kind: 'alias' | 'canonical';
  readonly path: readonly string[];
  readonly source: 'derived' | 'surface' | 'trail';
  readonly target: string;
}

export interface CliCommandSchemaEntry {
  readonly aliases: readonly CliCommandSchemaRoute[];
  readonly args: CliCommand['args'];
  readonly commandPath: readonly string[];
  readonly description?: string | undefined;
  readonly examples: readonly unknown[];
  readonly flags: CliCommand['flags'];
  readonly idempotent?: boolean | undefined;
  readonly input: Readonly<Record<string, unknown>>;
  readonly intent: CliCommand['intent'];
  readonly output: Readonly<Record<string, unknown>> | null;
  readonly routes: readonly CliCommandSchemaRoute[];
  readonly trailId: string;
  readonly versions?: CliCommand['versions'];
}

export interface CliSchemaIndex {
  readonly commands: readonly CliCommandSchemaEntry[];
}

const routePathKey = (path: readonly string[]) => path.join('\0');

const commandRoutes = (command: CliCommand): readonly CliCommandSchemaRoute[] =>
  command.routes ?? [
    {
      kind: 'canonical',
      path: command.path,
      source: 'derived',
      target: command.trail.id,
    },
  ];

const commandSchemaEntry = (command: CliCommand): CliCommandSchemaEntry => {
  const routes = commandRoutes(command);
  const aliases = routes.filter((route) => route.kind === 'alias');
  return {
    aliases,
    args: command.args,
    commandPath: command.path,
    description: command.description,
    examples: command.trail.examples ?? [],
    flags: command.flags,
    idempotent: command.idempotent,
    input: zodToJsonSchema(command.trail.input) as Readonly<
      Record<string, unknown>
    >,
    intent: command.intent,
    output:
      command.trail.output === undefined
        ? null
        : (zodToJsonSchema(command.trail.output) as Readonly<
            Record<string, unknown>
          >),
    routes,
    trailId: command.trail.id,
    versions: command.versions,
  };
};

/**
 * Derive a JSON-friendly schema index from framework-agnostic CLI commands.
 *
 * @example
 * ```ts
 * import { deriveCliCommands, deriveCliSchema } from '@ontrails/cli';
 *
 * const commands = deriveCliCommands(graph);
 * if (commands.isErr()) throw commands.error;
 *
 * const schema = deriveCliSchema(commands.value);
 * console.log(schema.commands.map((command) => command.commandPath));
 * ```
 */
export const deriveCliSchema = (
  commands: readonly CliCommand[]
): CliSchemaIndex => ({
  commands: commands
    .map(commandSchemaEntry)
    .toSorted((a, b) =>
      a.commandPath.join(' ').localeCompare(b.commandPath.join(' '))
    ),
});

/**
 * Find the command schema entry addressed by a canonical path or alias path.
 *
 * @example
 * ```ts
 * import { findCliSchemaCommand } from '@ontrails/cli';
 *
 * const command = findCliSchemaCommand(schema, ['wayfind', 'find']);
 * console.log(command?.trailId);
 * ```
 */
export const findCliSchemaCommand = (
  schema: CliSchemaIndex,
  path: readonly string[]
): CliCommandSchemaEntry | undefined => {
  const key = routePathKey(path);
  return schema.commands.find((command) =>
    command.routes.some((route) => routePathKey(route.path) === key)
  );
};
