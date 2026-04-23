import { afterAll, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { contour, Result, trail, topo } from '@ontrails/core';
import { connectDrizzle } from '@ontrails/drizzle';
import { z } from 'zod';

import { testAll } from '../all.js';
import { store as defineStore } from '@ontrails/store';

const requireContourExample = (
  contourDef: { examples?: readonly Record<string, unknown>[] },
  index: number
) => {
  const example = contourDef.examples?.[index];
  expect(example).toBeDefined();
  if (!example) {
    throw new Error(`Expected contour example at index ${index}`);
  }
  return example;
};

const dbDefinition = defineStore({
  entities: {
    fixtures: [
      {
        id: 'seed-1',
        name: 'Alpha',
        source: 'mock',
      },
    ],
    generated: ['id'],
    primaryKey: 'id',
    schema: z.object({
      id: z.string(),
      name: z.string(),
      source: z.string(),
    }),
  },
});

const createDbResource = (
  seed?: readonly {
    readonly id: string;
    readonly name: string;
    readonly source: string;
  }[]
) =>
  connectDrizzle(dbDefinition, {
    id: 'db.mock.all',
    ...(seed === undefined ? {} : { mockSeed: { entities: seed } }),
    url: ':memory:',
  });

const createOverrideStore = () => {
  const { mock: mockFactory } = createDbResource([
    {
      id: 'seed-1',
      name: 'Override',
      source: 'override',
    },
  ]);

  if (mockFactory === undefined) {
    throw new Error('Expected drizzle test store to expose a mock factory');
  }

  const created = mockFactory();
  if (created instanceof Promise) {
    throw new TypeError(
      'Expected drizzle test store mock to resolve synchronously'
    );
  }

  return created;
};

const mockDbResource = createDbResource();

const mockedTrail = trail('resource.mocked.all', {
  blaze: async (_input, ctx) => {
    const entity = await mockDbResource.from(ctx).entities.get('seed-1');
    if (entity === null) {
      return Result.err(new Error('expected seeded entity to exist'));
    }

    return Result.ok({ name: entity.name, source: entity.source });
  },
  description:
    'Trail that uses a mocked connector-bound resource through testAll',
  examples: [
    {
      expected: { name: 'Alpha', source: 'mock' },
      input: {},
      name: 'Uses auto-resolved resource mock',
    },
  ],
  input: z.object({}),
  output: z.object({ name: z.string(), source: z.string() }),
  resources: [mockDbResource],
});

const overrideTrail = trail('resource.override.all', {
  blaze: async (_input, ctx) => {
    const entity = await mockDbResource.from(ctx).entities.get('seed-1');
    if (entity === null) {
      return Result.err(new Error('expected overridden entity to exist'));
    }

    return Result.ok({ name: entity.name, source: entity.source });
  },
  description: 'Trail that prefers explicit overrides over mock factories',
  examples: [
    {
      expected: { name: 'Override', source: 'override' },
      input: {},
      name: 'Explicit resource override wins',
    },
  ],
  input: z.object({}),
  output: z.object({ name: z.string(), source: z.string() }),
  resources: [mockDbResource],
});

const contourFixture = contour(
  'allFixture',
  {
    id: z.string().uuid(),
    name: z.string(),
  },
  {
    examples: [
      {
        id: 'f46b837e-6c8d-42ec-8539-536f4e6daf0e',
        name: 'Contour-derived governance fixture',
      },
    ],
    identity: 'id',
  }
);

const contourDerivedBlaze = mock(() =>
  Result.ok(requireContourExample(contourFixture, 0))
);

const contourDerivedTrail = trail('contour.derived.all', {
  blaze: () => contourDerivedBlaze(),
  contours: [contourFixture],
  description: 'Trail that relies on contour-derived fixtures inside testAll',
  input: z.object({ id: contourFixture.shape.id }),
  output: contourFixture,
});

const repoTempDir = (): string =>
  join(
    resolve(import.meta.dir, '../..'),
    '.tmp-tests',
    `test-all-established-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

const runGeneratedGovernanceSuite = (
  helperName: 'testAll' | 'testAllEstablished'
): { readonly exitCode: number; readonly output: string } => {
  const dir = repoTempDir();
  const testFile = join(dir, `${helperName}.test.ts`);

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    testFile,
    `import { Result, trail, topo } from '@ontrails/core';
import { ${helperName} } from '../../src/index.ts';
import { z } from 'zod';

const draftTrail = trail('_draft.entity.prepare', {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

${helperName}(topo('draft-topo', { draftTrail }));
`
  );

  try {
    const proc = Bun.spawnSync({
      cmd: ['bun', 'test', testFile, '--bail'],
      cwd: resolve(import.meta.dir, '..', '..', '..'),
      stderr: 'pipe',
      stdout: 'pipe',
    });

    return {
      exitCode: proc.exitCode,
      output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

describe('testAll resource mocks', () => {
  // eslint-disable-next-line jest/require-hook
  testAll(
    topo('test-all-resource-mock-app', {
      mockDbResource,
      mockedTrail,
    } as Record<string, unknown>)
  );
});

describe('testAll explicit resource overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testAll(
    topo('test-all-resource-override-app', {
      mockDbResource,
      overrideTrail,
    } as Record<string, unknown>),
    () => ({
      resources: {
        'db.mock.all': createOverrideStore(),
      },
    })
  );
});

describe('testAll contour-derived fixtures', () => {
  // eslint-disable-next-line jest/require-hook
  testAll(
    topo('test-all-contour-derived-app', {
      contourDerivedTrail,
      contourFixture,
    } as Record<string, unknown>)
  );

  afterAll(() => {
    expect(contourDerivedBlaze).toHaveBeenCalledTimes(2);
  });
});

describe('testAllEstablished draft hygiene', () => {
  test('keeps testAll draft-friendly for in-progress graphs', () => {
    const result = runGeneratedGovernanceSuite('testAll');

    expect(result.exitCode).toBe(0);
  });

  test('fails draft-contaminated graphs under testAllEstablished', () => {
    const result = runGeneratedGovernanceSuite('testAllEstablished');

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('_draft.entity.prepare');
  });
});
