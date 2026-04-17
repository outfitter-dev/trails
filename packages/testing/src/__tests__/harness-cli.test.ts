import { describe, expect, test } from 'bun:test';

import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { createCliHarness } from '../harness-cli.js';

describe('createCliHarness', () => {
  test('runs top-level commands', async () => {
    const greet = trail('greet', {
      blaze: (input: { name: string }) => Result.ok(`Hello, ${input.name}!`),
      input: z.object({ name: z.string() }),
    });
    const harness = createCliHarness({
      graph: topo('test-app', { greet }),
    });

    const result = await harness.run('greet --name Trails');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello, Trails!');
  });

  test('runs nested commands using the full ordered path', async () => {
    const pin = trail('topo.pin', {
      blaze: (input: { name: string }) => Result.ok(`Pinned ${input.name}`),
      input: z.object({ name: z.string() }),
    });
    const harness = createCliHarness({
      graph: topo('test-app', { pin }),
    });

    const result = await harness.run('topo pin --name before-auth');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Pinned before-auth');
  });

  test('prefers the deepest matching executable path', async () => {
    const calls: string[] = [];
    const topoShow = trail('topo', {
      blaze: () => {
        calls.push('topo');
        return Result.ok('topo');
      },
      input: z.object({}),
    });
    const topoPin = trail('topo.pin', {
      blaze: () => {
        calls.push('topo.pin');
        return Result.ok('topo.pin');
      },
      input: z.object({}),
    });
    const harness = createCliHarness({
      graph: topo('test-app', { topoPin, topoShow }),
    });

    const child = await harness.run('topo pin');
    const parent = await harness.run('topo');

    expect(child.exitCode).toBe(0);
    expect(parent.exitCode).toBe(0);
    expect(calls).toEqual(['topo.pin', 'topo']);
  });
});
