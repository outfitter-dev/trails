import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result';
import { trail } from '../trail';
import type { TrailInput, TrailOutput } from '../type-utils';
import { inputOf, outputOf } from '../type-utils';

const greetTrail = trail('greet', {
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  run: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
});

const noOutputTrail = trail('ping', {
  input: z.object({}),
  run: () => Result.ok(),
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
});
