import { describe, expect, test } from 'bun:test';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isBunVersionAllowed } from '../bootstrap/bun.ts';
import { loadBootstrapConfig } from '../bootstrap/config.ts';
import { isLinkedWorktree } from '../bootstrap/git.ts';
import { detectHost, resolveRepoRoot } from '../bootstrap/host.ts';
import { parseBootstrapArgs } from '../bootstrap/main.ts';
import { ensureBunPolicy, listWorkspaceGlobs } from '../bootstrap/repo.ts';
import { resolveCleanupTarget } from '../bootstrap/sweep.ts';
import { collectToolStatus } from '../bootstrap/tools.ts';

const repoRoot = join(import.meta.dir, '..', '..');
const packageJson = JSON.parse(
  await Bun.file(join(repoRoot, 'package.json')).text()
) as {
  workspaces?: string[];
};
const expectedWorkspaces = Array.isArray(packageJson.workspaces)
  ? packageJson.workspaces
  : [];

const makeRepoRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bootstrap-root-'));
  writeFileSync(join(root, 'package.json'), '{"workspaces":[]}\n');
  writeFileSync(join(root, '.bun-version'), '1.4.4\n');
  return root;
};

describe('bootstrap dispatcher', () => {
  test('keeps legacy flags routed to repo', () => {
    expect(parseBootstrapArgs(['--force'])).toEqual({
      command: 'repo',
      force: true,
      provider: undefined,
      update: false,
    });
    expect(parseBootstrapArgs(['--update'])).toEqual({
      command: 'repo',
      force: false,
      provider: undefined,
      update: true,
    });
  });

  test('parses explicit subcommands', () => {
    expect(parseBootstrapArgs(['agent', '--update'])).toEqual({
      command: 'agent',
      force: false,
      provider: undefined,
      update: true,
    });
    expect(parseBootstrapArgs(['codex'])).toEqual({
      command: 'codex',
      force: false,
      provider: 'codex',
      update: false,
    });
    expect(parseBootstrapArgs(['claude'])).toEqual({
      command: 'claude',
      force: false,
      provider: 'claude',
      update: false,
    });
    expect(parseBootstrapArgs(['cursor', '--update'])).toEqual({
      command: 'cursor',
      force: false,
      provider: 'cursor',
      update: true,
    });
    expect(parseBootstrapArgs(['doctor'])).toEqual({
      command: 'doctor',
      force: false,
      provider: undefined,
      update: false,
    });
    expect(parseBootstrapArgs(['teardown'])).toEqual({
      command: 'teardown',
      force: false,
      provider: undefined,
      update: false,
    });
    expect(parseBootstrapArgs(['sweep'])).toEqual({
      command: 'sweep',
      force: false,
      provider: undefined,
      update: false,
    });
  });

  test('shell entrypoint exposes help without mutating setup state', () => {
    const proc = Bun.spawnSync({
      cmd: ['bash', './scripts/bootstrap.sh', '--help'],
      cwd: repoRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    });

    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain(
      'repo|agent|codex|claude|cursor|doctor|teardown'
    );
  });
});

describe('bootstrap shell runtime', () => {
  test.each([
    ['1.3.99', 'repo', true],
    ['1.4.0', 'repo', true],
    ['1.4.1', 'repo', true],
    ['1.4.2', 'repo', true],
    ['1.4.3', 'repo', true],
    ['1.4.4', 'repo', false],
    ['1.4.5', 'repo', false],
    ['1.4.0', 'doctor', false],
  ] as const)(
    'Bun %s entering %s repairs=%s before dispatch',
    (actual, command, repairs) => {
      const root = makeRepoRoot();
      const installDir = join(root, 'bun');
      mkdirSync(join(root, 'scripts'));
      mkdirSync(join(installDir, 'bin'), { recursive: true });
      copyFileSync(
        join(repoRoot, 'scripts/bootstrap.sh'),
        join(root, 'scripts/bootstrap.sh')
      );
      writeFileSync(join(installDir, 'version'), actual);
      writeFileSync(
        join(installDir, 'bin/bun'),
        '#!/bin/sh\n' +
          'version=$(cat "$BUN_INSTALL/version")\n' +
          'if [ "$1" = "--version" ]; then echo "$version"; else echo "dispatch:$version:$2"; fi\n',
        { mode: 0o755 }
      );
      writeFileSync(
        join(installDir, 'bin/curl'),
        '#!/bin/sh\n' +
          "cat <<'INSTALL'\n" +
          'printf "%s\\n" "$1" | cut -c 6- > "$BUN_INSTALL/version"\n' +
          'INSTALL\n',
        { mode: 0o755 }
      );
      try {
        for (const policy of ['compatible', 'strict'] as const) {
          const check = Bun.spawnSync({
            cmd: [
              process.execPath,
              '--eval',
              `import { checkBunVersion } from ${JSON.stringify(join(repoRoot, 'scripts/bootstrap/bun.ts'))}; console.log(JSON.stringify(checkBunVersion(process.cwd(), ${JSON.stringify(policy)})));`,
            ],
            cwd: root,
            env: {
              BUN_INSTALL: installDir,
              PATH: `${installDir}/bin:/usr/bin:/bin`,
            },
            stderr: 'pipe',
            stdout: 'pipe',
          });
          const allowed =
            actual === '1.4.4' ||
            (policy === 'compatible' && actual === '1.4.5');

          expect(check.exitCode).toBe(0);
          expect(JSON.parse(check.stdout.toString())).toEqual({
            actual,
            ok: allowed,
            pinned: '1.4.4',
            policy,
            ...(allowed
              ? {}
              : {
                  reason:
                    policy === 'strict'
                      ? `Expected Bun 1.4.4, found ${actual}`
                      : `Expected Bun 1.4.4 or newer compatible patch, found ${actual}`,
                }),
          });
        }

        const proc = Bun.spawnSync({
          cmd: ['bash', './scripts/bootstrap.sh', command],
          cwd: root,
          env: { BUN_INSTALL: installDir, HOME: root, PATH: '/usr/bin:/bin' },
          stderr: 'pipe',
          stdout: 'pipe',
        });

        expect(proc.exitCode).toBe(0);
        expect(proc.stdout.toString().trim()).toBe(
          `dispatch:${repairs ? '1.4.4' : actual}:${command}`
        );
        expect(proc.stderr.toString().includes('Installing Bun 1.4.4')).toBe(
          repairs
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );
});

describe('bootstrap repo policy', () => {
  test('workspace globs stay aligned with root package.json', async () => {
    await expect(listWorkspaceGlobs(repoRoot)).resolves.toEqual(
      expectedWorkspaces
    );
  });

  test.each([
    ['1.3.10', false, false],
    ['1.3.99', false, false],
    ['1.4.0', false, false],
    ['1.4.1', false, false],
    ['1.4.2', false, false],
    ['1.4.3', false, false],
    ['1.4.4', true, true],
    ['1.4.4-canary.1', true, false],
    ['1.4.5', true, false],
    ['1.5.0', false, false],
    ['2.0.0', false, false],
  ] as const)(
    'Bun %s follows compatible=%s and strict=%s against the 1.4.4 checkout pin',
    (actual, compatible, strict) => {
      expect(isBunVersionAllowed(actual, '1.4.4', 'compatible')).toBe(
        compatible
      );
      expect(isBunVersionAllowed(actual, '1.4.4', 'strict')).toBe(strict);
    }
  );

  test('stale Bun is repaired before policy enforcement fails', async () => {
    const config = loadBootstrapConfig();
    const root = makeRepoRoot();
    const installs: string[] = [];
    let checks = 0;
    try {
      await ensureBunPolicy(
        {
          config,
          force: false,
          host: {
            bunPolicy: 'compatible',
            provider: 'generic',
            remote: false,
          },
          repoRoot: root,
          update: false,
        },
        {
          checkBunVersion: (_repoRoot, policy) => {
            checks += 1;
            return checks === 1
              ? {
                  actual: '1.4.0',
                  ok: false,
                  pinned: '1.4.4',
                  policy,
                  reason:
                    'Expected Bun 1.4.4 or newer compatible patch, found 1.4.0',
                }
              : {
                  actual: '1.4.4',
                  ok: true,
                  pinned: '1.4.4',
                  policy,
                };
          },
          installPinnedBun: async (installRoot, versionFile) => {
            installs.push(`${installRoot}:${versionFile ?? ''}`);
          },
        }
      );

      expect(checks).toBe(2);
      expect(installs).toEqual([`${root}:.bun-version`]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('root resolution prefers provider env vars before cwd', () => {
    const config = loadBootstrapConfig();
    const codexRoot = makeRepoRoot();
    const claudeRoot = makeRepoRoot();
    try {
      expect(
        resolveRepoRoot(
          claudeRoot,
          {
            CLAUDE_PROJECT_DIR: claudeRoot,
            CODEX_WORKTREE_PATH: codexRoot,
          } as NodeJS.ProcessEnv,
          config
        )
      ).toBe(codexRoot);
    } finally {
      rmSync(codexRoot, { force: true, recursive: true });
      rmSync(claudeRoot, { force: true, recursive: true });
    }
  });

  test('provider-specific root resolution prefers the requested provider', () => {
    const config = loadBootstrapConfig();
    const codexRoot = makeRepoRoot();
    const claudeRoot = makeRepoRoot();
    try {
      expect(
        resolveRepoRoot(
          tmpdir(),
          {
            CLAUDE_PROJECT_DIR: claudeRoot,
            CODEX_WORKTREE_PATH: codexRoot,
          } as NodeJS.ProcessEnv,
          config,
          'claude'
        )
      ).toBe(claudeRoot);
    } finally {
      rmSync(codexRoot, { force: true, recursive: true });
      rmSync(claudeRoot, { force: true, recursive: true });
    }
  });

  test('env-detected Cursor provider resolves from cwd before generic roots', () => {
    const config = loadBootstrapConfig();
    const cursorRoot = makeRepoRoot();
    const genericRoot = makeRepoRoot();
    const env = {
      CURSOR_AGENT: '1',
      GITHUB_WORKSPACE: genericRoot,
    } as NodeJS.ProcessEnv;
    try {
      const host = detectHost(env, config);
      expect(host).toMatchObject({
        provider: 'cursor',
        remote: true,
      });
      expect(resolveRepoRoot(cursorRoot, env, config, host.provider)).toBe(
        cursorRoot
      );
    } finally {
      rmSync(cursorRoot, { force: true, recursive: true });
      rmSync(genericRoot, { force: true, recursive: true });
    }
  });

  test('root resolution accepts CLAUDECODE when it carries a repo path', () => {
    const config = loadBootstrapConfig();
    const claudeRoot = makeRepoRoot();
    try {
      expect(
        resolveRepoRoot(
          tmpdir(),
          { CLAUDECODE: claudeRoot } as NodeJS.ProcessEnv,
          config
        )
      ).toBe(claudeRoot);
    } finally {
      rmSync(claudeRoot, { force: true, recursive: true });
    }
  });

  test('host detection honors explicit provider and remote overrides', () => {
    const config = loadBootstrapConfig();
    expect(
      detectHost(
        {
          TRAILS_AGENT_ENV_PROVIDER: 'factory',
          TRAILS_AGENT_ENV_REMOTE: 'true',
        } as NodeJS.ProcessEnv,
        config
      )
    ).toMatchObject({
      bunPolicy: 'strict',
      provider: 'factory',
      remote: true,
    });
  });

  test('host detection recognizes Cursor cloud agents as a remote provider', () => {
    const config = loadBootstrapConfig();
    expect(
      detectHost({ CURSOR_AGENT: '1' } as NodeJS.ProcessEnv, config)
    ).toMatchObject({
      bunPolicy: 'strict',
      provider: 'cursor',
      remote: true,
    });
    expect(
      detectHost({ CURSOR_AGENT: 'true' } as NodeJS.ProcessEnv, config)
    ).toMatchObject({
      bunPolicy: 'strict',
      provider: 'cursor',
      remote: true,
    });
  });

  test('cursor root resolution falls back to the cwd checkout', () => {
    const config = loadBootstrapConfig();
    const cursorRoot = makeRepoRoot();
    try {
      expect(
        resolveRepoRoot(
          cursorRoot,
          { CURSOR_AGENT: '1' } as NodeJS.ProcessEnv,
          config,
          'cursor'
        )
      ).toBe(cursorRoot);
    } finally {
      rmSync(cursorRoot, { force: true, recursive: true });
    }
  });

  test('linked worktree detection compares git dir and common dir', () => {
    expect(isLinkedWorktree('.git/worktrees/branch', '.git')).toBe(true);
    expect(isLinkedWorktree('.git', '.git')).toBe(false);
  });

  test('optional tool absence is reported without throwing', () => {
    expect(collectToolStatus(['definitely-not-a-real-tool'], repoRoot)).toEqual(
      [{ name: 'definitely-not-a-real-tool', present: false }]
    );
  });

  test('sweep rejects cleanup targets outside the repo', () => {
    expect(() => resolveCleanupTarget(repoRoot, '../outside')).toThrow(
      'outside repo'
    );
  });

  test('teardown cleanup includes current trails state paths', () => {
    const config = loadBootstrapConfig();
    expect(config.cleanup.files).toContain('.trails/state/trails.db');
    expect(config.cleanup.files).toContain('.trails/state/tracing.db');
  });
});
