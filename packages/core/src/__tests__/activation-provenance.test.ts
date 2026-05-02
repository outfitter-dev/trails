import { describe, expect, test } from 'bun:test';

import {
  ACTIVATION_PROVENANCE_KEY,
  getActivationProvenance,
} from '../activation-provenance.js';
import type { ActivationProvenance } from '../activation-provenance.js';

describe('activation provenance', () => {
  test('reads valid activation provenance from extensions', () => {
    const activation = {
      fireId: 'fire_1',
      rootFireId: 'fire_1',
      source: {
        id: 'order.placed',
        kind: 'signal',
        producerTrailId: 'order.create',
      },
    };

    expect(
      getActivationProvenance({
        extensions: { [ACTIVATION_PROVENANCE_KEY]: activation },
      })
    ).toEqual(activation);
  });

  test('ignores malformed extension activation provenance', () => {
    expect(
      getActivationProvenance({
        extensions: {
          [ACTIVATION_PROVENANCE_KEY]: {
            fireId: 'fire_1',
            rootFireId: 'fire_1',
            source: { kind: 'signal' },
          },
        },
      })
    ).toBeUndefined();

    expect(
      getActivationProvenance({
        extensions: {
          [ACTIVATION_PROVENANCE_KEY]: {
            fireId: 'fire_1',
            rootFireId: 'fire_1',
            source: {
              id: 'order.placed',
              kind: 'signal',
              meta: 'owner',
            },
          },
        },
      })
    ).toBeUndefined();
  });

  test('falls back to valid extension provenance when direct activation is malformed', () => {
    const activation = {
      fireId: 'fire_2',
      parentFireId: 'fire_1',
      rootFireId: 'fire_1',
      source: {
        id: 'order.placed',
        kind: 'signal',
      },
    };

    expect(
      getActivationProvenance({
        activation: {
          fireId: 'fire_2',
          rootFireId: 'fire_1',
          source: {
            id: 123,
            kind: 'signal',
          },
        } as unknown as ActivationProvenance,
        extensions: { [ACTIVATION_PROVENANCE_KEY]: activation },
      })
    ).toEqual(activation);
  });
});
