import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { deriveTopoGraphHash } from '@ontrails/topography';
import type { TopoGraphForceEntry, TrailsLock } from '@ontrails/topography';

import { compileTrail } from '../trails/compile.js';

export const repoRoot = resolve(import.meta.dir, '../../../..');

const gitEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith('GIT_')
    )
  );

export const git = (root: string, ...args: string[]): string => {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: root,
    env: gitEnvironment(),
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${Buffer.from(result.stderr).toString('utf8')}`
    );
  }
  return Buffer.from(result.stdout).toString('utf8');
};

export const gitMayFail = (root: string, ...args: string[]) =>
  Bun.spawnSync(['git', ...args], {
    cwd: root,
    env: gitEnvironment(),
    stderr: 'pipe',
    stdout: 'pipe',
  });

export const commit = (root: string, message: string): void => {
  git(root, 'add', '--all');
  git(
    root,
    '-c',
    'user.name=Trails Test',
    '-c',
    'user.email=trails-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    message
  );
};

export const trailSource = (id: string, description: string): string => `
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const ${id} = trail('${id}', {
  description: '${description}',
  implementation: () => Result.ok({ value: '${id}' }),
  input: z.object({}),
  output: z.object({ value: z.literal('${id}') }),
});
`;

export const appSource = (appId = 'dispatch-shaped'): string => `
import { topo } from '@ontrails/core';
import { alpha } from './alpha.js';
import { beta } from './beta.js';

export default topo('${appId}', { alpha, beta });
`;

export const writeStandaloneApp = (
  root: string,
  appId = 'dispatch-shaped'
): void => {
  symlinkSync(
    join(repoRoot, 'node_modules'),
    join(root, 'node_modules'),
    'dir'
  );
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(root, 'alpha.ts'), trailSource('alpha', 'base alpha'));
  writeFileSync(join(root, 'beta.ts'), trailSource('beta', 'base beta'));
  writeFileSync(join(root, 'app.ts'), appSource(appId));
  git(root, 'init', '--quiet', '--initial-branch=main');
};

export const compile = async (
  root: string,
  module = './app.ts',
  forceCompile = false
): Promise<void> => {
  const result = await compileTrail.implementation(
    {
      ...(forceCompile ? { force: true } : {}),
      module,
      rootDir: root,
    },
    { cwd: root } as never
  );
  if (result.isErr()) {
    throw result.error;
  }
};

export const readLock = (path: string): TrailsLock =>
  JSON.parse(readFileSync(path, 'utf8')) as TrailsLock;

export const force = (
  id: string,
  acceptedAt: string,
  detail: string
): TopoGraphForceEntry => ({
  acceptedAt,
  change: 'modified',
  detail,
  id,
  kind: 'trail',
  severity: 'breaking',
  source: 'trails compile --force',
});

export const writeLock = (path: string, lock: TrailsLock): void => {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        ...lock,
        topoGraphHash: deriveTopoGraphHash(lock.topoGraph),
      },
      null,
      2
    )}\n`
  );
};

export const appendEntryForce = (
  path: string,
  event: TopoGraphForceEntry
): void => {
  const lock = readLock(path);
  writeLock(path, {
    ...lock,
    topoGraph: {
      ...lock.topoGraph,
      entries: lock.topoGraph.entries.map((entry) =>
        entry.kind === event.kind && entry.id === event.id
          ? { ...entry, forces: [...(entry.forces ?? []), event] }
          : entry
      ),
    },
  });
};

export const appendGraphForce = (
  path: string,
  event: TopoGraphForceEntry
): void => {
  const lock = readLock(path);
  writeLock(path, {
    ...lock,
    topoGraph: {
      ...lock.topoGraph,
      forces: [...(lock.topoGraph.forces ?? []), event],
    },
  });
};

export const allForces = (lock: TrailsLock): readonly TopoGraphForceEntry[] => [
  ...(lock.topoGraph.forces ?? []),
  ...lock.topoGraph.entries.flatMap((entry) => entry.forces ?? []),
];

export const requiredAlphaSource = (): string =>
  trailSource('alpha', 'required alpha').replace(
    'input: z.object({}),',
    'input: z.object({ required: z.string() }),'
  );
