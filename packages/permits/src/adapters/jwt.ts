import { Result, isPlainObject } from '@ontrails/core';

import type { AuthAdapter, AuthError } from './adapter.js';
import type { PermitExtractionInput } from '../extraction.js';
import type { Permit } from '../permit.js';
import { verifyIssuerSignature } from './jwt-jwks.js';

/** Configuration for the JWT auth adapter. */
export interface JwtAdapterOptions {
  /** Accepted algorithms (defaults: HS256 with secret; RS256/ES256/EdDSA with issuer). */
  readonly allowedAlgorithms?: readonly JwtAlgorithm[];
  /** Clock skew tolerated for exp/nbf checks, in seconds (default: 60). */
  readonly clockSkewSeconds?: number;
  /** HMAC secret for HS256 verification. */
  readonly secret?: string;
  /** Require exp in secret mode (default: true); issuer mode always requires it. */
  readonly requireExpiration?: boolean;
  /** Explicit trusted JWKS endpoint; otherwise discovered from issuer metadata. */
  readonly jwksUrl?: string;
  /** Expected issuer; without a secret, enables OIDC/JWKS verification. */
  readonly issuer?: string;
  /** Expected audience claim. */
  readonly audience?: string;
  /** Claim containing scopes (default: 'scope'). */
  readonly scopesClaim?: string;
  /** Claim containing roles (default: 'roles'). */
  readonly rolesClaim?: string;
}

/** JWT algorithms this adapter can verify today. */
export type JwtAlgorithm = 'HS256' | 'RS256' | 'ES256' | 'EdDSA';

interface JwtHeader {
  readonly alg?: unknown;
  readonly typ?: unknown;
  readonly kid?: unknown;
  readonly crit?: unknown;
  readonly b64?: unknown;
  readonly [key: string]: unknown;
}

/** JWT payload with standard claims. */
interface JwtPayload {
  readonly sub?: string;
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly exp?: number | null;
  readonly nbf?: number;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers (defined before callers)
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ALGORITHMS = [
  'HS256',
] as const satisfies readonly JwtAlgorithm[];
const SUPPORTED_JWT_ALGORITHMS = [
  'HS256',
  'RS256',
  'ES256',
  'EdDSA',
] as const satisfies readonly JwtAlgorithm[];
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

const authErr = (
  code: AuthError['code'],
  message: string
): Result<never, AuthError> => Result.err({ code, message });

/** Base64url-decode a string to bytes. */
const base64urlDecode = (input: string): Uint8Array<ArrayBuffer> => {
  const padded = input
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
};

const splitToken = (
  token: string
): readonly [string, string, string] | undefined => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
};

const decodeJsonPart = <T>(part: string): T | undefined => {
  try {
    const json = new TextDecoder().decode(base64urlDecode(part));
    const value: unknown = JSON.parse(json);
    return isPlainObject(value) ? (value as T) : undefined;
  } catch {
    return undefined;
  }
};

const normalizeClockSkewSeconds = (options: JwtAdapterOptions): number => {
  const raw = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const value = Math.floor(raw);
  return Number.isFinite(value)
    ? Math.max(0, value)
    : DEFAULT_CLOCK_SKEW_SECONDS;
};

const allowedAlgorithms = (
  options: JwtAdapterOptions
): readonly JwtAlgorithm[] =>
  options.allowedAlgorithms ??
  (options.secret ? DEFAULT_ALLOWED_ALGORITHMS : ['RS256', 'ES256', 'EdDSA']);

const isSupportedJwtAlgorithm = (
  algorithm: string
): algorithm is JwtAlgorithm =>
  (SUPPORTED_JWT_ALGORITHMS as readonly string[]).includes(algorithm);

const validateHeader = (
  header: JwtHeader,
  options: JwtAdapterOptions
): Result<JwtAlgorithm, AuthError> => {
  if (
    header.crit !== undefined ||
    header.b64 !== undefined ||
    header.typ === 'dpop+jwt'
  ) {
    return authErr(
      'invalid_token',
      'Unsupported JWT header extension or DPoP proof'
    );
  }
  if (header.kid !== undefined && typeof header.kid !== 'string') {
    return authErr('invalid_token', 'Invalid JWT kid header');
  }
  if (typeof header.alg !== 'string') {
    return authErr('invalid_token', 'Missing JWT alg header');
  }
  if (!isSupportedJwtAlgorithm(header.alg)) {
    return authErr('invalid_token', 'Unsupported JWT alg header');
  }
  if (
    (options.secret && header.alg !== 'HS256') ||
    (!options.secret && header.alg === 'HS256')
  ) {
    return authErr(
      'invalid_token',
      'JWT algorithm does not match verification mode'
    );
  }
  const configuredAlgorithms = allowedAlgorithms(options);
  if (configuredAlgorithms.length === 0) {
    return authErr(
      'invalid_token',
      'JWT allowedAlgorithms must include at least one algorithm'
    );
  }
  if (!configuredAlgorithms.includes(header.alg)) {
    return authErr('invalid_token', 'Unsupported JWT alg header');
  }
  return Result.ok(header.alg);
};

/** Import a secret as an HMAC CryptoKey. */
const importHmacKey = (secret: string): Promise<CryptoKey> => {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['verify']
  );
};

/** Verify the HMAC-SHA256 signature of a JWT. */
const verifyHmacSignature = (
  token: string,
  key: CryptoKey
): Promise<boolean> => {
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) {
    return Promise.resolve(false);
  }
  const data = token.slice(0, lastDot);
  const signature = base64urlDecode(token.slice(lastDot + 1));
  const encoder = new TextEncoder();
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature.buffer as ArrayBuffer,
    encoder.encode(data)
  );
};

/** Validate standard claims (exp, iss, aud). */
const validateClaims = (
  payload: JwtPayload,
  options: JwtAdapterOptions
): AuthError | undefined => {
  const now = Math.floor(Date.now() / 1000);
  const skew = normalizeClockSkewSeconds(options);
  const hasExpirationClaim = payload.exp !== undefined && payload.exp !== null;
  if (
    !hasExpirationClaim &&
    (!options.secret || options.requireExpiration !== false)
  ) {
    return { code: 'invalid_token', message: 'Missing expiration claim (exp)' };
  }
  if (
    payload.exp !== undefined &&
    (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp))
  ) {
    return { code: 'invalid_token', message: 'Invalid expiration claim (exp)' };
  }
  if (
    payload.exp !== undefined &&
    payload.exp !== null &&
    payload.exp <= now - skew
  ) {
    return { code: 'expired_token', message: 'Token has expired' };
  }
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) {
      return {
        code: 'invalid_token',
        message: 'Invalid not-before claim (nbf)',
      };
    }
    if (payload.nbf > now + skew) {
      return { code: 'invalid_token', message: 'Token is not valid yet' };
    }
  }
  if (options.issuer && payload.iss !== options.issuer) {
    return { code: 'invalid_token', message: 'Issuer mismatch' };
  }
  if (options.audience) {
    const { aud } = payload;
    const matches = Array.isArray(aud)
      ? aud.includes(options.audience)
      : aud === options.audience;
    if (!matches) {
      return { code: 'invalid_token', message: 'Audience mismatch' };
    }
  }
  return undefined;
};

/** Extract scopes from a payload claim (space-separated string or array). */
const extractScopes = (
  payload: JwtPayload,
  claim: string
): readonly string[] => {
  const raw = payload[claim];
  if (typeof raw === 'string') {
    return raw.split(' ').filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.filter(
      (s): s is string => typeof s === 'string' && s.length > 0
    );
  }
  return [];
};

/** Extract roles from a payload claim (string array). */
const extractRoles = (
  payload: JwtPayload,
  claim: string
): readonly string[] | undefined => {
  const raw = payload[claim];
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.filter((r): r is string => typeof r === 'string');
};

/** Build a Permit from a validated JWT payload. */
const buildPermit = (
  payload: JwtPayload,
  options: JwtAdapterOptions
): Result<Permit, AuthError> => {
  if (typeof payload.sub !== 'string' || !payload.sub) {
    return authErr('invalid_token', 'Missing subject claim (sub)');
  }
  const roles = extractRoles(payload, options.rolesClaim ?? 'roles');
  return Result.ok({
    id: payload.sub,
    scopes: extractScopes(payload, options.scopesClaim ?? 'scope'),
    ...(roles ? { roles } : {}),
  });
};

/** Verify the signature and return the decoded payload, or an error. */
const decodeAndVerify = async (
  token: string,
  options: JwtAdapterOptions
): Promise<Result<JwtPayload, AuthError>> => {
  const parts = splitToken(token);
  if (!parts) {
    return authErr('invalid_token', 'Malformed JWT');
  }
  const [rawHeader, rawPayload] = parts;
  const header = decodeJsonPart<JwtHeader>(rawHeader);
  if (!header) {
    return authErr('invalid_token', 'Malformed JWT header');
  }
  const headerResult = validateHeader(header, options);
  if (headerResult.isErr()) {
    return headerResult;
  }
  const payload = decodeJsonPart<JwtPayload>(rawPayload);
  if (!payload) {
    return authErr('invalid_token', 'Malformed JWT');
  }
  try {
    const algorithm = headerResult.value;
    const valid =
      algorithm === 'HS256'
        ? await verifyHmacSignature(
            token,
            await importHmacKey(options.secret ?? '')
          )
        : await verifyIssuerSignature(
            options.issuer ?? '',
            options.jwksUrl,
            algorithm,
            typeof header.kid === 'string' ? header.kid : undefined,
            new TextEncoder().encode(token.slice(0, token.lastIndexOf('.'))),
            base64urlDecode(parts[2])
          );
    return valid
      ? Result.ok(payload)
      : authErr('invalid_token', 'Invalid signature');
  } catch {
    return authErr(
      'invalid_token',
      'Unable to verify token signature or issuer keys'
    );
  }
};

/** Validate claims and build a permit from a verified payload. */
const payloadToPermit = (
  payload: JwtPayload,
  options: JwtAdapterOptions
): Result<Permit, AuthError> => {
  if (Object.hasOwn(payload, 'cnf')) {
    return authErr(
      'invalid_token',
      'Sender-constrained tokens require proof verification'
    );
  }
  const claimError = validateClaims(payload, options);
  if (claimError) {
    return Result.err(claimError);
  }
  return buildPermit(payload, options);
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a JWT auth adapter using native WebCrypto.
 *
 * A secret selects HS256 with optional issuer/audience checks. Without a
 * secret, issuer and audience are required for RS256/ES256/EdDSA verification.
 * Discovery and public keys are cached across adapter instances for five minutes;
 * unknown key IDs can refresh keys once per 30 seconds. No credentials returns
 * `Result.ok(null)`. Sender-constrained tokens require a different adapter.
 *
 * @example
 * ```typescript
 * const adapter = createJwtAdapter({ issuer: 'https://auth.example', audience: 'my-api' });
 * ```
 */
export const createJwtAdapter = (options: JwtAdapterOptions): AuthAdapter => {
  const authenticate = async (
    input: PermitExtractionInput
  ): Promise<Result<Permit | null, AuthError>> => {
    if (!input.bearerToken) {
      return Result.ok(null);
    }
    if (!options.secret && (!options.issuer || !options.audience)) {
      return authErr(
        'invalid_token',
        'Configure a secret or an issuer and expected audience'
      );
    }
    const decoded = await decodeAndVerify(input.bearerToken, options);
    return decoded.isErr() ? decoded : payloadToPermit(decoded.value, options);
  };

  return { authenticate };
};
