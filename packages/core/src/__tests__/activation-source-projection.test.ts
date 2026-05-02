import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  activationSourceDeclarationSignature,
  projectActivationSourceDeclaration,
} from '../activation-source-projection.js';
import { Result } from '../result.js';

describe('activation source projection', () => {
  test('canonicalizes webhook paths in declaration signatures', () => {
    const source = {
      id: 'billing.payment-received',
      kind: 'webhook' as const,
      method: 'post' as const,
      parse: z.object({ paymentId: z.string() }),
      path: ' /webhooks/payment ',
    };

    expect(projectActivationSourceDeclaration(source)).toMatchObject({
      method: 'POST',
      path: '/webhooks/payment',
    });
    expect(activationSourceDeclarationSignature(source)).toContain(
      '"path":"/webhooks/payment"'
    );
  });

  describe('verifier identity in signatures', () => {
    const baseSpec = () => ({
      id: 'billing.payment-received',
      kind: 'webhook' as const,
      method: 'POST' as const,
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
    });

    test('the same verifier reference yields the same signature', () => {
      const verify = () => Result.ok();
      const left = { ...baseSpec(), verify };
      const right = { ...baseSpec(), verify };

      expect(activationSourceDeclarationSignature(left)).toBe(
        activationSourceDeclarationSignature(right)
      );
    });

    test('different verifier functions yield different signatures', () => {
      const left = {
        ...baseSpec(),
        verify: () => Result.ok(),
      };
      const right = {
        ...baseSpec(),
        verify: () => Result.ok(),
      };

      expect(activationSourceDeclarationSignature(left)).not.toBe(
        activationSourceDeclarationSignature(right)
      );
    });

    test('an absent verifier compared with a present one yields different signatures', () => {
      const without = baseSpec();
      const withVerify = { ...baseSpec(), verify: () => Result.ok() };

      expect(activationSourceDeclarationSignature(without)).not.toBe(
        activationSourceDeclarationSignature(withVerify)
      );
    });

    test('the persisted projection does not include verifier identity', () => {
      const verify = () => Result.ok();
      const source = { ...baseSpec(), verify };

      const projection = projectActivationSourceDeclaration(source);
      const serialized = JSON.stringify(projection);

      // The projection records verify as a stable boolean marker, not as a
      // function reference or per-process identity token.
      expect(projection).toMatchObject({ hasVerify: true });
      expect(serialized).not.toContain('verify#');
      expect(serialized).not.toContain('[Function');
      // No reference identity leaks: a fresh projection of an equivalent
      // source must serialize identically.
      const equivalent = { ...baseSpec(), verify };
      expect(
        JSON.stringify(projectActivationSourceDeclaration(equivalent))
      ).toBe(serialized);
    });

    test('the persisted projection is stable across distinct verifier functions', () => {
      const left = { ...baseSpec(), verify: () => Result.ok() };
      const right = { ...baseSpec(), verify: () => Result.ok() };

      // Even though the verifier identities differ, the persisted projection
      // must be byte-identical so topo-store output remains deterministic.
      expect(JSON.stringify(projectActivationSourceDeclaration(left))).toBe(
        JSON.stringify(projectActivationSourceDeclaration(right))
      );
    });
  });
});
