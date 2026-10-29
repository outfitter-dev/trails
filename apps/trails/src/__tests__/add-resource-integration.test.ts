import { expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { executeTrail, ValidationError } from '@ontrails/core';
import { resolveWardenTopoTargets, runWarden } from '@ontrails/warden';

import { addResource } from '../trails/add-resource.js';
import { createResourceProject } from './resource-scaffold.fixture.js';

test('generated resource integrates with Warden and no-config testAll through its mock', async () => {
  const dir = createResourceProject();
  try {
    const generated = await executeTrail(
      addResource,
      { description: 'Editable in-memory starter', id: 'db.main' },
      {
        ctx: {
          cwd: dir,
          permit: { id: 'scaffold-test', scopes: ['project:write'] },
        },
      }
    );
    if (generated.isErr()) {
      throw generated.error;
    }
    writeFileSync(
      join(dir, 'src/app.ts'),
      `
import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';
import { db_mainResource } from './resources/db-main.js';
export const read = trail('starter.read', {
  input: z.object({}), output: z.object({ entries: z.number() }),
  intent: 'read', permit: 'public', resources: [db_mainResource],
  examples: [{ name: 'Empty mock', input: {}, expected: { entries: 0 } }],
  implementation: (_input, ctx) => Result.ok({ entries: db_mainResource.from(ctx).size }),
});
export const app = topo('resource-starter', { db_mainResource, read });
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
      throw new Error('Expected fixture topo');
    }
    expect(target.topo.resources.has('db.main')).toBe(true);
    const consumer = target.topo.get('starter.read');
    if (consumer === undefined) {
      throw new Error('Expected resource consumer');
    }
    const normal = await executeTrail(consumer, {}, { topo: target.topo });
    expect(normal.isErr()).toBe(true);
    if (normal.isOk()) {
      throw new Error('Expected required resource config to be missing');
    }
    expect(normal.error).toBeInstanceOf(ValidationError);
    const governed = await runWarden({
      depth: 'all',
      lock: 'skip',
      rootDir: dir,
      topos: resolved.topos,
    });
    expect(governed.diagnostics).toEqual([]);
    expect(governed.passed).toBe(true);
    // Bun 1.4.4 prints only the summary when stdout is not a TTY, so the
    // JUnit reporter is the stable witness that the scaffolded example ran.
    const reportPath = join(dir, 'junit.xml');
    const child = Bun.spawnSync({
      cmd: [
        process.execPath,
        'test',
        '--reporter=junit',
        `--reporter-outfile=${reportPath}`,
      ],
      cwd: dir,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    expect({
      code: child.exitCode,
      stderr: child.stderr.toString(),
      stdout: child.stdout.toString(),
    }).toMatchObject({ code: 0 });
    expect(readFileSync(reportPath, 'utf8')).toContain('starter.read');
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
