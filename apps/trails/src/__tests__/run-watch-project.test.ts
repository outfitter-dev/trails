import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ValidationError } from '@ontrails/core';

import { readWatchTopoGraphEntryHash } from '../run-watch-project.js';

const tempRoots: string[] = [];
const coreModuleUrl = import.meta.resolve('@ontrails/core');

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

test('revalidates configured app identity on the watch hash lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trails-watch-project-'));
  tempRoots.push(root);
  const appRoot = join(root, 'apps/app-a');
  await mkdir(join(appRoot, 'src'), { recursive: true });
  await writeFile(
    join(root, 'trails.config.json'),
    `${JSON.stringify({
      workspace: { apps: { 'app-a': { root: 'apps/app-a' } } },
    })}\n`
  );
  const counterKey = `watch-binding-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await writeFile(
    join(appRoot, 'src/app.ts'),
    [
      `import { Result, topo, trail } from ${JSON.stringify(coreModuleUrl)};`,
      `const count = ((globalThis[${JSON.stringify(counterKey)}] ?? 0) + 1);`,
      `globalThis[${JSON.stringify(counterKey)}] = count;`,
      `const watched = trail('entity.watch', {`,
      `  implementation: () => Result.ok({ ok: true }),`,
      `  input: undefined,`,
      `  output: undefined,`,
      `});`,
      `export const app = topo(count === 1 ? 'app-a' : 'other', { watched });`,
      '',
    ].join('\n')
  );

  await expect(
    readWatchTopoGraphEntryHash(
      { app: 'app-a', id: 'entity.watch', rootDir: root },
      root
    )
  ).rejects.toMatchObject({
    context: { actualAppId: 'other', expectedAppId: 'app-a' },
  } satisfies Partial<ValidationError>);
});
