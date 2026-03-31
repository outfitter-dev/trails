/**
 * Infrastructure trail that generates an example config file.
 *
 * Produces TOML, JSON, JSONC, or YAML output from the registered
 * config schema, with defaults shown and deprecated fields annotated.
 *
 * When `dir` is provided, also writes `.env.example` and `.schema.json`
 * to the specified directory.
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { Result, trail } from '@ontrails/core';
import type { z } from 'zod';
import { z as zod } from 'zod';

import { configService } from '../config-service.js';
import {
  generateEnvExample,
  generateExample,
  generateJsonSchema,
} from '../generate/index.js';

const formatEnum = zod.enum(['toml', 'json', 'jsonc', 'yaml']);

const outputSchema = zod.object({
  content: zod.string(),
  format: zod.string(),
  writtenFiles: zod.array(zod.string()).optional(),
});

/** Collect artifacts to write: [relativeName, content] pairs. */
const collectArtifacts = (
  schema: z.ZodObject<Record<string, z.ZodType>>
): [string, string][] => {
  const artifacts: [string, string][] = [];
  const envContent = generateEnvExample(schema);
  if (envContent.length > 0) {
    artifacts.push(['.env.example', envContent]);
  }
  artifacts.push([
    '.schema.json',
    JSON.stringify(generateJsonSchema(schema), null, 2),
  ]);
  return artifacts;
};

/** Write generated artifacts to the target directory. */
const writeArtifacts = async (
  dir: string,
  schema: z.ZodObject<Record<string, z.ZodType>>
): Promise<string[]> => {
  await mkdir(dir, { recursive: true });
  const artifacts = collectArtifacts(schema);
  const written: string[] = [];
  for (const [name, content] of artifacts) {
    const fullPath = join(dir, name);
    await Bun.write(fullPath, content);
    written.push(fullPath);
  }
  return written;
};

export const configInit = trail('config.init', {
  examples: [
    {
      input: {},
      name: 'Generate TOML example',
    },
  ],
  input: zod.object({
    dir: zod
      .string()
      .describe('Directory to write generated artifacts to')
      .optional(),
    format: formatEnum
      .describe('Output format for the example config file')
      .default('toml'),
  }),
  intent: 'write',
  metadata: { category: 'infrastructure' },
  output: outputSchema,
  run: async (input, ctx) => {
    const state = configService.from(ctx);
    const schema = state.schema as z.ZodObject<Record<string, z.ZodType>>;
    const content = generateExample(schema, input.format);

    if (input.dir) {
      const writtenFiles = await writeArtifacts(input.dir, schema);
      return Result.ok({ content, format: input.format, writtenFiles });
    }

    return Result.ok({ content, format: input.format });
  },
  services: [configService],
});
