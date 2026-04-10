import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result';
import { trail } from '../trail';
import type {
  CrossInput,
  TrailInput,
  TrailOutput,
  TrailResult,
} from '../type-utils';
import { inputOf, outputOf } from '../type-utils';

const greetTrail = trail('greet', {
  blaze: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
});

const noOutputTrail = trail('ping', {
  blaze: () => Result.ok(),
  input: z.object({}),
});

describe('type-utils', () => {
  describe('inputOf', () => {
    test('returns the Zod input schema and can parse valid input', () => {
      const schema = inputOf(greetTrail);
      const result = schema.safeParse({ name: 'Alice' });
      expect(result.success).toBe(true);
      expect(
        (result as { success: true; data: { name: string } }).data
      ).toEqual({
        name: 'Alice',
      });
    });

    test('preserves specific schema type so .shape is accessible', () => {
      const schema = inputOf(greetTrail);
      // .shape is only available on z.ZodObject, not the broader z.ZodType
      expect(schema.shape).toBeDefined();
      expect(schema.shape.name).toBeDefined();
    });
  });

  describe('outputOf', () => {
    test('returns the Zod output schema when defined', () => {
      const schema = outputOf(greetTrail);
      expect(schema).toBeDefined();
      // oxlint-disable-next-line no-non-null-assertion -- guarded by toBeDefined() above
      const result = schema!.safeParse({ message: 'hello' });
      expect(result.success).toBe(true);
    });

    test('returns undefined when no output schema', () => {
      const schema = outputOf(noOutputTrail);
      expect(schema).toBeUndefined();
    });
  });

  describe('type-level checks', () => {
    test('TrailInput matches expected shape', () => {
      // If this compiles, the type is correct
      const _input: TrailInput<typeof greetTrail> = { name: 'test' };
      expect(_input.name).toBe('test');
    });

    test('TrailOutput matches expected shape', () => {
      // If this compiles, the type is correct
      const _output: TrailOutput<typeof greetTrail> = { message: 'hello' };
      expect(_output.message).toBe('hello');
    });
  });

  describe('CrossInput', () => {
    test('returns base input when no crossInput defined', () => {
      type Input = CrossInput<typeof greetTrail>;
      const _input: Input = { name: 'test' };
      expect(_input.name).toBe('test');
    });

    test('merges crossInput with base input when crossInput defined', () => {
      const crossTrail = trail('cross.test', {
        blaze: (input) => Result.ok({ name: input.name }),
        crossInput: z.object({ forkedFrom: z.string() }),
        input: z.object({ name: z.string() }),
        output: z.object({ name: z.string() }),
      });

      type Input = CrossInput<typeof crossTrail>;
      // If this compiles, the type correctly merges both schemas
      const _input: Input = { forkedFrom: 'origin', name: 'test' };
      expect(_input.name).toBe('test');
      expect(_input.forkedFrom).toBe('origin');
    });
  });

  describe('TrailResult', () => {
    test('extracts Result<Output, Error> from a trail', () => {
      const t = trail('test.result', {
        blaze: (input) => Result.ok({ answer: input.q }),
        input: z.object({ q: z.string() }),
        output: z.object({ answer: z.string() }),
      });

      type Expected = Result<{ answer: string }, Error>;
      type Actual = TrailResult<typeof t>;

      // Compile-time check: assignment works in both directions
      const _check1: Expected = {} as Actual;
      const _check2: Actual = {} as Expected;

      // Runtime: type exists and is usable
      expect(true).toBe(true);
    });
  });
});
