import { describe, expect, test } from 'bun:test';

import { Result, topo, trail } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import type { TopoGraph, TopoGraphEntry } from '@ontrails/topographer';
import { z } from 'zod';

import {
  forkWithoutPreservedBlaze,
  markerSchemaUnsupported,
  versionPinnedCross,
} from '../rules/trail-versioning-source.js';
import {
  deprecationWithoutGuidance,
  pendingForce,
  versionGap,
  versionWithoutExamples,
} from '../rules/trail-versioning-topo.js';

const sourceFile = 'src/trails/versioning.ts';

const emptyTopo = topo('versioning-rules', {});

const graphWithEntry = (entry: TopoGraphEntry): TopoGraph => ({
  ...deriveTopoGraph(emptyTopo),
  entries: [entry],
});

const versionedTrail = trail('versioned.clean', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  version: 2,
  versions: {
    1: {
      examples: [{ input: {}, output: { ok: true } }],
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
    },
  },
});

describe('trail versioning source Warden rules', () => {
  test('version-pinned-cross warns on ctx.cross version options', () => {
    const diagnostics = versionPinnedCross.check(
      `
trail('parent', {
  blaze: async (_input, ctx) => {
    await ctx.cross('child', {}, { version: 1 });
    return Result.ok({});
  },
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        rule: 'version-pinned-cross',
        severity: 'warn',
      }),
    ]);
  });

  test('version-pinned-cross ignores input payload version fields', () => {
    const diagnostics = versionPinnedCross.check(
      `
trail('parent', {
  blaze: async (_input, ctx) => {
    await ctx.cross('child', { version: 1 });
    return Result.ok({});
  },
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([]);
  });

  test('fork-without-preserved-blaze rejects historical entries with no blaze or transpose', () => {
    const diagnostics = forkWithoutPreservedBlaze.check(
      `
trail('versioned.bad', {
  version: 2,
  versions: {
    1: {
      input: z.object({ old: z.string() }),
      output: z.object({ ok: z.boolean() }),
    },
  },
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        rule: 'fork-without-preserved-blaze',
        severity: 'error',
      }),
    ]);
  });

  test('marker-schema-unsupported rejects unstable version marker schema shapes', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('versioned.schema', {
  version: 2,
  input: z.object({ payload: z.any() }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        rule: 'marker-schema-unsupported',
        severity: 'error',
      }),
    ]);
  });

  test('marker-schema-unsupported ignores unsupported call names inside schema callbacks', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
const parser = {
  transform: (value) => value,
};

trail('versioned.schema-callback', {
  version: 2,
  input: z.object({
    payload: z.string().refine((value) => parser.transform(value).length > 0),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([]);
  });
});

describe('trail versioning topo-aware Warden rules', () => {
  test('version-gap catches non-contiguous coverage', async () => {
    const gapTrail = trail('versioned.gap', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      version: 3,
      versions: {
        1: {
          input: z.object({}),
          output: z.object({ ok: z.boolean() }),
          transpose: {
            input: ({ input }) => input,
            output: ({ output }) => output,
          },
        },
      },
    });

    const diagnostics = await versionGap.checkTopo(
      topo('version-gap', { gapTrail })
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('missing version 2'),
        rule: 'version-gap',
        severity: 'error',
      }),
    ]);
  });

  test('version-without-examples warns for live entries and exempts archived entries', async () => {
    const missingExampleTrail = trail('versioned.examples', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      version: 2,
      versions: {
        1: {
          input: z.object({}),
          output: z.object({ ok: z.boolean() }),
          transpose: {
            input: ({ input }) => input,
            output: ({ output }) => output,
          },
        },
      },
    });
    const archivedTrail = trail('versioned.archived', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      version: 2,
      versions: {
        1: {
          input: z.object({}),
          output: z.object({ ok: z.boolean() }),
          status: { state: 'archived' },
          transpose: {
            input: ({ input }) => input,
            output: ({ output }) => output,
          },
        },
      },
    });

    const diagnostics = await versionWithoutExamples.checkTopo(
      topo('version-examples', { archivedTrail, missingExampleTrail })
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('versioned.examples@1'),
        rule: 'version-without-examples',
        severity: 'warn',
      }),
    ]);
  });

  test('version-without-examples treats missing historical example counts as zero', async () => {
    const graph = graphWithEntry({
      exampleCount: 0,
      id: 'versioned.missing-count',
      kind: 'trail',
      surfaces: [],
      version: 2,
      versions: {
        1: {
          input: {},
          kind: 'revision',
          marker: 'aaaa',
          output: {},
        } as never,
      },
    });

    const diagnostics = await versionWithoutExamples.checkTopo(emptyTopo, {
      graph,
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('versioned.missing-count@1'),
        rule: 'version-without-examples',
        severity: 'warn',
      }),
    ]);
  });

  test('deprecation-without-guidance reads graph status even when runtime construction would reject it', async () => {
    const graph = graphWithEntry({
      exampleCount: 0,
      id: 'versioned.deprecated',
      kind: 'trail',
      surfaces: [],
      version: 2,
      versions: {
        1: {
          exampleCount: 0,
          input: {},
          kind: 'revision',
          marker: 'aaaa',
          output: {},
          status: { state: 'deprecated' } as never,
        },
      },
    });

    const diagnostics = await deprecationWithoutGuidance.checkTopo(emptyTopo, {
      graph,
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        rule: 'deprecation-without-guidance',
        severity: 'error',
      }),
    ]);
  });

  test('pending-force reports graph-only force audit entries', async () => {
    const [entry] = deriveTopoGraph(
      topo('version-clean', { versionedTrail })
    ).entries;
    const graph = graphWithEntry({
      ...entry,
      forces: [
        {
          acceptedAt: '2026-05-20T10:00:00.000Z',
          change: 'modified',
          detail: 'Version 1 input schema field removed: old',
          id: 'versioned.clean',
          kind: 'trail',
          severity: 'breaking',
          source: 'trails compile --force',
        },
      ],
    } as TopoGraphEntry);

    const diagnostics = await pendingForce.checkTopo(emptyTopo, { graph });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('pending forced topo break'),
        rule: 'pending-force',
        severity: 'warn',
      }),
    ]);
  });

  test('pending-force reports graph-level removed force audit entries', async () => {
    const graph = {
      ...deriveTopoGraph(emptyTopo),
      forces: [
        {
          acceptedAt: '2026-05-20T10:00:00.000Z',
          change: 'removed' as const,
          detail: 'Trail "legacy" removed',
          id: 'legacy',
          kind: 'trail' as const,
          severity: 'breaking' as const,
          source: 'trails compile --force' as const,
        },
      ],
    };

    const diagnostics = await pendingForce.checkTopo(emptyTopo, { graph });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('Trail "legacy"'),
        rule: 'pending-force',
        severity: 'warn',
      }),
    ]);
  });

  test('pending-force deduplicates overlapping entry and graph force audit entries', async () => {
    const force = {
      acceptedAt: '2026-05-20T10:00:00.000Z',
      change: 'modified' as const,
      detail: 'Version 1 input schema field removed: old',
      id: 'versioned.clean',
      kind: 'trail' as const,
      severity: 'breaking' as const,
      source: 'trails compile --force' as const,
    };
    const [entry] = deriveTopoGraph(
      topo('version-clean', { versionedTrail })
    ).entries;
    const graph = {
      ...graphWithEntry({
        ...entry,
        forces: [force],
      } as TopoGraphEntry),
      forces: [force],
    };

    const diagnostics = await pendingForce.checkTopo(emptyTopo, { graph });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('pending forced topo break'),
        rule: 'pending-force',
        severity: 'warn',
      }),
    ]);
  });
});
