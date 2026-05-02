import { shouldIncludeTrailForSurface } from '@ontrails/core';
import type { Topo, Trail } from '@ontrails/core';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'webhook-route-collision';
const TOPO_FILE = '<topo>';

type RouteMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

interface RouteClaim {
  readonly method: RouteMethod;
  readonly parse?: unknown;
  readonly path: string;
  readonly sourceId?: string | undefined;
  readonly trailId: string;
  readonly type: 'derived-trail' | 'webhook';
  readonly verify?: unknown;
}

const methodByIntent = {
  destroy: 'DELETE',
  read: 'GET',
  write: 'POST',
} as const satisfies Record<string, RouteMethod>;

const derivedTrailPath = (trailId: string): string =>
  `/${trailId.replaceAll('.', '/')}`;

const derivedTrailMethod = (
  trail: Trail<unknown, unknown, unknown>
): RouteMethod =>
  (methodByIntent as Partial<Record<string, RouteMethod>>)[trail.intent] ??
  'POST';

const routeKey = ({ method, path }: Pick<RouteClaim, 'method' | 'path'>) =>
  `${method} ${path}`;

const sortedClaims = (claims: readonly RouteClaim[]): readonly RouteClaim[] =>
  [...claims].toSorted((a, b) => {
    const byType = a.type.localeCompare(b.type);
    if (byType !== 0) {
      return byType;
    }
    const byTrail = a.trailId.localeCompare(b.trailId);
    if (byTrail !== 0) {
      return byTrail;
    }
    return (a.sourceId ?? '').localeCompare(b.sourceId ?? '');
  });

/**
 * Mirror the HTTP builder's default materialization policy. A derived trail
 * route is only emitted when {@link shouldIncludeTrailForSurface} accepts the
 * trail under empty options — internal trails are excluded unless callers
 * explicitly include them by id, which the warden cannot anticipate. Without
 * this filter the rule reports collisions against routes that HTTP would never
 * materialize. See `packages/http/src/build.ts` (`eligibleTrails`).
 */
const collectDerivedTrailClaims = (topo: Topo): readonly RouteClaim[] =>
  topo
    .list()
    .filter((trail) => shouldIncludeTrailForSurface(trail))
    .map((trail) => ({
      method: derivedTrailMethod(trail),
      path: derivedTrailPath(trail.id),
      trailId: trail.id,
      type: 'derived-trail' as const,
    }));

const webhookMethod = (method: string | undefined): RouteMethod =>
  (method?.trim().toUpperCase() as RouteMethod | undefined) ?? 'POST';

/**
 * Mirror the HTTP builder's default materialization policy for webhook
 * consumers. HTTP's `eligibleWebhookTrails` skips internal trails unless
 * callers explicitly include them by id, which the warden cannot anticipate.
 * Without this filter the rule reports collisions against webhook routes that
 * HTTP would never materialize. See `packages/http/src/build.ts`
 * (`eligibleWebhookTrails`, `isInternalTrail`).
 *
 * `shouldIncludeTrailForSurface` cannot be reused here because it short-
 * circuits on any trail with `activationSources.length > 0` — those are exactly
 * the webhook consumer trails we need to inspect. Replicate the visibility
 * shape inline: `visibility: 'internal'` and the legacy `meta.internal === true`
 * convention both opt out of default materialization.
 */
const isInternalConsumer = (trail: Trail<unknown, unknown, unknown>): boolean =>
  trail.visibility === 'internal' || trail.meta?.['internal'] === true;

const collectWebhookClaims = (topo: Topo): readonly RouteClaim[] => {
  const claims: RouteClaim[] = [];

  for (const trail of topo.list()) {
    if (isInternalConsumer(trail)) {
      continue;
    }
    for (const activation of trail.activationSources) {
      if (
        activation.source.kind !== 'webhook' ||
        typeof activation.source.path !== 'string'
      ) {
        continue;
      }
      claims.push({
        method: webhookMethod(activation.source.method),
        parse: activation.source.parse,
        path: activation.source.path.trim(),
        sourceId: activation.source.id,
        trailId: trail.id,
        type: 'webhook',
        verify: activation.source.verify,
      });
    }
  }

  return claims;
};

const claimLabel = (claim: RouteClaim): string =>
  claim.type === 'webhook'
    ? `webhook source "${claim.sourceId}" on trail "${claim.trailId}"`
    : `derived trail route "${claim.trailId}"`;

const buildDiagnostic = (
  key: string,
  claims: readonly RouteClaim[]
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `HTTP webhook route collision on ${key}: ${sortedClaims(claims)
    .map(claimLabel)
    .join(
      ', '
    )}. Give each webhook source a distinct method/path pair or move the direct trail route before materializing the HTTP surface.`,
  rule: RULE_NAME,
  severity: 'error',
});

const buildPolicyMismatchDiagnostic = (
  key: string,
  sourceId: string | undefined,
  field: 'parse' | 'verifier',
  claims: readonly RouteClaim[]
): WardenDiagnostic => {
  const labels = sortedClaims(claims).map(claimLabel).join(', ');
  const remediation =
    field === 'verifier'
      ? 'Reuse the same WebhookSource object so both consumers run under one verifier.'
      : 'Reuse the same WebhookSource object so both consumers parse payloads under one contract.';
  return {
    filePath: TOPO_FILE,
    line: 1,
    message: `HTTP webhook route collision on ${key}: trails sharing webhook source "${sourceId ?? '<unknown>'}" declare a mismatched ${field} policy (${labels}). ${remediation}`,
    rule: RULE_NAME,
    severity: 'error',
  };
};

/**
 * Within a group of webhook claims that share the same `sourceId`, surface a
 * diagnostic when the underlying source declarations diverge on `verify` or
 * `parse`. The HTTP builder rejects the same combination at runtime in
 * {@link mergeWebhookRoutes}; flagging it here surfaces the failure at lint
 * time instead of waiting for surface construction. Reference equality matches
 * the runtime check (a shared `WebhookSource` always passes; two separately
 * declared schemas or callbacks are treated as distinct policies).
 */
const collectPolicyMismatchDiagnostics = (
  key: string,
  webhookClaims: readonly RouteClaim[]
): WardenDiagnostic[] => {
  const claimsBySourceId = new Map<string, RouteClaim[]>();
  for (const claim of webhookClaims) {
    const id = claim.sourceId ?? '';
    const current = claimsBySourceId.get(id) ?? [];
    current.push(claim);
    claimsBySourceId.set(id, current);
  }

  const diagnostics: WardenDiagnostic[] = [];
  for (const [id, grouped] of claimsBySourceId) {
    if (grouped.length < 2) {
      continue;
    }
    const verifyRefs = new Set(grouped.map((claim) => claim.verify));
    if (verifyRefs.size > 1) {
      diagnostics.push(
        buildPolicyMismatchDiagnostic(key, id, 'verifier', grouped)
      );
      continue;
    }
    const parseRefs = new Set(grouped.map((claim) => claim.parse));
    if (parseRefs.size > 1) {
      diagnostics.push(
        buildPolicyMismatchDiagnostic(key, id, 'parse', grouped)
      );
    }
  }
  return diagnostics;
};

const buildDiagnostics = (claims: readonly RouteClaim[]) => {
  const claimsByRoute = new Map<string, RouteClaim[]>();
  for (const claim of claims) {
    const key = routeKey(claim);
    const current = claimsByRoute.get(key) ?? [];
    current.push(claim);
    claimsByRoute.set(key, current);
  }

  const diagnostics: WardenDiagnostic[] = [];
  for (const [key, grouped] of claimsByRoute) {
    const webhookClaims = grouped.filter((claim) => claim.type === 'webhook');
    if (webhookClaims.length === 0) {
      continue;
    }
    const webhookSourceIds = new Set(
      webhookClaims.map((claim) => claim.sourceId)
    );
    if (
      webhookSourceIds.size > 1 ||
      grouped.some((claim) => claim.type === 'derived-trail')
    ) {
      diagnostics.push(buildDiagnostic(key, grouped));
      continue;
    }
    diagnostics.push(...collectPolicyMismatchDiagnostics(key, webhookClaims));
  }
  return diagnostics;
};

export const webhookRouteCollision: TopoAwareWardenRule = {
  checkTopo: (topo) =>
    buildDiagnostics([
      ...collectDerivedTrailClaims(topo),
      ...collectWebhookClaims(topo),
    ]),
  description:
    'Reject webhook source method/path pairs that collide with each other or derived HTTP trail routes.',
  name: RULE_NAME,
  severity: 'error',
};
