import { describe, expect, test } from 'bun:test';

import { deriveFields } from '@ontrails/core';
import { z } from 'zod';

import {
  hasStructuredOnlyFields,
  normalizeParsedFlags,
  readStructuredInput,
  structuredInputPreset,
  supportsStructuredInput,
} from '../structured-input.js';

describe('structured input helpers', () => {
  test('normalizeParsedFlags converts kebab-case names to camelCase', () => {
    expect(
      normalizeParsedFlags({
        'input-file': '/tmp/input.json',
        'sort-order': 'asc',
      })
    ).toEqual({
      inputFile: '/tmp/input.json',
      sortOrder: 'asc',
    });
  });

  test('structuredInputPreset exposes JSON, file, and stdin channels', () => {
    expect(structuredInputPreset().map((flag) => flag.name)).toEqual([
      'input-json',
      'input-file',
      'stdin',
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
        inputJson: '{"query":"hello"}',
        stdin: true,
      })
    ).rejects.toThrow(
      'Use only one structured input source at a time: --input-json, --input-file, or --stdin'
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

  test('rejects non-object JSON payloads', async () => {
    await expect(
      readStructuredInput({
        inputJson: '["not","an","object"]',
      })
    ).rejects.toThrow(
      '--input-json must provide a JSON object at the top level'
    );
  });

  test('parses --input-file payloads via the injected file reader', async () => {
    await expect(
      readStructuredInput(
        {
          inputFile: '/tmp/input.json',
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

  test('parses --stdin payloads via the injected stdin reader', async () => {
    await expect(
      readStructuredInput(
        {
          stdin: true,
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
          stdin: true,
        },
        {
          readStdinText: () => Promise.resolve('   '),
        }
      )
    ).rejects.toThrow(
      '--stdin was provided but no JSON payload was read from stdin'
    );
  });
});
