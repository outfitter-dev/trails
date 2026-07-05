/**
 * Webhook signature verification for the three junction source types.
 *
 * Each verifier checks an HMAC-SHA256 signature over the exact raw request
 * body. Comparisons are constant-time so signature checks do not leak
 * timing information about the expected digest.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const endpointSources = ['github', 'stripe', 'generic-hmac'] as const;

export const endpointSourceSchema = z
  .enum(endpointSources)
  .describe('Webhook source type the endpoint verifies against');

export type EndpointSource = (typeof endpointSources)[number];

/** Header carrying the signature, by source type. */
export const signatureHeaderBySource = {
  'generic-hmac': 'x-junction-signature',
  github: 'x-hub-signature-256',
  stripe: 'stripe-signature',
} as const satisfies Record<EndpointSource, string>;

export interface VerifySignatureInput {
  /** Exact raw request body the sender signed. */
  readonly rawBody: string;
  /** Endpoint secret the signature must be derived from. */
  readonly secret: string;
  /** Signature header value for the endpoint's source type. */
  readonly signature: string;
}

const hmacHex = (secret: string, message: string): string =>
  createHmac('sha256', secret).update(message).digest('hex');

const constantTimeEqualsHex = (expected: string, actual: string): boolean => {
  if (!/^[0-9a-f]+$/i.test(actual) || actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(actual.toLowerCase(), 'hex')
  );
};

/** GitHub `X-Hub-Signature-256`: `sha256=<hex HMAC-SHA256(secret, body)>`. */
const verifyGithub = ({
  rawBody,
  secret,
  signature,
}: VerifySignatureInput): boolean => {
  if (!signature.startsWith('sha256=')) {
    return false;
  }
  const provided = signature.slice('sha256='.length);
  return constantTimeEqualsHex(hmacHex(secret, rawBody), provided);
};

/**
 * Stripe `Stripe-Signature`: `t=<timestamp>,v1=<hex HMAC-SHA256(secret,
 * `${timestamp}.${body}`)>`. Multiple `v1` entries may appear during secret
 * rotation; the signature is valid when any of them matches.
 */
const verifyStripe = ({
  rawBody,
  secret,
  signature,
}: VerifySignatureInput): boolean => {
  const parts = signature.split(',').map((part) => part.trim());
  const timestamp = parts
    .find((part) => part.startsWith('t='))
    ?.slice('t='.length);
  if (timestamp === undefined || timestamp.length === 0) {
    return false;
  }
  const expected = hmacHex(secret, `${timestamp}.${rawBody}`);
  return parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice('v1='.length))
    .some((candidate) => constantTimeEqualsHex(expected, candidate));
};

/** Generic `X-Junction-Signature`: `<hex HMAC-SHA256(secret, body)>`. */
const verifyGenericHmac = ({
  rawBody,
  secret,
  signature,
}: VerifySignatureInput): boolean =>
  constantTimeEqualsHex(hmacHex(secret, rawBody), signature);

const verifierBySource = {
  'generic-hmac': verifyGenericHmac,
  github: verifyGithub,
  stripe: verifyStripe,
} as const satisfies Record<
  EndpointSource,
  (input: VerifySignatureInput) => boolean
>;

/**
 * Verify a webhook signature for one endpoint source type.
 *
 * @example
 * ```typescript
 * verifySignature('github', {
 *   rawBody: 'Hello, World!',
 *   secret: "It's a Secret to Everybody",
 *   signature:
 *     'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
 * }); // true
 * ```
 */
export const verifySignature = (
  source: EndpointSource,
  input: VerifySignatureInput
): boolean => verifierBySource[source](input);

/**
 * Compute the signature header value a sender would attach for a source
 * type. Powers the signed-webhook script and test fixtures; the inverse of
 * `verifySignature`.
 */
export const signPayload = (
  source: EndpointSource,
  options: {
    readonly rawBody: string;
    readonly secret: string;
    /** Unix seconds used for Stripe-style timestamped signatures. */
    readonly timestamp?: number;
  }
): string => {
  if (source === 'github') {
    return `sha256=${hmacHex(options.secret, options.rawBody)}`;
  }
  if (source === 'stripe') {
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const digest = hmacHex(options.secret, `${timestamp}.${options.rawBody}`);
    return `t=${timestamp},v1=${digest}`;
  }
  return hmacHex(options.secret, options.rawBody);
};
