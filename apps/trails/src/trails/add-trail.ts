/**
 * `add.trail` trail -- Scaffold a new trail file with tests.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const literal = (value: string): string => JSON.stringify(value);

const deriveExampleMessage = (id: string): string => `${id} completed`;

const generateTrailFile = (
  id: string,
  description: string,
  exampleName: string,
  intent: 'read' | 'write' | 'destroy'
): string => {
  const intentLine = intent === 'write' ? '' : `\n  intent: '${intent}',`;
  const exampleMessage = deriveExampleMessage(id);

  return `import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const ${id.replaceAll('.', '_')} = trail('${id}', {
  blaze: async () => {
    return Result.ok({ message: ${literal(exampleMessage)} });
  },
  description: ${literal(description)},
  examples: [
    {
      expected: { message: ${literal(exampleMessage)} },
      input: {},
      name: ${literal(exampleName)},
    },
  ],
  input: z.object({}),${intentLine}
  output: z.object({ message: z.string() }),
});
`;
};

const generateTestFile = (id: string, exampleName: string): string => {
  const moduleName = id.replaceAll('.', '-');
  const trailName = id.replaceAll('.', '_');
  const exampleMessage = deriveExampleMessage(id);
  return `import { testTrail } from '@ontrails/testing';
import { ${trailName} } from '../src/trails/${moduleName}.js';

testTrail(${trailName}, [
  {
    description: ${literal(exampleName)},
    expectValue: { message: ${literal(exampleMessage)} },
    input: {},
  },
]);
`;
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

/** Write a file, creating parent directories as needed. */
const writeWithDirs = async (
  filePath: string,
  content: string
): Promise<void> => {
  mkdirSync(dirname(filePath), { recursive: true });
  await Bun.write(filePath, content);
};

export const addTrail = trail('add.trail', {
  args: ['id'],
  blaze: async (input, ctx) => {
    const { id } = input;
    const moduleName = id.replaceAll('.', '-');
    const cwd = resolve(ctx.cwd ?? '.');

    const files = new Map<string, string>([
      [
        `src/trails/${moduleName}.ts`,
        generateTrailFile(
          id,
          input.description,
          input.exampleName,
          input.intent
        ),
      ],
      [
        `__tests__/${moduleName}.test.ts`,
        generateTestFile(id, input.exampleName),
      ],
    ]);

    for (const [relativePath, content] of files) {
      await writeWithDirs(join(cwd, relativePath), content);
    }

    return Result.ok({ created: [...files.keys()] });
  },
  description: 'Scaffold a new trail with tests and examples',
  input: z.object({
    description: z
      .string()
      .min(1, 'Trail description is required')
      .describe('Trail description'),
    exampleName: z
      .string()
      .min(1, 'Starter example name is required')
      .describe('Starter example name'),
    id: z
      .string()
      .min(1, 'Trail ID is required')
      .describe('Trail ID (e.g., entity.update)'),
    intent: z
      .enum(['read', 'write', 'destroy'])
      .default('write')
      .describe('Trail intent'),
  }),
  output: z.object({
    created: z.array(z.string()),
  }),
});
