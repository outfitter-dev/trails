/**
 * `create.scaffold` trail -- Creates base project structure.
 *
 * Generates package.json, tsconfig, app.ts, starter trails, and .trails/ directory.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Starter = 'empty' | 'entity' | 'hello';

interface ScaffoldResult {
  readonly created: string[];
  readonly dir: string;
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Content generators
// ---------------------------------------------------------------------------

const generatePackageJson = (name: string): string => {
  const deps: Record<string, string> = {
    '@ontrails/core': 'workspace:*',
    zod: '^4.0.0',
  };

  const pkg: Record<string, unknown> = {
    dependencies: Object.fromEntries(
      Object.entries(deps).toSorted(([a], [b]) => a.localeCompare(b))
    ),
    name,
    scripts: {
      build: 'tsc -b',
      lint: 'oxlint ./src',
      test: 'bun test',
      typecheck: 'tsc --noEmit',
    },
    type: 'module',
    version: '0.1.0',
  };

  return JSON.stringify(pkg, null, 2);
};

const TSCONFIG_CONTENT = JSON.stringify(
  {
    compilerOptions: {
      declaration: true,
      module: 'ESNext',
      moduleResolution: 'bundler',
      noUncheckedIndexedAccess: true,
      outDir: 'dist',
      rootDir: 'src',
      skipLibCheck: true,
      strict: true,
      target: 'ESNext',
      verbatimModuleSyntax: true,
    },
    include: ['src'],
  },
  null,
  2
);

const GITIGNORE_CONTENT = `node_modules/
dist/
*.tsbuildinfo
.trails/_surface.json
`;

const OXLINTRC_CONTENT = JSON.stringify(
  {
    extends: ['ultracite'],
  },
  null,
  2
);

const OXFMTRC_CONTENT = `{
  // ultracite defaults
}
`;

const generateHelloTrail = (): string =>
  `import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const hello = trail('hello', {
  description: 'Say hello',
  examples: [
    {
      expected: { message: 'Hello, world!' },
      input: {},
      name: 'Default greeting',
    },
    {
      expected: { message: 'Hello, Trails!' },
      input: { name: 'Trails' },
      name: 'Named greeting',
    },
  ],
  implementation: (input) => {
    const name = input.name ?? 'world';
    return Result.ok({ message: \`Hello, \${name}!\` });
  },
  input: z.object({
    name: z.string().optional(),
  }),
  output: z.object({
    message: z.string(),
  }),
  readOnly: true,
});
`;

const generateEntityTrails = (): string =>
  `import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

const entitySchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const show = trail('entity.show', {
  description: 'Show an entity by ID',
  examples: [
    {
      expected: { id: '1', name: 'Example' },
      input: { id: '1' },
      name: 'Show entity',
    },
  ],
  implementation: (input) => {
    return Result.ok({ id: input.id, name: 'Example' });
  },
  input: z.object({ id: z.string() }),
  output: entitySchema,
  readOnly: true,
});

export const add = trail('entity.add', {
  description: 'Add a new entity',
  examples: [
    {
      expected: { id: '1', name: 'New' },
      input: { name: 'New' },
      name: 'Add entity',
    },
  ],
  implementation: (input) => {
    return Result.ok({ id: '1', name: input.name });
  },
  input: z.object({ name: z.string() }),
  output: entitySchema,
});
`;

const generateSearchTrail = (): string =>
  `import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const search = trail('search', {
  description: 'Search entities by query',
  examples: [
    {
      expected: { results: [] },
      input: { query: 'test' },
      name: 'Search entities',
    },
  ],
  implementation: () => {
    return Result.ok({ results: [] });
  },
  input: z.object({ query: z.string() }),
  output: z.object({
    results: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
  readOnly: true,
});
`;

const generateOnboardHike = (): string =>
  `import { Result, hike } from '@ontrails/core';
import { z } from 'zod';

export const onboard = hike('entity.onboard', {
  description: 'Onboard a new entity end-to-end',
  follows: ['entity.add'],
  implementation: async (input, ctx) => {
    const result = await ctx.follow('entity.add', { name: input.name });
    if (result.isErr()) {
      return result;
    }
    return Result.ok({ onboarded: true });
  },
  input: z.object({ name: z.string() }),
  output: z.object({ onboarded: z.boolean() }),
});
`;

const generateEntityEvents = (): string =>
  `import { event } from '@ontrails/core';
import { z } from 'zod';

export const entityUpdated = event('entity.updated', {
  description: 'Fired when an entity is updated',
  payload: z.object({
    entityId: z.string(),
    updatedAt: z.string(),
  }),
});
`;

const generateStore = (): string =>
  `/** In-memory store for entities. */

interface Entity {
  readonly id: string;
  readonly name: string;
}

const store = new Map<string, Entity>();

export const getEntity = (id: string): Entity | undefined => store.get(id);
export const addEntity = (entity: Entity): void => {
  store.set(entity.id, entity);
};
export const deleteEntity = (id: string): boolean => store.delete(id);
export const listEntities = (): Entity[] => Array.from(store.values());
`;

const starterImports: Record<
  Starter,
  { imports: string[]; modules: string[] }
> = {
  empty: { imports: [], modules: [] },
  entity: {
    imports: [
      "import * as entity from './trails/entity.js';",
      "import * as search from './trails/search.js';",
      "import * as onboard from './trails/onboard.js';",
      "import * as entityEvents from './events/entity-events.js';",
    ],
    modules: ['entity', 'search', 'onboard', 'entityEvents'],
  },
  hello: {
    imports: ["import * as hello from './trails/hello.js';"],
    modules: ['hello'],
  },
};

const generateAppTs = (name: string, starter: Starter): string => {
  const { imports, modules } = starterImports[starter];
  const topoArgs =
    modules.length > 0 ? `'${name}', ${modules.join(', ')}` : `'${name}'`;

  return [
    "import { topo } from '@ontrails/core';",
    ...imports,
    '',
    `export const app = topo(${topoArgs});`,
    '',
  ].join('\n');
};

// ---------------------------------------------------------------------------
// File collection and writing
// ---------------------------------------------------------------------------

const starterFileGenerators: Record<Starter, () => [string, string][]> = {
  empty: () => [['src/trails/.gitkeep', '']],
  entity: () => [
    ['src/trails/entity.ts', generateEntityTrails()],
    ['src/trails/search.ts', generateSearchTrail()],
    ['src/trails/onboard.ts', generateOnboardHike()],
    ['src/events/entity-events.ts', generateEntityEvents()],
    ['src/store.ts', generateStore()],
  ],
  hello: () => [['src/trails/hello.ts', generateHelloTrail()]],
};

const collectScaffoldFiles = (
  name: string,
  starter: Starter
): Map<string, string> =>
  new Map([
    ['package.json', generatePackageJson(name)],
    ['tsconfig.json', TSCONFIG_CONTENT],
    ['.gitignore', GITIGNORE_CONTENT],
    ['.oxlintrc.json', OXLINTRC_CONTENT],
    ['.oxfmtrc.jsonc', OXFMTRC_CONTENT],
    ['src/app.ts', generateAppTs(name, starter)],
    ...starterFileGenerators[starter](),
  ]);

const writeScaffoldFiles = async (
  projectDir: string,
  fileMap: Map<string, string>
): Promise<string[]> => {
  const files: string[] = [];
  for (const [relativePath, content] of fileMap) {
    const fullPath = join(projectDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    await Bun.write(fullPath, content);
    files.push(relativePath);
  }
  return files;
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const createScaffold = trail('create.scaffold', {
  description: 'Scaffold a new Trails project',
  implementation: async (input) => {
    const projectDir = resolve(input.dir ?? '.', input.name);
    const starter = (input.starter ?? 'hello') as Starter;
    const fileMap = collectScaffoldFiles(input.name, starter);
    const files = await writeScaffoldFiles(projectDir, fileMap);
    mkdirSync(join(projectDir, '.trails'), { recursive: true });

    return Result.ok({
      created: files,
      dir: projectDir,
      name: input.name,
    } satisfies ScaffoldResult);
  },
  input: z.object({
    dir: z.string().optional().describe('Parent directory'),
    name: z.string().describe('Project name'),
    starter: z
      .enum(['hello', 'entity', 'empty'])
      .default('hello')
      .describe('Starter trail'),
  }),
  markers: { internal: true },
  output: z.object({
    created: z.array(z.string()),
    dir: z.string(),
    name: z.string(),
  }),
});
