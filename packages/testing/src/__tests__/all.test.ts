import { afterAll, describe, expect, mock, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { entity, Result, trail, topo } from '@ontrails/core';
import { connectDrizzle } from '@ontrails/drizzle';
import { z } from 'zod';

import { testAll } from '../all.js';
import { store as defineStore } from '@ontrails/store';

const requireEntityExample = (
  entityDef: { examples?: readonly Record<string, unknown>[] },
  index: number
) => {
  const example = entityDef.examples?.[index];
  expect(example).toBeDefined();
  if (!example) {
    throw new Error(`Expected entity example at index ${index}`);
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
  description:
    'Trail that uses a mocked adapter-bound resource through testAll',
  examples: [
    {
      expected: { name: 'Alpha', source: 'mock' },
      input: {},
      name: 'Uses auto-resolved resource mock',
    },
  ],
  implementation: async (_input, ctx) => {
    const record = await mockDbResource.from(ctx).entities.get('seed-1');
    if (record === null) {
      return Result.err(new Error('expected seeded entity to exist'));
    }

    return Result.ok({ name: record.name, source: record.source });
  },
  input: z.object({}),
  output: z.object({ name: z.string(), source: z.string() }),
  resources: [mockDbResource],
});

const overrideTrail = trail('resource.override.all', {
  description: 'Trail that prefers explicit overrides over mock factories',
  examples: [
    {
      expected: { name: 'Override', source: 'override' },
      input: {},
      name: 'Explicit resource override wins',
    },
  ],
  implementation: async (_input, ctx) => {
    const record = await mockDbResource.from(ctx).entities.get('seed-1');
    if (record === null) {
      return Result.err(new Error('expected overridden entity to exist'));
    }

    return Result.ok({ name: record.name, source: record.source });
  },
  input: z.object({}),
  output: z.object({ name: z.string(), source: z.string() }),
  resources: [mockDbResource],
});

const entityFixture = entity(
  'allFixture',
  {
    id: z.string().uuid(),
    name: z.string(),
  },
  {
    examples: [
      {
        id: 'f46b837e-6c8d-42ec-8539-536f4e6daf0e',
        name: 'Entity-derived governance fixture',
      },
    ],
    identity: 'id',
  }
);

const entityDerivedImplementation = mock(() =>
  Result.ok(requireEntityExample(entityFixture, 0))
);

const entityDerivedTrail = trail('entity.derived.all', {
  description: 'Trail that relies on entity-derived fixtures inside testAll',
  entities: [entityFixture],
  implementation: () => entityDerivedImplementation(),
  input: z.object({ id: entityFixture.shape.id }),
  output: entityFixture,
});

const versionAllCurrentImplementation = mock((input: { name: string }) =>
  Result.ok({ message: `current:${input.name}` })
);
const versionAllForkImplementation = mock((input: { code: string }) =>
  Result.ok({ message: `fork:${input.code}` })
);
const versionedAllTrail = trail('versioned.all', {
  examples: [
    {
      expected: { message: 'current:Ada' },
      input: { name: 'Ada' },
      name: 'Current version example',
    },
  ],
  implementation: (input: { name: string }) =>
    versionAllCurrentImplementation(input),
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  version: 5,
  versions: {
    1: {
      examples: [
        {
          expected: { message: 'legacy:Ada' },
          input: { legacyName: 'Ada' },
          name: 'Revision version example',
        },
      ],
      input: z.object({ legacyName: z.string() }),
      output: z.object({ message: z.string() }),
      transpose: {
        input: ({ input }) => ({ name: input.legacyName }),
        output: ({ output }) => ({
          message: output.message.replace('current:', 'legacy:'),
        }),
      },
    },
    2: {
      examples: [
        {
          expected: { message: 'fork:beta' },
          input: { code: 'beta' },
          name: 'Deprecated fork version example',
        },
      ],
      implementation: (input: { code: string }) =>
        versionAllForkImplementation(input),
      input: z.object({ code: z.string() }),
      output: z.object({ message: z.string() }),
      status: { note: 'Use the current version.', state: 'deprecated' },
    },
    4: {
      examples: [
        {
          expected: { message: 'archived' },
          input: { archived: 42 },
          name: 'Archived version example',
        },
      ],
      input: z.object({ archived: z.boolean() }),
      output: z.object({ message: z.string() }),
      status: { state: 'archived' },
      transpose: {
        input: () => ({ name: 'archived' }),
        output: () => ({ message: 'archived' }),
      },
    },
  },
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
  const helperImport =
    helperName === 'testAllEstablished'
      ? '../../src/all-established.ts'
      : '../../src/index.ts';

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    testFile,
    `import { Result, trail, topo } from '@ontrails/core';
import { ${helperName} } from '${helperImport}';
import { z } from 'zod';

const draftTrail = trail('_draft.entity.prepare', {
  implementation: async () => Result.ok({ ok: true }),
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

const runGeneratedEstablishedSuite = (): {
  readonly exitCode: number;
  readonly output: string;
} => {
  const dir = repoTempDir();
  const reportFile = join(dir, 'testAllEstablished-surfaces.junit.xml');
  const testFile = join(dir, 'testAllEstablished-surfaces.test.ts');

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    testFile,
    `import { Result, trail, topo } from '@ontrails/core';
import { testAllEstablished } from '../../src/all-established.ts';
import { z } from 'zod';

const show = trail('entity.show', {
  implementation: async (input) => Result.ok({ name: input.name }),
  examples: [
    {
      expected: { name: 'Alpha' },
      input: { name: 'Alpha' },
      name: 'Show Alpha',
    },
  ],
  input: z.object({ name: z.string() }),
  intent: 'read',
  output: z.object({ name: z.string() }),
});

testAllEstablished(topo('established-topo', { show }));
`
  );

  try {
    const proc = Bun.spawnSync({
      cmd: [
        'bun',
        'test',
        testFile,
        '--reporter=junit',
        `--reporter-outfile=${reportFile}`,
      ],
      cwd: resolve(import.meta.dir, '..', '..', '..'),
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const report = existsSync(reportFile)
      ? readFileSync(reportFile, 'utf8')
      : '';

    return {
      exitCode: proc.exitCode,
      output: `${proc.stdout.toString()}\n${proc.stderr.toString()}\n${report}`,
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

describe('testAll entity-derived fixtures', () => {
  // eslint-disable-next-line jest/require-hook
  testAll(
    topo('test-all-entity-derived-app', {
      entityDerivedTrail,
      entityFixture,
    } as Record<string, unknown>)
  );

  afterAll(() => {
    expect(entityDerivedImplementation).toHaveBeenCalledTimes(2);
  });
});

describe('testAll version entries', () => {
  // eslint-disable-next-line jest/require-hook
  testAll(topo('test-all-versioned-app', { versionedAllTrail }));

  afterAll(() => {
    expect(versionAllCurrentImplementation).toHaveBeenCalledTimes(4);
    expect(versionAllForkImplementation).toHaveBeenCalledTimes(2);
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

  test('includes CLI, MCP, and HTTP surface projection checks', () => {
    const result = runGeneratedEstablishedSuite();

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      'CLI projection validates established topo'
    );
    expect(result.output).toContain(
      'MCP projection validates established topo'
    );
    expect(result.output).toContain(
      'HTTP projection validates established topo'
    );
  });
});
