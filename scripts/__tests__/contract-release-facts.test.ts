import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  findPublicTrailContractChangeFacts,
  findPublicTrailContractChangeFactsFromSnapshots,
} from '../contract-release-facts.ts';

const snapshot = (
  baseSource: string,
  currentSource: string,
  path = 'packages/core/src/public-trail.ts'
) => ({
  baseSource,
  changedFiles: [path],
  currentSource,
  packageName: '@ontrails/core',
  path,
  workspacePath: 'packages/core',
});

const publicTrail = (body: string): string => `
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const userCreate = trail('user.create', {
  blaze: () => Result.ok({ id: 'u1' }),
  ${body}
});
`;

describe('findPublicTrailContractChangeFactsFromSnapshots', () => {
  test('detects public input schema changes', () => {
    const facts = findPublicTrailContractChangeFactsFromSnapshots([
      snapshot(
        publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
`),
        publicTrail(`
  input: z.object({ email: z.string(), name: z.string() }),
  output: z.object({ id: z.string() }),
`)
      ),
    ]);

    expect(facts).toMatchObject([
      {
        aspect: 'input',
        packageName: '@ontrails/core',
        path: 'packages/core/src/public-trail.ts',
        trailId: 'user.create',
        workspacePath: 'packages/core',
      },
    ]);
    expect(facts[0]?.baseHash).not.toBe(facts[0]?.currentHash);
  });

  test('detects public output schema changes', () => {
    const facts = findPublicTrailContractChangeFactsFromSnapshots([
      snapshot(
        publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
`),
        publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ email: z.string(), id: z.string() }),
`)
      ),
    ]);

    expect(facts.map((fact) => fact.aspect)).toEqual(['output']);
  });

  test('detects public surface exposure changes', () => {
    const facts = findPublicTrailContractChangeFactsFromSnapshots([
      snapshot(
        publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
  surfaces: ['cli'],
`),
        publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
  surfaces: ['cli', 'mcp'],
`)
      ),
    ]);

    expect(facts.map((fact) => fact.aspect)).toEqual(['surfaces']);
  });

  test('detects public trail addition and removal', () => {
    const baseSource = publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
`);
    const currentSource = `
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const teamCreate = trail('team.create', {
  blaze: () => Result.ok({ id: 't1' }),
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
});
`;

    const facts = findPublicTrailContractChangeFactsFromSnapshots([
      snapshot(baseSource, currentSource),
    ]);

    expect(facts.map((fact) => `${fact.trailId}:${fact.aspect}`)).toEqual([
      'team.create:trail',
      'user.create:trail',
    ]);
  });

  test('detects visibility transitions involving public contracts', () => {
    const facts = findPublicTrailContractChangeFactsFromSnapshots([
      snapshot(
        publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
  visibility: 'internal',
`),
        publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
`)
      ),
    ]);

    expect(facts.map((fact) => fact.aspect)).toEqual(['visibility']);
  });

  test('ignores internal-only trail contract changes', () => {
    const facts = findPublicTrailContractChangeFactsFromSnapshots([
      snapshot(
        publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
  visibility: 'internal',
`),
        publicTrail(`
  input: z.object({ email: z.string(), name: z.string() }),
  output: z.object({ email: z.string(), id: z.string() }),
  visibility: 'internal',
`)
      ),
    ]);

    expect(facts).toEqual([]);
  });

  test('resolves same-file schema constants used by public trail contracts', () => {
    const baseSource = `
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

const inputSchema = z.object({ name: z.string() });
const outputSchema = z.object({ id: z.string() });

export const userCreate = trail('user.create', {
  blaze: () => Result.ok({ id: 'u1' }),
  input: inputSchema,
  output: outputSchema,
});
`;
    const currentSource = `
import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

const inputSchema = z.object({ email: z.string(), name: z.string() });
const outputSchema = z.object({ id: z.string() });

export const userCreate = trail('user.create', {
  blaze: () => Result.ok({ id: 'u1' }),
  input: inputSchema,
  output: outputSchema,
});
`;

    const facts = findPublicTrailContractChangeFactsFromSnapshots([
      snapshot(baseSource, currentSource),
    ]);

    expect(facts.map((fact) => fact.aspect)).toEqual(['input']);
  });

  test('ignores non-contract package source changes', () => {
    const facts = findPublicTrailContractChangeFactsFromSnapshots([
      snapshot(
        'export const version = "old";',
        'export const version = "new";',
        'packages/core/src/version.ts'
      ),
    ]);

    expect(facts).toEqual([]);
  });
});

describe('findPublicTrailContractChangeFacts', () => {
  test('derives public contract facts from changed publishable workspace files', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'trails-contract-facts-'));

    try {
      const workspaceRoot = join(repoRoot, 'packages/core');
      const sourcePath = join(workspaceRoot, 'src/public-trail.ts');
      mkdirSync(join(workspaceRoot, 'src'), { recursive: true });
      writeFileSync(
        sourcePath,
        publicTrail(`
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
`)
      );

      const facts = findPublicTrailContractChangeFacts({
        changedFiles: ['packages/core/src/public-trail.ts'],
        repoRoot,
        workspaces: [
          {
            isPrivate: false,
            name: '@ontrails/core',
            relativePath: 'packages/core',
          },
        ],
      });

      expect(facts).toMatchObject([
        {
          aspect: 'trail',
          packageName: '@ontrails/core',
          path: 'packages/core/src/public-trail.ts',
          trailId: 'user.create',
          workspacePath: 'packages/core',
        },
      ]);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });
});
