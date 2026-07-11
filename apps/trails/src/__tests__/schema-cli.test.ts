import { describe, expect, mock, test } from 'bun:test';

import { deriveCliCommands } from '@ontrails/cli';
import { Result, surfaceOverlay, trail, topo } from '@ontrails/core';
import { Command } from 'commander';
import { z } from 'zod';

import { attachSchemaCommand } from '../run-schema.js';

const buildProgram = () => {
  const search = trail('wayfind.search', {
    implementation: (input: { query: string }) => Result.ok(input.query),
    input: z.object({ query: z.string() }),
    output: z.string(),
  });
  const commands = deriveCliCommands(
    topo('schema-cli', { [search.id]: search }),
    {
      overlays: [surfaceOverlay({ cli: { 'wf.search': 'wayfind.search' } })],
    }
  );
  if (commands.isErr()) {
    throw commands.error;
  }
  const program = new Command('trails');
  program.exitOverride();
  attachSchemaCommand(program, commands.value);
  return program;
};

const withStdout = async (
  invoke: () => Promise<void> | void
): Promise<string> => {
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = mock((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as unknown as typeof process.stdout.write;
  try {
    await invoke();
  } finally {
    process.stdout.write = originalWrite;
  }
  return chunks.join('');
};

describe('attachSchemaCommand', () => {
  test('prints the full CLI schema index as JSON', async () => {
    const program = buildProgram();
    const output = await withStdout(() =>
      program.parseAsync(['node', 'trails', 'schema'])
    );
    const parsed = JSON.parse(output);

    expect(parsed.commands[0]).toMatchObject({
      commandPath: ['wayfind', 'search'],
      trailId: 'wayfind.search',
    });
  });

  test('finds a command by alias path', async () => {
    const program = buildProgram();
    const output = await withStdout(() =>
      program.parseAsync(['node', 'trails', 'schema', 'wf', 'search'])
    );
    const parsed = JSON.parse(output);

    expect(parsed.command).toMatchObject({
      commandPath: ['wayfind', 'search'],
      trailId: 'wayfind.search',
    });
  });
});
