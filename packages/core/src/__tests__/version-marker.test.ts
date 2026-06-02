import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { blobRefSchema } from '../blob-ref.js';
import { AmbiguousError, ValidationError } from '../errors.js';
import {
  TRAIL_VERSION_MARKER_LENGTH,
  canonicalizeTrailVersionMarkerContent,
  deriveCurrentTrailVersionMarker,
  deriveCurrentTrailVersionMarkerContent,
  deriveShortestUnambiguousTrailVersionMarkerPrefix,
  deriveTrailVersionMarker,
  resolveTrailVersionMarkerPrefix,
} from '../version-marker.js';

const markerInput = (input: z.ZodType) =>
  ({
    composes: [],
    detours: [],
    input,
    output: z.object({ ok: z.boolean() }),
    resources: [],
  }) as never;

const expectUnsupportedMarkerSchema = (
  input: z.ZodType,
  expectedPath: string,
  expectedDetail: string
): void => {
  let error: unknown;
  try {
    deriveCurrentTrailVersionMarker(markerInput(input));
  } catch (caughtError) {
    error = caughtError;
  }

  expect(error).toBeInstanceOf(ValidationError);
  expect((error as Error).message).toContain(expectedPath);
  expect((error as Error).message).toContain(expectedDetail);
};

describe('trail version markers', () => {
  test('hashes canonicalized content into a 16-character marker', () => {
    const left = deriveTrailVersionMarker({
      input: { properties: { id: { type: 'string' } }, type: 'object' },
      output: { type: 'object' },
    });
    const right = deriveTrailVersionMarker({
      input: { properties: { id: { type: 'string' } }, type: 'object' },
      output: { type: 'object' },
    });

    expect(left).toBe(right);
    expect(left).toHaveLength(TRAIL_VERSION_MARKER_LENGTH);
    expect(left).toMatch(/^[0-9a-f]{16}$/);
  });

  test('current marker content includes stable runtime contract references', () => {
    class MarkerConflictError extends Error {}

    const base = {
      composes: [],
      detours: [],
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
      resources: [],
    };
    const current = {
      ...base,
      composes: ['audit.log'],
      detours: [{ maxAttempts: 3, on: MarkerConflictError, recover: () => {} }],
      resources: [{ id: 'db.main' }],
    };

    const content = deriveCurrentTrailVersionMarkerContent(current as never);

    expect(content).toMatchObject({
      composes: ['audit.log'],
      detours: [{ maxAttempts: 3, on: 'MarkerConflictError' }],
      resources: ['db.main'],
    });
    expect(deriveCurrentTrailVersionMarker(base as never)).not.toBe(
      deriveCurrentTrailVersionMarker(current as never)
    );
  });

  test('rejects Zod validation checks that are not part of marker content', () => {
    expectUnsupportedMarkerSchema(
      z.object({ value: z.string().min(3) }),
      'input.value',
      'min_length'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.string().email() }),
      'input.value',
      'string_format'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.number().int() }),
      'input.value',
      'number_format'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.email() }),
      'input.value',
      'string_format'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.uuid() }),
      'input.value',
      'string_format'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.int() }),
      'input.value',
      'number_format'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.array(z.string()).min(1) }),
      'input.value',
      'min_length'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.string().refine((value) => value.length > 0) }),
      'input.value',
      'custom'
    );
    expectUnsupportedMarkerSchema(
      z.object({
        value: z.string().superRefine((value, ctx) => {
          if (value.length === 0) {
            ctx.addIssue({ code: 'custom', message: 'value is required' });
          }
        }),
      }),
      'input.value',
      'custom'
    );
  });

  test('rejects coerced Zod primitives so markers cannot collide with plain ones', () => {
    expectUnsupportedMarkerSchema(
      z.object({ value: z.coerce.number() }),
      'input.value',
      'coercion'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.coerce.string() }),
      'input.value',
      'coercion'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.coerce.boolean() }),
      'input.value',
      'coercion'
    );

    // A coerced primitive must not hash identically to its plain counterpart.
    expect(() =>
      deriveCurrentTrailVersionMarker(
        markerInput(z.object({ value: z.coerce.number() }))
      )
    ).toThrow(ValidationError);
  });

  test('rejects defaults because factories are opaque after Zod normalization', () => {
    expectUnsupportedMarkerSchema(
      z.object({
        value: z.string().default(() => Math.random().toString()),
      }),
      'input.value',
      'schema type "default"'
    );
    expectUnsupportedMarkerSchema(
      z.object({
        value: z.number().default(() => Date.now()),
      }),
      'input.value',
      'schema type "default"'
    );
    expectUnsupportedMarkerSchema(
      z.object({
        value: z.number().default(() => Math.floor(Date.now() / 1000)),
      }),
      'input.value',
      'schema type "default"'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.string().default('stable') }),
      'input.value',
      'schema type "default"'
    );
  });

  test('rejects JSON-lossy enum values before marker hashing', () => {
    expectUnsupportedMarkerSchema(
      z.object({ value: z.enum({ A: Number.NaN } as never) }),
      'input.value',
      'non-finite JSON value'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.enum({ A: Number.POSITIVE_INFINITY } as never) }),
      'input.value',
      'non-finite JSON value'
    );

    expect(() =>
      deriveCurrentTrailVersionMarker(
        markerInput(z.object({ value: z.enum(['a', 'b']) }))
      )
    ).not.toThrow();
    expect(() =>
      deriveCurrentTrailVersionMarker(
        markerInput(z.object({ value: z.enum({ A: null } as never) }))
      )
    ).not.toThrow();
  });

  test('rejects reference-valued literal and enum values before marker hashing', () => {
    expectUnsupportedMarkerSchema(
      z.object({ value: z.literal({ key: 'value' } as never) }),
      'input.value',
      'reference-valued literal or enum value'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.literal([['value']] as never) }),
      'input.value',
      'reference-valued literal or enum value'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.enum({ A: { key: 'value' } } as never) }),
      'input.value.A',
      'reference-valued literal or enum value'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.enum({ A: ['value'] } as never) }),
      'input.value.A',
      'reference-valued literal or enum value'
    );
  });

  test('accepts optional schemas without marker defaults', () => {
    expect(() =>
      deriveCurrentTrailVersionMarker(
        markerInput(z.object({ value: z.string().optional() }))
      )
    ).not.toThrow();
  });

  test('rejects hidden optional wrappers before marker hashing', () => {
    expectUnsupportedMarkerSchema(
      z.object({ value: z.string().optional().nullable() }),
      'input.value',
      'hidden optional wrapper'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.string().optional().readonly() }),
      'input.value',
      'hidden optional wrapper'
    );

    expect(() =>
      deriveCurrentTrailVersionMarker(
        markerInput(z.object({ value: z.string().nullable().optional() }))
      )
    ).not.toThrow();
    expect(() =>
      deriveCurrentTrailVersionMarker(
        markerInput(z.object({ value: z.string().readonly().optional() }))
      )
    ).not.toThrow();
  });

  test('accepts schemas with a deterministic JSON-schema override (blobRefSchema)', () => {
    // blobRefSchema is z.custom(...).meta({...}) — the preflight must not reject
    // it, because zodToJsonSchema projects it to a canonical descriptor.
    const marker = deriveCurrentTrailVersionMarker(
      markerInput(z.object({ file: blobRefSchema }))
    );
    expect(marker).toHaveLength(TRAIL_VERSION_MARKER_LENGTH);
  });

  test('rejects validation checks on schemas with JSON-schema overrides', () => {
    expectUnsupportedMarkerSchema(
      z.object({ file: blobRefSchema.refine((blob) => blob.size < 1024) }),
      'input.file',
      'custom'
    );
  });

  test('rejects multi-value literals that the projection cannot represent', () => {
    // The projection emits only the first literal value, so a multi-value
    // literal must fail loudly instead of colliding with a single-value one.
    expectUnsupportedMarkerSchema(
      z.object({ value: z.literal(['a', 'b']) }),
      'input.value',
      'multi-value literal'
    );
    // Single-value literals remain supported.
    expect(() =>
      deriveCurrentTrailVersionMarker(
        markerInput(z.object({ value: z.literal('a') }))
      )
    ).not.toThrow();
  });

  test('rejects non-finite literals that JSON serialization cannot preserve', () => {
    expectUnsupportedMarkerSchema(
      z.object({ value: z.literal(Number.NaN) }),
      'input.value',
      'non-finite literal'
    );
    expectUnsupportedMarkerSchema(
      z.object({ value: z.literal(Number.POSITIVE_INFINITY) }),
      'input.value',
      'non-finite literal'
    );
    // Finite and null literals remain supported and distinct.
    expect(() =>
      deriveCurrentTrailVersionMarker(
        markerInput(z.object({ value: z.literal(1) }))
      )
    ).not.toThrow();
    expect(() =>
      deriveCurrentTrailVersionMarker(
        markerInput(z.object({ value: z.literal(null) }))
      )
    ).not.toThrow();
  });

  test('rejects object unknown-key and catchall policies for markers', () => {
    expectUnsupportedMarkerSchema(
      z.object({ id: z.string() }).strict(),
      'input',
      'catchall'
    );
    expectUnsupportedMarkerSchema(
      z.object({ id: z.string() }).passthrough(),
      'input',
      'catchall'
    );
    expectUnsupportedMarkerSchema(
      z.object({ id: z.string() }).catchall(z.string()),
      'input',
      'catchall'
    );
  });

  test('rejects unsupported marker content instead of stringifying it', () => {
    expect(() =>
      canonicalizeTrailVersionMarkerContent({ schema: undefined })
    ).not.toThrow();
    expect(() =>
      canonicalizeTrailVersionMarkerContent({ parse: () => {} })
    ).toThrow(ValidationError);
    expect(() =>
      canonicalizeTrailVersionMarkerContent({ createdAt: new Date() })
    ).toThrow(ValidationError);
  });

  test('derives shortest unambiguous display prefixes with a length floor', () => {
    const marker = 'abcd000000000000';
    const display = deriveShortestUnambiguousTrailVersionMarkerPrefix(marker, [
      marker,
      'abce000000000000',
      'f000000000000000',
    ]);

    expect(display).toBe('abcd');
  });

  test('rejects display prefix derivation for markers outside the candidate set', () => {
    expect(() =>
      deriveShortestUnambiguousTrailVersionMarkerPrefix('abcd000000000000', [
        'abce000000000000',
        'f000000000000000',
      ])
    ).toThrow('not in the provided marker set');
  });

  test('resolves marker prefixes and rejects invalid or ambiguous prefixes', () => {
    const markers = [
      { marker: 'abcd000000000000', version: 1 },
      { marker: 'abcd100000000000', version: 2 },
      { marker: 'f000000000000000', version: 3 },
    ];

    expect(resolveTrailVersionMarkerPrefix(markers, 'f000')).toEqual({
      marker: 'f000000000000000',
      prefix: 'f000',
      version: 3,
    });
    expect(resolveTrailVersionMarkerPrefix(markers, 'ABCD1')).toEqual({
      marker: 'abcd100000000000',
      prefix: 'abcd1',
      version: 2,
    });
    expect(() => resolveTrailVersionMarkerPrefix(markers, 'abc')).toThrow(
      ValidationError
    );
    expect(() => resolveTrailVersionMarkerPrefix(markers, 'abcf')).toThrow(
      ValidationError
    );
    expect(() => resolveTrailVersionMarkerPrefix(markers, 'abcd')).toThrow(
      AmbiguousError
    );
  });

  test('reports full-marker ambiguity when duplicate markers exist', () => {
    expect(() =>
      deriveShortestUnambiguousTrailVersionMarkerPrefix('abcd000000000000', [
        'abcd000000000000',
        'abcd000000000000',
      ])
    ).toThrow(AmbiguousError);
  });
});
