import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  stripDefaultsFromShape,
  stripDefaultWrappers,
} from '../internal/zod-wrappers.js';

describe('stripDefaultWrappers', () => {
  test('drops plain default wrappers', () => {
    const withDefault = z.string().default('x');
    const stripped = stripDefaultWrappers(withDefault);

    expect(stripped.def.type).toBe('string');
    // Feeding an undefined through the stripped schema no longer
    // materializes the default.
    expect(stripped.safeParse().success).toBe(false);
    expect(stripped.safeParse('value').success).toBe(true);
  });

  test('drops optional + default layers together', () => {
    const schema = z.string().optional().default('x');
    const stripped = stripDefaultWrappers(schema);

    // Every wrapper around the underlying string is gone — optional is
    // dropped on purpose because downstream `.partial()` calls re-add it.
    expect(stripped.def.type).toBe('string');
    expect(stripped.safeParse().success).toBe(false);
    expect(stripped.safeParse('value').success).toBe(true);
  });

  test('preserves nullable constraints through the strip', () => {
    const schema = z.string().nullable().default('x');
    const stripped = stripDefaultWrappers(schema);

    // Default is gone; null is still a legal input.
    expect(stripped.def.type).toBe('nullable');
    expect(stripped.safeParse(null).success).toBe(true);
    expect(stripped.safeParse('value').success).toBe(true);
  });

  test('is load-bearing for .partial() on both call sites', () => {
    const shape = {
      author: z.string().optional().default('anon'),
      title: z.string().default('untitled'),
    };
    const schema = z.object(shape);

    // Both the store `deriveUpdateSchema` helper and the core derive-trail
    // `toPartialSchema` helper compose the same pattern: extend the schema
    // with the stripped shape, then call `.partial()`. Both call sites
    // must produce a schema that accepts an empty object without
    // re-materializing defaults.
    const stripped = stripDefaultsFromShape(schema);
    const partial = schema.extend(stripped).partial();

    const parsed = partial.parse({});
    expect(parsed).toEqual({});
    expect('author' in parsed).toBe(false);
    expect('title' in parsed).toBe(false);
  });
});
