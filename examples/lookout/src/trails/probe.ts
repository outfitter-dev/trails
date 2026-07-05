/**
 * Probe trails — the runtime heart of lookout.
 *
 * `probe.run` fetches a check's URL once; transient failure classes (timeout,
 * connection reset, 502/503) recover through detour contracts with bounded
 * retries and backoff. A success inside the detour records the honest
 * `recovered-after-retry` middle state most monitors hide. Exhausted retries
 * and definitive failures (wrong status, missing body text) record `down`.
 * Every resolved probe writes a row and moves the check's derived state.
 */

import {
  NetworkError,
  NotFoundError,
  Result,
  TimeoutError,
  trail,
} from '@ontrails/core';
import type { Detour, TrailContext, TrailsError } from '@ontrails/core';
import { z } from 'zod';

import { probeHttp } from '../resources/probe-http.js';
import type { ProbeReply } from '../resources/probe-http.js';
import { probeFailed, probeRecovered } from '../signals/probe-signals.js';
import { db, probeOutcomeValues, probeSchema } from '../store.js';
import type { Check, CheckState } from '../store.js';

/** Retries after the initial attempt; three attempts total before `down`. */
export const PROBE_MAX_RETRIES = 2;

/** Linear backoff base between detour attempts. */
export const PROBE_BACKOFF_MS = 150;

const TRANSIENT_STATUSES = new Set([502, 503]);

// ---------------------------------------------------------------------------
// Attempt classification
// ---------------------------------------------------------------------------

type AttemptOutcome =
  | { readonly kind: 'healthy' }
  | { readonly kind: 'definitive-failure'; readonly reason: string }
  | {
      readonly kind: 'transient-failure';
      readonly transient: 'timeout' | 'network';
      readonly reason: string;
    };

const classifyReply = (
  reply: ProbeReply,
  expect: Check['expect']
): AttemptOutcome => {
  if (reply.kind === 'timeout') {
    return {
      kind: 'transient-failure',
      reason: 'request timed out',
      transient: 'timeout',
    };
  }
  if (reply.kind === 'connection-reset') {
    return {
      kind: 'transient-failure',
      reason: `connection failed: ${reply.message}`,
      transient: 'network',
    };
  }
  if (TRANSIENT_STATUSES.has(reply.status)) {
    return {
      kind: 'transient-failure',
      reason: `upstream answered ${reply.status}`,
      transient: 'network',
    };
  }
  const expectedStatus = expect.status ?? 200;
  if (reply.status !== expectedStatus) {
    return {
      kind: 'definitive-failure',
      reason: `expected status ${expectedStatus}, got ${reply.status}`,
    };
  }
  if (
    expect.bodyIncludes !== undefined &&
    !reply.body.includes(expect.bodyIncludes)
  ) {
    return {
      kind: 'definitive-failure',
      reason: `response body does not include "${expect.bodyIncludes}"`,
    };
  }
  return { kind: 'healthy' };
};

const attemptProbe = async (
  ctx: TrailContext,
  check: Check
): Promise<AttemptOutcome> => {
  const reply = await probeHttp.from(ctx).request({
    method: check.method,
    timeoutMs: check.timeoutMs,
    url: check.url,
  });
  return classifyReply(reply, check.expect);
};

const transientError = (
  transient: 'timeout' | 'network',
  reason: string,
  checkId: string
): TrailsError =>
  transient === 'timeout'
    ? new TimeoutError(reason, { context: { checkId } })
    : new NetworkError(reason, { context: { checkId } });

// ---------------------------------------------------------------------------
// Probe finalization — one resolved probe row + derived check state
// ---------------------------------------------------------------------------

const transitionValues = ['none', 'failed', 'recovered'] as const;

const probeRunOutputSchema = z.object({
  attempts: z.number().int(),
  checkId: z.string(),
  durationMs: z.number().int(),
  failureReason: z.string().nullable(),
  outcome: z.enum(probeOutcomeValues),
  previousState: z.enum(['up', 'down', 'unknown']),
  probeId: z.string(),
  startedAt: z.string(),
  state: z.enum(['up', 'down']),
  transition: z.enum(transitionValues),
});

export type ProbeRunOutput = z.output<typeof probeRunOutputSchema>;

interface ResolvedAttempt {
  readonly attempts: number;
  readonly failureReason: string | null;
  readonly outcome: (typeof probeOutcomeValues)[number];
}

/** Signal payload for a resolved probe that produced a state transition. */
const transitionPayload = (check: Check, output: ProbeRunOutput) => ({
  at: output.startedAt,
  checkId: check.id,
  checkName: check.name,
  failureReason: output.failureReason,
  probeId: output.probeId,
  url: check.url,
});

const deriveTransition = (
  previousState: CheckState,
  state: 'up' | 'down'
): (typeof transitionValues)[number] => {
  if (state === 'down' && previousState !== 'down') {
    return 'failed';
  }
  if (state === 'up' && previousState === 'down') {
    return 'recovered';
  }
  return 'none';
};

const finalizeProbe = async (
  ctx: TrailContext,
  check: Check,
  resolved: ResolvedAttempt,
  startedAt: string,
  startedAtMs: number
): Promise<Result<ProbeRunOutput, TrailsError>> => {
  const store = db.from(ctx);
  const durationMs = Math.max(0, Math.round(performance.now() - startedAtMs));
  const probe = await store.probes.insert({
    attempts: resolved.attempts,
    checkId: check.id,
    durationMs,
    failureReason: resolved.failureReason,
    outcome: resolved.outcome,
    startedAt,
  });
  const state = resolved.outcome === 'down' ? 'down' : 'up';
  const transition = deriveTransition(check.state, state);
  await store.checks.update(check.id, { state });
  return Result.ok({
    attempts: resolved.attempts,
    checkId: check.id,
    durationMs,
    failureReason: resolved.failureReason,
    outcome: resolved.outcome,
    previousState: check.state,
    probeId: probe.id,
    startedAt,
    state,
    transition,
  });
};

// ---------------------------------------------------------------------------
// Detour recovery — bounded retries with backoff
// ---------------------------------------------------------------------------

const probeRunInputSchema = z.object({
  checkId: z.string().describe('Check to probe'),
});

type ProbeRunInput = z.output<typeof probeRunInputSchema>;

const recoverTransientProbe = async (
  attempt: { readonly attempt: number; readonly input: ProbeRunInput },
  ctx: TrailContext,
  chain: 'timeout' | 'network'
): Promise<Result<ProbeRunOutput, TrailsError>> => {
  await Bun.sleep(PROBE_BACKOFF_MS * attempt.attempt);
  const check = await db.from(ctx).checks.get(attempt.input.checkId);
  if (!check) {
    return Result.err(
      new NotFoundError(`Check "${attempt.input.checkId}" not found`)
    );
  }
  const startedAt = new Date().toISOString();
  const startedAtMs = performance.now();
  const outcome = await attemptProbe(ctx, check);
  const attempts = attempt.attempt + 1;
  if (
    outcome.kind === 'transient-failure' &&
    attempt.attempt < PROBE_MAX_RETRIES
  ) {
    // Still transient with retries left: rethrow the chain's error class so
    // the detour loop schedules the next bounded attempt.
    return Result.err(transientError(chain, outcome.reason, check.id));
  }
  const resolved: ResolvedAttempt =
    outcome.kind === 'healthy'
      ? { attempts, failureReason: null, outcome: 'recovered-after-retry' }
      : { attempts, failureReason: outcome.reason, outcome: 'down' };
  const final = await finalizeProbe(
    ctx,
    check,
    resolved,
    startedAt,
    startedAtMs
  );
  if (final.isOk() && final.value.transition === 'failed') {
    await ctx.fire?.(probeFailed, transitionPayload(check, final.value));
  }
  if (final.isOk() && final.value.transition === 'recovered') {
    await ctx.fire?.(probeRecovered, transitionPayload(check, final.value));
  }
  return final;
};

const probeDetours: readonly Detour<
  ProbeRunInput,
  ProbeRunOutput,
  TrailsError
>[] = [
  {
    maxAttempts: PROBE_MAX_RETRIES,
    on: TimeoutError,
    recover: async (attempt, ctx) =>
      await recoverTransientProbe(attempt, ctx, 'timeout'),
  },
  {
    maxAttempts: PROBE_MAX_RETRIES,
    on: NetworkError,
    recover: async (attempt, ctx) =>
      await recoverTransientProbe(attempt, ctx, 'network'),
  },
];

// ---------------------------------------------------------------------------
// probe.run
// ---------------------------------------------------------------------------

export const runProbe = trail('probe.run', {
  blaze: async (input, ctx) => {
    const check = await db.from(ctx).checks.get(input.checkId);
    if (!check) {
      return Result.err(
        new NotFoundError(`Check "${input.checkId}" not found`)
      );
    }
    const startedAt = new Date().toISOString();
    const startedAtMs = performance.now();
    const outcome = await attemptProbe(ctx, check);
    if (outcome.kind === 'transient-failure') {
      // Hand transient classes to the detour contracts — retries and backoff
      // live there, never inline.
      return Result.err(
        transientError(outcome.transient, outcome.reason, check.id)
      );
    }
    const resolved: ResolvedAttempt =
      outcome.kind === 'healthy'
        ? { attempts: 1, failureReason: null, outcome: 'up' }
        : { attempts: 1, failureReason: outcome.reason, outcome: 'down' };
    const final = await finalizeProbe(
      ctx,
      check,
      resolved,
      startedAt,
      startedAtMs
    );
    if (final.isOk() && final.value.transition === 'failed') {
      await ctx.fire?.(probeFailed, transitionPayload(check, final.value));
    }
    if (final.isOk() && final.value.transition === 'recovered') {
      await ctx.fire?.(probeRecovered, transitionPayload(check, final.value));
    }
    return final;
  },
  description:
    'Probe one check: transient failures recover through detours, resolved probes record a row and move the derived check state. Fires probe.failed on up→down and probe.recovered on down→up.',
  detours: probeDetours,
  examples: [
    {
      description: 'A healthy endpoint resolves up on the first attempt',
      expectedMatch: {
        attempts: 1,
        checkId: 'chk_steady',
        failureReason: null,
        outcome: 'up',
        state: 'up',
        transition: 'none',
      },
      input: { checkId: 'chk_steady' },
      name: 'Probe an up check',
    },
    {
      description: 'Unknown check ids return NotFoundError',
      error: 'NotFoundError',
      input: { checkId: 'chk_missing' },
      name: 'Probe a missing check',
    },
  ],
  fires: [probeFailed, probeRecovered],
  input: probeRunInputSchema,
  intent: 'write',
  output: probeRunOutputSchema,
  resources: [db, probeHttp],
  visibility: 'internal',
});

// ---------------------------------------------------------------------------
// probe.history
// ---------------------------------------------------------------------------

export const probeHistory = trail('probe.history', {
  blaze: async (input, ctx) => {
    const all = await db.from(ctx).probes.list({ checkId: input.checkId });
    const cutoff =
      input.sinceHours === undefined
        ? undefined
        : new Date(Date.now() - input.sinceHours * 3_600_000).toISOString();
    const windowed = [...all]
      .filter((probe) => cutoff === undefined || probe.startedAt >= cutoff)
      .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
    return Result.ok({
      probes: windowed.slice(input.offset, input.offset + input.limit),
      total: windowed.length,
    });
  },
  description:
    'Probe history for one check, newest first, windowed and paginated.',
  examples: [
    {
      description: 'A fresh check has no probe history yet',
      expected: { probes: [], total: 0 },
      input: { checkId: 'chk_steady' },
      name: 'Empty history',
    },
  ],
  input: z.object({
    checkId: z.string().describe('Check id'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(50)
      .describe('Maximum results'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe('Pagination offset'),
    sinceHours: z
      .number()
      .positive()
      .optional()
      .describe('Only include probes from the last N hours'),
  }),
  intent: 'read',
  output: z.object({
    probes: z.array(probeSchema),
    total: z.number().int(),
  }),
  permit: 'public',
  resources: [db],
});

// ---------------------------------------------------------------------------
// probe.prune — retention enforcement
// ---------------------------------------------------------------------------

export const pruneProbes = trail('probe.prune', {
  blaze: async (input, ctx) => {
    const store = db.from(ctx);
    const checks = await store.checks.list();
    let removed = 0;
    for (const check of checks) {
      const probes = await store.probes.list({ checkId: check.id });
      const excess = [...probes]
        .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(input.keepPerCheck);
      for (const probe of excess) {
        if (ctx.dryRun !== true) {
          await store.probes.remove(probe.id);
        }
        removed += 1;
      }
    }
    return Result.ok({ dryRun: ctx.dryRun === true, removed });
  },
  description:
    'Reconcile stored probe volume against the retention cap, pruning the oldest rows per check.',
  dryRun: true,
  examples: [
    {
      description: 'Nothing to prune when history is within retention',
      expected: { dryRun: false, removed: 0 },
      input: {},
      name: 'Prune within retention',
    },
  ],
  input: z.object({
    keepPerCheck: z
      .number()
      .int()
      .positive()
      .optional()
      .default(100)
      .describe('Probe rows to keep per check'),
  }),
  intent: 'destroy',
  output: z.object({
    dryRun: z.boolean(),
    removed: z.number().int(),
  }),
  permit: { scopes: ['lookout:admin'] },
  resources: [db],
});
