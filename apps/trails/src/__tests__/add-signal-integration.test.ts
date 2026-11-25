import { expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { executeTrail, topo } from '@ontrails/core';
import { resolveWardenTopoTargets, runWarden } from '@ontrails/warden';

import { addSignal } from '../trails/add-signal.js';
import {
  createResourceProject,
  resourceScaffoldPermit,
} from './resource-scaffold.fixture.js';

test('a generated signal dispatches from a Warden-clean producer to its consumer', async () => {
  const dir = createResourceProject();
  try {
    const result = await executeTrail(
      addSignal,
      { description: 'Entity archived event', id: 'entity.archived' },
      {
        ctx: {
          cwd: dir,
          permit: resourceScaffoldPermit,
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
import { entity_archivedSignal } from './signals/entity-archived.js';
const payload = { entityId: 'example', updatedAt: '2026-01-01T00:00:00Z' };
export const received: (typeof payload)[] = [];
export const publish = trail('starter.publish', {
  input: entity_archivedSignal.payload, output: z.object({ published: z.boolean() }),
  fires: [entity_archivedSignal], permit: 'public',
  examples: [{ name: 'Publish update', input: payload, expected: { published: true },
    signals: [{ signal: entity_archivedSignal, payloadMatch: payload, times: 1 }],
  }],
  implementation: async (input, ctx) => {
    if (ctx.fire === undefined) return Result.err(new InternalError('Signal firing is unavailable'));
    await ctx.fire(entity_archivedSignal, input);
    return Result.ok({ published: true });
  },
});
export const consume = trail('starter.consume', {
  input: entity_archivedSignal.payload, output: z.object({ seen: z.boolean() }),
  intent: 'read', on: [entity_archivedSignal], permit: 'public',
  examples: [{ name: 'Consume update', input: payload, expected: { seen: true } }],
  implementation: (input) => {
    received.push(input);
    return Result.ok({ seen: true });
  },
});
export const app = topo('signal-starter', { entity_archivedSignal, publish, consume });
`
    );
    writeFileSync(
      join(dir, '__tests__/contract.test.ts'),
      `
import { expect, test } from 'bun:test';
import { run } from '@ontrails/core';
import { testAll } from '@ontrails/testing';
import { app, received } from '../src/app.js';
testAll(app);

test('producer delivers the emitted payload to its reactive consumer', async () => {
  const payload = { entityId: 'via-dispatch', updatedAt: '2026-01-02T00:00:00Z' };
  const before = received.length;
  const result = await run(app, 'starter.publish', payload);
  if (result.isErr()) throw result.error;
  expect(received.slice(before)).toEqual([payload]);
});
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
    const event = target.topo.signals.get('entity.archived');
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
