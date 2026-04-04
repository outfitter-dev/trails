import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { deriveCliPath, deriveFields } from '../derive.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('derive', () => {
  describe('cli paths', () => {
    test('top-level trail IDs derive to a one-segment CLI path', () => {
      expect(deriveCliPath('search')).toEqual(['search']);
    });

    test('multi-dot trail IDs derive to the full ordered CLI path', () => {
      expect(deriveCliPath('topo.pin.remove')).toEqual([
        'topo',
        'pin',
        'remove',
      ]);
    });

    test('trail IDs with consecutive dots throw a ValidationError', () => {
      expect(() => deriveCliPath('topo..pin')).toThrow(
        'Trail ID "topo..pin" contains an empty segment'
      );
    });

    test('trail IDs with a leading dot throw a ValidationError', () => {
      expect(() => deriveCliPath('.pin')).toThrow(
        'Trail ID ".pin" contains an empty segment'
      );
    });

    test('trail IDs with a trailing dot throw a ValidationError', () => {
      expect(() => deriveCliPath('pin.')).toThrow(
        'Trail ID "pin." contains an empty segment'
      );
    });
  });

  describe('primitive types', () => {
    test('z.string() derives string field', () => {
      const schema = z.object({ name: z.string() });
      const fields = deriveFields(schema);
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
      const fields = deriveFields(schema);
      expect(fields[0]).toMatchObject({
        name: 'count',
        required: true,
        type: 'number',
      });
    });

    test('z.boolean() derives boolean field', () => {
      const schema = z.object({ verbose: z.boolean() });
      const fields = deriveFields(schema);
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
      const fields = deriveFields(schema);
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
      const fields = deriveFields(schema);
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

  describe('array types', () => {
    test('z.array(z.string()) derives string[] field', () => {
      const schema = z.object({ names: z.array(z.string()) });
      const fields = deriveFields(schema);
      expect(fields[0]).toMatchObject({
        name: 'names',
        options: undefined,
        required: true,
        type: 'string[]',
      });
    });

    test('z.array(z.number()) derives number[] field', () => {
      const schema = z.object({ scores: z.array(z.number()) });
      const fields = deriveFields(schema);
      expect(fields[0]).toMatchObject({
        name: 'scores',
        options: undefined,
        required: true,
        type: 'number[]',
      });
    });

    test('optional z.array(z.string()) marks not required', () => {
      const schema = z.object({ tags: z.array(z.string()).optional() });
      const fields = deriveFields(schema);
      expect(fields[0]).toMatchObject({
        name: 'tags',
        required: false,
        type: 'string[]',
      });
    });

    test('z.array(z.string()) with default sets default value', () => {
      const schema = z.object({
        items: z.array(z.string()).default(['a', 'b']),
      });
      const fields = deriveFields(schema);
      expect(fields[0]?.required).toBe(false);
      expect(fields[0]?.type).toBe('string[]');
      expect(fields[0]?.default).toEqual(['a', 'b']);
    });
  });

  describe('modifiers', () => {
    test('.describe() sets label', () => {
      const schema = z.object({
        name: z.string().describe('Your full name'),
      });
      const fields = deriveFields(schema);
      expect(fields[0]?.label).toBe('Your full name');
    });

    test('.default() sets default and marks not required', () => {
      const schema = z.object({
        port: z.number().default(3000),
      });
      const fields = deriveFields(schema);
      expect(fields[0]?.required).toBe(false);
      expect(fields[0]?.default).toBe(3000);
    });

    test('.optional() marks not required', () => {
      const schema = z.object({
        nickname: z.string().optional(),
      });
      const fields = deriveFields(schema);
      expect(fields[0]?.required).toBe(false);
    });
  });

  describe('overrides', () => {
    test('override label replaces derived label', () => {
      const schema = z.object({
        name: z.string().describe('Derived label'),
      });
      const fields = deriveFields(schema, {
        name: { label: 'Override label' },
      });
      expect(fields[0]?.label).toBe('Override label');
    });

    test('override options enrich enum values with labels and hints', () => {
      const schema = z.object({
        color: z.enum(['red', 'green', 'blue']),
      });
      const fields = deriveFields(schema, {
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
      const fields = deriveFields(schema);
      expect(fields.map((f) => f.name)).toEqual(['alpha', 'middle', 'zebra']);
    });

    test('returns empty array for non-object schema', () => {
      expect(deriveFields(z.string())).toEqual([]);
    });

    test('humanizes camelCase field names', () => {
      const schema = z.object({ firstName: z.string() });
      const fields = deriveFields(schema);
      expect(fields[0]?.label).toBe('First Name');
    });
  });
});
