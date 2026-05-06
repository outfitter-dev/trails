import { existsSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import type { BootstrapConfig } from './config.js';
import { info, success } from './shared.js';

export const resolveCleanupTarget = (
  repoRoot: string,
  configuredPath: string
): string => {
  const target = resolve(repoRoot, configuredPath);
  const relativePath = relative(repoRoot, target);
  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    relativePath.startsWith('/')
  ) {
    throw new Error(`Refusing cleanup target outside repo: ${configuredPath}`);
  }
  return target;
};

export const runSweep = (repoRoot: string, config: BootstrapConfig): void => {
  const targets = [...config.cleanup.directories, ...config.cleanup.files].map(
    (target) => resolveCleanupTarget(repoRoot, target)
  );

  let removed = 0;
  for (const target of targets) {
    if (!existsSync(target)) {
      continue;
    }
    info(`Removing ${relative(repoRoot, target)}`);
    rmSync(target, { force: true, recursive: true });
    removed += 1;
  }

  success(`Sweep complete (${String(removed)} targets removed)`);
};
