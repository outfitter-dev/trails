import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Result } from '@ontrails/core';

import type { ActionResultContext } from '../build.js';
import { defaultOnResult } from '../on-result.js';

// Minimal trail stub for testing
const stubTrail = () =>
  ({ id: 'test', kind: 'trail' }) as ActionResultContext['trail'];

describe('defaultOnResult', () => {
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

  test('outputs success values in resolved mode (text)', async () => {
    const ctx: ActionResultContext = {
      args: {},
      flags: {},
      input: { name: 'test' },
      result: Result.ok('hello'),
      topoName: 'test',
      trail: stubTrail(),
    };
    await defaultOnResult(ctx);
    expect(written.join('')).toBe('hello\n');
  });

  test('outputs success values in json mode', async () => {
    const ctx: ActionResultContext = {
      args: {},
      flags: { json: true },
      input: {},
      result: Result.ok({ id: 1 }),
      topoName: 'test',
      trail: stubTrail(),
    };
    await defaultOnResult(ctx);
    expect(written.join('')).toBe(`${JSON.stringify({ id: 1 }, null, 2)}\n`);
  });

  test('throws on error results', () => {
    const error = new Error('something broke');
    const ctx: ActionResultContext = {
      args: {},
      flags: {},
      input: {},
      result: Result.err(error),
      topoName: 'test',
      trail: stubTrail(),
    };
    expect(defaultOnResult(ctx)).rejects.toThrow('something broke');
  });
});
