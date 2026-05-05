import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';

import { renderCompletionScript } from '../completions.js';
import {
  attachCompletionsInstallCommand,
  runCompletionsInstall,
} from '../run-completions-install.js';
import type { CompletionShell } from '../completions.js';

interface InstallOutput {
  readonly shell: string;
  readonly path: string;
  readonly created: boolean;
  readonly message?: string;
}

const asInstallOutput = (value: unknown): InstallOutput =>
  value as InstallOutput;

const expectedScript = (shell: CompletionShell): string =>
  renderCompletionScript(shell, 'trails').unwrap();

let homeDir: string;

beforeEach(() => {
  homeDir = join(
    tmpdir(),
    `completions-install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(homeDir, { recursive: true });
});

afterEach(() => {
  rmSync(homeDir, { force: true, recursive: true });
});

describe('runCompletionsInstall', () => {
  describe('explicit shell', () => {
    test('writes a bash completion script to the standard path', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shell: 'bash',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(asInstallOutput(result.value).shell).toBe('bash');
      expect(asInstallOutput(result.value).created).toBe(true);
      const expectedPath = join(
        homeDir,
        '.local/share/bash-completion/completions/trails'
      );
      expect(asInstallOutput(result.value).path).toBe(expectedPath);
      const written = await readFile(expectedPath, 'utf8');
      expect(written).toBe(expectedScript('bash'));
    });

    test('writes a zsh completion script to the per-user site-functions path', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shell: 'zsh',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const expectedPath = join(
        homeDir,
        '.local/share/zsh/site-functions/_trails'
      );
      expect(asInstallOutput(result.value).shell).toBe('zsh');
      expect(asInstallOutput(result.value).path).toBe(expectedPath);
      const written = await readFile(expectedPath, 'utf8');
      expect(written).toBe(expectedScript('zsh'));
    });

    test('writes a fish completion script to the standard fish path', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shell: 'fish',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const expectedPath = join(
        homeDir,
        '.config/fish/completions/trails.fish'
      );
      expect(asInstallOutput(result.value).shell).toBe('fish');
      expect(asInstallOutput(result.value).path).toBe(expectedPath);
      const written = await readFile(expectedPath, 'utf8');
      expect(written).toBe(expectedScript('fish'));
    });

    test('returns a message that mentions the install path', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shell: 'bash',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(asInstallOutput(result.value).message).toContain(
        asInstallOutput(result.value).path
      );
    });
  });

  describe('shell auto-detection', () => {
    test('detects zsh from $SHELL=/bin/zsh', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shellEnv: '/bin/zsh',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(asInstallOutput(result.value).shell).toBe('zsh');
    });

    test('detects bash from $SHELL=/usr/local/bin/bash', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shellEnv: '/usr/local/bin/bash',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(asInstallOutput(result.value).shell).toBe('bash');
    });

    test('detects fish from $SHELL=/opt/homebrew/bin/fish', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shellEnv: '/opt/homebrew/bin/fish',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(asInstallOutput(result.value).shell).toBe('fish');
    });

    test('explicit shell input overrides shellEnv detection', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shell: 'fish',
        shellEnv: '/bin/zsh',
      });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(asInstallOutput(result.value).shell).toBe('fish');
    });
  });

  describe('detection failure', () => {
    test('returns ValidationError when shellEnv is empty and shell unset', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shellEnv: '',
      });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error.name).toBe('ValidationError');
      expect(result.error.message).toMatch(/shell|--shell/i);
    });

    test('returns ValidationError when shellEnv is an unsupported shell', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shellEnv: '/bin/csh',
      });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error.name).toBe('ValidationError');
    });

    test('returns ValidationError when explicit shell input is unsupported', async () => {
      const result = await runCompletionsInstall({
        homeDir,
        shell: 'csh',
      });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error.name).toBe('ValidationError');
    });
  });

  describe('idempotency', () => {
    test('writing twice succeeds; second call reports created=false', async () => {
      const first = await runCompletionsInstall({
        homeDir,
        shell: 'bash',
      });
      expect(first.isOk()).toBe(true);
      if (!first.isOk()) {
        return;
      }
      expect(asInstallOutput(first.value).created).toBe(true);

      const second = await runCompletionsInstall({
        homeDir,
        shell: 'bash',
      });
      expect(second.isOk()).toBe(true);
      if (!second.isOk()) {
        return;
      }
      expect(asInstallOutput(second.value).created).toBe(false);
      expect(asInstallOutput(second.value).message).toContain('Updated bash');
      expect(asInstallOutput(second.value).path).toBe(
        asInstallOutput(first.value).path
      );

      // Verify byte-equality across the two writes — true idempotency.
      const { path } = asInstallOutput(first.value);
      const writtenBytes = await readFile(path);
      const expectedBytes = Buffer.from(expectedScript('bash'));
      expect(writtenBytes.equals(expectedBytes)).toBe(true);
    });
  });

  describe('write failures', () => {
    test('returns Result.err when filesystem writes fail', async () => {
      rmSync(homeDir, { force: true, recursive: true });
      writeFileSync(homeDir, 'not a directory');

      const result = await runCompletionsInstall({
        homeDir,
        shell: 'bash',
      });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(Error);
    });
  });
});

describe('attachCompletionsInstallCommand', () => {
  test('wires a CLI command that invokes the install bridge', async () => {
    const program = new Command();
    let stdout = '';

    attachCompletionsInstallCommand(program, {
      homeDir,
      stdout: {
        write: (chunk) => {
          stdout += chunk;
          return true;
        },
      },
    });

    await program.parseAsync(
      ['node', 'trails', 'completions', 'install', '--shell', 'bash'],
      { from: 'node' }
    );

    const expectedPath = join(
      homeDir,
      '.local/share/bash-completion/completions/trails'
    );
    expect(stdout).toContain(expectedPath);
    expect(await readFile(expectedPath, 'utf8')).toBe(expectedScript('bash'));
  });
});
