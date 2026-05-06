import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BOOTSTRAP_DIR = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = resolve(BOOTSTRAP_DIR, '..');
export const DEFAULT_REPO_ROOT = resolve(SCRIPTS_DIR, '..');

export interface ExecResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export const has = (tool: string): boolean => Bun.which(tool) !== null;

export const run = (cmd: readonly string[], cwd: string): ExecResult => {
  const result = Bun.spawnSync({
    cmd,
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stderr: new TextDecoder().decode(result.stderr),
    stdout: new TextDecoder().decode(result.stdout),
  };
};

export const runInherit = async (
  cmd: readonly string[],
  cwd: string
): Promise<number> => {
  const proc = Bun.spawn(cmd, {
    cwd,
    stderr: 'inherit',
    stdout: 'inherit',
  });
  return await proc.exited;
};

export const repoFile = (repoRoot: string, path: string): string =>
  resolve(repoRoot, path);

export const isRepoRoot = (path: string): boolean =>
  existsSync(repoFile(path, 'package.json')) &&
  existsSync(repoFile(path, '.bun-version'));

export const info = (message: string): void => {
  console.error(`▸ ${message}`);
};

export const success = (message: string): void => {
  console.error(`✓ ${message}`);
};

export const warn = (message: string): void => {
  console.error(`! ${message}`);
};
