/**
 * Check trails — CRUD and scheduling toggles for monitored endpoints.
 *
 * Management trails carry the admin permit; the schema enforces the 30-second
 * interval floor at the boundary so implementations never re-validate it. Pause and
 * resume flip `enabled`, which is the flag the cron sweep reads — flipping it
 * is what starts and stops probe scheduling for a check.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { checkSchema, db } from '../store.js';

const ADMIN_SCOPES = ['lookout:admin'] as const;

const checkIdInput = z.object({
  id: z.string().describe('Check id'),
});

// ---------------------------------------------------------------------------
// check.create
// ---------------------------------------------------------------------------

export const createCheck = trail('check.create', {
  description: 'Register a new endpoint check and start monitoring it.',
  examples: [
    {
      description: 'Register a check with the default expectations',
      expectedMatch: {
        enabled: true,
        intervalSeconds: 60,
        name: 'api',
        state: 'unknown',
        url: 'https://api.example.com/health',
      },
      input: {
        intervalSeconds: 60,
        name: 'api',
        url: 'https://api.example.com/health',
      },
      name: 'Create a check',
    },
  ],
  implementation: async (input, ctx) => {
    const created = await db.from(ctx).checks.insert({
      enabled: true,
      expect: {
        ...(input.expectStatus === undefined
          ? {}
          : { status: input.expectStatus }),
        ...(input.expectBodyIncludes === undefined
          ? {}
          : { bodyIncludes: input.expectBodyIncludes }),
      },
      intervalSeconds: input.intervalSeconds,
      method: input.method,
      name: input.name,
      state: 'unknown',
      timeoutMs: input.timeoutMs,
      url: input.url,
    });
    return Result.ok(created);
  },
  input: z.object({
    expectBodyIncludes: z
      .string()
      .optional()
      .describe('Substring the response body must contain'),
    expectStatus: z
      .number()
      .int()
      .optional()
      .default(200)
      .describe('HTTP status the probe expects'),
    intervalSeconds: z
      .number()
      .int()
      .min(30)
      .describe('Probe interval in seconds (minimum 30)'),
    method: z
      .enum(['GET', 'HEAD'])
      .optional()
      .default('GET')
      .describe('HTTP method'),
    name: z.string().min(1).describe('Human-readable check name'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .default(2000)
      .describe('Per-attempt timeout in milliseconds'),
    url: z.url().describe('URL to probe'),
  }),
  intent: 'write',
  output: checkSchema,
  permit: { scopes: ADMIN_SCOPES },
  resources: [db],
});

// ---------------------------------------------------------------------------
// check.list
// ---------------------------------------------------------------------------

export const listChecks = trail('check.list', {
  description: 'List registered checks.',
  examples: [
    {
      description: 'List every registered check',
      input: {},
      name: 'List checks',
    },
  ],
  implementation: async (input, ctx) => {
    const filters =
      input.enabled === undefined ? undefined : { enabled: input.enabled };
    const checks = await db.from(ctx).checks.list(filters);
    return Result.ok({ checks: [...checks], total: checks.length });
  },
  input: z.object({
    enabled: z.boolean().optional().describe('Filter by enabled state'),
  }),
  intent: 'read',
  output: z.object({
    checks: z.array(checkSchema),
    total: z.number().int(),
  }),
  permit: 'public',
  resources: [db],
});

// ---------------------------------------------------------------------------
// check.get
// ---------------------------------------------------------------------------

export const getCheck = trail('check.get', {
  description: 'Show one check by id.',
  examples: [
    {
      description: 'Look up a seeded demo check',
      expectedMatch: { id: 'chk_steady', name: 'steady' },
      input: { id: 'chk_steady' },
      name: 'Get a check',
    },
    {
      description: 'Unknown ids return NotFoundError',
      error: 'NotFoundError',
      input: { id: 'chk_missing' },
      name: 'Get a missing check',
    },
  ],
  implementation: async (input, ctx) => {
    const check = await db.from(ctx).checks.get(input.id);
    if (!check) {
      return Result.err(new NotFoundError(`Check "${input.id}" not found`));
    }
    return Result.ok(check);
  },
  input: checkIdInput,
  intent: 'read',
  output: checkSchema,
  permit: 'public',
  resources: [db],
});

// ---------------------------------------------------------------------------
// check.update
// ---------------------------------------------------------------------------

export const updateCheck = trail('check.update', {
  description: 'Update fields on an existing check.',
  examples: [
    {
      description: 'Tighten the probe interval on a seeded check',
      expectedMatch: { id: 'chk_flaky', intervalSeconds: 45 },
      input: { id: 'chk_flaky', intervalSeconds: 45 },
      name: 'Update a check interval',
    },
  ],
  implementation: async (input, ctx) => {
    const { id, expectBodyIncludes, expectStatus, ...patch } = input;
    const existing = await db.from(ctx).checks.get(id);
    if (!existing) {
      return Result.err(new NotFoundError(`Check "${id}" not found`));
    }
    const expect =
      expectStatus === undefined && expectBodyIncludes === undefined
        ? existing.expect
        : {
            ...(expectStatus === undefined ? {} : { status: expectStatus }),
            ...(expectBodyIncludes === undefined
              ? {}
              : { bodyIncludes: expectBodyIncludes }),
          };
    const updated = await db.from(ctx).checks.update(id, {
      ...Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined)
      ),
      expect,
    });
    if (!updated) {
      return Result.err(new NotFoundError(`Check "${id}" not found`));
    }
    return Result.ok(updated);
  },
  input: z.object({
    expectBodyIncludes: z
      .string()
      .optional()
      .describe('Substring the response body must contain'),
    expectStatus: z
      .number()
      .int()
      .optional()
      .describe('HTTP status the probe expects'),
    id: z.string().describe('Check id'),
    intervalSeconds: z
      .number()
      .int()
      .min(30)
      .optional()
      .describe('Probe interval in seconds (minimum 30)'),
    method: z.enum(['GET', 'HEAD']).optional().describe('HTTP method'),
    name: z.string().min(1).optional().describe('Human-readable check name'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Per-attempt timeout in milliseconds'),
    url: z.url().optional().describe('URL to probe'),
  }),
  intent: 'write',
  output: checkSchema,
  permit: { scopes: ADMIN_SCOPES },
  resources: [db],
});

// ---------------------------------------------------------------------------
// check.delete
// ---------------------------------------------------------------------------

export const deleteCheck = trail('check.delete', {
  description: 'Delete a check and stop monitoring it.',
  examples: [
    {
      description: 'Delete a seeded demo check',
      expected: { deleted: true, id: 'chk_retired' },
      input: { id: 'chk_retired' },
      name: 'Delete a check',
    },
    {
      description: 'Unknown ids return NotFoundError',
      error: 'NotFoundError',
      input: { id: 'chk_missing' },
      name: 'Delete a missing check',
    },
  ],
  implementation: async (input, ctx) => {
    const removed = await db.from(ctx).checks.remove(input.id);
    if (!removed.deleted) {
      return Result.err(new NotFoundError(`Check "${input.id}" not found`));
    }
    return Result.ok({ deleted: true, id: input.id });
  },
  input: checkIdInput,
  intent: 'destroy',
  output: z.object({
    deleted: z.boolean(),
    id: z.string(),
  }),
  permit: { scopes: ADMIN_SCOPES },
  resources: [db],
});

// ---------------------------------------------------------------------------
// check.pause / check.resume
// ---------------------------------------------------------------------------

const setEnabled = async (ctx: TrailContext, id: string, enabled: boolean) =>
  await db.from(ctx).checks.update(id, { enabled });

export const pauseCheck = trail('check.pause', {
  description: 'Pause a check — the cron sweep stops scheduling probes for it.',
  examples: [
    {
      description: 'Pause a seeded demo check',
      expectedMatch: { enabled: false, id: 'chk_flaky' },
      input: { id: 'chk_flaky' },
      name: 'Pause a check',
    },
  ],
  implementation: async (input, ctx) => {
    const updated = await setEnabled(ctx, input.id, false);
    if (!updated) {
      return Result.err(new NotFoundError(`Check "${input.id}" not found`));
    }
    return Result.ok(updated);
  },
  input: checkIdInput,
  intent: 'write',
  output: checkSchema,
  permit: { scopes: ADMIN_SCOPES },
  resources: [db],
});

export const resumeCheck = trail('check.resume', {
  description: 'Resume a paused check — the cron sweep schedules probes again.',
  examples: [
    {
      description: 'Resume a seeded demo check',
      expectedMatch: { enabled: true, id: 'chk_flaky' },
      input: { id: 'chk_flaky' },
      name: 'Resume a check',
    },
  ],
  implementation: async (input, ctx) => {
    const updated = await setEnabled(ctx, input.id, true);
    if (!updated) {
      return Result.err(new NotFoundError(`Check "${input.id}" not found`));
    }
    return Result.ok(updated);
  },
  input: checkIdInput,
  intent: 'write',
  output: checkSchema,
  permit: { scopes: ADMIN_SCOPES },
  resources: [db],
});
