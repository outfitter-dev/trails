/** Scaffold a typed signal declaration and payload tests. */
import { resolve } from 'node:path';

import { Result, trail, ValidationError } from '@ontrails/core';
import { z } from 'zod';

import { writeNewProjectFiles } from '../new-project-files.js';
import {
  TRAIL_ID_PATTERN,
  trailIdToExportName,
  trailIdToModuleName,
} from '../project-writes.js';

const idMessage =
  'Signal scaffold IDs must use lowercase dotted segments, optionally prefixed with "_draft."; each segment starts with a letter and contains only letters or digits.';

/** Mirrors the authored payload in apps/trails/src/trails/create-scaffold.ts:892. */
const generateSignal = (
  id: string,
  description: string
): string => `import { signal } from '@ontrails/core';
import { z } from 'zod';

// Register this definition in your topo. Producers declare fires and call
// ctx.fire(signal, payload); reactive consumers declare on. Add actual producer
// IDs to the optional from field only after those producers are wired.
export const ${trailIdToExportName(id)}Signal = signal(${JSON.stringify(id)}, {
  description: ${JSON.stringify(description)},
  payload: z.object({
    entityId: z.string(),
    updatedAt: z.string(),
  }),
});
`;

const generateTests = (id: string): string => {
  const name = `${trailIdToExportName(id)}Signal`;
  return `import { expect, test } from 'bun:test';

import { ${name} } from '../src/signals/${trailIdToModuleName(id)}.js';

test('validates signal payloads', () => {
  expect(${name}.payload.safeParse({
    entityId: 'example', updatedAt: '2026-01-01T00:00:00Z',
  }).success).toBe(true);
  expect(${name}.payload.safeParse({ entityId: 'example' }).success).toBe(false);
  expect(${name}.payload.safeParse({ entityId: 1, updatedAt: 'now' }).success).toBe(false);
});
`;
};

export const addSignal = trail('add.signal', {
  args: ['id'],
  description: 'Scaffold a typed signal declaration with payload tests',
  dryRun: false,
  implementation: ({ id, description }, ctx) => {
    if (ctx.dryRun) {
      return Result.err(
        new ValidationError(
          'add.signal does not support dry-run. No files were written.'
        )
      );
    }
    if (!TRAIL_ID_PATTERN.test(id)) {
      return Result.err(new ValidationError(idMessage));
    }
    const module = trailIdToModuleName(id);
    const files = new Map([
      [`src/signals/${module}.ts`, generateSignal(id, description)],
      [`__tests__/${module}.test.ts`, generateTests(id)],
    ]);
    const written = writeNewProjectFiles(resolve(ctx.cwd ?? '.'), files);
    return written.isErr()
      ? written
      : Result.ok({ created: [...files.keys()] });
  },
  input: z.object({
    description: z.string().trim().min(1).describe('Signal description'),
    id: z
      .string()
      .regex(TRAIL_ID_PATTERN, idMessage)
      .describe(
        'Signal scaffold ID (e.g. entity.updated); lowercase dotted segments with optional _draft. prefix'
      ),
  }),
  output: z.object({ created: z.array(z.string()) }),
  permit: { scopes: ['project:write'] },
});
