/* oxlint-disable require-await -- blazes satisfy async interface without awaiting */
import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { executeTrail } from '../execute';
import {
  ConflictError,
  ValidationError,
  VersionNotSupportedError,
} from '../errors';
import type { Layer } from '../layer';
import { Result } from '../result';
import { resource } from '../resource';
import { run } from '../run';
import { topo } from '../topo';
import { trail } from '../trail';
import type { TrailContext } from '../types';
import { deriveTrailVersionMarkers } from '../version-marker';

const currentInput = z.object({
  loud: z.boolean().optional(),
  name: z.string(),
});
const currentOutput = z.object({
  message: z.string(),
  source: z.string(),
});
const legacyInput = z.object({ fullName: z.string() });
const legacyOutput = z.object({ text: z.string() });
const archivedInput = z.object({ archivedName: z.string() });
const forkInput = z.object({ id: z.string() });
const forkComposeInput = z.object({ source: z.string() });
const forkOutput = z.object({ summary: z.string() });

const suffixResource = resource('version.runtime.suffix', {
  create: () => Result.ok({ value: 'resource' }),
});

const versionHelper = trail('version.runtime.helper', {
  blaze: (input) => Result.ok({ value: `helper:${input.id}` }),
  input: z.object({ id: z.string() }),
  output: z.object({ value: z.string() }),
  visibility: 'internal',
});

const requireCompose = (
  ctx: TrailContext
): NonNullable<TrailContext['compose']> => {
  expect(ctx.compose).toBeDefined();
  return ctx.compose as NonNullable<TrailContext['compose']>;
};

const versionedTrail = trail('version.runtime.greet', {
  blaze: (input) =>
    Result.ok({
      message: `${input.loud ? 'HELLO' : 'hello'} ${input.name}`,
      source: 'current',
    }),
  input: currentInput,
  output: currentOutput,
  version: 6,
  versions: {
    1: {
      input: legacyInput,
      output: legacyOutput,
      transpose: {
        input: ({ input }) => ({ name: input.fullName }),
        output: ({ output }) => ({ text: output.message }),
      },
    },
    2: {
      input: currentInput,
      output: currentOutput,
      status: { note: 'still live for migration', state: 'deprecated' },
    },
    4: {
      input: archivedInput,
      output: legacyOutput,
      status: { state: 'archived' },
      transpose: {
        input: ({ input }) => ({ name: input.archivedName }),
        output: ({ output }) => ({ text: output.message }),
      },
    },
    5: {
      blaze: async (input, ctx) => {
        if (input.id === 'detour') {
          return Result.err(new ConflictError('fork conflict'));
        }
        const helper = await requireCompose(ctx)('version.runtime.helper', {
          id: input.id,
        });
        if (helper.isErr()) {
          return Result.err(helper.error);
        }
        return Result.ok({
          summary: `${input.source}:${helper.value.value}:${suffixResource.from(ctx).value}`,
        });
      },
      composeInput: forkComposeInput,
      composes: [versionHelper],
      detours: [
        {
          on: ConflictError,
          recover: ({ input }) =>
            Result.ok({ summary: `detoured:${input.id}` }),
        },
      ],
      input: forkInput,
      output: forkOutput,
      resources: [suffixResource],
    },
  },
});

const versionedTopo = topo('version-runtime-topo', {
  versionHelper,
  versionedTrail,
});

const numericMarkerTrail = trail('version.runtime.numeric-marker', {
  blaze: (input) => Result.ok({ value: `current:${input.current}` }),
  input: z.object({ current: z.string() }),
  output: z.object({ value: z.string() }),
  version: 2,
  versions: {
    1: {
      input: z.object({ field3: z.string() }),
      output: z.object({ value: z.string() }),
      transpose: {
        input: ({ input }) => ({ current: input.field3 }),
        output: ({ output }) => output,
      },
    },
  },
});

describe('trail version execution', () => {
  test('runs the current contract when the current version is requested', async () => {
    const result = await executeTrail(
      versionedTrail,
      { name: 'Ada' },
      { version: 6 }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      message: 'hello Ada',
      source: 'current',
    });
  });

  test('runs revision entries by transposing through the current contract', async () => {
    const seenInputs: unknown[] = [];
    const captureLayer: Layer = {
      name: 'capture-current-input',
      wrap(_trail, impl) {
        return async (input, ctx) => {
          seenInputs.push(input);
          return await impl(input, ctx);
        };
      },
    };

    const result = await executeTrail(
      versionedTrail,
      { fullName: 'Ada' },
      { layers: [captureLayer], version: 1 }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ text: 'hello Ada' });
    expect(seenInputs).toEqual([{ name: 'Ada' }]);
  });

  test('keeps deprecated historical entries live', async () => {
    const result = await executeTrail(
      versionedTrail,
      { loud: true, name: 'Ada' },
      { version: 2 }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      message: 'HELLO Ada',
      source: 'current',
    });
  });

  test('runs fork entries with their own blaze, resources, composes, and detours', async () => {
    const result = await executeTrail(
      versionedTrail,
      { id: 'forked', source: 'direct' },
      {
        topo: versionedTopo,
        validationSchema: z.object({
          id: z.string(),
          source: z.string(),
        }),
        version: 5,
      }
    );
    const detoured = await executeTrail(
      versionedTrail,
      { id: 'detour', source: 'direct' },
      {
        topo: versionedTopo,
        validationSchema: z.object({
          id: z.string(),
          source: z.string(),
        }),
        version: 5,
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      summary: 'direct:helper:forked:resource',
    });
    expect(detoured.isOk()).toBe(true);
    expect(detoured.unwrap()).toEqual({ summary: 'detoured:detour' });
  });

  test('preserves caller validation schema for direct fork version execution', async () => {
    const result = await executeTrail(
      versionedTrail,
      { id: 'forked', source: 'compose-only' },
      {
        topo: versionedTopo,
        validationSchema: z.object({
          id: z.string(),
          source: z.literal('direct'),
        }),
        version: 5,
      }
    );

    expect(result.isErr()).toBe(true);
    expect(result.error).toBeInstanceOf(ValidationError);
  });

  test('does not leak current composeInput validation into forks without composeInput', async () => {
    const target = trail('version.runtime.fork.without-compose-input', {
      blaze: (input) => Result.ok({ seen: `current:${input.id}` }),
      composeInput: z.object({ source: z.literal('current') }),
      input: z.object({ id: z.string() }),
      output: z.object({ seen: z.string() }),
      version: 2,
      versions: {
        1: {
          blaze: (input) => Result.ok({ seen: `fork:${input.source}` }),
          input: z.object({
            id: z.string(),
            source: z.literal('fork'),
          }),
          output: z.object({ seen: z.string() }),
        },
      },
    });
    const parent = trail('version.runtime.fork.compose-input.parent', {
      blaze: async (_input, ctx) => {
        const composed = await requireCompose(ctx)(
          'version.runtime.fork.without-compose-input',
          {
            id: 'forked',
            source: 'fork',
          },
          { version: 1 }
        );
        return composed.match({
          err: (error) => Result.err(error),
          ok: (value) => Result.ok(value),
        });
      },
      composes: [target],
      input: z.object({}),
      output: z.object({ seen: z.string() }),
    });
    const app = topo('version-runtime-fork-compose-input-topo', {
      parent,
      target,
    });

    const result = await executeTrail(parent, {}, { topo: app });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ seen: 'fork:fork' });
  });

  test('resolves marker-prefix references with the same projected markers', async () => {
    const marker = deriveTrailVersionMarkers(versionedTrail).find(
      (candidate) => candidate.version === 1
    )?.marker;
    expect(marker).toBeDefined();

    const result = await executeTrail(
      versionedTrail,
      { fullName: 'Ada' },
      { version: `@${marker?.slice(0, 4)}` }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ text: 'hello Ada' });
  });

  test('resolves all-digit marker prefixes when no matching numeric version exists', async () => {
    const marker = deriveTrailVersionMarkers(numericMarkerTrail).find(
      (candidate) => candidate.version === 1
    )?.marker;
    expect(marker).toMatch(/^\d{4}/);

    const result = await executeTrail(
      numericMarkerTrail,
      { field3: 'Ada' },
      { version: marker?.slice(0, 4) }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ value: 'current:Ada' });
  });

  test('rejects archived and missing version references', async () => {
    const archived = await executeTrail(
      versionedTrail,
      { archivedName: 'Ada' },
      { version: 4 }
    );
    const missing = await executeTrail(
      versionedTrail,
      { name: 'Ada' },
      { version: 42 }
    );

    expect(archived.isErr()).toBe(true);
    expect(archived.error).toBeInstanceOf(VersionNotSupportedError);
    expect((archived.error as VersionNotSupportedError).reason).toBe(
      'archived'
    );
    expect((archived.error as VersionNotSupportedError).context).toMatchObject({
      reason: 'archived',
      supported: [1, 2, 5, 6],
    });
    expect(missing.isErr()).toBe(true);
    expect(missing.error).toBeInstanceOf(VersionNotSupportedError);
    expect((missing.error as VersionNotSupportedError).reason).toBe('missing');
    expect((missing.error as VersionNotSupportedError).context).toMatchObject({
      reason: 'missing',
    });
  });

  test('keeps ctx.compose() current by default and allows explicit version pins', async () => {
    const parent = trail('version.runtime.parent', {
      blaze: async (_input, ctx) => {
        const compose = requireCompose(ctx);
        const current = await compose('version.runtime.greet', { name: 'Ada' });
        const legacy = await compose(
          'version.runtime.greet',
          { fullName: 'Ada' },
          { version: 1 }
        );
        const fork = await compose(
          'version.runtime.greet',
          { id: 'forked', source: 'parent' },
          { version: 5 }
        );
        if (current.isErr()) {
          return Result.err(current.error);
        }
        if (legacy.isErr()) {
          return Result.err(legacy.error);
        }
        if (fork.isErr()) {
          return Result.err(fork.error);
        }
        return Result.ok({
          current: (current.value as { message: string }).message,
          fork: (fork.value as { summary: string }).summary,
          legacy: (legacy.value as { text: string }).text,
        });
      },
      composes: [versionedTrail],
      input: z.object({}),
      output: z.object({
        current: z.string(),
        fork: z.string(),
        legacy: z.string(),
      }),
    });
    const app = topo('version-runtime-compose-topo', {
      parent,
      versionHelper,
      versionedTrail,
    });

    const result = await executeTrail(parent, {}, { topo: app });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      current: 'hello Ada',
      fork: 'parent:helper:forked:resource',
      legacy: 'hello Ada',
    });
  });

  test('supports run() references using id@version and id@marker', async () => {
    const marker = deriveTrailVersionMarkers(versionedTrail).find(
      (candidate) => candidate.version === 1
    )?.marker;
    expect(marker).toBeDefined();

    const byNumber = await run(versionedTopo, 'version.runtime.greet@1', {
      fullName: 'Ada',
    });
    const byMarker = await run(
      versionedTopo,
      `version.runtime.greet@${marker?.slice(0, 4)}`,
      { fullName: 'Ada' }
    );
    const conflicting = await run(
      versionedTopo,
      'version.runtime.greet@1',
      { fullName: 'Ada' },
      { version: 2 }
    );

    expect(byNumber.isOk()).toBe(true);
    expect(byNumber.unwrap()).toEqual({ text: 'hello Ada' });
    expect(byMarker.isOk()).toBe(true);
    expect(byMarker.unwrap()).toEqual({ text: 'hello Ada' });
    expect(conflicting.isErr()).toBe(true);
    expect(conflicting.error).toBeInstanceOf(ValidationError);
  });

  test('preserves literal run() trail ids containing @ without version suffixes', async () => {
    const literal = trail('version.runtime.literal@alpha', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const app = topo('version-runtime-literal-at-topo', { literal });

    const result = await run(app, 'version.runtime.literal@alpha', {});

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ ok: true });
  });
});
