import { describe, expect, test } from 'bun:test';

import { deriveAnnotations } from '../annotations.js';

describe('deriveAnnotations', () => {
  test('read intent produces readOnlyHint', () => {
    const annotations = deriveAnnotations({ intent: 'read' });
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBeUndefined();
    expect(annotations.idempotentHint).toBeUndefined();
  });

  test('destroy intent produces destructiveHint', () => {
    const annotations = deriveAnnotations({ intent: 'destroy' });
    expect(annotations.destructiveHint).toBe(true);
    expect(annotations.readOnlyHint).toBeUndefined();
  });

  test('idempotent trail produces idempotentHint', () => {
    const annotations = deriveAnnotations({
      idempotent: true,
      intent: 'write',
    });
    expect(annotations.idempotentHint).toBe(true);
  });

  test('read intent with idempotent combines correctly', () => {
    const annotations = deriveAnnotations({
      idempotent: true,
      intent: 'read',
    });
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.destructiveHint).toBeUndefined();
  });

  test('write intent produces empty annotations', () => {
    const annotations = deriveAnnotations({ intent: 'write' });
    expect(annotations.readOnlyHint).toBeUndefined();
    expect(annotations.destructiveHint).toBeUndefined();
    expect(annotations.idempotentHint).toBeUndefined();
    expect(annotations.title).toBeUndefined();
  });

  test('description maps to title', () => {
    const annotations = deriveAnnotations({
      description: 'Show entity details',
      intent: 'write',
    });
    expect(annotations.title).toBe('Show entity details');
  });

  test('all hints plus description', () => {
    const annotations = deriveAnnotations({
      description: 'A trail',
      idempotent: true,
      intent: 'destroy',
    });
    expect(annotations.destructiveHint).toBe(true);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.title).toBe('A trail');
  });
});
