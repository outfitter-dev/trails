import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { flagSchema } from '../model.js';
import type { Flag } from '../model.js';
import type { FlagStore } from '../resources/flags.js';
import { flagsResource } from '../resources/flags.js';
import { requireLiveFlag } from './shared.js';

const setEnabled = async (
  store: FlagStore,
  key: string,
  enabled: boolean
): Promise<Result<Flag, Error>> => {
  const existing = await requireLiveFlag(store, key);
  if (existing.isErr()) {
    return existing;
  }
  if (existing.value.enabled === enabled) {
    return existing;
  }
  const updated: Flag = { ...existing.value, enabled };
  await store.put(updated);
  return Result.ok(updated);
};

export const enable = trail('flag.enable', {
  description: 'Enable a flag so its rules apply; idempotent',
  examples: [
    {
      description: 'Enabling a disabled flag lets its rules serve values',
      expected: {
        archived: false,
        defaultValue: false,
        description: 'Guided onboarding checklist (not yet enabled)',
        enabled: true,
        key: 'new-onboarding',
        kind: 'boolean',
        rules: [{ id: 'everyone', serve: { value: true }, when: [] }],
      },
      input: { key: 'new-onboarding' },
      name: 'Enable a flag',
    },
  ],
  idempotent: true,
  implementation: async (input, ctx) =>
    setEnabled(flagsResource.from(ctx), input.key, true),
  input: z.object({
    key: z.string().describe('Flag key to enable'),
  }),
  intent: 'write',
  output: flagSchema,
  resources: [flagsResource],
});

export const disable = trail('flag.disable', {
  description:
    'Disable a flag so it always serves its default value; idempotent',
  examples: [
    {
      description:
        'Disabled flags serve their default with reason "disabled" until re-enabled',
      input: { key: 'checkout-v2' },
      name: 'Disable a flag',
    },
    {
      description: 'Archived flags cannot be toggled',
      error: 'NotFoundError',
      input: { key: 'legacy-banner' },
      name: 'Archived flag cannot be disabled',
    },
  ],
  idempotent: true,
  implementation: async (input, ctx) =>
    setEnabled(flagsResource.from(ctx), input.key, false),
  input: z.object({
    key: z.string().describe('Flag key to disable'),
  }),
  intent: 'write',
  output: flagSchema,
  resources: [flagsResource],
});
