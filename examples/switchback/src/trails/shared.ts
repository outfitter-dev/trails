import { NotFoundError, Result, ValidationError } from '@ontrails/core';

import type { FlagStore } from '../resources/flags.js';
import type { Flag, FlagValue } from '../model.js';

/**
 * Load a flag that trails may act on. Archived flags are retired: they are
 * invisible to evaluation and mutation, so they resolve as not found.
 */
export const requireLiveFlag = async (
  store: FlagStore,
  key: string
): Promise<Result<Flag, NotFoundError>> => {
  const flag = await store.get(key);
  if (!flag || flag.archived) {
    return Result.err(new NotFoundError(`Flag "${key}" not found`));
  }
  return Result.ok(flag);
};

const servable = (flag: Flag, value: FlagValue): boolean =>
  flag.kind === 'boolean'
    ? typeof value === 'boolean'
    : typeof value === 'string' && (flag.variants ?? []).includes(value);

/**
 * Cross-field invariants the schema alone cannot express: variant coverage,
 * servable values, unique rule ids, and split weights totaling 100.
 */
export const validateFlagInvariants = (
  flag: Flag
): Result<Flag, ValidationError> => {
  const fail = (message: string) =>
    Result.err(new ValidationError(`Flag "${flag.key}": ${message}`));

  if (flag.kind === 'variant' && (flag.variants?.length ?? 0) === 0) {
    return fail('variant flags must declare at least one variant');
  }
  if (flag.kind === 'boolean' && flag.variants !== undefined) {
    return fail('boolean flags must not declare variants');
  }
  if (!servable(flag, flag.defaultValue)) {
    return fail(
      `default value ${JSON.stringify(flag.defaultValue)} is not servable for this flag`
    );
  }

  const seen = new Set<string>();
  for (const rule of flag.rules) {
    if (seen.has(rule.id)) {
      return fail(`duplicate rule id "${rule.id}"`);
    }
    seen.add(rule.id);
    if ('value' in rule.serve) {
      if (!servable(flag, rule.serve.value)) {
        return fail(
          `rule "${rule.id}" serves ${JSON.stringify(rule.serve.value)}, which is not servable for this flag`
        );
      }
      continue;
    }
    const total = rule.serve.split.reduce((sum, arm) => sum + arm.weight, 0);
    if (total !== 100) {
      return fail(
        `rule "${rule.id}" split weights total ${total}, expected 100`
      );
    }
    for (const arm of rule.serve.split) {
      if (!servable(flag, arm.value)) {
        return fail(
          `rule "${rule.id}" split serves ${JSON.stringify(arm.value)}, which is not servable for this flag`
        );
      }
    }
  }
  return Result.ok(flag);
};
