import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  activationSourceDeclarationSignature,
  projectActivationSourceDeclaration,
} from '../activation-source-projection.js';

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
});
