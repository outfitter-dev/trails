import {
  AlreadyExistsError,
  NotFoundError,
  Result,
  ValidationError,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { flagSchema, ruleSchema } from '../model.js';
import type { Flag, Rule } from '../model.js';
import { flagsResource } from '../resources/flags.js';
import { requireLiveFlag, validateFlagInvariants } from './shared.js';

const withRules = (flag: Flag, rules: readonly Rule[]): Flag => ({
  ...flag,
  rules: [...rules],
});

export const add = trail('rule.add', {
  description:
    'Add an ordered rule to a flag; earlier rules win, so position matters',
  examples: [
    {
      description: 'Insert at position 0 so the new rule is checked first',
      expected: {
        archived: false,
        defaultValue: false,
        description: 'Guided onboarding checklist (not yet enabled)',
        enabled: false,
        key: 'new-onboarding',
        kind: 'boolean',
        rules: [
          {
            id: 'pro-users',
            serve: { value: true },
            when: [{ attribute: 'plan', op: 'eq', value: 'pro' }],
          },
          { id: 'everyone', serve: { value: true }, when: [] },
        ],
      },
      input: {
        key: 'new-onboarding',
        position: 0,
        rule: {
          id: 'pro-users',
          serve: { value: true },
          when: [{ attribute: 'plan', op: 'eq', value: 'pro' }],
        },
      },
      name: 'Add a targeting rule first',
    },
    {
      description: 'Rule ids are unique within a flag',
      error: 'AlreadyExistsError',
      input: {
        key: 'new-onboarding',
        rule: { id: 'everyone', serve: { value: false }, when: [] },
      },
      name: 'Duplicate rule id conflicts',
    },
    {
      description: 'Served values must fit the flag kind and variants',
      error: 'ValidationError',
      input: {
        key: 'dark-mode',
        rule: { id: 'bad-serve', serve: { value: 'blue' }, when: [] },
      },
      name: 'Unservable value is rejected',
    },
  ],
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    const existing = await requireLiveFlag(store, input.key);
    if (existing.isErr()) {
      return existing;
    }
    const flag = existing.value;
    if (flag.rules.some((rule) => rule.id === input.rule.id)) {
      return Result.err(
        new AlreadyExistsError(
          `Rule "${input.rule.id}" already exists on flag "${flag.key}"`
        )
      );
    }
    const position = Math.min(
      input.position ?? flag.rules.length,
      flag.rules.length
    );
    const rules = [...flag.rules];
    rules.splice(position, 0, input.rule);
    const valid = validateFlagInvariants(withRules(flag, rules));
    if (valid.isErr()) {
      return valid;
    }
    await store.put(valid.value);
    return Result.ok(valid.value);
  },
  input: z.object({
    key: z.string().describe('Flag key to add the rule to'),
    position: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Insertion index; appended when omitted'),
    rule: ruleSchema.describe('The rule to add'),
  }),
  intent: 'write',
  output: flagSchema,
  resources: [flagsResource],
});

export const remove = trail('rule.remove', {
  description: 'Remove a rule from a flag by rule id',
  examples: [
    {
      description: 'Removing the only rule leaves the default serving everyone',
      expected: {
        archived: false,
        defaultValue: false,
        description: 'Guided onboarding checklist (not yet enabled)',
        enabled: false,
        key: 'new-onboarding',
        kind: 'boolean',
        rules: [],
      },
      input: { key: 'new-onboarding', ruleId: 'everyone' },
      name: 'Remove a rule',
    },
    {
      description: 'Unknown rule ids are not found',
      error: 'NotFoundError',
      input: { key: 'new-onboarding', ruleId: 'missing-rule' },
      name: 'Unknown rule is not found',
    },
  ],
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    const existing = await requireLiveFlag(store, input.key);
    if (existing.isErr()) {
      return existing;
    }
    const flag = existing.value;
    if (!flag.rules.some((rule) => rule.id === input.ruleId)) {
      return Result.err(
        new NotFoundError(
          `Rule "${input.ruleId}" not found on flag "${flag.key}"`
        )
      );
    }
    const updated = withRules(
      flag,
      flag.rules.filter((rule) => rule.id !== input.ruleId)
    );
    await store.put(updated);
    return Result.ok(updated);
  },
  input: z.object({
    key: z.string().describe('Flag key to remove the rule from'),
    ruleId: z.string().describe('Rule id to remove'),
  }),
  intent: 'write',
  output: flagSchema,
  resources: [flagsResource],
});

export const reorder = trail('rule.reorder', {
  description:
    'Reorder the rules of a flag; the list must be a permutation of the current rule ids',
  examples: [
    {
      description:
        'Moving the rollout ahead of targeting changes which rule wins',
      expected: {
        archived: false,
        defaultValue: 'control',
        description: 'New checkout flow rollout',
        enabled: true,
        key: 'checkout-v2',
        kind: 'variant',
        rules: [
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
          {
            id: 'beta-users',
            serve: { value: 'treatment' },
            when: [{ attribute: 'plan', op: 'eq', value: 'beta' }],
          },
        ],
        variants: ['control', 'treatment'],
      },
      input: {
        key: 'checkout-v2',
        ruleIds: ['gradual-rollout', 'beta-users'],
      },
      name: 'Reorder rules',
    },
    {
      description: 'The new order must mention every current rule exactly once',
      error: 'ValidationError',
      input: { key: 'checkout-v2', ruleIds: ['beta-users'] },
      name: 'Partial order is rejected',
    },
  ],
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    const existing = await requireLiveFlag(store, input.key);
    if (existing.isErr()) {
      return existing;
    }
    const flag = existing.value;
    const current = flag.rules.map((rule) => rule.id);
    const requested = [...input.ruleIds];
    if (
      requested.length !== current.length ||
      [...requested].toSorted().join('\n') !==
        [...current].toSorted().join('\n')
    ) {
      return Result.err(
        new ValidationError(
          `Rule order for flag "${flag.key}" must be a permutation of [${current.join(', ')}]`
        )
      );
    }
    const byId = new Map(flag.rules.map((rule) => [rule.id, rule]));
    const updated = withRules(
      flag,
      requested.map((id) => byId.get(id) as Rule)
    );
    await store.put(updated);
    return Result.ok(updated);
  },
  input: z.object({
    key: z.string().describe('Flag key to reorder rules on'),
    ruleIds: z
      .array(z.string())
      .min(1)
      .describe('Complete rule id list in the new order'),
  }),
  intent: 'write',
  output: flagSchema,
  resources: [flagsResource],
});
