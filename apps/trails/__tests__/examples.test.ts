/* oxlint-disable eslint-plugin-jest/require-hook -- testExamples registers tests at module scope */
import { afterAll, beforeAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { testExamples } from '@ontrails/testing';

import { app } from '../src/app.js';

const trailsWorkspaceDir = resolve(import.meta.dir, '..', '.trails');
const trailsGitignorePath = join(trailsWorkspaceDir, '.gitignore');
const trailsWorkspaceSubdirs = ['config', 'dev', 'generated'] as const;
const trailsGitignore = `# Local config overrides
config/

# Development state
dev/

# Generated artifacts
generated/

# Shared Trails database
trails.db
trails.db-shm
trails.db-wal
`;

const resetTrailsWorkspace = (): void => {
  rmSync(trailsWorkspaceDir, { force: true, recursive: true });
  mkdirSync(trailsWorkspaceDir, { recursive: true });
  for (const subdir of trailsWorkspaceSubdirs) {
    mkdirSync(join(trailsWorkspaceDir, subdir), { recursive: true });
  }
  writeFileSync(trailsGitignorePath, trailsGitignore);
};

beforeAll(() => {
  resetTrailsWorkspace();
});

afterAll(() => {
  resetTrailsWorkspace();
});

testExamples(app);
