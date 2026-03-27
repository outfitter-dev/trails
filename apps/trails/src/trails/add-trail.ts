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
  readOnly: boolean,
  destructive: boolean
): string => {
  const markers: string[] = [];
  if (readOnly) {
    markers.push('  readOnly: true,');
  }
  if (destructive) {
    markers.push('  destructive: true,');
  }
  const markerBlock = markers.length > 0 ? `\n${markers.join('\n')}` : '';

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
  implementation: async (input) => {
    return Result.ok({});
  },
  input: z.object({}),${markerBlock}
});
`;
};

const generateTestFile = (id: string): string => {
  const moduleName = id.replaceAll('.', '-');
  return `import { describe, expect, test } from 'bun:test';

import { Result } from '@ontrails/core';

import { ${id.replaceAll('.', '_')} } from '../src/trails/${moduleName}.js';

describe('${id}', () => {
  test('runs successfully', async () => {
    const result = await ${id.replaceAll('.', '_')}.implementation({}, {} as never);
    expect(result.isOk()).toBe(true);
  });
});
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
  description: 'Scaffold a new trail with tests and examples',
  implementation: async (input, ctx) => {
    const { id } = input;
    const moduleName = id.replaceAll('.', '-');
    const cwd = resolve(ctx.cwd ?? '.');

    const files = new Map<string, string>([
      [
        `src/trails/${moduleName}.ts`,
        generateTrailFile(id, input.readOnly, input.destructive),
      ],
      [`__tests__/${moduleName}.test.ts`, generateTestFile(id)],
    ]);

    for (const [relativePath, content] of files) {
      await writeWithDirs(join(cwd, relativePath), content);
    }

    return Result.ok({ created: [...files.keys()] });
  },
  input: z.object({
    destructive: z.boolean().default(false).describe('Destructive trail'),
    id: z.string().describe('Trail ID (e.g., entity.update)'),
    readOnly: z.boolean().default(false).describe('Read-only trail'),
  }),
  output: z.object({
    created: z.array(z.string()),
  }),
});
