/**
 * Schema-derived store for the lookout uptime monitor.
 *
 * Four tables carry the whole domain: monitored checks, high-volume probe
 * results, transition-scoped incidents, and dispatched notifications. The
 * contract is authored once here and bound to SQLite through
 * `@ontrails/drizzle`; tests and examples run against the in-memory mock.
 */

import { store as defineStore } from '@ontrails/store';
import { connectDrizzle } from '@ontrails/drizzle';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entity schemas
// ---------------------------------------------------------------------------

export const checkStateValues = ['up', 'down', 'unknown'] as const;

export const checkSchema = z.object({
  createdAt: z.string(),
  enabled: z.boolean(),
  expect: z.object({
    bodyIncludes: z.string().optional(),
    status: z.number().int().optional(),
  }),
  id: z.string(),
  intervalSeconds: z.number().int(),
  method: z.enum(['GET', 'HEAD']),
  name: z.string(),
  state: z.enum(checkStateValues),
  timeoutMs: z.number().int(),
  updatedAt: z.string(),
  url: z.string(),
});

export const probeOutcomeValues = [
  'up',
  'down',
  'recovered-after-retry',
] as const;

export const probeSchema = z.object({
  attempts: z.number().int(),
  checkId: z.string(),
  durationMs: z.number().int(),
  failureReason: z.string().nullable(),
  id: z.string(),
  outcome: z.enum(probeOutcomeValues),
  startedAt: z.string(),
});

export const incidentStatusValues = [
  'open',
  'acknowledged',
  'resolved',
] as const;

export const incidentSchema = z.object({
  acknowledgedBy: z.string().nullable(),
  checkId: z.string(),
  id: z.string(),
  openedAt: z.string(),
  probeCount: z.number().int(),
  resolvedAt: z.string().nullable(),
  status: z.enum(incidentStatusValues),
});

export const notificationSchema = z.object({
  channel: z.enum(['console', 'webhook']),
  id: z.string(),
  incidentId: z.string(),
  ok: z.boolean(),
  sentAt: z.string(),
});

export type Check = z.output<typeof checkSchema>;
export type Probe = z.output<typeof probeSchema>;
export type Incident = z.output<typeof incidentSchema>;
export type CheckState = Check['state'];

// ---------------------------------------------------------------------------
// Store definition
// ---------------------------------------------------------------------------

/**
 * Demo checks seeded into the mock store so examples and the quickstart have
 * something to probe without any setup. The URLs point at the flaky local
 * test server (`bun run flaky-server`).
 */
const checkFixtures = [
  {
    enabled: true,
    expect: { status: 200 },
    id: 'chk_steady',
    intervalSeconds: 30,
    method: 'GET',
    name: 'steady',
    state: 'unknown',
    timeoutMs: 2000,
    url: 'http://localhost:4090/steady',
  },
  {
    enabled: true,
    expect: { status: 200 },
    id: 'chk_flaky',
    intervalSeconds: 30,
    method: 'GET',
    name: 'flaky',
    state: 'unknown',
    timeoutMs: 2000,
    url: 'http://localhost:4090/flaky',
  },
  {
    enabled: false,
    expect: { status: 200 },
    id: 'chk_retired',
    intervalSeconds: 30,
    method: 'GET',
    name: 'retired',
    state: 'unknown',
    timeoutMs: 2000,
    url: 'http://localhost:4090/steady',
  },
] as const;

/**
 * One open incident on the retired demo check so incident reads, dedupe, and
 * resolve examples have deterministic data without touching the checks the
 * probe tests script against.
 */
const incidentFixtures = [
  {
    acknowledgedBy: null,
    checkId: 'chk_retired',
    id: 'inc_demo',
    openedAt: '2026-07-01T03:12:00.000Z',
    probeCount: 1,
    resolvedAt: null,
    status: 'open',
  },
] as const;

export const lookoutStoreDefinition = defineStore({
  checks: {
    fixtures: checkFixtures,
    generated: ['id', 'createdAt', 'updatedAt'],
    indexes: ['enabled'],
    primaryKey: 'id',
    schema: checkSchema,
  },
  incidents: {
    fixtures: incidentFixtures,
    generated: ['id'],
    indexes: ['checkId', 'status'],
    primaryKey: 'id',
    schema: incidentSchema,
  },
  notifications: {
    generated: ['id'],
    indexes: ['incidentId'],
    primaryKey: 'id',
    schema: notificationSchema,
  },
  probes: {
    generated: ['id'],
    indexes: ['checkId'],
    primaryKey: 'id',
    schema: probeSchema,
  },
});

// ---------------------------------------------------------------------------
// Bound resource
// ---------------------------------------------------------------------------

const databaseUrl = Bun.env['LOOKOUT_DB'] ?? 'lookout.sqlite';

/**
 * SQLite-backed lookout store. Real runs persist to `lookout.sqlite` in the
 * working directory (override with `LOOKOUT_DB`, including `:memory:` for
 * single-process demo runs); tests and examples use the in-memory mock with
 * the demo check fixtures.
 */
export const db = connectDrizzle(lookoutStoreDefinition, {
  description:
    'SQLite store for lookout checks, probes, incidents, and notifications.',
  id: 'lookout.db',
  url: databaseUrl,
});
