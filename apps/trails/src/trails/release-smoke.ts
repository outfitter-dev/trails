/**
 * `release.smoke` trail -- Local release confidence checks.
 */

import { Result, trail, ValidationError } from '@ontrails/core';
import { z } from 'zod';

import { releaseSmokeCheckValues, runReleaseSmoke } from '../release/smoke.js';

const releaseSmokeCheckSchema = z.enum(releaseSmokeCheckValues);

const releaseSmokeInputSchema = z.object({
  check: z.string().default('all').describe('Release smoke check to run'),
});

const releaseSmokeCheckResultSchema = z.object({
  check: z.enum(['lock-roundtrip', 'packed-artifacts', 'wayfinder-dogfood']),
  lockCount: z.number().optional(),
  message: z.string(),
  packageCount: z.number().optional(),
  passed: z.literal(true),
  trailCount: z.number().optional(),
});

const releaseSmokeOutputSchema = z.object({
  checks: z.array(releaseSmokeCheckResultSchema).readonly(),
  message: z.string(),
  passed: z.literal(true),
});

export const releaseSmokeTrail = trail('release.smoke', {
  description: 'Run local release confidence smoke checks',
  implementation: async (input) => {
    try {
      const check = releaseSmokeCheckSchema.parse(input.check);
      return Result.ok(await runReleaseSmoke(check));
    } catch (error) {
      return Result.err(
        new ValidationError(
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  },
  input: releaseSmokeInputSchema,
  intent: 'read',
  output: releaseSmokeOutputSchema,
  permit: 'public',
});
