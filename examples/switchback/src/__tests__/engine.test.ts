import { describe, expect, test } from 'bun:test';
import { bucketFor, evaluateFlag } from '../engine.js';
import type { Flag } from '../model.js';

/**
 * Fixed hash vectors: these assert the documented FNV-1a bucketing contract.
 * They must never change — a subject's bucket is stable forever. If one of
 * these fails, the hash implementation drifted; fix the implementation, not
 * the vector.
 */
describe('bucketFor fixed vectors', () => {
  const vectors: [flagKey: string, subjectId: string, bucket: number][] = [
    ['checkout-v2', 'user-1', 7],
    ['checkout-v2', 'user-2', 26],
    ['checkout-v2', 'user-3', 45],
    ['checkout-v2', 'user-42', 10],
    ['new-onboarding', 'user-1', 64],
    ['new-onboarding', 'subject-abc', 10],
    ['dark-mode', 'user-1', 58],
  ];

  test.each(vectors)('%s : %s -> bucket %i', (flagKey, subjectId, bucket) => {
    expect(bucketFor(flagKey, subjectId)).toBe(bucket);
  });

  test('is a pure function of flagKey + subjectId', () => {
    const repeated = Array.from({ length: 5 }, () =>
      bucketFor('checkout-v2', 'user-1')
    );
    expect(repeated).toEqual([7, 7, 7, 7, 7]);
  });

  test('buckets the same subject independently per flag', () => {
    expect(bucketFor('checkout-v2', 'user-1')).not.toBe(
      bucketFor('dark-mode', 'user-1')
    );
  });
});

const rolloutFlag: Flag = {
  archived: false,
  defaultValue: 'control',
  description: 'New checkout flow',
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
};

describe('evaluateFlag', () => {
  test('first matching rule wins and the trace records the skip', () => {
    const evaluation = evaluateFlag(rolloutFlag, {
      attributes: { plan: 'beta' },
      subjectId: 'user-1',
    });
    expect(evaluation.value).toBe('treatment');
    expect(evaluation.variant).toBe('treatment');
    expect(evaluation.reason).toEqual({
      reason: 'rule-match',
      steps: [{ outcome: 'matched', ruleId: 'beta-users' }],
    });
  });

  test('percentage rollout resolves deterministically through the bucket', () => {
    // user-1 buckets to 7 (< 20) -> treatment; user-3 buckets to 45 -> control.
    const treated = evaluateFlag(rolloutFlag, {
      attributes: {},
      subjectId: 'user-1',
    });
    expect(treated.value).toBe('treatment');
    expect(treated.reason).toEqual({
      reason: 'percentage-rollout',
      steps: [
        {
          detail: 'attribute "plan" is missing',
          outcome: 'skipped',
          ruleId: 'beta-users',
        },
        {
          bucket: 7,
          outcome: 'percentage',
          ruleId: 'gradual-rollout',
          served: 'treatment',
        },
      ],
    });

    const control = evaluateFlag(rolloutFlag, {
      attributes: {},
      subjectId: 'user-3',
    });
    expect(control.value).toBe('control');
    expect(control.reason.steps.at(-1)).toEqual({
      bucket: 45,
      outcome: 'percentage',
      ruleId: 'gradual-rollout',
      served: 'control',
    });
  });

  test('disabled flag serves the default with reason disabled and no rule steps', () => {
    const evaluation = evaluateFlag(
      { ...rolloutFlag, enabled: false },
      {
        attributes: { plan: 'beta' },
        subjectId: 'user-1',
      }
    );
    expect(evaluation.value).toBe('control');
    expect(evaluation.reason).toEqual({ reason: 'disabled', steps: [] });
  });

  test('no matching rule serves the default with the full skip trace', () => {
    const gated: Flag = {
      ...rolloutFlag,
      rules: [rolloutFlag.rules[0] as Flag['rules'][number]],
    };
    const evaluation = evaluateFlag(gated, {
      attributes: { plan: 'free' },
      subjectId: 'user-9',
    });
    expect(evaluation.value).toBe('control');
    expect(evaluation.reason.reason).toBe('no-rule-match');
    expect(evaluation.reason.steps).toHaveLength(1);
    expect(evaluation.reason.steps[0]?.outcome).toBe('skipped');
  });

  test('empty rules serve the default', () => {
    const bare: Flag = { ...rolloutFlag, rules: [] };
    const evaluation = evaluateFlag(bare, {
      attributes: {},
      subjectId: 'user-1',
    });
    expect(evaluation.value).toBe('control');
    expect(evaluation.reason).toEqual({ reason: 'no-rule-match', steps: [] });
  });

  test('condition operators: neq, in, gte, lte', () => {
    const flag: Flag = {
      archived: false,
      defaultValue: false,
      description: 'operator coverage',
      enabled: true,
      key: 'ops-check',
      kind: 'boolean',
      rules: [
        {
          id: 'ops',
          serve: { value: true },
          when: [
            { attribute: 'region', op: 'neq', value: 'eu' },
            { attribute: 'plan', op: 'in', value: ['pro', 'team'] },
            { attribute: 'seats', op: 'gte', value: 5 },
            { attribute: 'seats', op: 'lte', value: 500 },
          ],
        },
      ],
    };
    const match = evaluateFlag(flag, {
      attributes: { plan: 'pro', region: 'us', seats: 12 },
      subjectId: 'org-1',
    });
    expect(match.value).toBe(true);

    const miss = evaluateFlag(flag, {
      attributes: { plan: 'pro', region: 'us', seats: 3 },
      subjectId: 'org-2',
    });
    expect(miss.value).toBe(false);
    expect(miss.reason.steps[0]).toEqual({
      detail: 'attribute "seats" = 3 is not gte 5',
      outcome: 'skipped',
      ruleId: 'ops',
    });
  });

  test('boolean-kind flags never report a variant', () => {
    const flag: Flag = {
      archived: false,
      defaultValue: false,
      description: 'dark mode',
      enabled: true,
      key: 'dark-mode',
      kind: 'boolean',
      rules: [{ id: 'all-on', serve: { value: true }, when: [] }],
    };
    const evaluation = evaluateFlag(flag, {
      attributes: {},
      subjectId: 'user-1',
    });
    expect(evaluation.value).toBe(true);
    expect(evaluation.variant).toBeUndefined();
  });
});
