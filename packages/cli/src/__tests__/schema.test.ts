import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { deriveCliCommands } from '../build.js';
import { deriveCliSchema, findCliSchemaCommand } from '../schema.js';

const buildSchema = () => {
  const search = trail('wayfind.search', {
    blaze: (input: { query: string }) => Result.ok(input.query),
    cli: {
      aliases: ['find'],
    },
    description: 'Search the graph',
    examples: [{ input: { query: 'trail' }, name: 'Search trails' }],
    input: z.object({ query: z.string() }),
    output: z.string(),
  });
  const result = deriveCliCommands(
    topo('schema-test', { [search.id]: search }),
    {
      aliases: {
        'wayfind.search': [['wf', 'search']],
      },
    }
  );
  if (result.isErr()) {
    throw result.error;
  }
  return deriveCliSchema(result.value);
};

describe('deriveCliSchema', () => {
  test('projects command routes and contracts into a schema index', () => {
    const schema = buildSchema();
    const [command] = schema.commands;

    expect(command).toMatchObject({
      aliases: [
        {
          kind: 'alias',
          path: ['wayfind', 'find'],
          source: 'trail',
          target: 'wayfind.search',
        },
        {
          kind: 'alias',
          path: ['wf', 'search'],
          source: 'surface',
          target: 'wayfind.search',
        },
      ],
      commandPath: ['wayfind', 'search'],
      description: 'Search the graph',
      intent: 'write',
      trailId: 'wayfind.search',
    });
    expect(command?.input).toMatchObject({
      properties: {
        query: { type: 'string' },
      },
      type: 'object',
    });
    expect(command?.output).toEqual({ type: 'string' });
  });

  test('finds commands by canonical and alias paths', () => {
    const schema = buildSchema();

    expect(findCliSchemaCommand(schema, ['wayfind', 'search'])?.trailId).toBe(
      'wayfind.search'
    );
    expect(findCliSchemaCommand(schema, ['wayfind', 'find'])?.trailId).toBe(
      'wayfind.search'
    );
    expect(findCliSchemaCommand(schema, ['wf', 'search'])?.trailId).toBe(
      'wayfind.search'
    );
  });
});
