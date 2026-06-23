import { describe, expect, test } from 'bun:test';

import { Result, signal, topo, trail } from '@ontrails/core';
import type { AnyTrail, TrailVisibility } from '@ontrails/core';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { publicOutputSchema } from '../rules/public-output-schema.js';
import type { WardenDiagnostic } from '../rules/types.js';

const emptyInput = z.object({});
const outputSchema = z.object({ ok: z.boolean() });
const changed = signal('entity.changed', {
  payload: z.object({ id: z.string() }),
});

const buildTrail = (
  id: string,
  options: {
    readonly meta?: Readonly<Record<string, unknown>>;
    readonly on?: readonly (typeof changed)[];
    readonly output?: typeof outputSchema;
    readonly visibility?: TrailVisibility;
  } = {}
) =>
  trail(id, {
    blaze: () => Result.ok({ ok: true }),
    input: emptyInput,
    ...options,
  });

const buildTopo = (...trails: readonly AnyTrail[]) =>
  topo(
    'public-output-schema-fixture',
    Object.fromEntries(
      trails.map((trailValue, index) => [`trail${index}`, trailValue])
    )
  );

const check = (...trails: readonly AnyTrail[]): readonly WardenDiagnostic[] => {
  const diagnostics = publicOutputSchema.checkTopo(buildTopo(...trails));
  if (diagnostics instanceof Promise) {
    throw new TypeError('public-output-schema runs synchronously');
  }
  return diagnostics;
};

describe('public-output-schema', () => {
  test('flags public surface-eligible trails without output schemas', () => {
    const diagnostics = check(buildTrail('report.read'));

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      filePath: '<topo>',
      rule: 'public-output-schema',
      severity: 'error',
    });
    expect(diagnostics[0]?.message).toContain(
      'Trail "report.read" is visible to public MCP/HTTP surface projection'
    );
  });

  test('allows public surface-eligible trails with output schemas', () => {
    const diagnostics = check(
      buildTrail('report.read', { output: outputSchema })
    );

    expect(diagnostics).toEqual([]);
  });

  test('ignores internal trails without output schemas', () => {
    const diagnostics = check(
      buildTrail('report.internal', { visibility: 'internal' })
    );

    expect(diagnostics).toEqual([]);
  });

  test('ignores legacy meta.internal trails without output schemas', () => {
    const diagnostics = check(
      buildTrail('report.legacyInternal', { meta: { internal: true } })
    );

    expect(diagnostics).toEqual([]);
  });

  test('ignores activation-source consumers because they are not direct surface routes', () => {
    const diagnostics = check(
      buildTrail('report.index', {
        on: [changed],
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('runWarden includes public output schema diagnostics when topo is supplied', async () => {
    const report = await runWarden({
      rootDir: process.cwd(),
      tier: 'topo-aware',
      topo: buildTopo(buildTrail('report.read')),
    });

    expect(
      report.diagnostics.some(
        (diagnostic) => diagnostic.rule === 'public-output-schema'
      )
    ).toBe(true);
  });
});
