import { afterEach, describe, expect, test } from 'bun:test';

import { DEFAULT_SAMPLING, shouldSample } from '../sampling.js';

type Intent = 'read' | 'write' | 'destroy' | undefined;

describe('DEFAULT_SAMPLING', () => {
  test('read defaults to 0.05', () => {
    expect(DEFAULT_SAMPLING.read).toBe(0.05);
  });

  test('write defaults to 1', () => {
    expect(DEFAULT_SAMPLING.write).toBe(1);
  });

  test('destroy defaults to 1', () => {
    expect(DEFAULT_SAMPLING.destroy).toBe(1);
  });
});

describe('shouldSample', () => {
  const originalRandom = Math.random;

  afterEach(() => {
    Math.random = originalRandom;
  });

  test('write intent defaults to 100% sampled', () => {
    Math.random = () => 0.99;
    expect(shouldSample('write')).toBe(true);
  });

  test('destroy intent defaults to 100% sampled', () => {
    Math.random = () => 0.99;
    expect(shouldSample('destroy')).toBe(true);
  });

  test('read intent with random 0.01 is sampled (under 5%)', () => {
    Math.random = () => 0.01;
    expect(shouldSample('read')).toBe(true);
  });

  test('read intent with random 0.10 is not sampled (over 5%)', () => {
    Math.random = () => 0.1;
    expect(shouldSample('read')).toBe(false);
  });

  test('custom sampling config overrides defaults', () => {
    Math.random = () => 0.49;
    expect(shouldSample('read', { read: 0.5 })).toBe(true);

    Math.random = () => 0.51;
    expect(shouldSample('read', { read: 0.5 })).toBe(false);
  });

  test('falls back to write rate for unspecified intent', () => {
    Math.random = () => 0.99;
    const noIntent: Intent = undefined;
    expect(shouldSample(noIntent)).toBe(true);
  });
});
