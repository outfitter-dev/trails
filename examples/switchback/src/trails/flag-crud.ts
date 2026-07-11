import {
  AlreadyExistsError,
  NotFoundError,
  Result,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { flagSchema, flagValueSchema, ruleSchema } from '../model.js';
import type { Flag } from '../model.js';
import { flagsResource } from '../resources/flags.js';
import { requireLiveFlag, validateFlagInvariants } from './shared.js';

export const create = trail('flag.create', {
  description: 'Create a new feature flag',
  examples: [
    {
      description: 'Boolean flags default to enabled with no rules',
      expected: {
        archived: false,
        defaultValue: false,
        description: 'Seasonal banner',
        enabled: true,
        key: 'holiday-banner',
        kind: 'boolean',
        rules: [],
      },
      input: {
        defaultValue: false,
        description: 'Seasonal banner',
        key: 'holiday-banner',
        kind: 'boolean',
      },
      name: 'Create a boolean flag',
    },
    {
      description: 'Flag keys are unique, including archived flags',
      error: 'AlreadyExistsError',
      input: {
        defaultValue: false,
        description: 'Duplicate of an existing flag',
        key: 'checkout-v2',
        kind: 'boolean',
      },
      name: 'Duplicate key conflicts',
    },
  ],
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    if (await store.get(input.key)) {
      return Result.err(
        new AlreadyExistsError(`Flag "${input.key}" already exists`)
      );
    }
    const flag: Flag = {
      archived: false,
      defaultValue: input.defaultValue,
      description: input.description,
      enabled: input.enabled,
      key: input.key,
      kind: input.kind,
      rules: input.rules,
      ...(input.variants === undefined ? {} : { variants: input.variants }),
    };
    const valid = validateFlagInvariants(flag);
    if (valid.isErr()) {
      return valid;
    }
    await store.put(flag);
    return Result.ok(flag);
  },
  input: z.object({
    defaultValue: flagValueSchema.describe(
      'Value served when disabled or when no rule matches'
    ),
    description: z.string().describe('What the flag controls'),
    enabled: z.boolean().default(true).describe('Start the flag enabled'),
    key: flagSchema.shape.key,
    kind: flagSchema.shape.kind,
    rules: z.array(ruleSchema).default([]).describe('Initial ordered rules'),
    variants: flagSchema.shape.variants,
  }),
  intent: 'write',
  output: flagSchema,
  resources: [flagsResource],
});

export const list = trail('flag.list', {
  description: 'List flag definitions, sorted by key',
  examples: [
    {
      description: 'Archived flags are hidden by default',
      input: {},
      name: 'List live flags',
    },
    {
      description: 'Pass includeArchived to see retired flags too',
      input: { includeArchived: true },
      name: 'List all flags including archived',
    },
  ],
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    const flags = await store.list();
    return Result.ok({
      flags: flags.filter((flag) => input.includeArchived || !flag.archived),
    });
  },
  input: z.object({
    includeArchived: z
      .boolean()
      .default(false)
      .describe('Include archived flags in the listing'),
  }),
  intent: 'read',
  output: z.object({
    flags: z.array(flagSchema).describe('Flag definitions sorted by key'),
  }),
  resources: [flagsResource],
});

export const get = trail('flag.get', {
  description: 'Show one flag definition by key, including archived flags',
  examples: [
    {
      description: 'The full definition includes the ordered rules',
      expected: {
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
      input: { key: 'dark-mode' },
      name: 'Show a flag definition',
    },
    {
      description: 'Unknown keys are not found',
      error: 'NotFoundError',
      input: { key: 'does-not-exist' },
      name: 'Unknown flag is not found',
    },
  ],
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    const flag = await store.get(input.key);
    if (!flag) {
      return Result.err(new NotFoundError(`Flag "${input.key}" not found`));
    }
    return Result.ok(flag);
  },
  input: z.object({
    key: z.string().describe('Flag key to look up'),
  }),
  intent: 'read',
  output: flagSchema,
  resources: [flagsResource],
});

export const update = trail('flag.update', {
  description: 'Update the description, default value, or variants of a flag',
  examples: [
    {
      description: 'Only the provided fields change',
      input: {
        description: 'Dark mode for every plan',
        key: 'dark-mode',
      },
      name: 'Update a description',
    },
    {
      description: 'Archived and unknown flags cannot be updated',
      error: 'NotFoundError',
      input: { description: 'Bring it back', key: 'legacy-banner' },
      name: 'Archived flag cannot be updated',
    },
  ],
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    const existing = await requireLiveFlag(store, input.key);
    if (existing.isErr()) {
      return existing;
    }
    const updated: Flag = {
      ...existing.value,
      ...(input.defaultValue === undefined
        ? {}
        : { defaultValue: input.defaultValue }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.variants === undefined ? {} : { variants: input.variants }),
    };
    const valid = validateFlagInvariants(updated);
    if (valid.isErr()) {
      return valid;
    }
    await store.put(updated);
    return Result.ok(updated);
  },
  input: z.object({
    defaultValue: flagValueSchema
      .optional()
      .describe('New default value, servable for the flag kind'),
    description: z.string().optional().describe('New description'),
    key: z.string().describe('Flag key to update'),
    variants: flagSchema.shape.variants,
  }),
  intent: 'write',
  output: flagSchema,
  resources: [flagsResource],
});

export const archive = trail('flag.archive', {
  description:
    'Archive a flag: it disappears from evaluation and listings but its definition is kept',
  examples: [
    {
      description: 'Archiving retires the flag without deleting its definition',
      expected: {
        archived: true,
        defaultValue: false,
        description: 'Guided onboarding checklist (not yet enabled)',
        enabled: false,
        key: 'new-onboarding',
        kind: 'boolean',
        rules: [{ id: 'everyone', serve: { value: true }, when: [] }],
      },
      input: { key: 'new-onboarding' },
      name: 'Archive a flag',
    },
  ],
  idempotent: true,
  implementation: async (input, ctx) => {
    const store = flagsResource.from(ctx);
    const flag = await store.get(input.key);
    if (!flag) {
      return Result.err(new NotFoundError(`Flag "${input.key}" not found`));
    }
    if (flag.archived) {
      return Result.ok(flag);
    }
    const archived: Flag = { ...flag, archived: true };
    await store.put(archived);
    return Result.ok(archived);
  },
  input: z.object({
    key: z.string().describe('Flag key to archive'),
  }),
  intent: 'write',
  output: flagSchema,
  resources: [flagsResource],
});
