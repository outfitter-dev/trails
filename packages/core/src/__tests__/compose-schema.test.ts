import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { buildComposeValidationSchema } from '../compose-schema.js';
import { Result } from '../result.js';
import { trail } from '../trail.js';

describe('buildComposeValidationSchema', () => {
  test('preserves authored schema introspection and public input isolation', () => {
    const input = z
      .object({ a: z.string() })
      .strict()
      .refine((value) => value.a !== 'bad');
    const composeInput = z
      .object({ resolver: z.string().optional() })
      .strict()
      .refine((value) => value.resolver !== 'bad');
    const inputShape = input.shape;
    const composeShape = composeInput.shape;
    const target = trail('compose.introspection', {
      composeInput,
      implementation: (value) => Result.ok(value),
      input,
    });
    const schema = buildComposeValidationSchema(target);

    expect(schema?.safeParse({ a: 'a', resolver: 'pattern' })).toEqual({
      data: { a: 'a', resolver: 'pattern' },
      success: true,
    });
    expect(schema?.safeParse({ a: 'bad', resolver: 'pattern' }).success).toBe(
      false
    );
    expect(schema?.safeParse({ a: 'a', resolver: 'bad' }).success).toBe(false);
    expect(target.input).toBe(input);
    expect(target.composeInput).toBe(composeInput);
    expect(input.shape).toBe(inputShape);
    expect(composeInput.shape).toBe(composeShape);
    expect(Object.keys(input.shape)).toEqual(['a']);
    expect(Object.keys(composeInput.shape)).toEqual(['resolver']);
    expect(input.shape.a.safeParse('a').success).toBe(true);
    expect(composeInput.shape.resolver.safeParse().success).toBe(true);
    expect(input.safeParse({ a: 'a' }).success).toBe(true);
    expect(input.safeParse({ a: 'bad' }).success).toBe(false);
    expect(input.safeParse({ a: 'a', resolver: 'pattern' }).success).toBe(
      false
    );
    expect(composeInput.safeParse({ resolver: 'pattern' }).success).toBe(true);
    expect(composeInput.safeParse({ resolver: 'bad' }).success).toBe(false);
    expect(
      composeInput.safeParse({ a: 'a', resolver: 'pattern' }).success
    ).toBe(false);
  });

  test('does not replace normal validation without composeInput', () => {
    const target = trail('compose.public', {
      implementation: (input) => Result.ok(input),
      input: z.object({ a: z.string() }),
    });
    expect(buildComposeValidationSchema(target)).toBeUndefined();
  });

  test('retains the non-object intersection fallback', () => {
    const target = trail('compose.non-object', {
      composeInput: z.string().min(2),
      implementation: (input) => Result.ok(input),
      input: z.string().startsWith('a'),
    });
    const schema = buildComposeValidationSchema(target);
    expect(schema?.safeParse('ab')).toEqual({ data: 'ab', success: true });
    expect(schema?.safeParse('a').success).toBe(false);
    expect(schema?.safeParse('bb').success).toBe(false);
  });

  test('materializes selected defaults and transforms once with right overlap precedence', () => {
    const calls = {
      default: 0,
      leftField: 0,
      leftRule: 0,
      rightField: 0,
      rightRule: 0,
    };
    const input = z
      .object({
        a: z.string().default(() => {
          calls.default += 1;
          return `a${calls.default}`;
        }),
        shared: z.string().transform((value) => {
          calls.leftField += 1;
          return `left:${value}`;
        }),
      })
      .strict()
      .refine((value) => {
        calls.leftRule += 1;
        return value.a === 'a1' && value.shared === 'right:v';
      });
    const composeInput = z
      .object({
        resolver: z.string().default('pattern'),
        shared: z.string().transform((value) => {
          calls.rightField += 1;
          return `right:${value}`;
        }),
      })
      .strict()
      .refine((value) => {
        calls.rightRule += 1;
        return value.shared === 'right:v' && value.resolver === 'pattern';
      });
    const target = trail('compose.effects', {
      composeInput,
      implementation: (value) => Result.ok(value),
      input,
    });

    const parsed = buildComposeValidationSchema(target)?.safeParse({
      shared: 'v',
    });

    expect(parsed).toEqual({
      data: { a: 'a1', resolver: 'pattern', shared: 'right:v' },
      success: true,
    });
    expect(calls).toEqual({
      default: 1,
      leftField: 0,
      leftRule: 1,
      rightField: 1,
      rightRule: 1,
    });
    expect(Object.keys(input.shape).toSorted()).toEqual(['a', 'shared']);
    expect(Object.keys(composeInput.shape).toSorted()).toEqual([
      'resolver',
      'shared',
    ]);
    expect(
      input.safeParse({ a: 'a', resolver: 'pattern', shared: 'v' }).success
    ).toBe(false);
    expect(
      composeInput.safeParse({ a: 'a', resolver: 'pattern', shared: 'v' })
        .success
    ).toBe(false);
  });

  test.each([
    {
      composeInput: z.object({ b: z.string() }).strict(),
      mode: 'strict',
      retained: false,
      success: false,
    },
    {
      composeInput: z.object({ b: z.string() }),
      mode: 'strip',
      retained: false,
      success: true,
    },
    {
      composeInput: z.object({ b: z.string() }).passthrough(),
      mode: 'passthrough',
      retained: true,
      success: true,
    },
    {
      composeInput: z.object({ b: z.string() }).catchall(z.number()),
      mode: 'catchall',
      retained: true,
      success: true,
    },
  ])(
    'retains the right $mode unknown-key policy',
    ({ composeInput, mode, success, retained }) => {
      let leftCalls = 0;
      const target = trail('compose.unknown', {
        composeInput,
        implementation: (input) => Result.ok(input),
        input: z
          .object({ a: z.string() })
          .strict()
          .refine((value) => {
            leftCalls += 1;
            return value.a === 'a';
          }),
      });
      const schema = buildComposeValidationSchema(target);
      const parsed = schema?.safeParse({ a: 'a', b: 'b', extra: 1 });
      expect(parsed?.success).toBe(success);
      if (success) {
        expect(parsed).toEqual({
          data: { a: 'a', b: 'b', ...(retained ? { extra: 1 } : {}) },
          success: true,
        });
        expect(leftCalls).toBe(1);
      }
      if (mode === 'catchall') {
        expect(
          schema?.safeParse({ a: 'a', b: 'b', extra: 'wrong' }).success
        ).toBe(false);
      }
    }
  );
});
