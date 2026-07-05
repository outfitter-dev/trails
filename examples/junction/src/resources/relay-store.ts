/**
 * Drizzle-bound relay store resource.
 *
 * The runtime path opens the SQLite file named by `JUNCTION_DB` (defaulting
 * to `.junction.sqlite` in the working directory) so relayed events survive
 * restarts. The mock path opens `:memory:` with deterministic fixtures —
 * fixed ids, secrets, and timestamps — so trail examples and offline tests
 * assert against stable values.
 */

import { connectDrizzle } from '@ontrails/drizzle';

import { relayStoreDefinition } from '../store.js';

export const mockEndpoints = [
  {
    createdAt: '2026-07-01T00:00:00.000Z',
    enabled: true,
    id: 'ep_github_demo',
    name: 'GitHub demo endpoint',
    secret: "It's a Secret to Everybody",
    source: 'github',
  },
  {
    createdAt: '2026-07-01T00:00:00.000Z',
    enabled: true,
    id: 'ep_stripe_demo',
    name: 'Stripe demo endpoint',
    secret: 'whsec_test_junction_secret',
    source: 'stripe',
  },
  {
    createdAt: '2026-07-01T00:00:00.000Z',
    enabled: true,
    id: 'ep_generic_demo',
    name: 'Generic HMAC demo endpoint',
    secret: 'generic_junction_secret',
    source: 'generic-hmac',
  },
  {
    createdAt: '2026-07-01T00:00:00.000Z',
    enabled: false,
    id: 'ep_disabled_demo',
    name: 'Disabled endpoint',
    secret: 'disabled_secret',
    source: 'generic-hmac',
  },
  {
    createdAt: '2026-07-01T00:00:00.000Z',
    enabled: true,
    id: 'ep_rotate_demo',
    name: 'Rotation demo endpoint',
    secret: 'rotate_me',
    source: 'generic-hmac',
  },
] as const;

export const mockTargets = [
  {
    enabled: true,
    id: 'tgt_logbook',
    name: 'Logbook receiver',
    url: 'https://targets.junction.test/logbook',
  },
  {
    enabled: true,
    id: 'tgt_unreachable',
    name: 'Unreachable receiver',
    url: 'https://targets.junction.test/unreachable',
  },
  {
    enabled: false,
    id: 'tgt_disabled',
    name: 'Disabled receiver',
    url: 'https://targets.junction.test/disabled',
  },
] as const;

export const mockRoutes = [
  {
    enabled: true,
    endpointId: 'ep_github_demo',
    id: 'rt_github_logbook',
    targetId: 'tgt_logbook',
  },
  {
    enabled: true,
    endpointId: 'ep_stripe_demo',
    filterEquals: 'payment_intent.succeeded',
    filterPath: 'type',
    id: 'rt_stripe_payments',
    targetId: 'tgt_logbook',
  },
  {
    enabled: true,
    endpointId: 'ep_generic_demo',
    id: 'rt_generic_unreachable',
    targetId: 'tgt_unreachable',
  },
  {
    enabled: false,
    endpointId: 'ep_github_demo',
    id: 'rt_disabled',
    targetId: 'tgt_disabled',
  },
  {
    enabled: false,
    endpointId: 'ep_disabled_demo',
    id: 'rt_toggle_demo',
    targetId: 'tgt_logbook',
  },
] as const;

export const mockEvents = [
  {
    endpointId: 'ep_github_demo',
    headers: { 'x-github-event': 'push' },
    id: 'evt_seed_push',
    payload: { action: 'push', repository: 'outfitter-dev/trails' },
    receivedAt: '2026-07-01T08:00:00.000Z',
    signatureValid: true,
    status: 'relayed',
  },
  {
    endpointId: 'ep_stripe_demo',
    headers: {},
    id: 'evt_seed_invalid',
    payload: {},
    receivedAt: '2026-07-01T09:00:00.000Z',
    signatureValid: false,
    status: 'dead',
  },
] as const;

export const mockDeliveries = [
  {
    attempts: 1,
    eventId: 'evt_seed_push',
    id: 'dlv_seed_ok',
    status: 'delivered',
    targetId: 'tgt_logbook',
  },
  {
    attempts: 3,
    eventId: 'evt_seed_push',
    id: 'dlv_seed_failed',
    lastError: 'NetworkError: target unreachable',
    status: 'failed',
    targetId: 'tgt_unreachable',
  },
] as const;

const mockSeed = {
  delivery: mockDeliveries.map((row) => ({ ...row })),
  endpoint: mockEndpoints.map((row) => ({ ...row })),
  event: mockEvents.map((row) => ({
    ...row,
    headers: { ...row.headers },
    payload: { ...row.payload },
  })),
  route: mockRoutes.map((row) => ({ ...row })),
  target: mockTargets.map((row) => ({ ...row })),
};

export const relayStoreResource = connectDrizzle(relayStoreDefinition, {
  description: 'SQLite-backed relay store for junction endpoints and events.',
  id: 'junction.store',
  mockSeed,
  url: process.env['JUNCTION_DB'] ?? '.junction.sqlite',
});
