/** Scaffold an editable in-memory resource and lifecycle tests. */
import { resolve } from 'node:path';

import { Result, trail, ValidationError } from '@ontrails/core';
import { z } from 'zod';

import {
  TRAIL_ID_PATTERN,
  trailIdToExportName,
  trailIdToModuleName,
} from '../project-writes.js';
import { writeResourceScaffoldFiles } from '../resource-scaffold-files.js';

const idMessage =
  'Resource scaffold IDs must use lowercase dotted segments, optionally prefixed with "_draft."; each segment starts with a letter and contains only letters or digits.';

/**
 * Reuse the file/export naming owner at apps/trails/src/project-writes.ts:57.
 * These scaffold constraints do not restrict Core's broader resource IDs.
 */
const generateResource = (
  id: string,
  description: string
): string => `import { Result, resource } from '@ontrails/core';
import { z } from 'zod';

/** Editable in-memory starter; replace its storage with your resource's implementation. */
export const ${trailIdToExportName(id)}Resource = resource(${JSON.stringify(id)}, {
  config: z.object({
    initialValues: z.record(z.string(), z.string()).default({}),
  }),
  create: ({ config }) => Result.ok(new Map(Object.entries(config.initialValues))),
  description: ${JSON.stringify(description)},
  dispose: (value) => value.clear(),
  health: (value) => Result.ok({ entries: value.size }),
  mock: () => new Map<string, string>(),
});
`;

const generateTests = (id: string): string => {
  const name = `${trailIdToExportName(id)}Resource`;
  return `import { expect, test } from 'bun:test';

import { ${name} } from '../src/resources/${trailIdToModuleName(id)}.js';

test('uses configured values and releases local state', async () => {
  const schema = ${name}.config;
  if (schema === undefined) throw new Error('Expected resource config schema');
  const result = await ${name}.create({
    config: schema.parse({ initialValues: { example: 'value' } }),
  });
  if (result.isErr()) throw result.error;
  expect(result.value.get('example')).toBe('value');
  const healthy = await ${name}.health?.(result.value);
  if (healthy === undefined) throw new Error('Expected resource health check');
  if (healthy.isErr()) throw healthy.error;
  expect(healthy.value).toEqual({ entries: 1 });
  await ${name}.dispose?.(result.value);
  expect(result.value.size).toBe(0);
  expect(schema.parse({})).toEqual({ initialValues: {} });
});

test('creates isolated mocks without configuration', async () => {
  const mock = ${name}.mock;
  if (mock === undefined) throw new Error('Expected resource mock');
  const first = await mock();
  const second = await mock();
  first.set('example', 'value');
  expect(second.size).toBe(0);
  expect(first).not.toBe(second);
});
`;
};

export const addResource = trail('add.resource', {
  args: ['id'],
  description:
    'Scaffold an in-memory resource with config, lifecycle, and mock tests',
  dryRun: false,
  implementation: async ({ id, description }, ctx) => {
    if (ctx.dryRun) {
      return Result.err(
        new ValidationError(
          'add.resource does not support dry-run. No files were written.'
        )
      );
    }
    if (!TRAIL_ID_PATTERN.test(id)) {
      return Result.err(new ValidationError(idMessage));
    }
    const module = trailIdToModuleName(id);
    const files = new Map([
      [`src/resources/${module}.ts`, generateResource(id, description)],
      [`__tests__/${module}.test.ts`, generateTests(id)],
    ]);
    const written = writeResourceScaffoldFiles(resolve(ctx.cwd ?? '.'), files);
    if (written.isErr()) {
      return written;
    }
    return Result.ok({ created: [...files.keys()] });
  },
  input: z.object({
    description: z.string().min(1).describe('Resource description'),
    id: z
      .string()
      .regex(TRAIL_ID_PATTERN, idMessage)
      .describe(
        'Resource scaffold ID (e.g. db.main); lowercase dotted segments with optional _draft. prefix'
      ),
  }),
  output: z.object({ created: z.array(z.string()) }),
  permit: { scopes: ['project:write'] },
});
