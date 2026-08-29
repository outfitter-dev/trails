import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { resolveOperatorProjectContext } from './project-context.js';
import {
  operatorProjectContextOutput,
  operatorProjectContextOutputSchema,
} from './project-context-output.js';

const configExplainInputSchema = z.object({
  app: z.string().optional().describe('Configured workspace app ID'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

const configExplainOutputSchema = z.object({
  configPath: z.string().nullable(),
  project: operatorProjectContextOutputSchema,
});

export const configExplainTrail = trail('config.explain', {
  description: 'Explain static Trails project and app identity',
  examples: [
    {
      input: {},
      name: 'Explain project identity from the current app context',
    },
  ],
  implementation: async (input, ctx) => {
    const context = await resolveOperatorProjectContext(input, {
      cwd: ctx.cwd,
    });
    if (context.isErr()) {
      return context;
    }
    return Result.ok({
      configPath: context.value.identity.configPath ?? null,
      project: operatorProjectContextOutput(context.value),
    });
  },
  input: configExplainInputSchema,
  intent: 'read',
  output: configExplainOutputSchema,
});
