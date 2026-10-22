import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  PermissionError,
  renderPublicSurfaceError,
  ValidationError,
} from '@ontrails/core';

import {
  createLoadAppMirrorRootPath,
  ensureLoadAppMirrorDirectory,
  LOAD_APP_MIRROR_PARENT_DIRNAME,
  removeLoadAppMirrorRoot,
  removeLoadAppMirrorRootQuietly,
  resolveLoadAppMirrorFilePath,
  writeLoadAppMirrorFile,
} from '../load-app-mirror.js';
import { loadFreshAppLease } from '../trails/load-app.js';

const roots: string[] = [];
const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'trails-scratch-test-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = join(root, 'target');
    if (existsSync(target)) {
      chmodSync(target, 0o700);
    }
    rmSync(root, { force: true, recursive: true });
  }
});

const cliPath = resolve(import.meta.dir, '../../bin/trails.ts');
const coreUrl = import.meta.resolve('@ontrails/core');
const fixtureApp = `import { topo, trail, Result } from ${JSON.stringify(coreUrl)};
export const app = topo('scratch-fixture', {
  check: trail('scratch.check', { intent: 'read', implementation: () => Result.ok({ ok: true }) }),
});\n`;

const runWayfind = async (target: string, scratch: string) => {
  const proc = Bun.spawn(
    [
      process.execPath,
      cliPath,
      'wayfind',
      '--source',
      'live',
      '--overview',
      '--module',
      './app.ts',
      '--root-dir',
      target,
      '--json',
    ],
    {
      cwd: target,
      env: { ...process.env, TEMP: scratch, TMP: scratch, TMPDIR: scratch },
      stderr: 'pipe',
      stdout: 'pipe',
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
};

describe('fresh app-load scratch ownership', () => {
  test('uses an exclusive private owner with a deterministic internal temporary-directory seam', () => {
    const scratch = temporaryRoot();
    const first = createLoadAppMirrorRootPath(process.cwd(), scratch);
    const second = createLoadAppMirrorRootPath(process.cwd(), scratch);
    expect(dirname(first)).toBe(join(scratch, LOAD_APP_MIRROR_PARENT_DIRNAME));
    expect(first).not.toBe(second);
    expect(lstatSync(dirname(first)).mode % 0o1000).toBe(0o700);
    expect(removeLoadAppMirrorRoot(first).isOk()).toBe(true);
    expect(existsSync(second)).toBe(true);
  });

  test('rejects a temporary owner inside the target, including a symlink alias', () => {
    const target = temporaryRoot();
    const outside = temporaryRoot();
    const alias = join(outside, 'alias');
    symlinkSync(target, alias, 'dir');
    expect(() => createLoadAppMirrorRootPath(target, target)).toThrow(
      'outside the target worktree'
    );
    expect(() => createLoadAppMirrorRootPath(target, alias)).toThrow(
      'outside the target worktree'
    );
    expect(existsSync(join(target, LOAD_APP_MIRROR_PARENT_DIRNAME))).toBe(
      false
    );
  });

  test('refuses symlink and non-private owners without changing their contents or permissions', () => {
    const scratch = temporaryRoot();
    const unrelated = temporaryRoot();
    const owner = join(scratch, LOAD_APP_MIRROR_PARENT_DIRNAME);
    symlinkSync(unrelated, owner, 'dir');
    expect(() => createLoadAppMirrorRootPath(process.cwd(), scratch)).toThrow();
    expect(readdirSync(unrelated)).toEqual([]);
    rmSync(owner);
    mkdirSync(owner, { mode: 0o755 });
    expect(() => createLoadAppMirrorRootPath(process.cwd(), scratch)).toThrow();
    expect(lstatSync(owner).mode % 0o1000).toBe(0o755);
  });

  test('does not follow root or nested symlinks for writes or cleanup', async () => {
    const scratch = temporaryRoot();
    const unrelated = temporaryRoot();
    const mirrorRoot = createLoadAppMirrorRootPath(process.cwd(), scratch);
    const source = join(unrelated, 'source.ts');
    writeFileSync(source, 'unchanged');
    const resolved = resolveLoadAppMirrorFilePath(source, mirrorRoot);
    if (resolved.isErr()) {
      throw resolved.error;
    }
    const destination = resolved.value;
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(source, destination);
    const write = await writeLoadAppMirrorFile(source, mirrorRoot);
    expect(write.isErr()).toBe(true);
    expect(readFileSync(source, 'utf8')).toBe('unchanged');
    const link = join(mirrorRoot, 'escape');
    symlinkSync(unrelated, link, 'dir');
    expect(
      ensureLoadAppMirrorDirectory(join(link, 'new'), mirrorRoot).isErr()
    ).toBe(true);
    expect(existsSync(join(unrelated, 'new'))).toBe(false);
    expect(removeLoadAppMirrorRoot(mirrorRoot).isOk()).toBe(true);
    symlinkSync(unrelated, mirrorRoot, 'dir');
    expect(removeLoadAppMirrorRoot(mirrorRoot).isErr()).toBe(true);
    expect(readFileSync(source, 'utf8')).toBe('unchanged');
  });

  test('rejects lookalike owners and traversal outside a real mirror', () => {
    const scratch = temporaryRoot();
    const mirrorRoot = createLoadAppMirrorRootPath(process.cwd(), scratch);
    const forged = join(
      temporaryRoot(),
      LOAD_APP_MIRROR_PARENT_DIRNAME,
      'load-app-fresh-123-forged'
    );
    mkdirSync(forged, { recursive: true });
    expect(removeLoadAppMirrorRoot(forged).isErr()).toBe(true);
    expect(
      ensureLoadAppMirrorDirectory(
        join(mirrorRoot, '..', 'escape'),
        mirrorRoot
      ).isErr()
    ).toBe(true);
    expect(existsSync(forged)).toBe(true);
  });

  test('reports scratch write failures as typed safe environment errors', () => {
    const scratch = temporaryRoot();
    const mirrorRoot = createLoadAppMirrorRootPath(process.cwd(), scratch);
    writeFileSync(join(mirrorRoot, 'file'), 'not a directory');
    const failure = ensureLoadAppMirrorDirectory(
      join(mirrorRoot, 'file', 'child'),
      mirrorRoot
    );
    expect(failure.isErr()).toBe(true);
    if (failure.isOk()) {
      throw new Error('Expected scratch write to fail');
    }
    const { error } = failure;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('Cannot write fresh app-load scratch');
    expect(error.message).not.toContain(scratch);
  });

  test.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
    'renders scratch write permission failures without exposing paths',
    () => {
      const scratch = temporaryRoot();
      const mirrorRoot = createLoadAppMirrorRootPath(process.cwd(), scratch);
      chmodSync(mirrorRoot, 0o500);
      try {
        expect(() =>
          writeFileSync(join(mirrorRoot, 'denial-probe'), 'must fail')
        ).toThrow();
        const result = ensureLoadAppMirrorDirectory(
          join(mirrorRoot, 'new'),
          mirrorRoot
        );
        if (result.isOk()) {
          throw new Error('Expected scratch write denial');
        }
        expect(result.error).toBeInstanceOf(PermissionError);
        const rendered = renderPublicSurfaceError('cli', result.error);
        expect(rendered.category).toBe('permission');
        expect(rendered.message).toContain(
          'Cannot write fresh app-load scratch'
        );
        expect(JSON.stringify(rendered)).not.toContain(scratch);
      } finally {
        chmodSync(mirrorRoot, 0o700);
      }
    }
  );

  test('leaves old mirrors from another live process alone and sweeps them after it exits', async () => {
    const target = temporaryRoot();
    writeFileSync(join(target, 'app.ts'), 'export const app = { trails: [] };');
    const child = Bun.spawn(
      [process.execPath, '-e', 'await Bun.stdin.text()'],
      { stderr: 'ignore', stdin: 'pipe', stdout: 'ignore' }
    );
    const allocated = createLoadAppMirrorRootPath(target);
    const mirrorRoot = join(
      dirname(allocated),
      `load-app-fresh-${child.pid}-livefixture`
    );
    renameSync(allocated, mirrorRoot);
    const staleTime = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(mirrorRoot, staleTime, staleTime);
    try {
      const first = await loadFreshAppLease('./app.ts', target);
      first.release();
      expect(existsSync(mirrorRoot)).toBe(true);
      child.kill();
      await child.exited;
      const second = await loadFreshAppLease('./app.ts', target);
      second.release();
      expect(existsSync(mirrorRoot)).toBe(false);
    } finally {
      child.kill();
      await child.exited;
      removeLoadAppMirrorRootQuietly(mirrorRoot);
    }
  });

  test('concurrent leases do not collide or release each other', async () => {
    const target = temporaryRoot();
    const modulePath = join(target, 'app.ts');
    writeFileSync(
      modulePath,
      `export const app = { trails: [], location: import.meta.url };`
    );
    const leases = await Promise.all(
      Array.from({ length: 6 }, () => loadFreshAppLease('./app.ts', target))
    );
    try {
      const paths = leases.map(
        (lease) =>
          new URL((lease.app as unknown as { location: string }).location)
            .pathname
      );
      expect(new Set(paths).size).toBe(6);
      leases[0]?.release();
      expect(existsSync(paths[0] ?? '')).toBe(false);
      expect(paths.slice(1).every((path) => existsSync(path))).toBe(true);
    } finally {
      for (const lease of leases) {
        lease.release();
      }
    }
  });
});

describe('live Wayfinder scratch boundary', () => {
  test.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
    'reads a genuinely non-writable target without creating target-local scratch',
    async () => {
      const root = temporaryRoot();
      const target = join(root, 'target');
      const scratch = join(root, 'scratch');
      mkdirSync(target);
      mkdirSync(scratch);
      writeFileSync(join(target, 'app.ts'), fixtureApp, { mode: 0o444 });
      chmodSync(target, 0o555);
      expect(() =>
        writeFileSync(join(target, 'denial-probe'), 'must fail')
      ).toThrow();
      const result = await runWayfind(target, scratch);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).result.entries[0].id).toBe(
        'scratch.check'
      );
      expect(readdirSync(target)).toEqual(['app.ts']);
      expect(existsSync(join(target, '.trails-tmp'))).toBe(false);
      expect(
        readdirSync(join(scratch, LOAD_APP_MIRROR_PARENT_DIRNAME))
      ).toEqual([]);
    }
  );

  test.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
    'exposes safe actionable permission diagnostics in ordinary JSON without trace',
    async () => {
      const root = temporaryRoot();
      const target = join(root, 'target');
      const scratch = join(root, 'sensitive-scratch-location');
      mkdirSync(target);
      mkdirSync(scratch);
      writeFileSync(join(target, 'app.ts'), fixtureApp);
      chmodSync(scratch, 0o555);
      try {
        expect(() =>
          writeFileSync(join(scratch, 'denial-probe'), 'must fail')
        ).toThrow();
        expect(() => createLoadAppMirrorRootPath(target, scratch)).toThrow(
          PermissionError
        );
        const result = await runWayfind(target, scratch);
        expect(result.exitCode).not.toBe(0);
        const envelope = JSON.parse(result.stderr);
        expect(envelope.ok).toBe(false);
        expect(envelope.error.category).toBe('permission');
        expect(envelope.error.message).toContain(
          'Cannot allocate fresh app-load scratch'
        );
        expect(envelope.error.message).toContain('TMPDIR');
        expect(envelope.context).toEqual({
          boundary: 'load-app-scratch',
          code: 'EACCES',
          operation: 'allocate',
        });
        expect(result.stdout + result.stderr).not.toContain(scratch);
        expect(existsSync(join(target, '.trails-tmp'))).toBe(false);
      } finally {
        chmodSync(scratch, 0o700);
      }
    }
  );

  test('keeps application import failures distinct from scratch allocation failures', async () => {
    const root = temporaryRoot();
    const target = join(root, 'target');
    const scratch = join(root, 'scratch');
    mkdirSync(target);
    mkdirSync(scratch);
    writeFileSync(
      join(target, 'app.ts'),
      `throw new Error('fixture application import failed');`
    );
    const result = await runWayfind(target, scratch);
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stderr).error.message).toContain(
      'fixture application import failed'
    );
    expect(result.stderr).not.toContain('load-app-scratch');
    expect(readdirSync(join(scratch, LOAD_APP_MIRROR_PARENT_DIRNAME))).toEqual(
      []
    );
  });
});
