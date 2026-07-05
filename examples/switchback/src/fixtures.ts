import type { Flag } from './model.js';

/**
 * Demo flag definitions. The committed `switchback.flags.json` carries the
 * same data for the file-backed store; a test asserts the two stay in sync.
 * The mock flags resource serves a fresh copy of these, so trail examples
 * evaluate against exactly the data a fresh checkout ships with.
 */
export const fixtureFlags = (): Flag[] => [
  {
    archived: false,
    defaultValue: 'control',
    description: 'New checkout flow rollout',
    enabled: true,
    key: 'checkout-v2',
    kind: 'variant',
    rules: [
      {
        id: 'beta-users',
        serve: { value: 'treatment' },
        when: [{ attribute: 'plan', op: 'eq', value: 'beta' }],
      },
      {
        id: 'gradual-rollout',
        serve: {
          split: [
            { value: 'treatment', weight: 20 },
            { value: 'control', weight: 80 },
          ],
        },
        when: [],
      },
    ],
    variants: ['control', 'treatment'],
  },
  {
    archived: false,
    defaultValue: false,
    description: 'Dark mode for paid plans, half rollout for everyone else',
    enabled: true,
    key: 'dark-mode',
    kind: 'boolean',
    rules: [
      {
        id: 'paid-plans',
        serve: { value: true },
        when: [{ attribute: 'plan', op: 'in', value: ['pro', 'team'] }],
      },
      {
        id: 'half-rollout',
        serve: {
          split: [
            { value: true, weight: 50 },
            { value: false, weight: 50 },
          ],
        },
        when: [],
      },
    ],
  },
  {
    archived: false,
    defaultValue: false,
    description: 'Guided onboarding checklist (not yet enabled)',
    enabled: false,
    key: 'new-onboarding',
    kind: 'boolean',
    rules: [{ id: 'everyone', serve: { value: true }, when: [] }],
  },
  {
    archived: true,
    defaultValue: true,
    description: 'Retired promo banner',
    enabled: true,
    key: 'legacy-banner',
    kind: 'boolean',
    rules: [],
  },
];
