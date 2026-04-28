import { Result } from '@ontrails/core';

import type { AuthConnector, AuthError } from './connector.js';
import type { PermitExtractionInput } from '../extraction.js';
import type { Permit } from '../permit.js';

/** Configuration for the JWT auth connector. */
export interface JwtConnectorOptions {
  /** Accepted JWT header algorithms (default: ['HS256']). */
  readonly allowedAlgorithms?: readonly JwtAlgorithm[];
  /** Clock skew tolerated for exp/nbf checks, in seconds (default: 60). */
  readonly clockSkewSeconds?: number;
  /** HMAC secret for HS256 verification. */
  readonly secret?: string;
  /** Whether accepted tokens must include exp (default: true). */
  readonly requireExpiration?: boolean;
  /** JWKS endpoint for RS256/ES256 (not yet implemented). */
  readonly jwksUrl?: string;
  /** Expected issuer claim. */
  readonly issuer?: string;
  /** Expected audience claim. */
  readonly audience?: string;
  /** Claim containing scopes (default: 'scope'). */
  readonly scopesClaim?: string;
  /** Claim containing roles (default: 'roles'). */
  readonly rolesClaim?: string;
}

/** JWT algorithms this connector can verify today. */
export type JwtAlgorithm = 'HS256';

interface JwtHeader {
  readonly alg?: unknown;
  readonly typ?: unknown;
  readonly [key: string]: unknown;
}

/** JWT payload with standard claims. */
interface JwtPayload {
  readonly sub?: string;
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly exp?: number;
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
] as const satisfies readonly JwtAlgorithm[];
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

const authErr = (
  code: AuthError['code'],
  message: string
): Result<never, AuthError> => Result.err({ code, message });

/** Base64url-decode a string to bytes. */
const base64urlDecode = (input: string): Uint8Array => {
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
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
};

const normalizeClockSkewSeconds = (options: JwtConnectorOptions): number => {
  const raw = options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const value = Math.floor(raw);
  return Number.isFinite(value)
    ? Math.max(0, value)
    : DEFAULT_CLOCK_SKEW_SECONDS;
};

const allowedAlgorithms = (
  options: JwtConnectorOptions
): readonly JwtAlgorithm[] =>
  options.allowedAlgorithms ?? DEFAULT_ALLOWED_ALGORITHMS;

const isSupportedJwtAlgorithm = (
  algorithm: string
): algorithm is JwtAlgorithm =>
  (SUPPORTED_JWT_ALGORITHMS as readonly string[]).includes(algorithm);

const validateHeader = (
  header: JwtHeader,
  options: JwtConnectorOptions
): Result<JwtAlgorithm, AuthError> => {
  if (typeof header.alg !== 'string') {
    return authErr('invalid_token', 'Missing JWT alg header');
  }
  if (!isSupportedJwtAlgorithm(header.alg)) {
    return authErr('invalid_token', 'Unsupported JWT alg header');
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

const verifyJwtSignature = async (
  token: string,
  secret: string,
  algorithm: JwtAlgorithm
): Promise<boolean> => {
  switch (algorithm) {
    case 'HS256': {
      const key = await importHmacKey(secret);
      return await verifyHmacSignature(token, key);
    }
    default: {
      const exhaustive: never = algorithm;
      void exhaustive;
      return false;
    }
  }
};

/** Validate standard claims (exp, iss, aud). */
const validateClaims = (
  payload: JwtPayload,
  options: JwtConnectorOptions
): AuthError | undefined => {
  const now = Math.floor(Date.now() / 1000);
  const skew = normalizeClockSkewSeconds(options);
  if (payload.exp === undefined && options.requireExpiration !== false) {
    return { code: 'invalid_token', message: 'Missing expiration claim (exp)' };
  }
  if (
    payload.exp !== undefined &&
    (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp))
  ) {
    return { code: 'invalid_token', message: 'Invalid expiration claim (exp)' };
  }
  if (payload.exp !== undefined && payload.exp < now - skew) {
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
  options: JwtConnectorOptions
): Result<Permit, AuthError> => {
  if (!payload.sub) {
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
  secret: string,
  options: JwtConnectorOptions
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
    const valid = await verifyJwtSignature(token, secret, headerResult.value);
    return valid
      ? Result.ok(payload)
      : authErr('invalid_token', 'Invalid signature');
  } catch {
    return authErr('invalid_token', 'Malformed token signature');
  }
};

/** Validate claims and build a permit from a verified payload. */
const payloadToPermit = (
  payload: JwtPayload,
  options: JwtConnectorOptions
): Result<Permit, AuthError> => {
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
 * Create a JWT auth connector using Bun's native crypto.
 *
 * Verifies HS256-signed JWTs, extracts claims into a Permit, and checks
 * issuer/audience when configured. Returns `Result.ok(null)` when no
 * credentials are provided.
 */
export const createJwtConnector = (
  options: JwtConnectorOptions
): AuthConnector => {
  const authenticate = async (
    input: PermitExtractionInput
  ): Promise<Result<Permit | null, AuthError>> => {
    if (!input.bearerToken) {
      return Result.ok(null);
    }
    if (!options.secret) {
      return authErr('invalid_token', 'No secret configured');
    }
    const decoded = await decodeAndVerify(
      input.bearerToken,
      options.secret,
      options
    );
    return decoded.isErr() ? decoded : payloadToPermit(decoded.value, options);
  };

  return { authenticate };
};
