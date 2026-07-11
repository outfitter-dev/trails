/**
 * TRL-473: Project typed layer input onto the CLI surface.
 *
 * When a layer attached at trail/surface/topo scope declares an `input`
 * schema, the CLI command derives flags from that schema, parses values from
 * argv, and passes them into the layer's runtime input via
 * `ctx.extensions[LAYER_INPUTS_KEY][layer.name]`.
 */

import { describe, expect, test } from 'bun:test';

import {
  LAYER_FIELD_RESERVED_NAMES,
  LAYER_INPUTS_KEY,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import type { Implementation, Layer } from '@ontrails/core';
import { z } from 'zod';

import { deriveCliCommands } from '../build.js';
import type { CliCommand } from '../command.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildCommands = (...args: Parameters<typeof deriveCliCommands>) => {
  const result = deriveCliCommands(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const requireCommand = (commands: CliCommand[]): CliCommand => {
  const [command] = commands;
  expect(command).toBeDefined();
  if (!command) {
    throw new Error('Expected command');
  }
  return command;
};

interface InputBucket {
  value: unknown;
}

const captureLayerInput = (
  layerName: string,
  schema: z.ZodType<unknown>,
  bucket: InputBucket
): Layer => ({
  input: schema,
  name: layerName,
  wrap<I, O>(_t, impl: Implementation<I, O>): Implementation<I, O> {
    return async (input, ctx) => {
      const all = ctx.extensions?.[LAYER_INPUTS_KEY] as
        | Record<string, unknown>
        | undefined;
      bucket.value = all?.[layerName];
      return await impl(input, ctx);
    };
  },
});

const makeEchoTrail = (
  overrides: { readonly layers?: readonly Layer[] } = {}
) =>
  trail('echo', {
    implementation: (input: { value: string }) =>
      Result.ok({ value: input.value }),
    input: z.object({ value: z.string() }),
    output: z.object({ value: z.string() }),
    ...(overrides.layers === undefined ? {} : { layers: overrides.layers }),
  });

const withMutedStderr = <T>(fn: () => T): { result: T; stderr: string } => {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  type WriteFn = typeof process.stderr.write;
  const stub: WriteFn = ((chunk: unknown) => {
    chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as WriteFn;
  process.stderr.write = stub;
  try {
    const result = fn();
    return { result, stderr: chunks.join('') };
  } finally {
    process.stderr.write = originalWrite;
  }
};

// ---------------------------------------------------------------------------
// Flag projection
// ---------------------------------------------------------------------------

describe('TRL-473 layer input projection — flag derivation', () => {
  test('a typed trail-scope layer adds a flag derived from its input schema', () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'trace',
      z.object({ verbose: z.boolean() }),
      bucket
    );

    const echo = makeEchoTrail({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });

    const command = requireCommand(buildCommands(app));
    const flagNames = command.flags.map((f) => f.name);
    expect(flagNames).toContain('verbose');
  });

  test('surface-scope layer flags appear on every command', () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'tenant',
      z.object({ tenantId: z.string() }),
      bucket
    );
    const a = trail('alpha', {
      implementation: () => Result.ok(1),
      input: z.object({}),
    });
    const b = trail('beta', {
      implementation: () => Result.ok(2),
      input: z.object({}),
    });
    const app = topo('app', { [a.id]: a, [b.id]: b });

    const commands = buildCommands(app, { layers: [layer] });
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      const flagNames = command.flags.map((f) => f.name);
      expect(flagNames).toContain('tenant-id');
    }
  });

  test('topo-scope layer flags appear on every command', () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'audit',
      z.object({ auditMode: z.enum(['off', 'full']) }),
      bucket
    );
    const a = trail('alpha', {
      implementation: () => Result.ok(1),
      input: z.object({}),
    });
    const b = trail('beta', {
      implementation: () => Result.ok(2),
      input: z.object({}),
    });
    const app = topo('app', { [a.id]: a, [b.id]: b }, { layers: [layer] });

    const commands = buildCommands(app);
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      const flagNames = command.flags.map((f) => f.name);
      expect(flagNames).toContain('audit-mode');
    }
  });

  test('multiple layers with disjoint fields each emit their own flags', () => {
    const layerA: Layer = {
      input: z.object({ alpha: z.boolean() }),
      name: 'layerA',
      wrap: (_t, impl) => impl,
    };
    const layerB: Layer = {
      input: z.object({ beta: z.string() }),
      name: 'layerB',
      wrap: (_t, impl) => impl,
    };

    const echo = makeEchoTrail({ layers: [layerA, layerB] });
    const app = topo('app', { [echo.id]: echo });

    const command = requireCommand(buildCommands(app));
    const flagNames = command.flags.map((f) => f.name);
    expect(flagNames).toContain('alpha');
    expect(flagNames).toContain('beta');
  });

  test('layers without an input schema contribute no flags', () => {
    const layer: Layer = {
      name: 'noop',
      wrap: (_t, impl) => impl,
    };
    const echo = makeEchoTrail({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });
    const echoBaseline = makeEchoTrail();
    const baselineApp = topo('app', { [echoBaseline.id]: echoBaseline });

    const flagsWithLayer = new Set(
      requireCommand(buildCommands(app)).flags.map((f) => f.name)
    );
    const baselineFlags = new Set(
      requireCommand(buildCommands(baselineApp)).flags.map((f) => f.name)
    );
    expect(flagsWithLayer).toEqual(baselineFlags);
  });
});

// ---------------------------------------------------------------------------
// Runtime mapping
// ---------------------------------------------------------------------------

describe('TRL-473 layer input projection — runtime mapping', () => {
  test('parsed flag values reach the layer at runtime', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'trace',
      z.object({ verbose: z.boolean() }),
      bucket
    );
    const echo = makeEchoTrail({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });

    const command = requireCommand(buildCommands(app));
    const result = await command.execute(
      { value: 'hi' },
      { value: 'hi', verbose: true }
    );

    expect(result.isOk()).toBe(true);
    expect(bucket.value).toEqual({ verbose: true });
  });

  test('layer input does not pollute the trail input', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'trace',
      z.object({ verbose: z.boolean() }),
      bucket
    );
    let trailInput: unknown;
    const recorded = trail('rec', {
      implementation: (input: { value: string }) => {
        trailInput = input;
        return Result.ok({ value: input.value });
      },
      input: z.object({ value: z.string() }),
      layers: [layer],
      output: z.object({ value: z.string() }),
    });
    const app = topo('app', { [recorded.id]: recorded });

    const command = requireCommand(buildCommands(app));
    const result = await command.execute(
      { value: 'hi' },
      { value: 'hi', verbose: true }
    );

    expect(result.isOk()).toBe(true);
    expect(trailInput).toEqual({ value: 'hi' });
  });

  test('topo-scope layer receives runtime input through ctx.extensions', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'audit',
      z.object({ auditMode: z.enum(['off', 'full']) }),
      bucket
    );
    const echo = makeEchoTrail();
    const app = topo('app', { [echo.id]: echo }, { layers: [layer] });

    const command = requireCommand(buildCommands(app));
    const result = await command.execute(
      { value: 'hi' },
      { auditMode: 'full', value: 'hi' }
    );

    expect(result.isOk()).toBe(true);
    expect(bucket.value).toEqual({ auditMode: 'full' });
  });

  test('omitted layer flags still materialize schema defaults', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'trace',
      z.object({
        enabled: z.boolean().default(false),
        mode: z.enum(['audit', 'off']).default('audit'),
      }),
      bucket
    );
    const echo = makeEchoTrail({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });

    const command = requireCommand(buildCommands(app));
    const result = await command.execute({ value: 'hi' }, { value: 'hi' });

    expect(result.isOk()).toBe(true);
    expect(bucket.value).toEqual({ enabled: false, mode: 'audit' });
  });
});

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

describe('TRL-473 layer input projection — collisions', () => {
  test('a layer field colliding with a trail field is renamed and delivered', async () => {
    const bucket: InputBucket = { value: undefined };
    const collidingLayer = captureLayerInput(
      'collide',
      z.object({ value: z.boolean() }),
      bucket
    );

    const echo = trail('echo', {
      implementation: (input: { value: string }) =>
        Result.ok({ value: input.value }),
      input: z.object({ value: z.string() }),
      layers: [collidingLayer],
      output: z.object({ value: z.string() }),
    });
    const app = topo('app', { [echo.id]: echo });

    const { result: commands, stderr } = withMutedStderr(() =>
      buildCommands(app)
    );

    const command = requireCommand(commands);
    const flagNames = command.flags.map((f) => f.name);
    // Trail's `value` flag remains unchanged.
    expect(flagNames).toContain('value');
    // Layer's colliding `value` is renamed under the layer's kebab name.
    expect(flagNames).toContain('collide-value');
    // A warning was emitted on stderr.
    expect(stderr).toContain('collide');
    expect(stderr).toContain('--value');
    expect(stderr).toContain('--collide-value');

    const execResult = await command.execute(
      { value: 'hi' },
      { collideValue: true, value: 'hi' }
    );
    expect(execResult.isOk()).toBe(true);
    expect(bucket.value).toEqual({ value: true });
  });

  test('a layer field colliding with a meta flag is renamed', () => {
    const layer: Layer = {
      // `quiet` is a shared LAYER_FIELD_RESERVED_NAMES entry.
      input: z.object({ quiet: z.boolean() }),
      name: 'shh',
      wrap: (_t, impl) => impl,
    };
    const echo = makeEchoTrail({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });

    const { result: commands, stderr } = withMutedStderr(() =>
      buildCommands(app)
    );

    const command = requireCommand(commands);
    const flagNames = command.flags.map((f) => f.name);
    expect(flagNames).toContain('shh-quiet');
    expect(LAYER_FIELD_RESERVED_NAMES.has('quiet')).toBe(true);
    expect(stderr).toContain('shh');
    expect(stderr).toContain('CLI meta flag');
  });

  test('a renamed layer field gets a deterministic suffix when the fallback also collides', async () => {
    const bucket: InputBucket = { value: undefined };
    const authLayer = captureLayerInput(
      'auth',
      z.object({ token: z.string() }),
      bucket
    );
    const echo = trail('echo', {
      implementation: (input: {
        authToken: string;
        token: string;
        value: string;
      }) => Result.ok({ value: input.value }),
      input: z.object({
        authToken: z.string(),
        token: z.string(),
        value: z.string(),
      }),
      layers: [authLayer],
      output: z.object({ value: z.string() }),
    });
    const app = topo('app', { [echo.id]: echo });

    const { result: commands } = withMutedStderr(() => buildCommands(app));
    const command = requireCommand(commands);
    const flagNames = command.flags.map((f) => f.name);
    expect(flagNames).toContain('auth-token');
    expect(flagNames).toContain('auth-token2');

    const execResult = await command.execute(
      { value: 'hi' },
      {
        authToken: 'trail-auth',
        authToken2: 'layer-auth',
        token: 'trail-token',
        value: 'hi',
      }
    );
    if (execResult.isErr()) {
      throw execResult.error;
    }
    expect(execResult.isOk()).toBe(true);
    expect(bucket.value).toEqual({ token: 'layer-auth' });
  });

  test('the rename rule is deterministic across builds', () => {
    const buildOnce = () => {
      const collidingLayer: Layer = {
        input: z.object({ value: z.boolean() }),
        name: 'collide',
        wrap: (_t, impl) => impl,
      };
      const echo = trail('echo', {
        implementation: (input: { value: string }) =>
          Result.ok({ value: input.value }),
        input: z.object({ value: z.string() }),
        layers: [collidingLayer],
        output: z.object({ value: z.string() }),
      });
      const app = topo('app', { [echo.id]: echo });
      const { result: commands } = withMutedStderr(() => buildCommands(app));
      return new Set(requireCommand(commands).flags.map((f) => f.name));
    };
    expect(buildOnce()).toEqual(buildOnce());
  });
});
