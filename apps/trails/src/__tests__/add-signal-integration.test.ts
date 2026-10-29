import { expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { executeTrail, topo } from '@ontrails/core';
import { resolveWardenTopoTargets, runWarden } from '@ontrails/warden';

import { addSignal } from '../trails/add-signal.js';
import { createResourceProject } from './resource-scaffold.fixture.js';

test('generated signal is Warden-clean when wired to a real producer and consumer', async () => {
  const dir = createResourceProject();
  try {
    const result = await executeTrail(
      addSignal,
      { description: 'Entity update event', id: 'entity.updated' },
      {
        ctx: {
          cwd: dir,
          permit: { id: 'signal-scaffold', scopes: ['project:write'] },
        },
      }
    );
    if (result.isErr()) {
      throw result.error;
    }
    writeFileSync(
      join(dir, 'src/app.ts'),
      `
import { InternalError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';
import { entity_updatedSignal } from './signals/entity-updated.js';
const payload = { entityId: 'example', updatedAt: '2026-01-01T00:00:00Z' };
export const publish = trail('starter.publish', {
  input: entity_updatedSignal.payload, output: z.object({ published: z.boolean() }),
  fires: [entity_updatedSignal], permit: 'public',
  examples: [{ name: 'Publish update', input: payload, expected: { published: true },
    signals: [{ signal: entity_updatedSignal, payloadMatch: payload, times: 1 }],
  }],
  implementation: async (input, ctx) => {
    if (ctx.fire === undefined) return Result.err(new InternalError('Signal firing is unavailable'));
    await ctx.fire(entity_updatedSignal, input);
    return Result.ok({ published: true });
  },
});
export const consume = trail('starter.consume', {
  input: entity_updatedSignal.payload, output: z.object({ seen: z.boolean() }),
  intent: 'read', on: [entity_updatedSignal], permit: 'public',
  examples: [{ name: 'Consume update', input: payload, expected: { seen: true } }],
  implementation: () => Result.ok({ seen: true }),
});
export const app = topo('signal-starter', { entity_updatedSignal, publish, consume });
`
    );
    writeFileSync(
      join(dir, '__tests__/contract.test.ts'),
      `
import { testAll } from '@ontrails/testing';
import { app } from '../src/app.js';
testAll(app);
`
    );
    const resolved = await resolveWardenTopoTargets({
      rootDir: dir,
      strict: true,
    });
    expect(resolved.diagnostics).toEqual([]);
    const [target] = resolved.topos;
    if (target === undefined) {
      throw new Error('Expected wired signal topo');
    }
    const event = target.topo.signals.get('entity.updated');
    if (event === undefined) {
      throw new Error('Expected generated signal');
    }
    expect(event.from).toBeUndefined();
    expect(target.topo.trails.has('starter.publish')).toBe(true);
    expect(target.topo.trails.has('starter.consume')).toBe(true);
    const governed = await runWarden({
      depth: 'all',
      lock: 'skip',
      rootDir: dir,
      topos: resolved.topos,
    });
    expect(governed.diagnostics).toEqual([]);
    const unwired = await runWarden({
      depth: 'all',
      lock: 'skip',
      rootDir: dir,
      topo: topo('unwired', { event }),
    });
    expect(
      unwired.diagnostics.some((item) => item.rule === 'signal-graph-coaching')
    ).toBe(true);
    for (const args of [
      ['test'],
      [
        Bun.resolveSync('typescript/bin/tsc', import.meta.dir),
        '--noEmit',
        '--project',
        join(dir, 'tsconfig.json'),
      ],
    ]) {
      const child = Bun.spawnSync({
        cmd: [process.execPath, ...args],
        cwd: dir,
        stderr: 'pipe',
        stdout: 'pipe',
      });
      expect({
        code: child.exitCode,
        stderr: child.stderr.toString(),
        stdout: child.stdout.toString(),
      }).toMatchObject({ code: 0 });
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
