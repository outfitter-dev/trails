import { describe, expect, test } from 'bun:test';

import { deriveFields } from '@ontrails/core';
import { z } from 'zod';

import {
  hasStructuredOnlyFields,
  normalizeParsedFlags,
  parsePositionalInlineJson,
  readStructuredInput,
  resolveStructuredInput,
  structuredInputPreset,
  supportsStructuredInput,
} from '../structured-input.js';

describe('structured input helpers', () => {
  test('normalizeParsedFlags converts kebab-case names to camelCase', () => {
    expect(
      normalizeParsedFlags({
        input: '/tmp/input.json',
        'sort-order': 'asc',
      })
    ).toEqual({
      input: '/tmp/input.json',
      sortOrder: 'asc',
    });
  });

  test('structuredInputPreset exposes path/stdin and inline JSON channels', () => {
    expect(
      structuredInputPreset().map((flag) => ({
        name: flag.name,
        required: flag.required,
      }))
    ).toEqual([
      { name: 'input', required: true },
      { name: 'input-json', required: true },
    ]);
  });

  test('supportsStructuredInput returns true only for non-empty object schemas', () => {
    expect(supportsStructuredInput(z.object({ query: z.string() }))).toBe(true);
    expect(supportsStructuredInput(z.object({}))).toBe(false);
    expect(supportsStructuredInput(z.string())).toBe(false);
  });

  test('hasStructuredOnlyFields detects omitted complex fields', () => {
    const schema = z.object({
      files: z.array(
        z.object({
          content: z.string(),
          filename: z.string(),
        })
      ),
      query: z.string(),
    });

    expect(hasStructuredOnlyFields(schema, deriveFields(schema).length)).toBe(
      true
    );
    expect(
      hasStructuredOnlyFields(
        z.object({ query: z.string() }),
        deriveFields(z.object({ query: z.string() })).length
      )
    ).toBe(false);
  });
});

describe('readStructuredInput', () => {
  test('returns an empty object when no structured source was provided', async () => {
    await expect(readStructuredInput({ query: 'hello' })).resolves.toEqual({});
  });

  test('rejects multiple structured sources at once', async () => {
    await expect(
      readStructuredInput({
        input: '/tmp/input.json',
        inputJson: '{"query":"hello"}',
      })
    ).rejects.toThrow(
      'Use only one structured input source at a time: --input or --input-json'
    );
  });

  test('parses --input-json payloads into an input object', async () => {
    await expect(
      readStructuredInput({
        inputJson: '{"query":"hello","limit":10}',
      })
    ).resolves.toEqual({
      limit: 10,
      query: 'hello',
    });
  });

  test('rejects invalid JSON for --input-json', async () => {
    await expect(
      readStructuredInput({
        inputJson: '{bad json}',
      })
    ).rejects.toThrow('Invalid JSON for --input-json');
  });

  test('rejects missing values for structured flags', async () => {
    await expect(readStructuredInput({ input: true })).rejects.toThrow(
      '--input requires a value'
    );
    await expect(readStructuredInput({ inputJson: true })).rejects.toThrow(
      '--input-json requires a value'
    );
  });

  test('rejects non-object JSON payloads', async () => {
    await expect(
      readStructuredInput({
        inputJson: '["not","an","object"]',
      })
    ).rejects.toThrow(
      '--input-json must provide a JSON object at the top level'
    );
  });

  test('parses --input file payloads via the injected file reader', async () => {
    await expect(
      readStructuredInput(
        {
          input: '/tmp/input.json',
        },
        {
          readFileText: (path) => {
            expect(path).toBe('/tmp/input.json');
            return Promise.resolve('{"query":"from file"}');
          },
        }
      )
    ).resolves.toEqual({ query: 'from file' });
  });

  test('parses --input - payloads via the injected stdin reader', async () => {
    await expect(
      readStructuredInput(
        {
          input: '-',
        },
        {
          readStdinText: () => Promise.resolve('{"query":"from stdin"}'),
        }
      )
    ).resolves.toEqual({ query: 'from stdin' });
  });

  test('rejects empty stdin payloads', async () => {
    await expect(
      readStructuredInput(
        {
          input: '-',
        },
        {
          readStdinText: () => Promise.resolve('   '),
        }
      )
    ).rejects.toThrow(
      '--input - was provided but no JSON payload was read from stdin'
    );
  });
});

describe('parsePositionalInlineJson', () => {
  test('returns undefined when the value is not a string', () => {
    expect(parsePositionalInlineJson()).toBeUndefined();
    expect(parsePositionalInlineJson(123)).toBeUndefined();
    expect(parsePositionalInlineJson({})).toBeUndefined();
  });

  test('returns undefined for an empty string', () => {
    expect(parsePositionalInlineJson('')).toBeUndefined();
  });

  test('parses a JSON object string into an object', () => {
    expect(parsePositionalInlineJson('{"name":"Alpha","limit":3}')).toEqual({
      limit: 3,
      name: 'Alpha',
    });
  });

  test('rejects invalid JSON with a parse error', () => {
    expect(() => parsePositionalInlineJson('{bad json}')).toThrow(
      'Invalid JSON for <inline-json>'
    );
  });

  test('rejects non-object JSON payloads', () => {
    expect(() => parsePositionalInlineJson('[1,2,3]')).toThrow(
      '<inline-json> must provide a JSON object at the top level'
    );
  });
});

describe('resolveStructuredInput', () => {
  test('returns no payload when neither flags nor positional are provided', async () => {
    const result = await resolveStructuredInput({});
    expect(result.payload).toBeUndefined();
    expect(result.used).toBe(false);
  });

  test('parses the positional inline JSON when no flags are provided', async () => {
    const result = await resolveStructuredInput({}, '{"name":"Alpha"}');
    expect(result.payload).toEqual({ name: 'Alpha' });
    expect(result.used).toBe(true);
  });

  test('reads --input-json when no positional is provided', async () => {
    const result = await resolveStructuredInput({ inputJson: '{"k":1}' });
    expect(result.payload).toEqual({ k: 1 });
    expect(result.used).toBe(true);
  });

  test('reads --input file via injected reader', async () => {
    const result = await resolveStructuredInput(
      { input: '/tmp/in.json' },
      undefined,
      {
        readFileText: (path) => {
          expect(path).toBe('/tmp/in.json');
          return Promise.resolve('{"from":"file"}');
        },
      }
    );
    expect(result.payload).toEqual({ from: 'file' });
    expect(result.used).toBe(true);
  });

  test('reads --input - via injected reader', async () => {
    const result = await resolveStructuredInput({ input: '-' }, undefined, {
      readStdinText: () => Promise.resolve('{"from":"stdin"}'),
    });
    expect(result.payload).toEqual({ from: 'stdin' });
    expect(result.used).toBe(true);
  });

  test('rejects when both --input-json and positional are provided', async () => {
    await expect(
      resolveStructuredInput({ inputJson: '{"a":1}' }, '{"b":2}')
    ).rejects.toThrow(
      'Use only one structured input source at a time: --input, --input-json, or the positional inline-JSON argument'
    );
  });

  test('rejects when both --input and positional are provided', async () => {
    await expect(
      resolveStructuredInput({ input: '/tmp/in.json' }, '{"b":2}')
    ).rejects.toThrow(
      'Use only one structured input source at a time: --input, --input-json, or the positional inline-JSON argument'
    );
  });
});
