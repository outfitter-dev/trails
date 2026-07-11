/* oxlint-disable eslint-plugin-jest/require-hook -- testExamples registers tests at module scope */
import { afterAll, beforeAll, setDefaultTimeout } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { topo } from '@ontrails/core';
import { testExamples } from '@ontrails/testing';

import { operatorApp } from '../src/app.js';

const trailsWorkspaceDir = resolve(import.meta.dir, '..', '.trails');
const repoRoot = resolve(import.meta.dir, '..', '..', '..');

// These examples exercise the real fresh-app loader. Under the full parallel
// repo suite, package compilation can legitimately push a load past Bun's 5s
// unit-test default even though the same example completes quickly in isolation.
setDefaultTimeout(15_000);

const resetTrailsWorkspace = (): void => {
  rmSync(trailsWorkspaceDir, { force: true, recursive: true });
  mkdirSync(trailsWorkspaceDir, { recursive: true });
};

beforeAll(() => {
  resetTrailsWorkspace();
});

afterAll(() => {
  resetTrailsWorkspace();
});

const operatorExamplesApp = topo(
  'trails-examples',
  Object.fromEntries(
    operatorApp
      .list()
      .filter((trail) => !trail.id.startsWith('wayfind.'))
      .map((trail) => [trail.id, trail])
  )
);

// Wayfinder CLI dogfood trails depend on saved topo artifacts; the repo-level
// dogfood smoke covers them against exported operator artifacts.
testExamples(operatorExamplesApp, { cwd: repoRoot });
