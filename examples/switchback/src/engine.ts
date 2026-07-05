import type {
  Condition,
  EvalContext,
  Evaluation,
  Flag,
  FlagValue,
  TraceStep,
} from './model.js';

/**
 * Pure evaluation engine. No clock, no randomness, no I/O — a function of
 * (flag definition, evaluation context) only, so identical inputs produce
 * identical outputs forever.
 *
 * ## Bucketing hash (stable contract — do not change)
 *
 * Percentage rollouts bucket subjects with standard FNV-1a 32-bit over the
 * UTF-8 bytes of `"<flagKey>:<subjectId>"`:
 *
 *   hash = 0x811c9dc5
 *   for each byte b: hash = (hash XOR b) * 0x01000193  (mod 2^32)
 *   bucket = hash mod 100
 *
 * The bucket is stable per flag+subject, so a subject keeps its variant as
 * long as the split stays the same, and different flags bucket the same
 * subject independently. Fixed vectors (asserted in tests, valid forever):
 *
 *   checkout-v2 : user-1  -> bucket 7
 *   checkout-v2 : user-42 -> bucket 10
 *   dark-mode   : user-1  -> bucket 58
 */
export const bucketFor = (flagKey: string, subjectId: string): number => {
  const bytes = new TextEncoder().encode(`${flagKey}:${subjectId}`);
  // FNV offset basis (0x811c9dc5)
  let hash = 2_166_136_261;
  for (const byte of bytes) {
    // oxlint-disable-next-line no-bitwise -- FNV-1a is defined over 32-bit XOR
    hash ^= byte;
    // oxlint-disable-next-line no-bitwise, unicorn/prefer-math-trunc -- `>>> 0` normalizes Math.imul to unsigned 32-bit; Math.trunc is not equivalent
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash % 100;
};

const conditionMatches = (
  condition: Condition,
  context: EvalContext
): { matched: boolean; detail?: string } => {
  const actual = context.attributes[condition.attribute];
  if (actual === undefined) {
    return {
      detail: `attribute "${condition.attribute}" is missing`,
      matched: false,
    };
  }
  const describe = (verdict: boolean, relation: string) =>
    verdict
      ? { matched: true as const }
      : {
          detail: `attribute "${condition.attribute}" = ${JSON.stringify(actual)} is not ${relation} ${JSON.stringify(condition.value)}`,
          matched: false as const,
        };
  if (condition.op === 'eq') {
    return describe(actual === condition.value, 'eq');
  }
  if (condition.op === 'neq') {
    return describe(actual !== condition.value, 'neq');
  }
  if (condition.op === 'in') {
    const allowed = Array.isArray(condition.value)
      ? condition.value
      : [condition.value];
    return describe(
      allowed.some((entry) => entry === actual),
      'in'
    );
  }
  if (condition.op === 'gte') {
    return describe(
      typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual >= condition.value,
      'gte'
    );
  }
  return describe(
    typeof actual === 'number' &&
      typeof condition.value === 'number' &&
      actual <= condition.value,
    'lte'
  );
};

/**
 * Assemble an Evaluation, including `variant` only for variant-kind flags so
 * example `expected` blocks can deep-equal results without undefined noise.
 */
const toEvaluation = (
  flag: Flag,
  value: FlagValue,
  reason: Evaluation['reason']
): Evaluation => {
  const variant =
    flag.kind === 'variant' && typeof value === 'string' ? value : undefined;
  return variant === undefined
    ? { key: flag.key, reason, value }
    : { key: flag.key, reason, value, variant };
};

const resolveSplit = (
  arms: readonly { value: FlagValue; weight: number }[],
  bucket: number
): FlagValue => {
  let upperBound = 0;
  for (const arm of arms) {
    upperBound += arm.weight;
    if (bucket < upperBound) {
      return arm.value;
    }
  }
  // Weights are validated to total 100, so bucket (0-99) always lands above;
  // serve the last arm if a stored definition slipped past validation.
  return arms.at(-1)?.value as FlagValue;
};

/**
 * Evaluate a flag against a context, producing the served value and a
 * rule-by-rule trace explaining why.
 *
 * Semantics: disabled flags serve the default with reason `disabled` and no
 * rules are inspected. Otherwise rules run in order; the first rule whose
 * conditions all match serves either its fixed value (`rule-match`) or a
 * split arm chosen by `bucketFor` (`percentage-rollout`). If no rule
 * matches, the default is served (`no-rule-match`). Archived flags are the
 * caller's concern — the trails treat them as not found.
 */
export const evaluateFlag = (flag: Flag, context: EvalContext): Evaluation => {
  const steps: TraceStep[] = [];

  if (!flag.enabled) {
    return toEvaluation(flag, flag.defaultValue, { reason: 'disabled', steps });
  }

  for (const rule of flag.rules) {
    const failure = rule.when
      .map((condition) => conditionMatches(condition, context))
      .find((verdict) => !verdict.matched);
    if (failure) {
      steps.push({
        detail: failure.detail ?? 'condition failed',
        outcome: 'skipped',
        ruleId: rule.id,
      });
      continue;
    }
    if ('value' in rule.serve) {
      steps.push({ outcome: 'matched', ruleId: rule.id });
      return toEvaluation(flag, rule.serve.value, {
        reason: 'rule-match',
        steps,
      });
    }
    const bucket = bucketFor(flag.key, context.subjectId);
    const served = resolveSplit(rule.serve.split, bucket);
    steps.push({ bucket, outcome: 'percentage', ruleId: rule.id, served });
    return toEvaluation(flag, served, { reason: 'percentage-rollout', steps });
  }

  return toEvaluation(flag, flag.defaultValue, {
    reason: 'no-rule-match',
    steps,
  });
};
