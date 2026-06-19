import { Result, ValidationError, trail } from '@ontrails/core';
import type { Result as TrailResult, TrailContext } from '@ontrails/core';
import {
  wayfinderIncludeSchema,
  wayfinderSourceModeSchema,
  wayfinderViewSchema,
} from '@ontrails/wayfinder';
import type { WayfinderInclude, WayfinderView } from '@ontrails/wayfinder';
import { z } from 'zod';

const wayfindInputSchema = z
  .object({
    include: z
      .array(wayfinderIncludeSchema)
      .default([])
      .describe('Attach bounded fact families to the selected result'),
    intent: z
      .enum(['destroy', 'read', 'write'])
      .optional()
      .describe('Filter trails by intent'),
    limit: z.number().int().positive().max(500).default(100),
    resources: z.boolean().default(false).describe('Resolve resource facts'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    source: wayfinderSourceModeSchema
      .default('locked')
      .describe('Graph source to read'),
    surfaces: z.boolean().default(false).describe('Resolve surface facts'),
    target: z
      .string()
      .optional()
      .describe('Graph entity ID or source file path to inspect'),
    trails: z.boolean().default(false).describe('Resolve trail facts'),
    view: wayfinderViewSchema
      .default('list')
      .describe('View to render for the resolved target or population'),
  })
  .strict();

const wayfindOutputSchema = z.object({
  includes: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown(),
  source: wayfinderSourceModeSchema,
  target: z.string().optional(),
  view: wayfinderViewSchema,
});

type WayfindInput = z.output<typeof wayfindInputSchema>;
type TrailContextWithCompose = TrailContext & {
  readonly compose: NonNullable<TrailContext['compose']>;
};

const sourceUnsupported = (input: WayfindInput) =>
  input.source === 'live'
    ? new ValidationError(
        '`trails wayfind --source live` is reserved for the live graph cutover; use locked artifacts for this release candidate.'
      )
    : undefined;

const sourceInput = (
  input: WayfindInput
): { readonly rootDir?: string | undefined } =>
  input.rootDir === undefined ? {} : { rootDir: input.rootDir };

const populationFilters = (
  input: WayfindInput
): { readonly intent?: WayfindInput['intent'] } =>
  input.intent === undefined ? {} : { intent: input.intent };

const targetLooksLikeFile = (target: string): boolean =>
  target.includes('/') || /\.[cm]?[jt]sx?$/.test(target);

const targetLooksLikePattern = (target: string): boolean =>
  target.includes('*') || target.includes('?');

const targetFilter = (input: WayfindInput) => {
  if (input.target === undefined) {
    return populationFilters(input);
  }
  return targetLooksLikePattern(input.target)
    ? { idGlob: input.target }
    : { id: input.target };
};

const includeResultKey = (include: WayfinderInclude): string => include;

const includeInput = (input: WayfindInput) => ({
  filters: targetFilter(input),
  limit: input.limit,
  ...sourceInput(input),
});

const composeInclude = (
  include: WayfinderInclude,
  input: WayfindInput,
  ctx: TrailContextWithCompose
) => {
  switch (include) {
    case 'adapters': {
      return ctx.compose('wayfind.adapters', {
        limit: input.limit,
        ...sourceInput(input),
      });
    }
    case 'errors': {
      return ctx.compose('wayfind.errors', includeInput(input));
    }
    case 'examples': {
      return ctx.compose('wayfind.examples', includeInput(input));
    }
    case 'surfaces': {
      return ctx.compose('wayfind.surfaces', includeInput(input));
    }
    case 'versions': {
      return ctx.compose('wayfind.versions', includeInput(input));
    }
    default: {
      return Result.err(
        new ValidationError(`Unsupported Wayfinder include: ${include}`)
      );
    }
  }
};

const resolveIncludes = async (
  input: WayfindInput,
  ctx: TrailContextWithCompose
) => {
  if (input.include.length === 0) {
    return Result.ok();
  }
  const includes: Record<string, unknown> = {};
  for (const include of input.include) {
    const result = await composeInclude(include, input, ctx);
    if (result.isErr()) {
      return Result.err(result.error);
    }
    includes[includeResultKey(include)] = result.value;
  }
  return Result.ok(includes);
};

const envelopeFor = async (
  result: Awaited<ReturnType<TrailContextWithCompose['compose']>>,
  input: WayfindInput,
  ctx: TrailContextWithCompose,
  view: WayfinderView
): Promise<TrailResult<z.output<typeof wayfindOutputSchema>, Error>> => {
  if (result.isErr()) {
    return Result.err(result.error);
  }
  const includes = await resolveIncludes(input, ctx);
  if (includes.isErr()) {
    return Result.err(includes.error);
  }
  return Result.ok({
    ...(includes.value === undefined ? {} : { includes: includes.value }),
    result: result.value,
    source: input.source,
    ...(input.target === undefined ? {} : { target: input.target }),
    view,
  });
};

const viewTarget = async (
  input: WayfindInput,
  ctx: TrailContextWithCompose
) => {
  const { target } = input;
  if (target === undefined) {
    return;
  }
  if (targetLooksLikeFile(target) || input.view === 'outline') {
    return {
      result: ctx.compose('wayfind.outline', {
        all: false,
        contracts: false,
        file: target,
        review: false,
        source: false,
        ...sourceInput(input),
        surfaces: false,
      }),
      view: 'outline' as const,
    };
  }
  if (targetLooksLikePattern(target)) {
    return {
      result: ctx.compose('wayfind.search', {
        filters: { idGlob: target },
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (input.view === 'contract') {
    return {
      result: ctx.compose('wayfind.contract', {
        id: target,
        ...sourceInput(input),
      }),
      view: 'contract' as const,
    };
  }
  if (input.view === 'describe' || input.view === 'summary') {
    return {
      result: ctx.compose('wayfind.describe', {
        id: target,
        ...sourceInput(input),
      }),
      view: input.view,
    };
  }
  if (input.view === 'map') {
    return {
      result: ctx.compose('wayfind.impact', {
        direction: 'both',
        id: target,
        limit: input.limit,
        maxDepth: 1,
        ...sourceInput(input),
      }),
      view: 'map' as const,
    };
  }
  return {
    result: ctx.compose('wayfind.describe', {
      id: target,
      ...sourceInput(input),
    }),
    view: 'describe' as const,
  };
};

const viewPopulation = async (
  input: WayfindInput,
  ctx: TrailContextWithCompose
) => {
  const filters = populationFilters(input);
  if (input.view === 'overview') {
    return {
      result: ctx.compose('wayfind.overview', sourceInput(input)),
      view: 'overview' as const,
    };
  }
  if (input.resources) {
    return {
      result: ctx.compose('wayfind.resources', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (input.surfaces) {
    return {
      result: ctx.compose('wayfind.surfaces', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  if (input.trails || input.intent !== undefined) {
    return {
      result: ctx.compose('wayfind.trails', {
        filters,
        limit: input.limit,
        ...sourceInput(input),
      }),
      view: 'list' as const,
    };
  }
  return {
    result: ctx.compose('wayfind.search', {
      filters,
      limit: input.limit,
      ...sourceInput(input),
    }),
    view: 'list' as const,
  };
};

export const wayfindTrail = trail('wayfind.navigate', {
  args: ['target'],
  blaze: async (input, ctx) => {
    const unsupported = sourceUnsupported(input);
    if (unsupported !== undefined) {
      return Result.err(unsupported);
    }
    const dispatched = await (input.target === undefined
      ? viewPopulation(input, ctx)
      : viewTarget(input, ctx));
    if (dispatched === undefined) {
      return Result.err(
        new ValidationError('Provide a Wayfinder target or population filter.')
      );
    }
    return envelopeFor(await dispatched.result, input, ctx, dispatched.view);
  },
  cli: {
    path: 'wayfind',
  },
  composes: [
    'wayfind.contract',
    'wayfind.describe',
    'wayfind.examples',
    'wayfind.impact',
    'wayfind.outline',
    'wayfind.overview',
    'wayfind.resources',
    'wayfind.search',
    'wayfind.surfaces',
    'wayfind.trails',
    'wayfind.versions',
  ],
  description: 'Navigate Trails graph facts by target, filters, and view',
  examples: [
    {
      input: {},
      name: 'List graph entries',
    },
    {
      input: { target: 'wayfind.search', view: 'contract' },
      name: 'Inspect a trail contract',
    },
    {
      input: { target: 'wayfind.search' },
      name: 'Describe a trail',
    },
    {
      input: { target: 'wayfind.search', view: 'map' },
      name: 'Map nearby graph context',
    },
    {
      input: { target: 'apps/trails/src/trails/wayfind.ts' },
      name: 'Outline a source file',
    },
    {
      input: { resources: true },
      name: 'List resource facts',
    },
    {
      input: { surfaces: true },
      name: 'List surface facts',
    },
    {
      input: { view: 'overview' },
      name: 'Show graph overview',
    },
    {
      input: { include: ['examples'], target: 'wayfind.search' },
      name: 'Attach examples for a target',
    },
    {
      input: { include: ['versions'], target: 'wayfind.search' },
      name: 'Attach version facts for a target',
    },
    {
      input: { intent: 'read', trails: true },
      name: 'List read trails',
    },
  ],
  input: wayfindInputSchema,
  intent: 'read',
  output: wayfindOutputSchema,
  visibility: 'public',
});
