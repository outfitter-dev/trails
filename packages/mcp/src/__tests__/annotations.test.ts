import { describe, expect, test } from 'bun:test';

import { deriveAnnotations } from '../annotations.js';

describe('deriveAnnotations', () => {
  test('readOnly trail produces readOnlyHint', () => {
    const annotations = deriveAnnotations({ readOnly: true });
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBeUndefined();
    expect(annotations.idempotentHint).toBeUndefined();
  });

  test('destructive trail produces destructiveHint', () => {
    const annotations = deriveAnnotations({ destructive: true });
    expect(annotations.destructiveHint).toBe(true);
    expect(annotations.readOnlyHint).toBeUndefined();
  });

  test('idempotent trail produces idempotentHint', () => {
    const annotations = deriveAnnotations({ idempotent: true });
    expect(annotations.idempotentHint).toBe(true);
  });

  test('multiple markers combine correctly', () => {
    const annotations = deriveAnnotations({
      idempotent: true,
      readOnly: true,
    });
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.destructiveHint).toBeUndefined();
  });

  test('no markers produces empty annotations', () => {
    const annotations = deriveAnnotations({});
    expect(annotations.readOnlyHint).toBeUndefined();
    expect(annotations.destructiveHint).toBeUndefined();
    expect(annotations.idempotentHint).toBeUndefined();
    expect(annotations.title).toBeUndefined();
  });

  test('description maps to title', () => {
    const annotations = deriveAnnotations({
      description: 'Show entity details',
    });
    expect(annotations.title).toBe('Show entity details');
  });

  test('all markers plus description', () => {
    const annotations = deriveAnnotations({
      description: 'A trail',
      destructive: true,
      idempotent: true,
      readOnly: true,
    });
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(true);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.title).toBe('A trail');
  });

  test('false values are not included', () => {
    const annotations = deriveAnnotations({
      destructive: false,
      readOnly: false,
    });
    expect(annotations.readOnlyHint).toBeUndefined();
    expect(annotations.destructiveHint).toBeUndefined();
  });
});
