/**
 * The hero surface: junction's HTTP app.
 *
 * Both halves derive from the same graph through `@ontrails/hono`:
 *
 * - the management API under `/api/*` with JWT-backed permits, and
 * - webhook ingress at the root, where the `webhook.inbound` activation
 *   source materializes as `POST /hooks/:endpointId` with raw-body and
 *   allowlisted-header delivery to the `webhook.receive` trail.
 *
 * `GET /api/openapi.json` serves the management-API spec — the same
 * derivation that is committed at `openapi.json`. Errors on every route
 * render through the shared taxonomy policy.
 */

import type { ResourceOverrideMap } from '@ontrails/core';
import { createApp } from '@ontrails/hono';
import { deriveOpenApiSpec } from '@ontrails/http';
import type { Hono } from 'hono';

import { graph } from './app.js';
import { authConfigValues, resolveHttpPermit } from './permits.js';

const INGRESS_TRAILS = ['webhook.receive'] as const;

export const deriveJunctionOpenApiSpec = () =>
  deriveOpenApiSpec(graph, {
    basePath: '/api',
    exclude: [...INGRESS_TRAILS],
    title: 'junction management API',
    version: '0.1.0',
  });

export interface CreateServerAppOptions {
  /** Resource overrides threaded to every derived route. */
  readonly resources?: ResourceOverrideMap | undefined;
}

export const createServerApp = (options: CreateServerAppOptions = {}): Hono => {
  const app = createApp(graph, {
    basePath: '/api',
    configValues: authConfigValues(),
    exclude: [...INGRESS_TRAILS],
    resolvePermit: resolveHttpPermit,
    resources: options.resources,
  });

  app.get('/api/openapi.json', (c) => c.json(deriveJunctionOpenApiSpec()));

  const ingress = createApp(graph, {
    configValues: authConfigValues(),
    include: [...INGRESS_TRAILS],
    resources: options.resources,
  });
  app.route('/', ingress);

  return app;
};
