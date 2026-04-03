/* oxlint-disable eslint-plugin-jest/require-hook -- testExamples registers tests at module scope */
import { afterAll, beforeAll } from 'bun:test';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { testExamples } from '@ontrails/testing';

import { app } from '../src/app.js';

const trailsWorkspaceDir = resolve(import.meta.dir, '..', '.trails');

beforeAll(() => {
  rmSync(trailsWorkspaceDir, { force: true, recursive: true });
});

afterAll(() => {
  rmSync(trailsWorkspaceDir, { force: true, recursive: true });
});

testExamples(app);
