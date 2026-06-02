import { describe, expect, test } from 'bun:test';

import { Result, topo, trail } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import type { TopoGraph, TopoGraphEntry } from '@ontrails/topographer';
import { z } from 'zod';

import {
  forkWithoutPreservedBlaze,
  markerSchemaUnsupported,
  versionPinnedCompose,
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
      examples: [{ expected: { ok: true }, input: {}, name: 'version 1' }],
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      transpose: {
        input: () => ({}),
        output: ({ output }) => output,
      },
    },
  },
});

describe('trail versioning source Warden rules', () => {
  test('version-pinned-compose warns on ctx.compose version options', () => {
    const diagnostics = versionPinnedCompose.check(
      `
trail('parent', {
  blaze: async (_input, ctx) => {
    await ctx.compose('child', {}, { version: 1 });
    return Result.ok({});
  },
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        rule: 'version-pinned-compose',
        severity: 'warn',
      }),
    ]);
  });

  test('version-pinned-compose ignores input payload version fields', () => {
    const diagnostics = versionPinnedCompose.check(
      `
trail('parent', {
  blaze: async (_input, ctx) => {
    await ctx.compose('child', { version: 1 });
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

  test('marker-schema-unsupported rejects runtime-unsupported schema types', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('versioned.schema-types', {
  version: 2,
  input: z.object({
    deferred: z.lazy(() => z.string()),
    merged: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
    keyed: z.record(z.string(), z.string()),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'marker-schema-unsupported',
          severity: 'error',
        }),
      ])
    );
  });

  test('marker-schema-unsupported rejects validation checks and object policies', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
const constrained = z.string().min(3);

trail('versioned.validation-checks', {
  version: 2,
  input: z.object({
    name: z.string().min(3),
    email: z.string().email(),
    count: z.number().int(),
    tags: z.array(z.string()).min(1),
    refined: z.string().refine((value) => value.length > 0),
    superRefined: z.string().superRefine((value, ctx) => {
      if (value.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'required' });
      }
    }),
    strictObject: z.object({ id: z.string() }).strict(),
    openObject: z.object({ id: z.string() }).passthrough(),
    catchallObject: z.object({ id: z.string() }).catchall(z.string()),
    fromBinding: constrained,
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(10);
    expect(diagnostics.every((entry) => entry.severity === 'error')).toBe(true);
  });

  test('marker-schema-unsupported covers string and number checks the runtime guard rejects', () => {
    // The runtime marker guard rejects any non-empty Zod def.checks, so these
    // previously omitted Zod v4 checks must surface as Warden diagnostics too.
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('versioned.omitted-checks', {
  version: 2,
  input: z.object({
    trimmed: z.string().trim(),
    emoji: z.string().emoji(),
    base64: z.string().base64(),
    base64url: z.string().base64url(),
    cuid: z.string().cuid(),
    cuid2: z.string().cuid2(),
    ksuid: z.string().ksuid(),
    stepped: z.number().step(2),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(8);
    expect(diagnostics.every((entry) => entry.severity === 'error')).toBe(true);
    expect(
      diagnostics.every((entry) => entry.rule === 'marker-schema-unsupported')
    ).toBe(true);
  });

  test('marker-schema-unsupported flags coerced primitives the runtime guard rejects', () => {
    // z.coerce.number()/string()/boolean() end in a supported primitive name,
    // so the deny-list never matches; the coercion lives on the intermediate
    // .coerce member, which the runtime marker guard rejects.
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('versioned.coerced', {
  version: 2,
  input: z.object({
    n: z.coerce.number(),
    s: z.coerce.string(),
    b: z.coerce.boolean(),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(3);
    expect(
      diagnostics.every(
        (entry) =>
          entry.rule === 'marker-schema-unsupported' &&
          entry.severity === 'error'
      )
    ).toBe(true);
  });

  test('marker-schema-unsupported covers runtime-rejected constructors and modifiers', () => {
    // Evidence-verified against the runtime marker guard: each of these forms is
    // rejected at marker derivation, so the source rule must flag them too.
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('versioned.runtime-rejected', {
  version: 2,
  input: z.object({
    big: z.bigint(),
    tup: z.tuple([z.string()]),
    strictObj: z.strictObject({ a: z.string() }),
    looseObj: z.looseObject({ a: z.string() }),
    intersected: z.string().and(z.string()),
    caught: z.string().catch('x'),
    piped: z.string().pipe(z.string()),
    mapped: z.map(z.string(), z.string()),
    setted: z.set(z.string()),
    promised: z.promise(z.string()),
    sym: z.symbol(),
    notANumber: z.nan(),
    nul: z.null(),
    undef: z.undefined(),
    voided: z.void(),
    nevered: z.never(),
    fileField: z.file(),
    fn: z.function(),
    coded: z.codec(z.string(), z.string(), {
      decode: (value) => value,
      encode: (value) => value,
    }),
    stringBoolean: z.stringbool(),
    hashed: z.hash('sha256'),
    looseRec: z.looseRecord(z.string(), z.string()),
    instance: z.instanceof(Date),
    template: z.templateLiteral([z.string()]),
    partial: z.partialRecord(z.string(), z.string()),
    jsonField: z.json(),
    requiredAgain: z.string().nonoptional(),
    prefaulted: z.string().prefault('x'),
	    overwritten: z.string().overwrite((value) => value.trim()),
	    manualCheck: z.string().check((ctx) => {}),
	    requiredObject: z.object({ a: z.string().optional() }).required(),
	    defaulted: z.string().default('x'),
	    multiLiteral: z.literal(['a', 'b']),
	    constMultiLiteral: z.literal(['a', 'b'] as const),
	  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(34);
    expect(
      diagnostics.every(
        (entry) =>
          entry.rule === 'marker-schema-unsupported' &&
          entry.severity === 'error'
      )
    ).toBe(true);
  });

  test('marker-schema-unsupported rejects reference-valued literal and enum values', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('versioned.reference-values', {
  version: 2,
  input: z.object({
    objectLiteral: z.literal({ key: 'value' } as const),
    arrayLiteral: z.literal([['value']] as const),
    objectEnum: z.enum({ A: { key: 'value' } } as never),
    arrayEnum: z.enum({ A: ['value'] } as never),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(4);
    expect(
      diagnostics.every(
        (entry) =>
          entry.rule === 'marker-schema-unsupported' &&
          entry.severity === 'error'
      )
    ).toBe(true);
  });

  test('marker-schema-unsupported keeps supported wrappers and unions clean', () => {
    // Guard against deny-list false positives on runtime-accepted forms.
    const diagnostics = markerSchemaUnsupported.check(
      `
const statuses = ['a', 'b'] as const;

trail('versioned.supported', {
  version: 2,
  input: z.object({
    opt: z.string().optional(),
    nullable: z.string().nullable(),
    nullish: z.string().nullish(),
    readonlyField: z.string().readonly(),
    described: z.string().describe('d'),
    union: z.string().or(z.number()),
    branded: z.string().brand('X'),
    choice: z.enum(['a', 'b']),
    computedChoice: z.enum(statuses.map((status) => status)),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([]);
  });

  test('marker-schema-unsupported rejects defaults in versioned marker schemas', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('versioned.defaults', {
  version: 2,
  input: z.object({
    stable: z.string().default('draft'),
    random: z.string().default(() => Math.random().toString()),
    clock: z.number().default(() => Date.now()),
    lossy: z.number().default(Number.NaN),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(4);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'marker-schema-unsupported',
          severity: 'error',
        }),
      ])
    );
  });

  test('marker-schema-unsupported rejects JSON-lossy literal and enum values', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('versioned.json-lossy-values', {
  version: 2,
  input: z.object({
    nanLiteral: z.literal(Number.NaN),
	    infiniteLiteral: z.literal(Number.POSITIVE_INFINITY),
	    undefinedLiteral: z.literal(undefined),
	    bigintLiteral: z.literal(1n),
	    regexLiteral: z.literal(/x/),
	    arrayLiteral: z.literal([Number.NaN] as const),
	    nanEnum: z.enum({ A: Number.NaN } as never),
	    infiniteEnum: z.enum([Number.POSITIVE_INFINITY] as never),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(8);
    expect(
      diagnostics.every(
        (entry) =>
          entry.rule === 'marker-schema-unsupported' &&
          entry.severity === 'error'
      )
    ).toBe(true);
  });

  test('marker-schema-unsupported rejects hidden optional wrappers', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('versioned.hidden-optional', {
  version: 2,
  input: z.object({
    hiddenInNullable: z.string().optional().nullable(),
    hiddenInReadonly: z.string().optional().readonly(),
    visibleNullable: z.string().nullable().optional(),
    visibleReadonly: z.string().readonly().optional(),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(2);
    expect(
      diagnostics.every(
        (entry) =>
          entry.rule === 'marker-schema-unsupported' &&
          entry.severity === 'error'
      )
    ).toBe(true);
  });

  test('marker-schema-unsupported follows aliases for hidden optional wrappers', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
const base = z.string().optional();
const nested = base.nullable();

trail('versioned.hidden-optional-alias', {
  version: 2,
  input: z.object({
    visible: base,
    directHidden: base.nullable(),
    nestedHidden: nested,
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(2);
    expect(
      diagnostics.every(
        (entry) =>
          entry.rule === 'marker-schema-unsupported' &&
          entry.severity === 'error'
      )
    ).toBe(true);
  });

  test('marker-schema-unsupported rejects optional wrappers outside object properties', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
const visible = z.string().optional();
const hidden = z.string().optional();
const nested = z.string().optional();

trail('versioned.optional-context', {
  version: 2,
  input: hidden,
  output: z.object({
    visible,
    nestedHidden: z.array(nested),
    directNestedHidden: z.array(z.string().optional()),
  }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(3);
    expect(
      diagnostics.every(
        (entry) =>
          entry.rule === 'marker-schema-unsupported' &&
          entry.severity === 'error'
      )
    ).toBe(true);
  });

  test('marker-schema-unsupported covers named Zod schema bindings', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
const base = z.string();

trail('versioned.schema-binding', {
  version: 2,
  input: z.object({
    name: base.min(3),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual(
      expect.objectContaining({
        rule: 'marker-schema-unsupported',
        severity: 'error',
      })
    );
  });

  test('marker-schema-unsupported does not follow shadowed schema binding names', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
		function buildHelper() {
	  const status = z.string().min(3);
	  return status;
	}

	const status = 'active';

	trail('versioned.shadowed-binding', {
	  version: 2,
	  input: z.object({
	    status: z.literal(status),
	  }),
	  output: z.object({ ok: z.boolean() }),
	  blaze: async () => Result.ok({ ok: true }),
	});
	`,
      sourceFile
    );

    expect(diagnostics).toEqual([]);
  });

  test('marker-schema-unsupported treats function parameters as binding shadows', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
const status = z.string().min(3);

function makeTrail(status: 'active') {
  return trail('versioned.parameter-shadow', {
    version: 2,
    input: z.object({
      status: z.literal(status),
    }),
    output: z.object({ ok: z.boolean() }),
    blaze: async () => Result.ok({ ok: true }),
  });
}
`,
      sourceFile
    );

    expect(diagnostics).toEqual([]);
  });

  test('marker-schema-unsupported respects block scope for schema bindings', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
const status = 'active';

{
  const status = z.string().min(3);
}

trail('versioned.block-shadowed-binding', {
  version: 2,
  input: z.object({
    status: z.literal(status),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([]);
  });

  test('marker-schema-unsupported follows schema aliases', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
const constrained = z.string().min(3);
const field = constrained;

trail('versioned.schema-alias', {
  version: 2,
  input: z.object({
    name: field,
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual(
      expect.objectContaining({
        rule: 'marker-schema-unsupported',
        severity: 'error',
      })
    );
  });

  test('marker-schema-unsupported ignores helper factories named like checks', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
const email = () => z.string();
const map = () => z.string();
const min = () => z.number();

trail('versioned.helper-factories', {
  version: 2,
  input: z.object({
    address: email(),
    label: map(),
    count: min(),
  }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([]);
  });

  test('marker-schema-unsupported ignores unversioned trail schemas', () => {
    const diagnostics = markerSchemaUnsupported.check(
      `
trail('unversioned.schema', {
  input: z.object({ payload: z.record(z.string(), z.string()) }),
  output: z.object({ ok: z.boolean() }),
  blaze: async () => Result.ok({ ok: true }),
});
`,
      sourceFile
    );

    expect(diagnostics).toEqual([]);
  });

  test('marker-schema-unsupported skips unsupported call names inside schema callbacks', () => {
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

    expect(diagnostics).toEqual([
      expect.objectContaining({
        rule: 'marker-schema-unsupported',
        severity: 'error',
      }),
    ]);
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
