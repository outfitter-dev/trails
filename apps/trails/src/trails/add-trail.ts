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

const generateTrailFile = (
  id: string,
  intent: 'read' | 'write' | 'destroy'
): string => {
  const intentLine = intent === 'write' ? '' : `\n  intent: '${intent}',`;

  return `import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const ${id.replaceAll('.', '_')} = trail('${id}', {
  description: 'TODO: describe this trail',
  examples: [
    {
      input: {},
      name: 'TODO: add example',
    },
  ],
  blaze: async (input) => {
    return Result.ok({ message: 'TODO' });
  },
  input: z.object({}),${intentLine}
  output: z.object({ message: z.string() }),
});
`;
};

const generateTestFile = (id: string): string => {
  const moduleName = id.replaceAll('.', '-');
  const trailName = id.replaceAll('.', '_');
  return `import { testTrail } from '@ontrails/testing';
import { ${trailName} } from '../src/trails/${moduleName}.js';

testTrail(${trailName}, [
  { description: 'basic test', input: {}, expectOk: true },
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
  blaze: async (input, ctx) => {
    const { id } = input;
    const moduleName = id.replaceAll('.', '-');
    const cwd = resolve(ctx.cwd ?? '.');

    const files = new Map<string, string>([
      [`src/trails/${moduleName}.ts`, generateTrailFile(id, input.intent)],
      [`__tests__/${moduleName}.test.ts`, generateTestFile(id)],
    ]);

    for (const [relativePath, content] of files) {
      await writeWithDirs(join(cwd, relativePath), content);
    }

    return Result.ok({ created: [...files.keys()] });
  },
  description: 'Scaffold a new trail with tests and examples',
  input: z.object({
    id: z.string().describe('Trail ID (e.g., entity.update)'),
    intent: z
      .enum(['read', 'write', 'destroy'])
      .default('write')
      .describe('Trail intent'),
  }),
  output: z.object({
    created: z.array(z.string()),
  }),
});
