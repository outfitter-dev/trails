import { Result } from '@ontrails/core';

import type { AuthConnector, AuthError } from './connector.js';
import type { PermitExtractionInput } from '../extraction.js';
import type { Permit } from '../permit.js';

/** Configuration for the JWT auth connector. */
export interface JwtConnectorOptions {
  /** HMAC secret for HS256 verification. */
  readonly secret?: string;
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

/** JWT payload with standard claims. */
interface JwtPayload {
  readonly sub?: string;
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly exp?: number;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers (defined before callers)
// ---------------------------------------------------------------------------

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

/** Decode a JWT payload without verifying the signature. */
const decodePayload = (token: string): JwtPayload | undefined => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const json = new TextDecoder().decode(base64urlDecode(parts[1] ?? ''));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return undefined;
  }
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
  options: JwtConnectorOptions
): AuthError | undefined => {
  if (
    payload.exp !== undefined &&
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return { code: 'expired_token', message: 'Token has expired' };
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
  secret: string
): Promise<Result<JwtPayload, AuthError>> => {
  const payload = decodePayload(token);
  if (!payload) {
    return authErr('invalid_token', 'Malformed JWT');
  }
  try {
    const key = await importHmacKey(secret);
    const valid = await verifyHmacSignature(token, key);
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
    const decoded = await decodeAndVerify(input.bearerToken, options.secret);
    return decoded.isErr() ? decoded : payloadToPermit(decoded.value, options);
  };

  return { authenticate };
};
