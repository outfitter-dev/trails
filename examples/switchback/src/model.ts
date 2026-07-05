import { z } from 'zod';

/**
 * Domain model for switchback feature flags.
 *
 * A flag is either boolean-kind (serves `true`/`false`) or variant-kind
 * (serves one of its named variants). Ordered rules decide what a flag serves
 * for a given evaluation context; the first rule whose conditions all match
 * wins. A rule serves either a fixed value or a percentage split resolved by
 * a deterministic seeded hash (see `engine.ts`).
 */

export const conditionOps = ['eq', 'neq', 'in', 'gte', 'lte'] as const;

/** A single attribute check inside a rule's `when` clause. */
export const conditionSchema = z.object({
  attribute: z
    .string()
    .min(1)
    .describe('Attribute name to inspect on the evaluation context'),
  op: z.enum(conditionOps).describe('Comparison operator'),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number()])),
    ])
    .describe(
      'Value to compare against; an array is required for the "in" operator'
    ),
});

/** A flag value a rule or default can serve. */
export const flagValueSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .describe(
    'Value a flag serves; boolean flags serve booleans, variant flags serve variant names'
  );

/** One weighted arm of a percentage split. Weights must total 100. */
export const splitArmSchema = z.object({
  value: flagValueSchema.describe(
    'Value served when the subject buckets into this arm'
  ),
  weight: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('Share of the 0-99 bucket range, out of 100'),
});

/** What a matched rule serves: a fixed value or a percentage split. */
export const serveSchema = z.union([
  z.object({ value: flagValueSchema.describe('Fixed value to serve') }),
  z.object({
    split: z
      .array(splitArmSchema)
      .min(1)
      .describe('Weighted arms; weights must total 100'),
  }),
]);

/** An ordered rule: all `when` conditions must match for the rule to serve. */
export const ruleSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe('Stable rule identifier, unique within the flag'),
  serve: serveSchema.describe('What to serve when the rule matches'),
  when: z
    .array(conditionSchema)
    .describe('Conditions that must all match for this rule to apply'),
});

/** A feature flag definition. */
export const flagSchema = z.object({
  archived: z
    .boolean()
    .describe('Archived flags are hidden and cannot be evaluated'),
  defaultValue: flagValueSchema.describe(
    'Value served when disabled or when no rule matches'
  ),
  description: z.string().describe('What the flag controls'),
  enabled: z
    .boolean()
    .describe('Disabled flags always serve the default value'),
  key: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case key')
    .describe('Unique kebab-case flag key'),
  kind: z
    .enum(['boolean', 'variant'])
    .describe('boolean serves true/false; variant serves a named variant'),
  rules: z.array(ruleSchema).describe('Ordered rules; first full match wins'),
  variants: z
    .array(z.string().min(1))
    .optional()
    .describe('Allowed variant names (variant-kind flags only)'),
});

/** The context a flag is evaluated against. */
export const evalContextSchema = z.object({
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({})
    .describe('Attributes rules can match on (e.g. plan, region)'),
  subjectId: z
    .string()
    .min(1)
    .describe('Stable subject identifier used for percentage bucketing'),
});

/** One entry in the rule-by-rule evaluation trace. */
export const traceStepSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z
      .literal('matched')
      .describe('All conditions matched; the rule served a fixed value'),
    ruleId: z.string().describe('Rule that was inspected'),
  }),
  z.object({
    detail: z.string().describe('Which condition failed and why'),
    outcome: z
      .literal('skipped')
      .describe('A condition failed; the rule did not apply'),
    ruleId: z.string().describe('Rule that was inspected'),
  }),
  z.object({
    bucket: z
      .number()
      .int()
      .min(0)
      .max(99)
      .describe('Deterministic bucket for flagKey + subjectId'),
    outcome: z
      .literal('percentage')
      .describe('The rule matched and resolved through a split'),
    ruleId: z.string().describe('Rule that was inspected'),
    served: flagValueSchema.describe('Value the bucket landed on'),
  }),
]);

/** Why an evaluation produced its value: terminal reason plus the rule trace. */
export const evalTraceSchema = z.object({
  reason: z
    .enum(['rule-match', 'percentage-rollout', 'no-rule-match', 'disabled'])
    .describe('Terminal reason the served value was chosen'),
  steps: z.array(traceStepSchema).describe('Ordered rule-by-rule outcomes'),
});

/** Result of evaluating one flag. */
export const evaluationSchema = z.object({
  key: flagSchema.shape.key,
  reason: evalTraceSchema.describe('Rule-by-rule explanation of the outcome'),
  value: flagValueSchema.describe('The served value'),
  variant: z
    .string()
    .optional()
    .describe('Variant name when the flag is variant-kind'),
});

export type Condition = z.infer<typeof conditionSchema>;
export type FlagValue = z.infer<typeof flagValueSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Flag = z.infer<typeof flagSchema>;
export type EvalContext = z.infer<typeof evalContextSchema>;
export type TraceStep = z.infer<typeof traceStepSchema>;
export type EvalTrace = z.infer<typeof evalTraceSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
