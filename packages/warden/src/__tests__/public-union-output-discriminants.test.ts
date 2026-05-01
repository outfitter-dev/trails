import { describe, expect, test } from 'bun:test';

import { Result, topo, trail } from '@ontrails/core';
import type { AnyTrail, TrailVisibility } from '@ontrails/core';
import { z } from 'zod';

import { publicUnionOutputDiscriminants } from '../rules/public-union-output-discriminants.js';

const emptyInput = z.object({});

const buildTrail = <TOutput>(
  id: string,
  output: z.ZodType<TOutput>,
  options: {
    readonly meta?: Readonly<Record<string, unknown>>;
    readonly visibility?: TrailVisibility;
  } = {}
) =>
  trail(id, {
    blaze: () => Result.ok(undefined as TOutput),
    input: emptyInput,
    output,
    ...options,
  });

const buildTopo = (...trails: readonly AnyTrail[]) =>
  topo(
    'public-union-output-discriminants-fixture',
    Object.fromEntries(
      trails.map((trailValue, index) => [`trail${index}`, trailValue])
    )
  );

const check = (...trails: readonly AnyTrail[]) =>
  publicUnionOutputDiscriminants.checkTopo(buildTopo(...trails));

describe('public-union-output-discriminants', () => {
  test('flags public object union outputs without a literal discriminator', () => {
    const diagnostics = check(
      buildTrail(
        'report.read',
        z.union([
          z.object({ message: z.string() }),
          z.object({ count: z.number() }),
        ])
      )
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      'Trail "report.read" exposes a public output anyOf'
    );
    expect(diagnostics[0]?.message).toContain('required literal discriminator');
  });

  test('allows discriminated public object union outputs', () => {
    const diagnostics = check(
      buildTrail(
        'report.read',
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('message'), message: z.string() }),
          z.object({ count: z.number(), kind: z.literal('count') }),
        ])
      )
    );

    expect(diagnostics).toEqual([]);
  });

  test('requires discriminator literal values to distinguish every branch', () => {
    const diagnostics = check(
      buildTrail(
        'report.read',
        z.union([
          z.object({ kind: z.literal('same'), message: z.string() }),
          z.object({ count: z.number(), kind: z.literal('same') }),
        ])
      )
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('flags ambiguous public object unions with nullable branches', () => {
    const diagnostics = check(
      buildTrail(
        'report.read',
        z.union([
          z.object({ message: z.string() }),
          z.object({ count: z.number() }),
          z.null(),
        ])
      )
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('ignores internal trails even when their output unions are ambiguous', () => {
    const diagnostics = check(
      buildTrail(
        'report.internal',
        z.union([
          z.object({ message: z.string() }),
          z.object({ count: z.number() }),
        ]),
        { visibility: 'internal' }
      )
    );

    expect(diagnostics).toEqual([]);
  });

  test('ignores legacy meta.internal trails even when their output unions are ambiguous', () => {
    const diagnostics = check(
      buildTrail(
        'report.legacyInternal',
        z.union([
          z.object({ message: z.string() }),
          z.object({ count: z.number() }),
        ]),
        { meta: { internal: true } }
      )
    );

    expect(diagnostics).toEqual([]);
  });

  test('ignores non-object and nullable output unions', () => {
    const diagnostics = check(
      buildTrail('value.read', z.union([z.string(), z.number()])),
      buildTrail('maybe.read', z.object({ value: z.string() }).nullable())
    );

    expect(diagnostics).toEqual([]);
  });
});
