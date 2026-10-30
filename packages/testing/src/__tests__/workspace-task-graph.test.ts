import { expect, test } from 'bun:test';
import { join, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dir, '../..');
const repoRoot = resolve(packageRoot, '../..');

test('local harness compiler and test tasks include their workspace peer inputs', async () => {
  const manifest = (await Bun.file(
    join(packageRoot, 'package.json')
  ).json()) as {
    readonly peerDependencies: Readonly<Record<string, string>>;
  };
  const peers = Object.keys(manifest.peerDependencies).filter((name) =>
    name.startsWith('@ontrails/')
  );
  const result = Bun.spawnSync(
    [
      process.execPath,
      join(repoRoot, 'node_modules/turbo/bin/turbo'),
      'run',
      'build',
      'typecheck',
      'test',
      '--filter=@ontrails/testing',
      '--cache=local:r',
      '--dry=json',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
      stderr: 'pipe',
      stdout: 'pipe',
    }
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).not.toContain(
    'Could not resolve workspaces'
  );
  expect(result.stderr.toString()).not.toContain('Unsupported bun lockfile');
  const graph = JSON.parse(result.stdout.toString()) as {
    readonly tasks: readonly {
      readonly taskId: string;
      readonly dependencies: readonly string[];
    }[];
  };

  for (const [task, inputTask] of [
    ['build', 'build'],
    ['test', 'build'],
    ['typecheck', 'typecheck'],
  ] as const) {
    const ownTask = graph.tasks.find(
      (entry) => entry.taskId === `@ontrails/testing#${task}`
    );
    expect(ownTask).toBeDefined();
    for (const peer of peers) {
      expect(ownTask?.dependencies).toContain(`${peer}#${inputTask}`);
    }
  }
});
