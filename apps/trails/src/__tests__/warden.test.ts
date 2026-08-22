import type { ActionResultContext } from '@ontrails/cli';
import { deriveTrailsDir, Result, topo } from '@ontrails/core';
import {
  deriveTopoGraph,
  deriveTopoGraphHash,
  LOCK_MANIFEST_SCHEMA_VERSION,
  writeLockManifest,
} from '@ontrails/topography';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tryWardenOutput } from '../run-warden.js';
import { wardenGuideTrail } from '../trails/warden-guide.js';
import { buildWardenCommandArgs, wardenTrail } from '../trails/warden.js';

const wardenBinPath = fileURLToPath(
  new URL('../../../../packages/warden/bin/warden.ts', import.meta.url)
);
const trailsBinPath = fileURLToPath(
  new URL('../../bin/trails.ts', import.meta.url)
);
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const cliTimeoutMs = 30_000;
const coreModuleUrl = import.meta.resolve('@ontrails/core');

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `trails-warden-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

interface WardenJsonOutput {
  readonly diagnostics: readonly {
    readonly guidance?: {
      readonly summary: string;
    };
    readonly rule: string;
    readonly severity: 'error' | 'warn';
  }[];
  readonly passed: boolean;
  readonly project?: unknown;
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
  };
}

interface CliRun {
  readonly exitCode: number;
  readonly json: WardenJsonOutput;
  readonly stderr: string;
  readonly stdout: string;
}

interface RawCliRun {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const runRawCli = (
  binPath: string,
  args: readonly string[],
  cwd: string
): RawCliRun => {
  const command = [process.execPath, binPath, ...args];
  const proc = Bun.spawnSync({
    cmd: command,
    cwd,
    env: { ...process.env, NO_COLOR: '1' } as Record<string, string>,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: cliTimeoutMs,
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  const signalCode = proc.signalCode ?? undefined;
  if (proc.exitedDueToTimeout || signalCode !== undefined) {
    throw new Error(
      [
        `Warden CLI subprocess ${proc.exitedDueToTimeout ? 'timed out' : 'terminated'} before producing raw output.`,
        `command: ${command.join(' ')}`,
        `cwd: ${cwd}`,
        ...(proc.exitedDueToTimeout ? [`timeoutMs: ${cliTimeoutMs}`] : []),
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `signal: ${signalCode ?? 'null'}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join('\n')
    );
  }

  return {
    exitCode: proc.exitCode ?? -1,
    stderr,
    stdout,
  };
};

const runCli = (
  binPath: string,
  args: readonly string[],
  cwd: string
): CliRun => {
  const command = [process.execPath, binPath, ...args];
  const proc = Bun.spawnSync({
    cmd: command,
    cwd,
    env: { ...process.env, NO_COLOR: '1' } as Record<string, string>,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: cliTimeoutMs,
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  const signalCode = proc.signalCode ?? undefined;
  if (proc.exitedDueToTimeout || signalCode !== undefined) {
    throw new Error(
      [
        `Warden CLI subprocess ${proc.exitedDueToTimeout ? 'timed out' : 'terminated'} before producing JSON output.`,
        `command: ${command.join(' ')}`,
        `cwd: ${cwd}`,
        ...(proc.exitedDueToTimeout ? [`timeoutMs: ${cliTimeoutMs}`] : []),
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `signal: ${signalCode ?? 'null'}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join('\n')
    );
  }

  let json: WardenJsonOutput;
  try {
    json = JSON.parse(stdout) as WardenJsonOutput;
  } catch (error) {
    throw new Error(
      [
        `Failed to parse JSON output from ${binPath}`,
        `command: ${command.join(' ')}`,
        `cwd: ${cwd}`,
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `signal: ${proc.signalCode ?? 'null'}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join('\n'),
      { cause: error }
    );
  }

  return {
    exitCode: proc.exitCode ?? -1,
    json,
    stderr,
    stdout,
  };
};

const writeProjectOnlyErrorFixture = (dir: string): void => {
  writeFileSync(
    join(dir, 'project-only.ts'),
    `trail('entity.show', {
  on: ['entity.changed'],
  implementation: async () => Result.ok({ ok: true }),
});`
  );
};

const writeAllDepthWarningFixture = (dir: string): void => {
  writeFileSync(
    join(dir, 'warning-only.ts'),
    `trail('entity.show', {
  input: z.object({ firstName: z.string() }),
  fields: {
    firstName: { label: 'First Name' },
  },
  implementation: async () => Result.ok({ ok: true }),
});`
  );
};

const writeConfiguredWorkspaceFixture = (dir: string): void => {
  writeFileSync(
    join(dir, 'trails.config.json'),
    `${JSON.stringify(
      {
        workspace: {
          apps: {
            alpha: { root: 'apps/alpha' },
            beta: { root: 'apps/beta' },
          },
        },
      },
      null,
      2
    )}\n`
  );
  for (const appId of ['alpha', 'beta']) {
    mkdirSync(join(dir, 'apps', appId, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'apps', appId, 'src', 'app.ts'),
      `import { topo } from ${JSON.stringify(coreModuleUrl)};\nexport const app = topo('${appId}', []);\n`
    );
  }
};

const writeAppManifest = (
  rootDir: string,
  appId: string,
  hash: string
): Promise<string> =>
  writeLockManifest(
    {
      artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
      scope: { app: appId },
      summary: { entities: 0, resources: 0, signals: 0, trails: 0 },
      version: LOCK_MANIFEST_SCHEMA_VERSION,
    },
    { dir: deriveTrailsDir({ rootDir }) }
  );

describe('trails warden', () => {
  test('declares write intent because --fix can mutate source files', () => {
    expect(wardenTrail.intent).toBe('write');
  });

  test('declares public permit access for the local governance command', () => {
    expect(wardenTrail.permit).toBe('public');
  });

  test('renders final Warden flags into the shared command surface', () => {
    const args = buildWardenCommandArgs({
      adapterCheck: true,
      apps: ['trails', 'demo'],
      cached: true,
      ci: true,
      depth: 'topo',
      drafts: 'include',
      excludeDrafts: true,
      failOn: 'error',
      fix: true,
      format: 'summary',
      github: true,
      includeDrafts: false,
      json: false,
      lock: 'auto',
      noLockMutation: true,
      onlyDrafts: false,
      prePush: false,
      refresh: false,
      scopeExclude: ['.agents/notes/**', '.scratch/**'],
      skipLock: false,
      strict: true,
      summary: false,
    });

    expect(args).toEqual([
      '--ci',
      '--depth',
      'topo',
      '--strict',
      '--github',
      '--cached',
      '--exclude-drafts',
      '--no-lock-mutation',
      '--fix',
      '--adapter-check',
      '--scope-exclude',
      '.agents/notes/**',
      '--scope-exclude',
      '.scratch/**',
      '--apps',
      'trails,demo',
    ]);
  });

  test('runs through the shared Warden command and returns formatted output', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("hello", {
  implementation: async () => {
    throw new Error("boom");
  },
});`
      );

      const result = await wardenTrail.implementation(
        { depth: 'source', format: 'summary', lock: 'skip', rootDir: dir },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.passed).toBe(false);
      expect(result.value.errorCount).toBe(1);
      expect(result.value.diagnostics[0]?.guidance?.summary).toBe(
        'Convert thrown failures in implementations into explicit Result.err() outcomes.'
      );
      expect(result.value.formatted).toContain('## Warden Report');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('format aliases produce raw Warden formatter output', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'empty.ts'), 'export {};');

      const result = await wardenTrail.implementation(
        { depth: 'source', json: true, lock: 'skip', rootDir: dir },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(JSON.parse(result.value.formatted)).toMatchObject({
        passed: true,
        project: {
          configuredAppIds: [],
          selectedExtent: 'standalone-app',
        },
        summary: { errors: 0, warnings: 0 },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('renders selection through the effective environment format', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'empty.ts'), 'export {};');

      const result = await wardenTrail.implementation(
        { depth: 'source', lock: 'skip', rootDir: dir },
        { cwd: dir, env: { TRAILS_FORMAT: 'json' } } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(JSON.parse(result.value.formatted)).toMatchObject({
        passed: true,
        project: { selectedExtent: 'standalone-app' },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('uses the effective github alias when raw format conflicts', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'empty.ts'), 'export {};');

      const result = await wardenTrail.implementation(
        {
          depth: 'source',
          format: 'json',
          github: true,
          lock: 'skip',
          rootDir: dir,
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.formatted).toContain(
        'Selection: standalone-app (root-dir)'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('selects a Config-owned app while preserving project-wide source scope', async () => {
    const dir = makeTempDir();
    try {
      writeConfiguredWorkspaceFixture(dir);
      writeFileSync(
        join(dir, 'apps', 'beta', 'bad.ts'),
        `trail('beta.fail', {
  implementation: () => {
    throw new Error('still project governed');
  },
});\n`
      );

      const result = await wardenTrail.implementation(
        {
          app: 'alpha',
          depth: 'source',
          format: 'summary',
          lock: 'skip',
          rootDir: dir,
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.project).toMatchObject({
        app: { appId: 'alpha' },
        configuredAppIds: ['alpha', 'beta'],
        projectRoot: dir,
        selectedExtent: 'configured-app',
        selectionProvenance: 'app',
      });
      expect(result.value.errorCount).toBe(1);
      expect(result.value.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('checks configured workspace drift against each app-local lock', async () => {
    const dir = makeTempDir();
    try {
      writeConfiguredWorkspaceFixture(dir);
      for (const appId of ['alpha', 'beta']) {
        const app = topo(appId, []);
        await writeAppManifest(
          join(dir, 'apps', appId),
          appId,
          deriveTopoGraphHash(deriveTopoGraph(app))
        );
      }

      const fresh = await wardenTrail.implementation(
        { depth: 'all', rootDir: dir },
        { cwd: dir, env: {} } as never
      );
      await writeAppManifest(
        join(dir, 'apps', 'alpha'),
        'alpha',
        '0'.repeat(64)
      );
      const stale = await wardenTrail.implementation(
        { depth: 'all', rootDir: dir },
        { cwd: dir, env: {} } as never
      );

      expect(fresh.isOk()).toBe(true);
      expect(fresh.value?.drift).toMatchObject({ stale: false });
      expect(fresh.value?.passed).toBe(true);
      expect(stale.isOk()).toBe(true);
      expect(stale.value?.drift).toMatchObject({ stale: true });
      expect(stale.value?.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('blocks configured workspace drift when app-local locks are missing', async () => {
    const dir = makeTempDir();
    try {
      writeConfiguredWorkspaceFixture(dir);

      const result = await wardenTrail.implementation(
        { depth: 'all', rootDir: dir },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value?.drift).toMatchObject({
        committedHash: null,
        currentHash: 'blocked',
        stale: true,
      });
      expect(result.value?.drift?.blockedReason).toContain('alpha');
      expect(result.value?.drift?.blockedReason).toContain('beta');
      expect(result.value?.drift?.blockedReason).toContain(
        join(dir, 'apps', 'alpha', 'trails.lock')
      );
      expect(result.value?.drift?.blockedReason).toContain(
        join(dir, 'apps', 'beta', 'trails.lock')
      );
      expect(result.value?.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects legacy --apps as a second configured-workspace catalog', async () => {
    const dir = makeTempDir();
    try {
      writeConfiguredWorkspaceFixture(dir);

      const result = await wardenTrail.implementation(
        {
          apps: ['alpha'],
          depth: 'source',
          lock: 'skip',
          rootDir: dir,
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isOk()) {
        throw new Error('Expected configured workspace --apps to fail.');
      }
      expect(result.error.message).toContain(
        'derive Warden app targets from workspace.apps'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects a configured app whose live topo has another name', async () => {
    const dir = makeTempDir();
    try {
      writeConfiguredWorkspaceFixture(dir);
      const sourcePath = join(dir, 'legacy.ts');
      const source = 'export const play = trail("play", { crosses: [] });\n';
      writeFileSync(
        join(dir, 'apps', 'alpha', 'src', 'app.ts'),
        `import { topo } from ${JSON.stringify(coreModuleUrl)};\nexport const app = topo('other', []);\n`
      );
      writeFileSync(sourcePath, source);

      const result = await wardenTrail.implementation(
        {
          app: 'alpha',
          depth: 'topo',
          fix: true,
          lock: 'skip',
          rootDir: dir,
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Loaded topo "other"');
      }
      expect(readFileSync(sourcePath, 'utf8')).toBe(source);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not boot configured apps before source analysis', async () => {
    const dir = makeTempDir();
    try {
      writeConfiguredWorkspaceFixture(dir);
      writeFileSync(
        join(dir, 'apps', 'alpha', 'src', 'app.ts'),
        `throw new Error('boot fails');\n`
      );
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail('source.fail', {
  implementation: () => {
    throw new Error('still governed');
  },
});\n`
      );

      const result = await wardenTrail.implementation(
        {
          app: 'alpha',
          depth: 'source',
          format: 'summary',
          lock: 'skip',
          rootDir: dir,
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.errorCount).toBe(1);
      expect(result.value.diagnostics[0]?.rule).toBe(
        'no-throw-in-implementation'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('rejects a configured app boot failure before applying source fixes', async () => {
    const dir = makeTempDir();
    try {
      writeConfiguredWorkspaceFixture(dir);
      const sourcePath = join(dir, 'legacy.ts');
      const source = 'export const play = trail("play", { crosses: [] });\n';
      writeFileSync(
        join(dir, 'apps', 'alpha', 'src', 'app.ts'),
        `throw new Error('boot fails');\n`
      );
      writeFileSync(sourcePath, source);

      const result = await wardenTrail.implementation(
        {
          app: 'alpha',
          depth: 'topo',
          fix: true,
          lock: 'skip',
          rootDir: dir,
        },
        { cwd: dir, env: {} } as never
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain(
          'Unable to prove the Config-owned identity "alpha"'
        );
      }
      expect(readFileSync(sourcePath, 'utf8')).toBe(source);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('warden guide renders markdown from the Warden manifest', async () => {
    const result = await wardenGuideTrail.implementation(
      { guideFormat: 'markdown' },
      {
        cwd: repoRoot,
        env: {},
      } as never
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.manifest.kind).toBe('trails-warden-guide-manifest');
    expect(result.value.formatted).toContain('# Trails Warden Guide');
    expect(result.value.formatted).toContain(
      '### `no-throw-in-implementation`'
    );
    expect(result.value.formatted).toContain(
      'Convert thrown failures in implementations into explicit Result.err() outcomes.'
    );
  });

  test('warden output schema accepts shared structured guidance diagnostics', () => {
    const parsed = wardenTrail.output.safeParse({
      diagnostics: [
        {
          code: 'no-throw-in-implementation',
          filePath: 'src/trails/entity.ts',
          fix: {
            class: 'term-rewrite',
            reason: 'Retired term needs a reviewed migration.',
            safety: 'review',
          },
          guidance: {
            docs: [{ label: 'Trail Rules', path: 'AGENTS.md#trail-rules' }],
            summary:
              'Convert thrown failures in implementations into Result.err().',
          },
          line: 3,
          message: 'Do not throw inside the implementation.',
          rule: 'no-throw-in-implementation',
          severity: 'error',
          topoName: 'demo',
        },
      ],
      drift: null,
      errorCount: 1,
      fixes: undefined,
      formatted: 'Result: FAIL',
      passed: false,
      project: {
        app: {
          appRoot: '.',
          artifactPath: '/repo/trails.lock',
          configured: false,
          modulePath: 'src/app.ts',
          moduleSource: 'convention',
        },
        configuredAppIds: [],
        projectRoot: '/repo',
        selectedExtent: 'standalone-app',
        selectionProvenance: 'cwd',
      },
      warnCount: 0,
    });

    expect(parsed.success).toBe(true);
  });

  test('warden output schema rejects impossible selection provenance', () => {
    const parsed = wardenTrail.output.safeParse({
      diagnostics: [],
      drift: null,
      errorCount: 0,
      formatted: 'Result: PASS',
      passed: true,
      project: {
        app: {
          appId: 'impossible',
          appRoot: '.',
          artifactPath: '/repo/trails.lock',
          configured: false,
          modulePath: 'src/app.ts',
          moduleSource: 'convention',
        },
        configuredAppIds: [],
        projectRoot: '/repo',
        selectedExtent: 'standalone-app',
        selectionProvenance: 'app',
      },
      warnCount: 0,
    });

    expect(parsed.success).toBe(false);
  });

  test('warden guide format aliases work through the CLI', () => {
    const raw = runRawCli(
      trailsBinPath,
      ['warden', 'guide', '--agent-json'],
      repoRoot
    );
    const parsed = JSON.parse(raw.stdout) as {
      readonly kind: string;
      readonly rules: readonly { readonly id: string }[];
    };

    expect(raw.exitCode).toBe(0);
    expect(raw.stderr).toBe('');
    expect(parsed.kind).toBe('trails-warden-agent-guide');
    expect(parsed.rules.map((rule) => rule.id)).toContain(
      'no-throw-in-implementation'
    );
  });

  test('trails warden forwards scope exclude value flags', () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, '.agents', 'notes'), { recursive: true });
      writeFileSync(
        join(dir, '.agents', 'notes', 'ignored.ts'),
        `export const flag = '--dev${'-permit'}';\n`
      );

      const raw = runCli(
        trailsBinPath,
        [
          'warden',
          '--depth',
          'source',
          '--lock',
          'skip',
          '--json',
          '--root-dir',
          dir,
          '--scope-exclude',
          '.agents/notes/**',
        ],
        repoRoot
      );

      expect(raw.exitCode).toBe(0);
      expect(raw.json).toMatchObject({
        passed: true,
        summary: { errors: 0 },
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('standalone Warden bin shows help without running checks', () => {
    const raw = runRawCli(wardenBinPath, ['--help'], repoRoot);

    expect(raw.exitCode).toBe(0);
    expect(raw.stderr).toBe('');
    expect(raw.stdout).toContain('Usage: warden [options]');
    expect(raw.stdout).toContain('--depth <value>');
    expect(raw.stdout).toContain('--fix');
    expect(raw.stdout).toContain('--adapter-check');
    expect(raw.stdout).toContain('--scope-exclude <glob>');
    expect(raw.stdout).not.toContain('Warden Report');
  });

  test('onResult bridge writes formatted output and sets the exit code', () => {
    const originalWrite = process.stdout.write;
    const originalExitCode = process.exitCode;
    let output = '';
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;
    process.exitCode = 0;

    try {
      const handled = tryWardenOutput({
        args: {},
        flags: {},
        input: {},
        result: Result.ok({ formatted: 'warden says no', passed: false }),
        topoName: 'trails',
        trail: wardenTrail as unknown as ActionResultContext['trail'],
      });

      expect(handled).toBe(true);
      expect(output).toBe('warden says no\n');
      expect(process.exitCode).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
      // Bun does not clear a non-zero exitCode when assigned undefined.
      process.exitCode = originalExitCode ?? 0;
    }
  });

  test('onResult bridge writes guide output without changing exit code', () => {
    const originalWrite = process.stdout.write;
    const originalExitCode = process.exitCode;
    let output = '';
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;
    process.exitCode = 7;

    try {
      const handled = tryWardenOutput({
        args: {},
        flags: {},
        input: {},
        result: Result.ok({ formatted: '# Guide' }),
        topoName: 'trails',
        trail: wardenGuideTrail as unknown as ActionResultContext['trail'],
      });

      expect(handled).toBe(true);
      expect(output).toBe('# Guide\n');
      expect(process.exitCode).toBe(7);
    } finally {
      process.stdout.write = originalWrite;
      process.exitCode = originalExitCode ?? 0;
    }
  });

  test.each([
    {
      depth: 'source',
      expectedErrors: 0,
      expectedExitCode: 0,
      expectedRule: undefined,
      expectedWarnings: 0,
      failOn: 'error',
      fixture: writeProjectOnlyErrorFixture,
      name: 'source/error ignores project-only findings',
    },
    {
      depth: 'source',
      expectedErrors: 0,
      expectedExitCode: 0,
      expectedRule: undefined,
      expectedWarnings: 0,
      failOn: 'warning',
      fixture: writeAllDepthWarningFixture,
      name: 'source/warning ignores advisory findings',
    },
    {
      depth: 'project',
      expectedErrors: 1,
      expectedExitCode: 1,
      expectedRule: 'on-references-exist',
      expectedWarnings: 0,
      failOn: 'error',
      fixture: writeProjectOnlyErrorFixture,
      name: 'project/error fails on project findings',
    },
    {
      depth: 'project',
      expectedErrors: 1,
      expectedExitCode: 1,
      expectedRule: 'on-references-exist',
      expectedWarnings: 0,
      failOn: 'warning',
      fixture: writeProjectOnlyErrorFixture,
      name: 'project/warning still fails on errors',
    },
    {
      depth: 'topo',
      expectedErrors: 1,
      expectedExitCode: 1,
      expectedRule: 'on-references-exist',
      expectedWarnings: 0,
      failOn: 'error',
      fixture: writeProjectOnlyErrorFixture,
      name: 'topo/error includes shallower project findings',
    },
    {
      depth: 'topo',
      expectedErrors: 1,
      expectedExitCode: 1,
      expectedRule: 'on-references-exist',
      expectedWarnings: 0,
      failOn: 'warning',
      fixture: writeProjectOnlyErrorFixture,
      name: 'topo/warning still fails on errors',
    },
    {
      depth: 'all',
      expectedErrors: 0,
      expectedExitCode: 0,
      expectedRule: 'prefer-schema-inference',
      expectedWarnings: 1,
      failOn: 'error',
      fixture: writeAllDepthWarningFixture,
      name: 'all/error reports warnings without failing',
    },
    {
      depth: 'all',
      expectedErrors: 0,
      expectedExitCode: 1,
      expectedRule: 'prefer-schema-inference',
      expectedWarnings: 1,
      failOn: 'warning',
      fixture: writeAllDepthWarningFixture,
      name: 'all/warning fails on warning-only findings',
    },
  ] as const)(
    'acceptance: $name across Warden bin and trails warden',
    ({
      depth,
      expectedErrors,
      expectedExitCode,
      expectedRule,
      expectedWarnings,
      failOn,
      fixture,
    }) => {
      const dir = makeTempDir();
      try {
        fixture(dir);
        const args = [
          '--depth',
          depth,
          '--fail-on',
          failOn,
          '--lock',
          'skip',
          '--format',
          'json',
          '--root-dir',
          dir,
        ];
        const warden = runCli(wardenBinPath, args, repoRoot);
        const trails = runCli(trailsBinPath, ['warden', ...args], repoRoot);

        expect(warden.exitCode).toBe(expectedExitCode);
        expect(trails.exitCode).toBe(expectedExitCode);
        expect(warden.stderr).toBe('');
        expect(trails.stderr).toBe('');
        const { project, ...trailsReport } = trails.json;
        expect(trailsReport).toEqual(warden.json);
        expect(project).toMatchObject({
          configuredAppIds: [],
          selectedExtent: 'standalone-app',
        });
        expect(warden.json.passed).toBe(expectedExitCode === 0);
        expect(warden.json.summary).toMatchObject({
          errors: expectedErrors,
          warnings: expectedWarnings,
        });
        if (expectedRule === undefined) {
          expect(warden.json.diagnostics).toHaveLength(0);
        } else {
          expect(warden.json.diagnostics.map((entry) => entry.rule)).toContain(
            expectedRule
          );
        }
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  );
});
