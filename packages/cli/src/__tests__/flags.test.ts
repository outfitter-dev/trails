import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  cwdPreset,
  deriveFlags,
  dryRunPreset,
  outputModePreset,
} from '../flags.js';

const requireFlag = (flags: ReturnType<typeof deriveFlags>, name: string) => {
  const flag = flags.find((entry) => entry.name === name);
  expect(flag).toBeDefined();
  if (!flag) {
    throw new Error(`Expected flag: ${name}`);
  }
  return flag;
};

describe('deriveFlags', () => {
  describe('primitive fields', () => {
    test('z.string() derives a string flag', () => {
      const flags = deriveFlags(z.object({ name: z.string() }));
      const flag = requireFlag(flags, 'name');

      expect(flags).toHaveLength(1);
      expect(flag.type).toBe('string');
      expect(flag.required).toBe(true);
      expect(flag.variadic).toBe(false);
    });

    test('z.number() derives a number flag', () => {
      const flags = deriveFlags(z.object({ count: z.number() }));
      const flag = requireFlag(flags, 'count');

      expect(flags).toHaveLength(1);
      expect(flag.type).toBe('number');
      expect(flag.required).toBe(true);
    });

    test('z.boolean() derives a boolean flag', () => {
      const flags = deriveFlags(z.object({ verbose: z.boolean() }));
      const flag = requireFlag(flags, 'verbose');

      expect(flags).toHaveLength(1);
      expect(flag.type).toBe('boolean');
      expect(flag.required).toBe(true);
    });
  });

  describe('complex field shapes', () => {
    test('z.enum() derives a string flag with choices', () => {
      const flags = deriveFlags(
        z.object({ format: z.enum(['json', 'text', 'csv']) })
      );
      const flag = requireFlag(flags, 'format');

      expect(flags).toHaveLength(1);
      expect(flag.type).toBe('string');
      expect(flag.choices).toEqual(['json', 'text', 'csv']);
    });

    test('z.array(z.string()) derives a variadic string[] flag', () => {
      const flags = deriveFlags(z.object({ tags: z.array(z.string()) }));
      const flag = requireFlag(flags, 'tags');

      expect(flags).toHaveLength(1);
      expect(flag.type).toBe('string[]');
      expect(flag.variadic).toBe(true);
    });

    test('z.array(z.number()) derives a variadic number[] flag', () => {
      const flags = deriveFlags(z.object({ ids: z.array(z.number()) }));
      const flag = requireFlag(flags, 'ids');

      expect(flags).toHaveLength(1);
      expect(flag.type).toBe('number[]');
      expect(flag.variadic).toBe(true);
    });
  });

  describe('modifiers and naming', () => {
    test('z.optional() sets required: false', () => {
      const flags = deriveFlags(z.object({ label: z.string().optional() }));
      const flag = requireFlag(flags, 'label');

      expect(flags).toHaveLength(1);
      expect(flag.required).toBe(false);
    });

    test('z.default() sets required: false and populates default', () => {
      const flags = deriveFlags(z.object({ limit: z.number().default(10) }));
      const flag = requireFlag(flags, 'limit');

      expect(flags).toHaveLength(1);
      expect(flag.required).toBe(false);
      expect(flag.default).toBe(10);
    });

    test('.describe() populates flag description', () => {
      const flags = deriveFlags(
        z.object({ query: z.string().describe('Search query') })
      );

      expect(flags).toHaveLength(1);
      expect(requireFlag(flags, 'query').description).toBe('Search query');
    });

    test('camelCase field names convert to kebab-case flag names', () => {
      const flags = deriveFlags(
        z.object({ maxItems: z.number(), sortOrder: z.string() })
      );
      const names = flags.map((f) => f.name);

      expect(flags).toHaveLength(2);
      expect(names).toContain('sort-order');
      expect(names).toContain('max-items');
    });
  });

  describe('edge cases', () => {
    test('non-object schema returns empty flags', () => {
      const flags = deriveFlags(z.string());
      expect(flags).toHaveLength(0);
    });

    test('handles multiple fields together', () => {
      const schema = z.object({
        count: z.number().optional(),
        name: z.string(),
        tags: z.array(z.string()),
        verbose: z.boolean().default(false),
      });
      const flags = deriveFlags(schema);
      expect(flags).toHaveLength(4);
    });
  });
});

describe('outputModePreset', () => {
  test('returns --output, --json, --jsonl flags', () => {
    const flags = outputModePreset();
    expect(flags).toHaveLength(3);

    const outputFlag = requireFlag(flags, 'output');
    const jsonFlag = requireFlag(flags, 'json');
    const jsonlFlag = requireFlag(flags, 'jsonl');

    expect(outputFlag.short).toBe('o');
    expect(outputFlag.choices).toEqual(['text', 'json', 'jsonl']);
    expect(outputFlag.default).toBe('text');
    expect(jsonFlag.type).toBe('boolean');
    expect(jsonlFlag.type).toBe('boolean');
  });
});

describe('cwdPreset', () => {
  test('returns --cwd flag', () => {
    const flags = cwdPreset();
    expect(flags).toHaveLength(1);
    expect(flags[0]?.name).toBe('cwd');
    expect(flags[0]?.type).toBe('string');
    expect(flags[0]?.required).toBe(false);
  });
});

describe('dryRunPreset', () => {
  test('returns --dry-run flag', () => {
    const flags = dryRunPreset();
    expect(flags).toHaveLength(1);
    expect(flags[0]?.name).toBe('dry-run');
    expect(flags[0]?.type).toBe('boolean');
    expect(flags[0]?.default).toBe(false);
  });
});
