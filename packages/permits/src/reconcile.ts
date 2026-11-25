/**
 * The one permit reconciliation every surface calls.
 *
 * A surface extracts its candidates (an inline permit, a synthetic development
 * permit, a presented credential) and names its posture. This module turns
 * those into one `BasePermit` or none, errors on conflicts and on presented
 * credentials nobody can verify, refuses asserted kinds where the posture
 * forbids them, and stamps admission evidence on whatever it admits. It is the
 * CLI's `--permit` / `--token` / dev-permit reconciliation lifted out of the
 * CLI so stdio MCP, the fetch handler, HTTP and WebSocket share it.
 */

import type { BasePermit, PermitActor, Topo } from '@ontrails/core';
import { AuthError, Result, ValidationError } from '@ontrails/core';

import { AUTH_RESOURCE_ID } from './boundary.js';
import type { PermitExtractionInput } from './extraction.js';

/**
 * Where the caller of a surface sits.
 *
 * `in-process` surfaces (the CLI, stdio MCP) run in the user's own process;
 * the launcher is the user, so asserted kinds may be admitted under host
 * policy. `network` surfaces (HTTP, Streamable HTTP MCP, WebSocket) admit
 * only verified credentials.
 */
export type SurfacePosture = 'in-process' | 'network';

/** Synthetic permit identifier; distinctive so accidental use shows in traces. */
export const SYNTHETIC_PERMIT_ID = 'dev-permit';

/** An operator-authored permit presented as-is (`--permit '<json>'`). */
export interface InlinePermitCandidate {
  /** How the surface names this candidate in conflict messages. */
  readonly label: string;
  readonly permit: BasePermit;
}

/** A request for the synthetic full-scope development permit (the CLI's dev flag). */
export interface SyntheticPermitCandidate {
  readonly label: string;
}

/** A presented credential the surface's verifier must check. */
export interface CredentialCandidate {
  readonly label: string;
  readonly apiKey?: string | undefined;
  readonly authToken?: string | undefined;
  readonly authorization?: string | undefined;
  readonly bearerToken?: string | undefined;
  readonly headers?: Headers | undefined;
  readonly sessionId?: string | undefined;
}

/** Everything a surface found that could become the permit. */
export interface PermitCandidates {
  readonly credential?: CredentialCandidate | undefined;
  readonly inline?: InlinePermitCandidate | undefined;
  readonly synthetic?: SyntheticPermitCandidate | undefined;
}

/**
 * Host policy for asserted kinds on an in-process surface.
 *
 * The launcher never controls this: it comes from app config or an
 * environment variable the user sets. When omitted the policy is derived
 * from the topo: asserted kinds are allowed when the app declares no `auth`
 * resource (there is nothing to verify against) and denied once one exists.
 */
export interface AssertedKindsPolicy {
  /** Whether `inline` and `synthetic` candidates may be admitted at all. */
  readonly allow: boolean;
  /** Policy name recorded as the admission's `by`. */
  readonly name?: string | undefined;
  /** Ceiling on the scopes an asserted or synthetic permit may hold. */
  readonly maxScopes?: readonly string[] | undefined;
}

/** A verifier: the surface's resolver over a normalized extraction input. */
export type PermitVerifier = (
  input: PermitExtractionInput
) =>
  | Promise<Result<BasePermit | null, Error>>
  | Result<BasePermit | null, Error>;

export interface ReconcilePermitOptions {
  /** The current actor the host knows (the launching client); never trusted as verified for asserted kinds. */
  readonly actor?: PermitActor | undefined;
  readonly candidates: PermitCandidates;
  readonly graph: Topo;
  /** Message when a credential is presented and no verifier is configured. */
  readonly missingVerifierMessage?: string | undefined;
  readonly policy?: AssertedKindsPolicy | undefined;
  readonly posture: SurfacePosture;
  readonly requestId: string;
  readonly surface: PermitExtractionInput['surface'];
  /** Name recorded as the admission's `by` for verified permits. */
  readonly verifierName?: string | undefined;
  readonly verify?: PermitVerifier | undefined;
}

/**
 * Collect every scope declared by any trail on the resolved topo.
 *
 * The synthetic permit must satisfy every permit-protected trail the user
 * might invoke; `findMissingScopes` matches literally, so the permit
 * enumerates the union of declared scopes. Trails on a mounted topo do not
 * contribute.
 */
export const collectDeclaredScopes = (graph: Topo): readonly string[] => {
  const scopes = new Set<string>();
  for (const trail of graph.list()) {
    const requirement = trail.permit;
    if (requirement === undefined || requirement === 'public') {
      continue;
    }
    for (const scope of requirement.scopes) {
      scopes.add(scope);
    }
  }
  return [...scopes];
};

/**
 * The asserted-kinds policy in force: explicit, or derived from the topo.
 *
 * @example
 * const policy = deriveAssertedKindsPolicy(graph);
 * // { allow: true, name: 'derived:no-auth-resource' } when no auth resource exists
 */
export const deriveAssertedKindsPolicy = (
  graph: Topo,
  explicit?: AssertedKindsPolicy | undefined
): AssertedKindsPolicy => {
  if (explicit !== undefined) {
    return { ...explicit, name: explicit.name || 'host-policy' };
  }
  const hasVerifier = graph.getResource(AUTH_RESOURCE_ID) !== undefined;
  return hasVerifier
    ? { allow: false, name: 'derived:auth-resource-declared' }
    : { allow: true, name: 'derived:no-auth-resource' };
};

const CREDENTIAL_HEADERS = ['authorization', 'x-api-key', 'x-auth-token'];

/**
 * Whether the surface found a credential: an explicit value, or raw headers
 * carrying a recognized credential header a verifier would select from.
 */
const presentsCredential = (candidate: CredentialCandidate): boolean =>
  [
    candidate.bearerToken,
    candidate.apiKey,
    candidate.authToken,
    candidate.authorization,
  ].some((value) => value !== undefined && value.length > 0) ||
  CREDENTIAL_HEADERS.some((name) => {
    const value = candidate.headers?.get(name);
    return value !== null && value !== undefined && value.length > 0;
  });

const capScopes = (
  scopes: readonly string[],
  policy: AssertedKindsPolicy
): readonly string[] =>
  policy.maxScopes === undefined
    ? scopes
    : scopes.filter((scope) => policy.maxScopes?.includes(scope));

/** An asserted kind never carries a verified actor; the host label stays asserted. */
const assertedActors = (
  authored: readonly PermitActor[],
  actor: PermitActor | undefined
): readonly PermitActor[] => {
  const chain = authored.length > 0 || actor === undefined ? authored : [actor];
  return chain.map((entry) => ({ ...entry, verified: false }));
};

const admitAsserted = (
  options: ReconcilePermitOptions,
  label: string,
  build: (policy: AssertedKindsPolicy) => BasePermit
): Result<BasePermit, Error> => {
  if (options.posture === 'network') {
    return Result.err(
      new AuthError(
        `${label} is an asserted credential kind and is refused on a network surface; present a verifiable credential instead.`,
        { context: { code: 'asserted_kind_refused', label } }
      )
    );
  }
  const policy = deriveAssertedKindsPolicy(options.graph, options.policy);
  if (!policy.allow) {
    return Result.err(
      new AuthError(
        `${label} is disabled by host policy (${policy.name ?? 'host-policy'}); this app declares an auth resource, so enable asserted kinds explicitly with a maximum grant or present a verifiable credential.`,
        { context: { code: 'asserted_kind_disabled', label } }
      )
    );
  }
  return Result.ok(build(policy));
};

const toExtractionInput = (
  credential: CredentialCandidate,
  options: Pick<ReconcilePermitOptions, 'requestId' | 'surface'>
): PermitExtractionInput => ({
  ...(credential.apiKey === undefined ? {} : { apiKey: credential.apiKey }),
  ...(credential.authToken === undefined
    ? {}
    : { authToken: credential.authToken }),
  ...(credential.authorization === undefined
    ? {}
    : { authorization: credential.authorization }),
  ...(credential.bearerToken === undefined
    ? {}
    : { bearerToken: credential.bearerToken }),
  ...(credential.headers === undefined ? {} : { headers: credential.headers }),
  requestId: options.requestId,
  ...(credential.sessionId === undefined
    ? {}
    : { sessionId: credential.sessionId }),
  surface: options.surface,
});

/** Verify a presented credential, or refuse it when nobody can. */
const admitCredential = async (
  options: ReconcilePermitOptions,
  credential: CredentialCandidate
): Promise<Result<BasePermit | undefined, Error>> => {
  if (options.verify === undefined) {
    const message =
      options.missingVerifierMessage ??
      `${credential.label} was presented but this surface has no permit verifier; configure one.`;
    return Result.err(
      options.posture === 'network'
        ? new AuthError(message, { context: { code: 'no_permit_resolver' } })
        : new ValidationError(message, {
            context: { code: 'no_permit_resolver' },
          })
    );
  }
  const verified = await options.verify(toExtractionInput(credential, options));
  if (verified.isErr()) {
    return verified;
  }
  if (verified.value === null) {
    // The verifier owns selection: null means no accepted credential was
    // selected, which is absence on every posture (an adapter that wants a
    // presented credential refused returns an error instead).
    return Result.ok();
  }
  return Result.ok({
    ...verified.value,
    admission: { by: options.verifierName ?? 'verifier', kind: 'verified' },
  });
};

/**
 * Reconcile a surface's candidates into one permit, or none.
 *
 * - No candidate: `Result.ok(undefined)`. The surface decides what absence
 *   means (an in-process host keeps its seed; a network surface is anonymous).
 * - More than one candidate: `ValidationError`, naming the labels.
 * - A presented credential with no verifier: `ValidationError` in process,
 *   `AuthError` (`no_permit_resolver`) on the network.
 * - A verifier runs whenever the surface supplied a credential candidate, even
 *   an empty one, because the verifier owns selection. Its `null` means it
 *   selected no credential, which is absence; a verifier that wants a
 *   presented credential refused returns an error. Surfaces whose verifier
 *   never answers `null` for a presented token (the CLI's
 *   `resolvePermitFromToken` returns a permit or an error) therefore never
 *   fall back to a host seed on a declined token.
 * - `inline` and `synthetic` are refused on the network and gated by host
 *   policy in process; what they admit carries `asserted` or `synthetic`
 *   admission and an unverified actor chain.
 *
 * @example
 * const result = await reconcilePermit({
 *   candidates: { credential: { bearerToken: token, label: '--token' } },
 *   graph,
 *   posture: 'in-process',
 *   requestId,
 *   surface: 'cli',
 *   verify: (input) => resolvePermitFromInput({ ...input, graph }),
 * });
 */
export const reconcilePermit = async (
  options: ReconcilePermitOptions
): Promise<Result<BasePermit | undefined, Error>> => {
  const { candidates } = options;
  const { credential } = candidates;
  const credentialPresented =
    credential !== undefined && presentsCredential(credential);
  const presented = [
    candidates.inline?.label,
    credentialPresented ? credential.label : undefined,
    candidates.synthetic?.label,
  ].filter((label): label is string => label !== undefined);
  if (presented.length > 1) {
    return Result.err(
      new ValidationError(
        `${presented.join(', ')} are mutually exclusive; pass only one.`,
        { context: { code: 'permit_candidates_conflict', labels: presented } }
      )
    );
  }

  if (candidates.synthetic !== undefined) {
    const { label } = candidates.synthetic;
    return admitAsserted(options, label, (policy) => ({
      actors: assertedActors([], options.actor),
      admission: { by: policy.name ?? 'host-policy', kind: 'synthetic' },
      id: SYNTHETIC_PERMIT_ID,
      scopes: capScopes(collectDeclaredScopes(options.graph), policy),
    }));
  }

  if (candidates.inline !== undefined) {
    const { label, permit } = candidates.inline;
    return admitAsserted(options, label, (policy) => ({
      ...permit,
      actors: assertedActors(permit.actors, options.actor),
      admission: { by: policy.name ?? 'host-policy', kind: 'asserted' },
      scopes: capScopes(permit.scopes, policy),
    }));
  }

  // A verifier owns credential selection (cookies, custom headers), so it
  // runs whenever the surface supplied a candidate at all; without one, only
  // an explicitly presented credential is an error.
  if (
    credential === undefined ||
    (options.verify === undefined && !credentialPresented)
  ) {
    return Result.ok();
  }
  return await admitCredential(options, credential);
};
