import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { ValidationError } from '../errors.js';
import {
  validateInput,
  validateOutput,
  formatZodIssues,
  zodToJsonSchema,
} from '../validation.js';

// ---------------------------------------------------------------------------
// validateInput
// ---------------------------------------------------------------------------

describe('validateInput', () => {
  const schema = z.object({
    age: z.number().min(0),
    name: z.string(),
  });

  test('returns Ok for valid data', () => {
    const result = validateInput(schema, { age: 30, name: 'Alice' });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ age: 30, name: 'Alice' });
  });

  test('returns Err with ValidationError for invalid data', () => {
    const result = validateInput(schema, { name: 123 });
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error).toBeInstanceOf(ValidationError);
    expect(err.error.category).toBe('validation');
  });

  test('includes formatted issues in error message', () => {
    const result = validateInput(schema, {});
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error.message).toContain('name');
  });

  test('attaches ZodError as cause', () => {
    const result = validateInput(schema, {});
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error.cause).toBeInstanceOf(z.ZodError);
  });

  test('attaches issues in context', () => {
    const result = validateInput(schema, {});
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error.context).toBeDefined();
    expect(Array.isArray(err.error.context?.['issues'])).toBe(true);
  });

  test('works with simple string schema', () => {
    const str = z.string().min(1);
    expect(validateInput(str, 'hello').isOk()).toBe(true);
    expect(validateInput(str, '').isErr()).toBe(true);
    expect(validateInput(str, 42).isErr()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateOutput
// ---------------------------------------------------------------------------

describe('validateOutput', () => {
  const schema = z.object({
    id: z.string(),
    score: z.number(),
  });

  test('returns Ok for valid data', () => {
    const result = validateOutput(schema, { id: 'abc', score: 42 });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ id: 'abc', score: 42 });
  });

  test('returns Err with ValidationError for invalid data', () => {
    const result = validateOutput(schema, { id: 123 });
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error).toBeInstanceOf(ValidationError);
    expect(err.error.category).toBe('validation');
  });

  test('error message includes "Output validation failed" prefix', () => {
    const result = validateOutput(schema, {});
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error.message).toContain('Output validation failed');
  });

  test('attaches ZodError as cause', () => {
    const result = validateOutput(schema, {});
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error.cause).toBeInstanceOf(z.ZodError);
  });

  test('attaches issues in context', () => {
    const result = validateOutput(schema, {});
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error.context).toBeDefined();
    expect(Array.isArray(err.error.context?.['issues'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatZodIssues
// ---------------------------------------------------------------------------

describe('formatZodIssues', () => {
  test('formats issues with paths', () => {
    const schema = z.object({ email: z.string().email() });
    const parsed = schema.safeParse({ email: 'not-email' });
    expect(parsed.success).toBe(false);
    const failed1 = parsed as unknown as { error: z.ZodError };
    const messages1 = formatZodIssues(failed1.error.issues);
    expect(messages1.length).toBeGreaterThan(0);
    expect(messages1[0]).toMatch(/^email: /);
  });

  test('formats root-level issues without path prefix', () => {
    const schema = z.string();
    const parsed = schema.safeParse(42);
    expect(parsed.success).toBe(false);
    const failed = parsed as unknown as { error: z.ZodError };
    const messages = formatZodIssues(failed.error.issues);
    expect(messages.length).toBeGreaterThan(0);
    // Root issues have no "path: " prefix — message starts directly
    // (the message itself may contain colons, but won't start with "path: ")
    expect(messages[0]).not.toMatch(/^\w+: /);
  });

  test('formats nested paths with dot notation', () => {
    const schema = z.object({
      user: z.object({ name: z.string() }),
    });
    const parsed = schema.safeParse({ user: { name: 123 } });
    expect(parsed.success).toBe(false);
    const failed = parsed as unknown as { error: z.ZodError };
    const messages = formatZodIssues(failed.error.issues);
    expect(messages[0]).toMatch(/^user\.name: /);
  });
});

// ---------------------------------------------------------------------------
// zodToJsonSchema
// ---------------------------------------------------------------------------

describe('zodToJsonSchema', () => {
  describe('primitives', () => {
    test('converts z.string()', () => {
      expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' });
    });

    test('converts z.number()', () => {
      expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' });
    });

    test('converts z.boolean()', () => {
      expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' });
    });

    test('converts z.literal()', () => {
      expect(zodToJsonSchema(z.literal('hello'))).toEqual({ const: 'hello' });
      expect(zodToJsonSchema(z.literal(42))).toEqual({ const: 42 });
    });

    test('converts z.enum()', () => {
      expect(zodToJsonSchema(z.enum(['a', 'b', 'c']))).toEqual({
        enum: ['a', 'b', 'c'],
        type: 'string',
      });
    });

    test('converts z.array()', () => {
      expect(zodToJsonSchema(z.array(z.string()))).toEqual({
        items: { type: 'string' },
        type: 'array',
      });
    });
  });

  describe('objects', () => {
    test('converts z.object() with required fields', () => {
      const schema = z.object({ age: z.number(), name: z.string() });
      const result = zodToJsonSchema(schema);
      expect(result).toEqual({
        properties: {
          age: { type: 'number' },
          name: { type: 'string' },
        },
        required: ['age', 'name'],
        type: 'object',
      });
    });

    test('converts z.object() with optional fields', () => {
      const schema = z.object({
        name: z.string(),
        nickname: z.string().optional(),
      });
      const result = zodToJsonSchema(schema);
      expect(result).toEqual({
        properties: {
          name: { type: 'string' },
          nickname: { type: 'string' },
        },
        required: ['name'],
        type: 'object',
      });
    });

    test('converts z.object() with default fields', () => {
      const schema = z.object({
        name: z.string(),
        role: z.string().default('user'),
      });
      const result = zodToJsonSchema(schema);
      expect(result).toEqual({
        properties: {
          name: { type: 'string' },
          role: { default: 'user', type: 'string' },
        },
        required: ['name'],
        type: 'object',
      });
    });

    test('handles nested objects', () => {
      const schema = z.object({
        user: z.object({ name: z.string() }),
      });
      expect(zodToJsonSchema(schema)).toEqual({
        properties: {
          user: {
            properties: { name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        },
        required: ['user'],
        type: 'object',
      });
    });
  });

  describe('modifiers and combinators', () => {
    test('converts z.union()', () => {
      const schema = z.union([z.string(), z.number()]);
      expect(zodToJsonSchema(schema)).toEqual({
        anyOf: [{ type: 'string' }, { type: 'number' }],
      });
    });

    test('preserves z.describe()', () => {
      const schema = z.string().describe('A user name');
      expect(zodToJsonSchema(schema)).toEqual({
        description: 'A user name',
        type: 'string',
      });
    });

    test('handles z.nullable()', () => {
      const schema = z.string().nullable();
      expect(zodToJsonSchema(schema)).toEqual({
        anyOf: [{ type: 'string' }, { type: 'null' }],
      });
    });

    test('returns empty object for unknown types', () => {
      // z.any() is not in our coverage list
      expect(zodToJsonSchema(z.any())).toEqual({});
    });
  });

  describe('default values', () => {
    test('preserves static defaults as-is', () => {
      const schema = z.string().default('hello');
      expect(zodToJsonSchema(schema)).toEqual({
        default: 'hello',
        type: 'string',
      });
    });

    test('memoizes functional defaults for deterministic output', () => {
      let counter = 0;
      const schema = z.string().default(() => {
        counter += 1;
        return `id-${counter}`;
      });
      const first = zodToJsonSchema(schema);
      const second = zodToJsonSchema(schema);
      // Both calls return the same memoized value
      expect(first).toEqual(second);
      // The default was evaluated exactly once (counter incremented once)
      expect(first['default']).toBe('id-1');
      expect(counter).toBe(1);
    });

    test('produces identical output across calls for functional defaults', () => {
      const schema = z.string().default(() => `id-${Date.now()}`);
      const first = zodToJsonSchema(schema);
      const second = zodToJsonSchema(schema);
      expect(first).toEqual(second);
    });
  });
});
