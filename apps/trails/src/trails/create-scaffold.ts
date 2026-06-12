/**
 * `create.scaffold` trail -- Creates base project structure.
 *
 * Generates package.json, tsconfig, app.ts, starter trails, and .trails/ directory.
 */

import { resolve } from 'node:path';

import { Result, trail, WORKSPACE_GITIGNORE_CONTENT } from '@ontrails/core';
import { z } from 'zod';

import {
  applyProjectOperations,
  planProjectOperations,
  PROJECT_NAME_MESSAGE,
  PROJECT_NAME_PATTERN,
  resolveProjectDir,
} from '../project-writes.js';
import type {
  PlannedProjectOperation,
  ProjectWriteOperation,
} from '../project-writes.js';
import {
  ontrailsPackageRange,
  scaffoldDependencyVersions,
  trailsPackageVersion,
} from '../versions.js';
import {
  stringifyScaffoldJson,
  stringifyScaffoldPackageJson,
} from './scaffold-json.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Starter = 'empty' | 'entity' | 'hello';

interface ScaffoldResult {
  readonly created: string[];
  readonly dir: string;
  readonly dryRun: boolean;
  readonly name: string;
  readonly plannedOperations: PlannedProjectOperation[];
}

const frameworkCommandScripts = {
  add: 'trails add',
  compile: 'trails compile',
  completions: 'trails completions',
  deprecate: 'trails deprecate',
  diff: 'trails diff',
  doctor: 'trails doctor',
  guide: 'trails guide',
  revise: 'trails revise',
  run: 'trails run',
  survey: 'trails survey',
  topo: 'trails topo',
  validate: 'trails validate',
  warden: 'trails warden',
} as const satisfies Record<string, string>;

// ---------------------------------------------------------------------------
// Content generators
// ---------------------------------------------------------------------------

const generatePackageJson = (name: string): string => {
  const deps: Record<string, string> = {
    '@ontrails/core': ontrailsPackageRange,
    zod: scaffoldDependencyVersions.zod,
  };

  const pkg: Record<string, unknown> = {
    dependencies: Object.fromEntries(
      Object.entries(deps).toSorted(([a], [b]) => a.localeCompare(b))
    ),
    devDependencies: Object.fromEntries(
      Object.entries({
        '@ontrails/trails': ontrailsPackageRange,
        '@types/bun': scaffoldDependencyVersions.bunTypes,
        oxfmt: scaffoldDependencyVersions.oxfmt,
        oxlint: scaffoldDependencyVersions.oxlint,
        typescript: scaffoldDependencyVersions.typescript,
        ultracite: scaffoldDependencyVersions.ultracite,
      }).toSorted(([a], [b]) => a.localeCompare(b))
    ),
    name,
    scripts: Object.fromEntries(
      Object.entries({
        build: 'tsc -b',
        'format:check': 'bunx ultracite check .',
        'format:fix': 'bunx ultracite fix .',
        lint: 'oxlint ./src',
        test: 'bun test',
        typecheck: 'tsc --noEmit',
        ...frameworkCommandScripts,
      }).toSorted(([a], [b]) => a.localeCompare(b))
    ),
    type: 'module',
    version: '0.1.0',
  };

  return stringifyScaffoldPackageJson(pkg);
};

const generateScaffoldProvenance = (starter: Starter): string =>
  stringifyScaffoldJson({
    generatedAt: new Date().toISOString(),
    scaffoldVersion: trailsPackageVersion,
    schemaVersion: 1,
    template: starter,
  });

const TSCONFIG_CONTENT = `{
  "compilerOptions": {
    "declaration": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "strict": true,
    "target": "ESNext",
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
`;

const TSCONFIG_TESTS_CONTENT = `{
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["bun"]
  },
  "exclude": [],
  "extends": "./tsconfig.json",
  "include": ["src", "__tests__"]
}
`;

const AGENTS_CONTENT = `# AGENTS.md

This is a Trails project. Trails is an agent-native, contract-first TypeScript framework: author a trail once with typed input, Result output, examples, intent, and meta; surface it through CLI, MCP, HTTP, or future WebSocket without rewriting the contract.

## Commands

Use the project scripts first:

\`\`\`bash
bun install
bun run build
bun test
bun run typecheck
bun run lint
bun run format:check
bun run warden
bun run survey
bun run guide
\`\`\`

## Lexicon

- \`trail\`, not action or handler
- \`blaze\`, not handler or impl
- \`topo\`, not registry or collection
- \`compose\`, not follow
- \`surface\`, not transport
- \`resource\`, not service or dependency
- \`layer\`, for cross-cutting trail wrapping

## Trail Rules

- Blazes return \`Result\`; never throw from trail logic.
- Use \`Result.ok()\` and \`Result.err()\`; branch with \`isOk()\`, \`isErr()\`, or \`match()\`.
- Keep trail logic surface-agnostic. Do not import CLI, MCP, HTTP, request, or response types into blazes.
- Public MCP or HTTP trails declare an \`output\` schema.
- Trails that compose other trails declare \`composes: [...]\` and invoke them with \`ctx.compose(...)\`.
- Trails that use infrastructure declare \`resources: [...]\` and access them through the resource helpers.
- Use \`detours\` for recovery strategies instead of inline retry logic.
- Prefer examples for happy-path coverage, and add focused tests for edge cases.
`;

const CLAUDE_CONTENT = `# CLAUDE.md

## Compatibility Shim

Keep shared project guidance in \`./AGENTS.md\`. Only Claude-specific bootstrap notes belong here.

## Agent Instructions

@AGENTS.md
`;

const GITIGNORE_CONTENT = `node_modules/
dist/
*.tsbuildinfo
.trails/cache/
.trails/state/
.trails/config.local.js
.trails/config.local.ts
`;

const OXLINT_CONFIG_CONTENT = `import { defineConfig } from 'oxlint';
import ultracite from 'ultracite/oxlint/core';

export default defineConfig({
  extends: [ultracite],
  rules: {
    'no-warning-comments': [
      'error',
      {
        location: 'start',
        terms: ['todo:', 'fixme', 'xxx'],
      },
    ],
  },
});
`;

const OXFMTRC_CONTENT = `{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "bracketSpacing": true,
  "arrowParens": "always",
  "proseWrap": "never",
  "printWidth": 80,
}
`;

const generateHelloTrail = (): string =>
  `import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const hello = trail('hello', {
  blaze: (input) => {
    const name = input.name ?? 'world';
    return Result.ok({ message: \`Hello, \${name}!\` });
  },
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
  input: z.object({
    name: z.string().optional(),
  }),
  intent: 'read',
  output: z.object({
    message: z.string(),
  }),
});
`;

const generateEntityTrails = (): string =>
  `import { randomUUID } from 'node:crypto';

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { entityStore } from '../store.js';

const entitySchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const show = trail('entity.show', {
  blaze: (input, ctx) => {
    const store = entityStore.from(ctx);
    const entity = store.get(input.id);
    if (!entity) {
      return Result.err(new NotFoundError(\`Entity "\${input.id}" not found\`));
    }
    return Result.ok(entity);
  },
  description: 'Show an entity by ID',
  examples: [
    {
      expected: { id: '1', name: 'Example' },
      input: { id: '1' },
      name: 'Show entity',
    },
  ],
  input: z.object({ id: z.string() }),
  intent: 'read',
  output: entitySchema,
  resources: [entityStore],
});

export const add = trail('entity.add', {
  blaze: (input, ctx) => {
    const store = entityStore.from(ctx);
    const entity = { id: randomUUID(), name: input.name };
    store.add(entity);
    return Result.ok(entity);
  },
  description: 'Add a new entity',
  examples: [
    {
      expectedMatch: { name: 'New' },
      input: { name: 'New' },
      name: 'Add entity',
    },
  ],
  input: z.object({ name: z.string() }),
  intent: 'write',
  output: entitySchema,
  permit: { scopes: ['entity:write'] },
  resources: [entityStore],
});

export const list = trail('entity.list', {
  blaze: (_input, ctx) => {
    const store = entityStore.from(ctx);
    return Result.ok({ entities: store.list() });
  },
  description: 'List entities',
  examples: [
    {
      expected: { entities: [{ id: '1', name: 'Example' }] },
      input: {},
      name: 'List entities',
    },
  ],
  input: z.object({}),
  intent: 'read',
  output: z.object({
    entities: z.array(entitySchema),
  }),
  resources: [entityStore],
});

export const remove = trail('entity.delete', {
  blaze: (input, ctx) => {
    const store = entityStore.from(ctx);
    const deleted = store.delete(input.id);
    return Result.ok({ deleted, id: input.id });
  },
  description: 'Delete an entity by ID',
  examples: [
    {
      expected: { deleted: true, id: '1' },
      input: { id: '1' },
      name: 'Delete entity',
    },
  ],
  input: z.object({ id: z.string() }),
  intent: 'destroy',
  output: z.object({
    deleted: z.boolean(),
    id: z.string(),
  }),
  permit: { scopes: ['entity:write'] },
  resources: [entityStore],
});
`;

const generateSearchTrail = (): string =>
  `import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const search = trail('search', {
  blaze: () => {
    return Result.ok({ results: [] });
  },
  description: 'Search entities by query',
  examples: [
    {
      expected: { results: [] },
      input: { query: 'test' },
      name: 'Search entities',
    },
  ],
  input: z.object({ query: z.string() }),
  intent: 'read',
  output: z.object({
    results: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});
`;

const generateOnboardTrail = (): string =>
  `import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const onboard = trail('entity.onboard', {
  blaze: async (input, ctx) => {
    const result = await ctx.compose('entity.add', { name: input.name });
    if (result.isErr()) {
      return result;
    }
    return Result.ok({ onboarded: true });
  },
  composes: ['entity.add'],
  description: 'Onboard a new entity end-to-end',
  input: z.object({ name: z.string() }),
  intent: 'write',
  output: z.object({ onboarded: z.boolean() }),
  permit: { scopes: ['entity:write'] },
});
`;

const generateEntitySignals = (): string =>
  `import { signal } from '@ontrails/core';
import { z } from 'zod';

export const entityUpdated = signal('entity.updated', {
  description: 'Fired when an entity is updated',
  payload: z.object({
    entityId: z.string(),
    updatedAt: z.string(),
  }),
});
`;

const generateStore = (): string =>
  `import { Result, resource } from '@ontrails/core';

/** In-memory store for entities. */

export interface Entity {
  readonly id: string;
  readonly name: string;
}

export interface EntityStore {
  add(entity: Entity): void;
  delete(id: string): boolean;
  get(id: string): Entity | undefined;
  list(): Entity[];
}

const defaultEntities: readonly Entity[] = [{ id: '1', name: 'Example' }];

export const createEntityStore = (
  seed: readonly Entity[] = defaultEntities
): EntityStore => {
  const store = new Map(seed.map((entity) => [entity.id, entity] as const));
  return {
    add(entity) {
      store.set(entity.id, entity);
    },
    delete(id) {
      return store.delete(id);
    },
    get(id) {
      return store.get(id);
    },
    list() {
      return [...store.values()];
    },
  };
};

export const entityStore = resource('entity.store', {
  create: () => Result.ok(createEntityStore()),
  description: 'In-memory entity store for the entity starter.',
  mock: createEntityStore,
});
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
      "import * as entitySignals from './signals/entity-signals.js';",
      "import * as store from './store.js';",
    ],
    modules: ['entity', 'search', 'onboard', 'entitySignals', 'store'],
  },
  hello: {
    imports: ["import * as hello from './trails/hello.js';"],
    modules: ['hello'],
  },
};

const renderTopoExpression = (
  appNameLiteral: string,
  modules: readonly string[]
): string => {
  if (modules.length === 0) {
    return `topo(${appNameLiteral})`;
  }

  if (modules.length === 1) {
    return `topo(${appNameLiteral}, ${modules[0]})`;
  }

  return `topo(\n  ${[appNameLiteral, ...modules].join(',\n  ')}\n)`;
};

const generateAppTs = (name: string, starter: Starter): string => {
  const { imports, modules } = starterImports[starter];
  const appNameLiteral = `'${name}'`;
  const topoExpression = renderTopoExpression(appNameLiteral, modules);

  return [
    "import { topo } from '@ontrails/core';",
    ...imports,
    '',
    `export const app = ${topoExpression};`,
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
    ['src/trails/onboard.ts', generateOnboardTrail()],
    ['src/signals/entity-signals.ts', generateEntitySignals()],
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
    ['AGENTS.md', AGENTS_CONTENT],
    ['CLAUDE.md', CLAUDE_CONTENT],
    ['tsconfig.json', TSCONFIG_CONTENT],
    ['tsconfig.tests.json', TSCONFIG_TESTS_CONTENT],
    ['.gitignore', GITIGNORE_CONTENT],
    ['oxlint.config.ts', OXLINT_CONFIG_CONTENT],
    ['.oxfmtrc.jsonc', OXFMTRC_CONTENT],
    ['.trails/.gitignore', WORKSPACE_GITIGNORE_CONTENT],
    ['.trails/scaffold.json', generateScaffoldProvenance(starter)],
    ['src/app.ts', generateAppTs(name, starter)],
    ...starterFileGenerators[starter](),
  ]);

const collectScaffoldOperations = (
  fileMap: Map<string, string>
): ProjectWriteOperation[] =>
  [...fileMap].map(([path, content]) => ({
    content,
    kind: 'write' as const,
    path,
  }));

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const createScaffold = trail('create.scaffold', {
  blaze: async (input) => {
    const projectDirResult = resolveProjectDir(input.dir ?? '.', input.name);
    if (projectDirResult.isErr()) {
      return projectDirResult;
    }

    const projectDir = projectDirResult.value;
    const starter = (input.starter ?? 'hello') as Starter;
    const dryRun = input.dryRun === true;
    const fileMap = collectScaffoldFiles(input.name, starter);
    const operations = collectScaffoldOperations(fileMap);
    const plannedOperations = dryRun
      ? planProjectOperations(projectDir, operations, { existing: 'preserve' })
      : await applyProjectOperations(projectDir, operations, {
          existing: 'preserve',
        });
    if (plannedOperations.isErr()) {
      return Result.err(plannedOperations.error);
    }

    const created = dryRun
      ? []
      : plannedOperations.value
          .filter((operation) => operation.kind === 'write')
          .map((operation) => operation.path);

    return Result.ok({
      created,
      dir: resolve(projectDir),
      dryRun,
      name: input.name,
      plannedOperations: plannedOperations.value,
    } satisfies ScaffoldResult);
  },
  description: 'Scaffold a new Trails project',
  input: z.object({
    dir: z.string().optional().describe('Parent directory'),
    dryRun: z
      .boolean()
      .default(false)
      .describe('Plan scaffold writes without touching the project directory'),
    name: z
      .string()
      .regex(PROJECT_NAME_PATTERN, PROJECT_NAME_MESSAGE)
      .describe('Project name'),
    starter: z
      .enum(['hello', 'entity', 'empty'])
      .default('hello')
      .describe('Starter trail'),
  }),
  intent: 'write',
  output: z.object({
    created: z
      .array(z.string())
      .describe('Project-relative paths of files written (empty in dry-run)'),
    dir: z.string(),
    dryRun: z.boolean(),
    name: z.string(),
    plannedOperations: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('mkdir'), path: z.string() }),
        z.object({
          from: z.string(),
          kind: z.literal('rename'),
          to: z.string(),
        }),
        z.object({ kind: z.literal('write'), path: z.string() }),
      ])
    ),
  }),
  permit: { scopes: ['project:write'] },
  visibility: 'internal',
});
