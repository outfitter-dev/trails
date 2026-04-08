import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { output, resolveOutputMode } from '../output.js';

describe('output', () => {
  let written: string[];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    written = [];
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      written.push(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  test('text mode writes string directly', async () => {
    await output('hello world', 'text');
    expect(written.join('')).toBe('hello world\n');
  });

  test('text mode JSON-stringifies objects', async () => {
    await output({ key: 'value' }, 'text');
    expect(written.join('')).toBe(
      `${JSON.stringify({ key: 'value' }, null, 2)}\n`
    );
  });

  test('json mode writes JSON with indentation', async () => {
    await output({ a: 1 }, 'json');
    expect(written.join('')).toBe(`${JSON.stringify({ a: 1 }, null, 2)}\n`);
  });

  test('jsonl mode writes each array element as a line', async () => {
    await output([{ id: 1 }, { id: 2 }], 'jsonl');
    expect(written).toEqual([
      `${JSON.stringify({ id: 1 })}\n`,
      `${JSON.stringify({ id: 2 })}\n`,
    ]);
  });

  test('jsonl mode writes single object as one line', async () => {
    await output({ id: 1 }, 'jsonl');
    expect(written.join('')).toBe(`${JSON.stringify({ id: 1 })}\n`);
  });
});

describe('resolveOutputMode', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('flag precedence', () => {
    test('--json flag returns json', () => {
      const result = resolveOutputMode({ json: true }, 'stash');
      expect(result.mode).toBe('json');
    });

    test('--jsonl flag returns jsonl', () => {
      const result = resolveOutputMode({ jsonl: true }, 'stash');
      expect(result.mode).toBe('jsonl');
    });

    test('--json takes priority over --jsonl', () => {
      const result = resolveOutputMode({ json: true, jsonl: true }, 'stash');
      expect(result.mode).toBe('json');
    });

    test('--output flag returns specified mode', () => {
      const result = resolveOutputMode({ output: 'jsonl' }, 'stash');
      expect(result.mode).toBe('jsonl');
    });

    test('--json takes priority over --output', () => {
      const result = resolveOutputMode({ json: true, output: 'text' }, 'stash');
      expect(result.mode).toBe('json');
    });
  });

  describe('topo-derived environment fallback', () => {
    test('<TOPO>_JSON=1 env var returns json', () => {
      process.env['STASH_JSON'] = '1';
      const result = resolveOutputMode({}, 'stash');
      expect(result.mode).toBe('json');
    });

    test('<TOPO>_JSONL=1 env var returns jsonl', () => {
      process.env['STASH_JSONL'] = '1';
      const result = resolveOutputMode({}, 'stash');
      expect(result.mode).toBe('jsonl');
    });

    test('flags take priority over env vars', () => {
      process.env['STASH_JSON'] = '1';
      const result = resolveOutputMode({ jsonl: true }, 'stash');
      expect(result.mode).toBe('jsonl');
    });

    test('defaults to text when nothing specified', () => {
      const result = resolveOutputMode({}, 'stash');
      expect(result.mode).toBe('text');
    });

    test('env var for a different topo does not leak', () => {
      process.env['OTHER_JSON'] = '1';
      const result = resolveOutputMode({}, 'stash');
      expect(result.mode).toBe('text');
    });

    test('legacy TRAILS_JSON is no longer honored', () => {
      process.env['TRAILS_JSON'] = '1';
      const result = resolveOutputMode({}, 'stash');
      expect(result.mode).toBe('text');
    });

    test('topo name with hyphens is normalized to underscores', () => {
      process.env['MY_APP_JSON'] = '1';
      const result = resolveOutputMode({}, 'my-app');
      expect(result.mode).toBe('json');
    });

    test('topo name starting with a digit gets underscore prefix', () => {
      process.env['_1APP_JSON'] = '1';
      const result = resolveOutputMode({}, '1app');
      expect(result.mode).toBe('json');
    });
  });
});
