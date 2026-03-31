import { describe, expect, test } from 'bun:test';

import { configRef, isConfigRef } from '../ref.js';

describe('configRef', () => {
  test('creates a marker object with __configRef flag', () => {
    const ref = configRef('db.host');
    expect(ref.__configRef).toBe(true);
    expect(ref.path).toBe('db.host');
  });

  test('creates distinct refs for different paths', () => {
    const ref1 = configRef('db.host');
    const ref2 = configRef('db.port');
    expect(ref1.path).not.toBe(ref2.path);
  });
});

describe('isConfigRef', () => {
  test('returns true for configRef markers', () => {
    const ref = configRef('db.host');
    expect(isConfigRef(ref)).toBe(true);
  });

  test('returns false for plain objects', () => {
    expect(isConfigRef({ path: 'db.host' })).toBe(false);
  });

  test('returns false for non-objects', () => {
    expect(isConfigRef('db.host')).toBe(false);
    expect(isConfigRef(42)).toBe(false);
    expect(isConfigRef(null)).toBe(false);
    expect(isConfigRef()).toBe(false);
  });
});
