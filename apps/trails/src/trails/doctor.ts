import { deriveTrailsDir, Result, trail } from '@ontrails/core';
import { readTopoGraph } from '@ontrails/topographer';
import { z } from 'zod';

import {
  deriveDoctorSummary,
  withLifecycleApp,
} from './version-lifecycle-support.js';

const readDoctorForceGraph = async (
  rootDir: string
): Promise<Awaited<ReturnType<typeof readTopoGraph>> | undefined> => {
  try {
    return await readTopoGraph({ dir: deriveTrailsDir({ rootDir }) });
  } catch {
    // Force audit details are supplemental; stale topo locks should not block doctor counts.
    return undefined;
  }
};

export const doctorTrail = trail('doctor', {
  blaze: async (input, ctx) =>
    withLifecycleApp(input, ctx.cwd, async (app, rootDir) => {
      const forceGraph = await readDoctorForceGraph(rootDir);
      return Result.ok(deriveDoctorSummary(app, { forceGraph }));
    }),
  description: 'Diagnose trail versioning lifecycle state',
  input: z.object({
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: z.object({
    archived: z.number(),
    deprecated: z.number(),
    forceDetails: z.array(
      z
        .object({
          acceptedAt: z.string(),
          change: z.enum(['modified', 'removed']),
          detail: z.string(),
          id: z.string(),
          kind: z.enum(['contour', 'trail', 'signal', 'resource']),
          reason: z.string().optional(),
          scope: z.enum(['entry', 'graph']),
          severity: z.literal('breaking'),
          source: z.literal('trails compile --force'),
        })
        .strict()
    ),
    forceEvents: z.number(),
    mode: z.literal('doctor'),
    trails: z.number(),
    versioned: z.number(),
  }),
});
