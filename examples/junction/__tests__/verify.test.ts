import { describe, expect, test } from 'bun:test';

import { signPayload, verifySignature } from '../src/verify.js';

/**
 * Real HMAC vectors for all three source types.
 *
 * The GitHub vector is the published example from GitHub's webhook
 * validation docs. The Stripe and generic vectors were computed
 * independently with `node:crypto` HMAC-SHA256 over the documented
 * signing formats.
 */
const vectors = {
  generic: {
    rawBody: '{"event":"ping","ok":true}',
    secret: 'generic_junction_secret',
    signature:
      '4a226af3f20e3c5b45acafa69811a392be579d5ad5e6dfade7285b9a33b08aa8',
  },
  github: {
    rawBody: 'Hello, World!',
    secret: "It's a Secret to Everybody",
    signature:
      'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
  },
  stripe: {
    rawBody: '{"id":"evt_123","type":"payment_intent.succeeded"}',
    secret: 'whsec_test_junction_secret',
    signature:
      't=1751500000,v1=431b963fbb5a3d5152ae923741576fe1503dc213c25473d61487007b001fec54',
    timestamp: 1_751_500_000,
  },
} as const;

describe('verifySignature', () => {
  test('accepts the published GitHub X-Hub-Signature-256 vector', () => {
    expect(verifySignature('github', vectors.github)).toBe(true);
  });

  test('rejects a GitHub signature computed with the wrong secret', () => {
    expect(
      verifySignature('github', { ...vectors.github, secret: 'wrong' })
    ).toBe(false);
  });

  test('rejects a GitHub signature over a tampered body', () => {
    expect(
      verifySignature('github', {
        ...vectors.github,
        rawBody: 'Hello, World!!',
      })
    ).toBe(false);
  });

  test('rejects a GitHub signature missing the sha256= prefix', () => {
    expect(
      verifySignature('github', {
        ...vectors.github,
        signature: vectors.github.signature.slice('sha256='.length),
      })
    ).toBe(false);
  });

  test('accepts the Stripe-Signature vector', () => {
    expect(verifySignature('stripe', vectors.stripe)).toBe(true);
  });

  test('accepts a Stripe signature with rotated v1 candidates', () => {
    const rotated = `t=1751500000,v1=${'0'.repeat(64)},v1=431b963fbb5a3d5152ae923741576fe1503dc213c25473d61487007b001fec54`;
    expect(
      verifySignature('stripe', { ...vectors.stripe, signature: rotated })
    ).toBe(true);
  });

  test('rejects a Stripe signature whose timestamp was altered', () => {
    const altered = vectors.stripe.signature.replace(
      't=1751500000',
      't=1751500001'
    );
    expect(
      verifySignature('stripe', { ...vectors.stripe, signature: altered })
    ).toBe(false);
  });

  test('rejects a Stripe signature without a timestamp component', () => {
    expect(
      verifySignature('stripe', {
        ...vectors.stripe,
        signature:
          'v1=431b963fbb5a3d5152ae923741576fe1503dc213c25473d61487007b001fec54',
      })
    ).toBe(false);
  });

  test('accepts the generic HMAC-SHA256 vector', () => {
    expect(verifySignature('generic-hmac', vectors.generic)).toBe(true);
  });

  test('rejects a generic signature of the wrong length', () => {
    expect(
      verifySignature('generic-hmac', {
        ...vectors.generic,
        signature: vectors.generic.signature.slice(0, 32),
      })
    ).toBe(false);
  });

  test('rejects a generic signature that is not hex', () => {
    expect(
      verifySignature('generic-hmac', {
        ...vectors.generic,
        signature: 'z'.repeat(64),
      })
    ).toBe(false);
  });
});

describe('signPayload', () => {
  test('reproduces the GitHub vector', () => {
    expect(
      signPayload('github', {
        rawBody: vectors.github.rawBody,
        secret: vectors.github.secret,
      })
    ).toBe(vectors.github.signature);
  });

  test('reproduces the Stripe vector at a fixed timestamp', () => {
    expect(
      signPayload('stripe', {
        rawBody: vectors.stripe.rawBody,
        secret: vectors.stripe.secret,
        timestamp: vectors.stripe.timestamp,
      })
    ).toBe(vectors.stripe.signature);
  });

  test('reproduces the generic vector', () => {
    expect(
      signPayload('generic-hmac', {
        rawBody: vectors.generic.rawBody,
        secret: vectors.generic.secret,
      })
    ).toBe(vectors.generic.signature);
  });

  test('round-trips through verifySignature for every source', () => {
    for (const source of ['github', 'stripe', 'generic-hmac'] as const) {
      const rawBody = '{"round":"trip"}';
      const secret = 'round-trip-secret';
      const signature = signPayload(source, { rawBody, secret });
      expect(verifySignature(source, { rawBody, secret, signature })).toBe(
        true
      );
    }
  });
});
