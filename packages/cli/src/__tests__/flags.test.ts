import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  applyCliFlagValueAliases,
  deriveCliFlagValueAliases,
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

  describe('value aliases', () => {
    test('derives enum value aliases from a truthy override', () => {
      const flags = deriveFlags(
        z.object({ format: z.enum(['json', 'text']) }),
        { format: { aliases: true } }
      );
      const flag = requireFlag(flags, 'format');

      expect(flag.valueAliases).toEqual([
        { name: 'json', value: 'json' },
        { name: 'text', value: 'text' },
      ]);
    });

    test('derives explicit enum value aliases', () => {
      const flags = deriveFlags(
        z.object({ drafts: z.enum(['include', 'exclude', 'only']) }),
        {
          drafts: {
            aliases: {
              include: {
                description: 'Include draft state',
                name: 'include-drafts',
              },
              only: 'only-drafts',
            },
          },
        }
      );
      const flag = requireFlag(flags, 'drafts');

      expect(flag.valueAliases).toEqual([
        {
          description: 'Include draft state',
          name: 'include-drafts',
          value: 'include',
        },
        { name: 'only-drafts', value: 'only' },
      ]);
    });

    test('rejects aliases for values outside the flag choices', () => {
      expect(() =>
        deriveCliFlagValueAliases({
          aliases: { csv: 'csv' },
          choices: ['json', 'text'],
          flagName: 'format',
        })
      ).toThrow('targets unknown value "csv"');
    });

    test('rejects aliases on non-enum fields', () => {
      expect(() =>
        deriveFlags(z.object({ verbose: z.boolean() }), {
          verbose: { aliases: true },
        })
      ).toThrow('requires enum choices');
    });

    test('applies parsed aliases to canonical camelCase flag keys', () => {
      const flags = deriveFlags(
        z.object({ outputFormat: z.enum(['json', 'text']) }),
        { outputFormat: { aliases: { json: 'json-output' } } }
      );

      expect(
        applyCliFlagValueAliases(flags, {
          jsonOutput: true,
          untouched: 'yes',
        })
      ).toEqual({
        outputFormat: 'json',
        untouched: 'yes',
      });
    });

    test('rejects aliases combined with user supplied canonical flags', () => {
      const flags = deriveFlags(
        z.object({ outputFormat: z.enum(['json', 'text']) }),
        { outputFormat: { aliases: { json: 'json-output' } } }
      );

      expect(() =>
        applyCliFlagValueAliases(
          flags,
          { jsonOutput: true, outputFormat: 'text' },
          new Set(['jsonOutput', 'outputFormat'])
        )
      ).toThrow(
        'CLI flag "--output-format" cannot be combined with value alias "--json-output"'
      );
    });

    test('rejects ambiguous canonical defaults combined with aliases without caller-supplied key tracking', () => {
      const flags = deriveFlags(
        z.object({ outputFormat: z.enum(['json', 'text']).default('text') }),
        { outputFormat: { aliases: { json: 'json-output' } } }
      );

      expect(() =>
        applyCliFlagValueAliases(flags, {
          jsonOutput: true,
          outputFormat: 'text',
        })
      ).toThrow(
        'CLI flag "--output-format" cannot be combined with value alias "--json-output"'
      );
    });

    test('rejects multiple aliases for the same canonical flag', () => {
      const flags = deriveFlags(
        z.object({ format: z.enum(['json', 'summary', 'text']) }),
        { format: { aliases: true } }
      );

      expect(() =>
        applyCliFlagValueAliases(flags, {
          json: true,
          summary: true,
        })
      ).toThrow(
        'CLI flag "--format" received multiple value aliases: --json, --summary'
      );
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

    test('z.array(z.enum()) derives a bounded multiselect flag', () => {
      const flags = deriveFlags(
        z.object({ include: z.array(z.enum(['examples', 'errors'])) })
      );
      const flag = requireFlag(flags, 'include');

      expect(flags).toHaveLength(1);
      expect(flag.type).toBe('string[]');
      expect(flag.choices).toEqual(['examples', 'errors']);
      expect(flag.variadic).toBe(false);
    });

    test('z.array(z.number()) derives a variadic number[] flag', () => {
      const flags = deriveFlags(z.object({ ids: z.array(z.number()) }));
      const flag = requireFlag(flags, 'ids');

      expect(flags).toHaveLength(1);
      expect(flag.type).toBe('number[]');
      expect(flag.variadic).toBe(true);
    });

    test('nested object fields are omitted when they are not faithfully representable', () => {
      const flags = deriveFlags(
        z.object({
          filter: z.object({
            query: z.string(),
          }),
        })
      );

      expect(flags).toEqual([]);
    });

    test('arrays of objects are omitted when they are not faithfully representable', () => {
      const flags = deriveFlags(
        z.object({
          files: z.array(
            z.object({
              content: z.string(),
              filename: z.string(),
            })
          ),
        })
      );

      expect(flags).toEqual([]);
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

    test('field overrides still flow through flag derivation', () => {
      const flags = deriveFlags(
        z.object({ query: z.string().describe('Search query') }),
        {
          query: { label: 'Find query' },
        }
      );

      expect(flags).toHaveLength(1);
      expect(requireFlag(flags, 'query').description).toBe('Find query');
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
  test('returns --output, --json, --jsonl, --quiet flags', () => {
    const flags = outputModePreset();
    expect(flags).toHaveLength(4);

    const outputFlag = requireFlag(flags, 'output');
    const jsonFlag = requireFlag(flags, 'json');
    const jsonlFlag = requireFlag(flags, 'jsonl');
    const quietFlag = requireFlag(flags, 'quiet');

    expect(outputFlag.short).toBe('o');
    expect(outputFlag.choices).toEqual(['text', 'json', 'jsonl']);
    expect(outputFlag.default).toBeUndefined();
    expect(jsonFlag.type).toBe('boolean');
    expect(jsonlFlag.type).toBe('boolean');
    expect(quietFlag.type).toBe('boolean');
    expect(quietFlag.short).toBe('q');
    expect(quietFlag.required).toBe(false);
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
    expect(flags[0]?.default).toBeUndefined();
  });
});
