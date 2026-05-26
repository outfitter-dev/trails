import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

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
