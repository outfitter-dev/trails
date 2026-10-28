import { describe, expect, test } from 'bun:test';

import { resource, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { createCliHarness } from '../harness-cli.js';

describe('createCliHarness', () => {
  test('runs top-level commands', async () => {
    const greet = trail('greet', {
      implementation: (input: { name: string }) =>
        Result.ok(`Hello, ${input.name}!`),
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
      implementation: (input: { name: string }) =>
        Result.ok(`Pinned ${input.name}`),
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
      implementation: () => {
        calls.push('topo');
        return Result.ok('topo');
      },
      input: z.object({}),
    });
    const topoPin = trail('topo.pin', {
      implementation: () => {
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

  test('threads resource overrides through CLI rendering options', async () => {
    const dbResource = resource('db.main', {
      create: () => Result.ok({ source: 'factory' }),
    });
    const readResource = trail('resource.read', {
      implementation: (_input, ctx) =>
        Result.ok({ source: dbResource.from(ctx).source as string }),
      input: z.object({}),
      output: z.object({ source: z.string() }),
      resources: [dbResource],
    });
    const harness = createCliHarness({
      graph: topo('test-app', { dbResource, readResource }),
      resources: {
        'db.main': { source: 'override' },
      },
    });

    const result = await harness.run('resource read');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"override"');
  });
});

describe('CLI flag registration fidelity', () => {
  for (const withOutput of [false, true]) {
    for (const [args, accepted] of [
      ['', true],
      ['--name Trails', true],
      ['--enabled --name Trails', true],
      ['--no-enabled', true],
      ['--name=123', true],
      ['--output=json', withOutput],
      ['-o json', withOutput],
      ['-ojson', withOutput],
      ['-qojson', withOutput],
      ['--jsonl', withOutput],
      ['--output jsonl', withOutput],
      ['--tags one two', true],
      ['--tags one --tags two', true],
      ['--colors red blue', true],
      ['--colors red --colors blue', true],
      ['--definitely-not-real=value', false],
      ['--output json', withOutput],
      ['--json', withOutput],
      ['--definitely-not-real', false],
      ['-z', false],
    ] as const) {
      test(`output preset ${withOutput}: ${args || '(no flags)'}`, async () => {
        const { outputModePreset } = await import('@ontrails/cli');
        const { app } = await import('./fixtures/cli-flags-app.js');
        const harness = createCliHarness({
          graph: app,
          presets: withOutput ? [outputModePreset()] : [],
        });
        const result = await harness.run(`system status ${args}`);
        const proc = Bun.spawnSync({
          cmd: [
            process.execPath,
            `${import.meta.dir}/fixtures/cli-flags.ts`,
            'system',
            'status',
            ...args.split(' ').filter(Boolean),
          ],
          env: { ...process.env, CLI_OUTPUT_PRESET: withOutput ? '1' : '0' },
          stderr: 'pipe',
          stdout: 'pipe',
        });

        expect(proc.exitCode).toBe(accepted ? 0 : 1);
        expect(result.exitCode).toBe(proc.exitCode);
        if (accepted) {
          expect(result.json).toEqual(JSON.parse(proc.stdout.toString()));
          expect(result.stdout).toBe(proc.stdout.toString());
        } else {
          expect(result.stdout).toBe('');
          expect(result.stderr).toContain('Unknown option');
        }
      });
    }
  }
});
