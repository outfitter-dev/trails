import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { verifyPublishedRegistry } from '../release/native-bun-registry-preflight.js';
import { checkRegistryPosture } from '../release/native-bun-registry.js';
import type {
  RegistryResult,
  RegistryWorkspace,
} from '../release/native-bun-registry.js';

const workspaces: readonly RegistryWorkspace[] = [
  { name: '@ontrails/core', path: 'packages/core', version: '0.2.1' },
  { name: '@ontrails/trails', path: 'apps/trails', version: '0.2.1' },
];

const clock = () => {
  let elapsed = 0;
  const sleeps: number[] = [];
  return {
    advance: (ms: number) => {
      elapsed += ms;
    },
    now: () => elapsed,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      elapsed += ms;
    },
    sleeps,
    timeoutMs: 120_000,
  };
};

const published = (
  workspace: RegistryWorkspace,
  overrides: Partial<Extract<RegistryResult, { status: 'published' }>> = {}
): RegistryResult => ({
  distTags: { latest: workspace.version },
  expectedTagVersion: workspace.version,
  name: workspace.name,
  status: 'published',
  version: workspace.version,
  versionPublished: true,
  workspaceVersion: workspace.version,
  ...overrides,
});

describe('post-publish registry propagation', () => {
  test.each(['metadata', 'tag'] as const)(
    'waits for %s independently and keeps confirmed packages',
    async (lag) => {
      const runtime = clock();
      const batches: string[][] = [];
      const report = await verifyPublishedRegistry(
        workspaces,
        'latest',
        async (pending) => {
          batches.push(pending.map(({ name }) => name));
          return checkRegistryPosture(
            pending,
            async (name) => ({
              'dist-tags': {
                latest:
                  name === '@ontrails/core' &&
                  batches.length === 1 &&
                  lag === 'tag'
                    ? '0.2.0'
                    : '0.2.1',
              },
              name,
              version: '0.2.1',
            }),
            async (name) =>
              !(
                name === '@ontrails/core' &&
                batches.length === 1 &&
                lag === 'metadata'
              ),
            'latest'
          );
        },
        runtime
      );
      expect(report.state).toBe('complete');
      expect(report.attempts).toBe(2);
      expect(batches).toEqual([
        workspaces.map(({ name }) => name),
        ['@ontrails/core'],
      ]);
      expect(report.results.map(({ name }) => name)).toEqual(
        workspaces.map(({ name }) => name)
      );
      expect(runtime.sleeps).toEqual([5000]);
    }
  );

  test('waits for a first-time package to become visible', async () => {
    let attempts = 0;
    const report = await verifyPublishedRegistry(
      workspaces,
      'latest',
      async (pending) => {
        attempts += 1;
        return pending.map((workspace) =>
          attempts === 1
            ? {
                name: workspace.name,
                status: 'missing',
                workspaceVersion: workspace.version,
              }
            : published(workspace)
        );
      },
      clock()
    );
    expect(report.state).toBe('complete');
    expect(report.attempts).toBe(2);
  });

  test('consumer package proof completes even while exact metadata is absent', async () => {
    const runtime = clock();
    const report = await verifyPublishedRegistry(
      workspaces,
      'latest',
      async (pending) =>
        pending.map((workspace) =>
          published(workspace, {
            versionProof: { kind: 'consumer-pack', published: true },
            versionPublished: false,
          })
        ),
      runtime
    );
    expect(report.state).toBe('complete');
    expect(runtime.sleeps).toEqual([]);
  });

  test.each(['metadata', 'tag', 'package'] as const)(
    'bounds persistent missing %s with capped backoff',
    async (lag) => {
      const runtime = clock();
      const report = await verifyPublishedRegistry(
        workspaces,
        'latest',
        async (pending) =>
          pending.map((workspace) =>
            lag === 'package'
              ? {
                  name: workspace.name,
                  status: 'missing',
                  workspaceVersion: workspace.version,
                }
              : published(
                  workspace,
                  lag === 'metadata'
                    ? { versionPublished: false }
                    : { expectedTagVersion: '0.2.0' }
                )
          ),
        runtime
      );
      expect(report.state).toBe('timeout');
      expect(report.attempts).toBe(6);
      expect(report.elapsedMs).toBe(120_000);
      expect(runtime.sleeps).toEqual([
        5000, 10_000, 20_000, 30_000, 30_000, 25_000,
      ]);
      expect(report.results).toHaveLength(2);
    }
  );

  test('counts probe duration against the same deadline', async () => {
    const runtime = clock();
    const report = await verifyPublishedRegistry(
      workspaces,
      'latest',
      async (pending) => {
        runtime.advance(118_000);
        return pending.map((workspace) =>
          published(workspace, { versionPublished: false })
        );
      },
      runtime
    );
    expect(report.state).toBe('timeout');
    expect(report.attempts).toBe(1);
    expect(report.elapsedMs).toBe(120_000);
    expect(runtime.sleeps).toEqual([2000]);
  });

  test.each([120_000, 120_001])(
    'accepts complete proofs returned at %ims without another wait',
    async (probeMs) => {
      const runtime = clock();
      const report = await verifyPublishedRegistry(
        workspaces,
        'latest',
        async (pending) => {
          runtime.advance(probeMs);
          return pending.map((workspace) => published(workspace));
        },
        runtime
      );
      expect(report.state).toBe('complete');
      expect(report.attempts).toBe(1);
      expect(runtime.sleeps).toEqual([]);
    }
  );

  test.each(['tag-ahead', 'inaccessible', 'unprobed'] as const)(
    'fails immediately on %s even with another package pending',
    async (failure) => {
      const runtime = clock();
      const report = await verifyPublishedRegistry(
        workspaces,
        'latest',
        async (pending) =>
          pending.map((workspace, index) => {
            if (index > 0) {
              return published(workspace, { versionPublished: false });
            }
            if (failure === 'inaccessible') {
              return {
                error: 'E401 Unauthorized',
                name: workspace.name,
                status: 'inaccessible',
                workspaceVersion: workspace.version,
              };
            }
            return published(
              workspace,
              failure === 'tag-ahead'
                ? { expectedTagVersion: '0.2.2' }
                : { versionPublished: undefined }
            );
          }),
        runtime
      );
      expect(report.state).toBe('failed');
      expect(report.attempts).toBe(1);
      expect(runtime.sleeps).toEqual([]);
    }
  );

  test('aborts an in-flight probe and reports timeout rather than registry failure', async () => {
    let aborted = false;
    const report = await verifyPublishedRegistry(
      workspaces,
      'latest',
      async (pending, signal) => {
        const waiting = Promise.withResolvers<boolean>();
        signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            waiting.resolve(true);
          },
          { once: true }
        );
        await waiting.promise;
        return pending.map((workspace) => ({
          error: 'aborted',
          name: workspace.name,
          status: 'inaccessible',
          workspaceVersion: workspace.version,
        }));
      },
      {
        now: () => performance.now(),
        sleep: async (ms) => {
          await Bun.sleep(ms);
        },
        timeoutMs: 30,
      }
    );
    expect(aborted).toBe(true);
    expect(report.state).toBe('timeout');
    expect(report.attempts).toBe(1);
  });

  test('an empty workspace set completes without probing', async () => {
    const report = await verifyPublishedRegistry(
      [],
      'latest',
      async () => {
        throw new Error('unexpected probe');
      },
      clock()
    );
    expect(report.state).toBe('complete');
    expect(report.attempts).toBe(0);
  });

  test('keeps the last lag observation when a retry is cancelled at the deadline', async () => {
    let attempts = 0;
    const report = await verifyPublishedRegistry(
      workspaces,
      'latest',
      async (pending, signal) => {
        attempts += 1;
        if (attempts === 1) {
          return pending.map((workspace) => ({
            name: workspace.name,
            status: 'missing',
            workspaceVersion: workspace.version,
          }));
        }
        const waiting = Promise.withResolvers<boolean>();
        signal?.addEventListener('abort', () => waiting.resolve(true), {
          once: true,
        });
        await waiting.promise;
        return pending.map((workspace) => ({
          error: 'aborted at deadline',
          name: workspace.name,
          status: 'inaccessible',
          workspaceVersion: workspace.version,
        }));
      },
      { now: () => performance.now(), sleep: async () => {}, timeoutMs: 30 }
    );
    expect(report.state).toBe('timeout');
    expect(report.attempts).toBe(2);
    expect(report.results.map(({ status }) => status)).toEqual([
      'missing',
      'missing',
    ]);
  });
});

const killFakeNpm = async (pidFile: string): Promise<void> => {
  if (!(await Bun.file(pidFile).exists())) {
    return;
  }
  const pid = Number(await Bun.file(pidFile).text());
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('Invalid fake npm fixture PID');
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
    ) {
      throw error;
    }
  }
};

test('the npm runner kills a subprocess that ignores SIGTERM at its abort deadline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trails-registry-abort-'));
  const ready = join(root, 'ready');
  const runner = join(root, 'runner.ts');
  try {
    await writeFile(
      join(root, 'npm'),
      `#!${process.execPath}\nprocess.on('SIGTERM', () => {});\nawait Bun.write(${JSON.stringify(ready)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
      { mode: 0o755 }
    );
    await writeFile(
      runner,
      `import { runNpmRegistryCommand } from ${JSON.stringify(join(import.meta.dir, '../release/native-bun-registry.ts'))};\nconst controller = new AbortController();\nconst pending = runNpmRegistryCommand(['view', 'fixture'], controller.signal);\nwhile (!(await Bun.file(${JSON.stringify(ready)}).exists())) await Bun.sleep(10);\ncontroller.abort();\nconst result = await pending;\nif (result.exitCode === 0) process.exit(1);\nconsole.log('aborted');\n`
    );
    const child = Bun.spawn([process.execPath, runner], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH ?? ''}` },
      killSignal: 'SIGKILL',
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 3000,
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('aborted');
  } finally {
    try {
      await killFakeNpm(ready);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
});
