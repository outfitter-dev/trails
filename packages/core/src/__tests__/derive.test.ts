import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { derive } from '../derive.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('derive', () => {
  describe('primitive types', () => {
    test('z.string() derives string field', () => {
      const schema = z.object({ name: z.string() });
      const fields = derive(schema);
      expect(fields).toHaveLength(1);
      expect(fields[0]).toMatchObject({
        label: 'Name',
        name: 'name',
        required: true,
        type: 'string',
      });
    });

    test('z.number() derives number field', () => {
      const schema = z.object({ count: z.number() });
      const fields = derive(schema);
      expect(fields[0]).toMatchObject({
        name: 'count',
        required: true,
        type: 'number',
      });
    });

    test('z.boolean() derives boolean field', () => {
      const schema = z.object({ verbose: z.boolean() });
      const fields = derive(schema);
      expect(fields[0]).toMatchObject({
        name: 'verbose',
        required: true,
        type: 'boolean',
      });
    });
  });

  describe('enum and multiselect', () => {
    test('z.enum() derives enum field with options', () => {
      const schema = z.object({ color: z.enum(['red', 'green', 'blue']) });
      const fields = derive(schema);
      expect(fields[0]).toMatchObject({
        name: 'color',
        required: true,
        type: 'enum',
      });
      expect(fields[0]?.options).toEqual([
        { value: 'red' },
        { value: 'green' },
        { value: 'blue' },
      ]);
    });

    test('z.array(z.enum()) derives multiselect field', () => {
      const schema = z.object({
        tags: z.array(z.enum(['a', 'b', 'c'])),
      });
      const fields = derive(schema);
      expect(fields[0]).toMatchObject({
        name: 'tags',
        required: true,
        type: 'multiselect',
      });
      expect(fields[0]?.options).toEqual([
        { value: 'a' },
        { value: 'b' },
        { value: 'c' },
      ]);
    });
  });

  describe('modifiers', () => {
    test('.describe() sets label', () => {
      const schema = z.object({
        name: z.string().describe('Your full name'),
      });
      const fields = derive(schema);
      expect(fields[0]?.label).toBe('Your full name');
    });

    test('.default() sets default and marks not required', () => {
      const schema = z.object({
        port: z.number().default(3000),
      });
      const fields = derive(schema);
      expect(fields[0]?.required).toBe(false);
      expect(fields[0]?.default).toBe(3000);
    });

    test('.optional() marks not required', () => {
      const schema = z.object({
        nickname: z.string().optional(),
      });
      const fields = derive(schema);
      expect(fields[0]?.required).toBe(false);
    });
  });

  describe('overrides', () => {
    test('override label replaces derived label', () => {
      const schema = z.object({
        name: z.string().describe('Derived label'),
      });
      const fields = derive(schema, {
        name: { label: 'Override label' },
      });
      expect(fields[0]?.label).toBe('Override label');
    });

    test('override options enrich enum values with labels and hints', () => {
      const schema = z.object({
        color: z.enum(['red', 'green', 'blue']),
      });
      const fields = derive(schema, {
        color: {
          options: [
            { hint: 'Hot color', label: 'Red', value: 'red' },
            { label: 'Green', value: 'green' },
          ],
        },
      });
      expect(fields[0]?.options).toEqual([
        { hint: 'Hot color', label: 'Red', value: 'red' },
        { label: 'Green', value: 'green' },
        { value: 'blue' },
      ]);
    });
  });

  describe('sorting and edge cases', () => {
    test('returns fields sorted by name', () => {
      const schema = z.object({
        alpha: z.string(),
        middle: z.string(),
        zebra: z.string(),
      });
      const fields = derive(schema);
      expect(fields.map((f) => f.name)).toEqual(['alpha', 'middle', 'zebra']);
    });

    test('returns empty array for non-object schema', () => {
      expect(derive(z.string())).toEqual([]);
    });

    test('humanizes camelCase field names', () => {
      const schema = z.object({ firstName: z.string() });
      const fields = derive(schema);
      expect(fields[0]?.label).toBe('First Name');
    });
  });
});
