/* oxlint-disable eslint-plugin-jest/require-hook -- testExamples registers tests at module scope */
import { afterAll, beforeAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { WORKSPACE_GITIGNORE_CONTENT } from '@ontrails/core';
import { testExamples } from '@ontrails/testing';

import { operatorApp } from '../src/app.js';

const trailsWorkspaceDir = resolve(import.meta.dir, '..', '.trails');
const trailsGitignorePath = join(trailsWorkspaceDir, '.gitignore');
const trailsWorkspaceSubdirs = ['cache', 'state'] as const;
const repoRoot = resolve(import.meta.dir, '..', '..', '..');

const resetTrailsWorkspace = (): void => {
  rmSync(trailsWorkspaceDir, { force: true, recursive: true });
  mkdirSync(trailsWorkspaceDir, { recursive: true });
  for (const subdir of trailsWorkspaceSubdirs) {
    mkdirSync(join(trailsWorkspaceDir, subdir), { recursive: true });
  }
  writeFileSync(trailsGitignorePath, WORKSPACE_GITIGNORE_CONTENT);
};

beforeAll(() => {
  resetTrailsWorkspace();
});

afterAll(() => {
  resetTrailsWorkspace();
});

// Wayfinder CLI dogfood trails depend on saved topo artifacts; the repo-level
// dogfood smoke covers them against exported operator artifacts.
testExamples(operatorApp, { cwd: repoRoot });
