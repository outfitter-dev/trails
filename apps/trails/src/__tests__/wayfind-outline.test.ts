import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  Result,
  createTrailContext,
  surfaceOverlay,
  topo,
  trail,
} from '@ontrails/core';
import {
  deriveTopoGraph,
  deriveTopoGraphHash,
  writeTrailsLock,
} from '@ontrails/topographer';
import type {
  TopoGraph,
  TopoGraphEntry,
  TrailsLock,
} from '@ontrails/topographer';
import { z } from 'zod';

import { wayfindOutlineTrail } from '../trails/wayfind-outline.js';

let tempDir: string;

const userCreate = trail('user.create', {
  implementation: () => Result.ok({ id: 'u1' }),
  input: z.object({ name: z.string() }),
  intent: 'write',
  output: z.object({ id: z.string() }),
});

const app = () => topo('demo', { userCreate });

const withSurfaces = (topoGraph: TopoGraph): TopoGraph => ({
  ...topoGraph,
  entries: topoGraph.entries.map((entry): TopoGraphEntry => {
    if (entry.id === 'user.create') {
      return { ...entry, surfaces: ['cli'] };
    }
    return entry;
  }),
  generatedAt: '2026-06-04T00:00:00.000Z',
});

const countEntries = (
  topoGraph: TopoGraph,
  kind: TopoGraphEntry['kind']
): number => topoGraph.entries.filter((entry) => entry.kind === kind).length;

const writeArtifacts = async (rootDir: string): Promise<TopoGraph> => {
  const topoGraph = withSurfaces(
    deriveTopoGraph(app(), {
      overlays: [surfaceOverlay({ cli: { 'u.create': 'user.create' } })],
    })
  );
  await writeTrailsLock(
    {
      scope: { app: 'demo' },
      summary: {
        entities: countEntries(topoGraph, 'entity'),
        resources: countEntries(topoGraph, 'resource'),
        signals: countEntries(topoGraph, 'signal'),
        trails: countEntries(topoGraph, 'trail'),
      },
      topoGraph,
      topoGraphHash: deriveTopoGraphHash(topoGraph),
      version: 5,
    } as TrailsLock,
    { dir: rootDir }
  );
  return topoGraph;
};

const writeFile = async (
  rootDir: string,
  path: string,
  value: string
): Promise<void> => {
  const filePath = join(rootDir, path);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, value);
};

const expectOk = async <TValue>(
  result: Promise<Result<TValue, unknown>>
): Promise<TValue> => {
  const awaited = await result;
  expect(awaited.isOk()).toBe(true);
  if (awaited.isErr()) {
    throw awaited.error;
  }
  return awaited.value;
};

const ctx = (rootDir = tempDir) =>
  createTrailContext({ cwd: rootDir, workspaceRoot: rootDir });

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'trails-outline-test-'));
  await writeArtifacts(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

describe('wayfind.outline operator trail', () => {
  test('outlines a source file and reconciles trail ids to saved graph facts', async () => {
    await writeFile(
      tempDir,
      'src/app.ts',
      [
        "import { Result, topo, trail } from '@ontrails/core';",
        "export const userCreateTrail = trail('user.create', {",
        '  implementation: () => Result.ok({ id: "u1" }),',
        '  input: z.object({ name: z.string() }),',
        '  output: z.object({ id: z.string() }),',
        '});',
        'export const app = topo("demo", { userCreateTrail });',
        '',
      ].join('\n')
    );

    const result = await expectOk(
      wayfindOutlineTrail.implementation({ file: 'src/app.ts' }, ctx())
    );

    expect(result.features).toMatchObject({
      included: ['trails', 'apps', 'surfaces', 'graph', 'diagnostics'],
      view: 'default',
    });
    expect(result.file).toBe('src/app.ts');
    expect(result.trails).toEqual([
      expect.objectContaining({
        graph: expect.objectContaining({
          exampleCount: 0,
          intent: 'write',
          surfaces: ['cli'],
        }),
        id: 'user.create',
      }),
    ]);
    expect(result.apps).toEqual([
      expect.objectContaining({ callee: 'topo', name: 'app' }),
    ]);
    expect(result.graph?.matchedTrailIds).toEqual(['user.create']);
    expect(result.surfaces).toEqual(['cli']);
    expect(result.counts).toMatchObject({
      apps: 1,
      declarations: 2,
      diagnostics: result.diagnostics?.length ?? 0,
      graphMatches: 1,
      trails: 1,
    });
    expect(result).not.toHaveProperty('summary');
  });

  test('outlines graph surfaces without requiring graph feature output', async () => {
    await writeFile(
      tempDir,
      'src/app.ts',
      [
        "import { Result, topo, trail } from '@ontrails/core';",
        "export const userCreateTrail = trail('user.create', {",
        '  implementation: () => Result.ok({ id: "u1" }),',
        '});',
        'export const app = topo("demo", { userCreateTrail });',
        '',
      ].join('\n')
    );

    const result = await expectOk(
      wayfindOutlineTrail.implementation(
        { features: 'surfaces', file: 'src/app.ts' },
        ctx()
      )
    );

    expect(result.features.included).toEqual(['surfaces']);
    expect(result.surfaces).toEqual(['cli']);
    expect(result.trails).toBeUndefined();
    expect(result.graph).toBeUndefined();
  });

  test('outlines source-only facts when graph artifacts are unavailable', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'trails-outline-source-'));
    try {
      await writeFile(
        sourceRoot,
        'src/source.ts',
        [
          "import { Result, trail } from '@ontrails/core';",
          "import { sourceName as localName } from './dependency';",
          "export function helper() { return 'ok'; }",
          "export const localTrail = trail('local.read', {",
          '  implementation: () => Result.ok({ ok: true }),',
          '  input: z.object({}),',
          '});',
          '',
        ].join('\n')
      );

      const result = await expectOk(
        wayfindOutlineTrail.implementation(
          { file: 'src/source.ts', rootDir: sourceRoot, source: true },
          ctx(sourceRoot)
        )
      );

      expect(result.features.view).toBe('source');
      expect(result.source?.declarations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'function', name: 'helper' }),
          expect.objectContaining({ kind: 'const', name: 'localTrail' }),
        ])
      );
      expect(result.source?.imports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            names: ['localName'],
            source: './dependency',
          }),
        ])
      );
      expect(result.trails).toBeUndefined();
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'graph.missing',
          message: expect.stringContaining('--module <app-module>'),
          severity: 'warn',
        }),
      ]);
      expect(result.diagnostics?.[0]?.message).toContain(
        '--root-dir <workspace-root>'
      );
      expect(result.diagnostics?.[0]?.message).toContain('--permit');
      expect(result.diagnostics?.[0]?.message).toContain(
        '"scopes":["topo:write"]'
      );
      expect(result.diagnostics?.[0]?.message).toContain('topo:write');
    } finally {
      await rm(sourceRoot, { force: true, recursive: true });
    }
  });
});
