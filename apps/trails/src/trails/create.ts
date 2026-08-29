/**
 * `create` trail -- Create a new Trails project.
 *
 * Composes create.scaffold, add.surface, and add.verify sub-trails
 * via ctx.compose.
 */

import { realpathSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { InternalError, Result, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import {
  PROJECT_NAME_MESSAGE,
  PROJECT_NAME_PATTERN,
  projectPathExists,
  writeProjectFile,
} from '../project-writes.js';
import type { PlannedProjectOperation } from '../project-writes.js';
import { resolveSurfaceEntryFile } from './add-surface.js';
import { resolveVerifyHookDir } from './add-verify.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Starter = 'empty' | 'entity' | 'hello';
type Surface = 'cli' | 'http' | 'mcp';

interface CreateInput {
  readonly dir?: string | undefined;
  readonly name: string;
  readonly starter: Starter;
  readonly surfaces: readonly Surface[];
  readonly verify: boolean;
  readonly workspace: boolean;
}

interface ScaffoldRequest {
  readonly dir?: string | undefined;
  readonly dryRun: boolean;
  readonly name: string;
  readonly starter: Starter;
  readonly workspace: boolean;
}

interface VerifyRequest {
  readonly dir?: string | undefined;
  readonly name: string;
  readonly verify: boolean;
}

interface ScaffoldedProject {
  readonly appDir: string;
  readonly appRoot: string;
  readonly created: string[];
  readonly dir: string;
  readonly dryRun: boolean;
  readonly layout: 'standalone' | 'workspace';
  readonly name: string;
  readonly plannedOperations: PlannedProjectOperation[];
}

interface CreateResult {
  readonly appDir: string;
  readonly created: string[];
  readonly dir: string;
  readonly dryRun: boolean;
  readonly guidance: string[];
  readonly layout: 'standalone' | 'workspace';
  readonly name: string;
  readonly plannedOperations: PlannedProjectOperation[];
}

interface SurfaceResult {
  readonly created: string | null;
  readonly dependency: string;
}

type TrailContextWithCompose = TrailContext & {
  readonly compose: NonNullable<TrailContext['compose']>;
};

const hasCompose = (ctx: TrailContext): ctx is TrailContextWithCompose =>
  Boolean(ctx.compose);

const buildScaffoldInput = (input: ScaffoldRequest) => ({
  ...(input.dir === undefined ? {} : { dir: input.dir }),
  dryRun: input.dryRun,
  name: input.name,
  starter: input.starter,
  workspace: input.workspace,
});

const buildSurfaceInput = (dir: string, surface: string) => ({
  dir,
  surface,
});

const buildVerifyInput = (input: VerifyRequest) => ({
  ...(input.dir === undefined ? {} : { dir: input.dir }),
  name: input.name,
});

const collectSurfaceFiles = async (
  surfaces: readonly string[],
  addSurface: (surface: string) => Promise<Result<SurfaceResult, Error>>
): Promise<Result<string[], Error>> => {
  const created: string[] = [];

  for (const surface of surfaces) {
    const result = await addSurface(surface);
    if (result.isErr()) {
      return result;
    }
    if (result.value.created !== null) {
      created.push(result.value.created);
    }
  }

  return Result.ok(created);
};

const collectVerifyFiles = async (
  shouldVerify: boolean,
  addVerify: () => Promise<Result<{ created: string[] }, Error>>
): Promise<Result<string[], Error>> => {
  if (!shouldVerify) {
    return Result.ok([]);
  }

  const result = await addVerify();
  return result.isErr()
    ? Result.err(result.error)
    : Result.ok(result.value.created);
};

const collectCreatedFiles = (
  scaffolded: readonly string[],
  surfaces: readonly string[],
  verify: readonly string[],
  readme: string | null
): string[] =>
  readme === null
    ? [...scaffolded, ...surfaces, ...verify]
    : [...scaffolded, ...surfaces, ...verify, readme];

const projectRelativeAppPath = (appRoot: string, path: string): string =>
  appRoot === '.' ? path : `${appRoot}/${path}`;

const projectRelativeVerifyPath = (
  scaffolded: ScaffoldedProject,
  hookDir: string,
  path: string
): string => {
  if (path !== 'lefthook.yml') {
    return projectRelativeAppPath(scaffolded.appRoot, path);
  }
  // Keep reports relative when canonical hook ownership spans a filesystem
  // alias such as macOS's /var -> /private/var mapping.
  try {
    return (
      relative(
        realpathSync(scaffolded.dir),
        join(realpathSync(hookDir), path)
      ) || path
    );
  } catch {
    return relative(scaffolded.dir, join(hookDir, path)) || path;
  }
};

type ResolvedSurfaceEntryFiles = ReadonlyMap<Surface, string>;

const resolveSurfaceEntryFiles = (
  appDir: string,
  surfaces: readonly Surface[],
  projectedLocalTsconfig: boolean
): Result<ResolvedSurfaceEntryFiles, Error> => {
  const entries = new Map<Surface, string>();
  for (const surface of surfaces) {
    const entryFile = resolveSurfaceEntryFile(appDir, surface, {
      projectedLocalTsconfig,
      projectedPackageTypeModule: true,
    });
    if (entryFile.isErr()) {
      return entryFile;
    }
    entries.set(surface, entryFile.value);
  }
  return Result.ok(entries);
};

const plansLocalTsconfig = (scaffolded: ScaffoldedProject): boolean =>
  scaffolded.plannedOperations.some(
    (operation) =>
      operation.kind === 'write' &&
      operation.path ===
        projectRelativeAppPath(scaffolded.appRoot, 'tsconfig.json')
  );

const collectCreateOperations = (
  scaffolded: ScaffoldedProject,
  input: CreateInput,
  surfaceEntryFiles: ResolvedSurfaceEntryFiles,
  hookDir: string
): Result<PlannedProjectOperation[], Error> => {
  const surfacePaths = [...surfaceEntryFiles.values()].map((entryFile) =>
    projectRelativeAppPath(scaffolded.appRoot, entryFile)
  );

  const preserveExistingPaths = [
    ...surfacePaths,
    ...(input.verify
      ? [
          projectRelativeAppPath(
            scaffolded.appRoot,
            '__tests__/examples.test.ts'
          ),
        ]
      : []),
    'README.md',
  ];
  const additions: PlannedProjectOperation[] = [];
  for (const path of preserveExistingPaths) {
    const exists = projectPathExists(scaffolded.dir, path);
    if (exists.isErr()) {
      return exists;
    }
    if (!exists.value) {
      additions.push({ kind: 'write', path });
    }
  }
  if (input.verify) {
    const hookExists = projectPathExists(hookDir, 'lefthook.yml');
    if (hookExists.isErr()) {
      return hookExists;
    }
    if (!hookExists.value) {
      additions.push({
        kind: 'write',
        path: projectRelativeVerifyPath(scaffolded, hookDir, 'lefthook.yml'),
      });
    }
  }
  additions.push(
    ...(input.surfaces.length === 0
      ? []
      : [
          {
            kind: 'write' as const,
            path: projectRelativeAppPath(scaffolded.appRoot, 'package.json'),
          },
        ]),
    ...(input.verify
      ? [
          {
            kind: 'write' as const,
            path: projectRelativeAppPath(scaffolded.appRoot, 'package.json'),
          },
        ]
      : [])
  );
  const unique = new Map<string, PlannedProjectOperation>();
  for (const operation of [...scaffolded.plannedOperations, ...additions]) {
    const key =
      operation.kind === 'rename'
        ? `${operation.kind}:${operation.from}:${operation.to}`
        : `${operation.kind}:${operation.path}`;
    unique.set(key, operation);
  }
  return Result.ok([...unique.values()]);
};

const createGuidance = (input: CreateInput): string[] =>
  input.workspace
    ? [
        `Install dependencies, then run \`bunx trails compile --app ${input.name} --permit '{"id":"local-dev","scopes":["topo:write"]}'\` from the workspace root to derive apps/${input.name}/trails.lock.`,
        'The workspace view derives from the literal workspace.apps catalog and app-owned locks; no root aggregate lock is created.',
        'Disposable cache and observed state stay in the global per-user Trails cache and state homes.',
      ]
    : [
        'Install dependencies, then run `bun run compile --permit \'{"id":"local-dev","scopes":["topo:write"]}\'` from the app root to derive trails.lock.',
        'Disposable cache and observed state stay in the global per-user Trails cache and state homes.',
      ];

const surfaceReadmeDescriptions = {
  cli: 'CLI surface entry point',
  http: 'HTTP surface entry point',
  mcp: 'MCP surface entry point',
} satisfies Record<Surface, string>;

const starterReadmeLines = {
  empty:
    'Starts with an empty `src/trails/` directory for authoring from scratch.',
  entity:
    'Includes sample entity trails, a signal, and an in-memory store for exploration.',
  hello: 'Includes a `hello` trail with examples for the first happy path.',
} satisfies Record<Starter, string>;

const starterOwnedFiles = {
  empty: [],
  entity: [
    'src/app.ts',
    'src/signals/entity-signals.ts',
    'src/store.ts',
    'src/trails/entity.ts',
    'src/trails/onboard.ts',
    'src/trails/search.ts',
  ],
  hello: ['src/app.ts', 'src/trails/hello.ts'],
} as const satisfies Record<Starter, readonly string[]>;

const createdStarterContract = (
  starter: Starter,
  appPrefix: string,
  createdScaffoldFiles: ReadonlySet<string>
): boolean =>
  starter !== 'empty' &&
  starterOwnedFiles[starter].every((path) =>
    createdScaffoldFiles.has(`${appPrefix}${path}`)
  );

const generateReadme = (
  input: CreateInput,
  surfaceEntryFiles: ResolvedSurfaceEntryFiles,
  createdSurfaceFiles: ReadonlySet<string>,
  createdScaffoldFiles: ReadonlySet<string>
): string => {
  const appPrefix = input.workspace ? `apps/${input.name}/` : '';
  const surfaceLines = [...surfaceEntryFiles]
    .map(
      ([surface, entryFile]) =>
        `- \`${appPrefix}${entryFile}\` - ${surfaceReadmeDescriptions[surface]}`
    )
    .join('\n');
  const verificationCommand = input.verify ? 'bun test\n' : '';
  const verificationStructure = input.verify
    ? '- `__tests__/examples.test.ts` - examples-as-tests harness\n'
    : '- Verification files were not generated for this project\n';
  const ownsStarterContract = createdStarterContract(
    input.starter,
    appPrefix,
    createdScaffoldFiles
  );
  const workspaceRunCommand =
    !input.workspace || !ownsStarterContract
      ? ''
      : `bunx trails run ${input.starter === 'hello' ? 'hello' : 'entity.list'} --app ${input.name} --permit '{"id":"local-dev","scopes":["trails:run"]}'\n`;
  const cliEntryFile = surfaceEntryFiles.get('cli');
  const localPermitGuidance =
    input.starter === 'entity' &&
    ownsStarterContract &&
    cliEntryFile !== undefined &&
    createdSurfaceFiles.has(cliEntryFile)
      ? `## Local Permits

Protected starter writes require an explicit scoped permit. For local exploration, run the generated CLI with the narrow starter scope:

\`\`\`bash
bun ${appPrefix}${cliEntryFile} entity add --name New --permit '{"id":"local-dev","scopes":["entity:write"]}'
\`\`\`

`
      : '';

  const compileCommands = input.workspace
    ? `bunx trails compile --app ${input.name} --permit '{"id":"local-dev","scopes":["topo:write"]}'
bunx trails validate --app ${input.name}
${workspaceRunCommand}bunx trails warden --app ${input.name}
bunx trails wayfind --overview --app ${input.name}`
    : `bun run compile --permit '{"id":"local-dev","scopes":["topo:write"]}'
bun run validate
bun run warden
bun run survey
bun run guide`;
  const layoutDescription = input.workspace
    ? `This configured workspace names the \`${input.name}\` app in root \`workspace.apps\`. The app owns \`apps/${input.name}/trails.lock\`; the workspace derives its cross-app view and never creates a root aggregate lock.`
    : 'This standalone app owns its root `trails.lock`.';

  return `# ${input.name}

A Trails project. Trails is an agent-native, contract-first TypeScript framework: author a trail once with typed input, Result output, examples, intent, and meta; surface it through CLI, MCP, HTTP, or future WebSocket.

${layoutDescription}

## Getting Started

\`\`\`bash
bun install
${compileCommands}
${verificationCommand}
\`\`\`

## Project Structure

- \`${appPrefix}src/app.ts\` - the side-effect-free topo entry
- \`${appPrefix}src/trails/\` - trail definitions
${surfaceLines}
${verificationStructure.replaceAll('`__tests__/', `\`${appPrefix}__tests__/`)}- \`${appPrefix}AGENTS.md\` - project guidance for agents working in this app

The generated app module authors deterministic scaffold provenance in the \`scaffold\` overlay. The normal compile path validates and embeds it in the app-owned lock. Disposable cache and observed state live in the global per-user cache and state homes, never in this project.

## Starter

${starterReadmeLines[input.starter]}

${localPermitGuidance}## Next Steps

- Add a trail with ${input.workspace ? `\`cd apps/${input.name} && bun run add\`` : '`bun run add`'}
- Run ${input.workspace ? `\`bunx trails warden --app ${input.name}\`` : '`bun run warden`'} before review
- Read \`${appPrefix}AGENTS.md\` for Trails vocabulary and conventions
`;
};

const writeReadme = async (
  input: CreateInput,
  dir: string,
  surfaceEntryFiles: ResolvedSurfaceEntryFiles,
  createdSurfaceFiles: ReadonlySet<string>,
  createdScaffoldFiles: ReadonlySet<string>
): Promise<Result<string | null, Error>> => {
  const exists = projectPathExists(dir, 'README.md');
  if (exists.isErr()) {
    return exists;
  }
  if (exists.value) {
    return Result.ok(null);
  }

  const written = await writeProjectFile(
    dir,
    'README.md',
    generateReadme(
      input,
      surfaceEntryFiles,
      createdSurfaceFiles,
      createdScaffoldFiles
    )
  );
  return written.isErr() ? Result.err(written.error) : Result.ok('README.md');
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const createTrail = trail('create', {
  composes: ['create.scaffold', 'add.surface', 'add.verify'],
  description: 'Create a new Trails project',
  dryRun: true,
  fields: {
    starter: {
      options: [
        {
          hint: 'One trail, one example',
          label: 'Hello world',
          value: 'hello',
        },
        {
          hint: '4 trails, signal, store',
          label: 'Entity CRUD',
          value: 'entity',
        },
        { hint: 'Just the structure', label: 'Empty', value: 'empty' },
      ],
    },
    surfaces: {
      options: [
        { hint: 'Commander-based command line', label: 'CLI', value: 'cli' },
        {
          hint: 'Model Context Protocol for agents',
          label: 'MCP',
          value: 'mcp',
        },
        {
          hint: 'Hono-powered HTTP endpoints',
          label: 'HTTP',
          value: 'http',
        },
      ],
    },
  },
  implementation: async (input: CreateInput, ctx) => {
    if (!hasCompose(ctx)) {
      return Result.err(new InternalError('create trail requires ctx.compose'));
    }

    const scaffoldPlan = await ctx.compose<ScaffoldedProject>(
      'create.scaffold',
      buildScaffoldInput({ ...input, dryRun: true })
    );
    if (scaffoldPlan.isErr()) {
      return scaffoldPlan;
    }

    let hookDir: Result<string, Error> = Result.ok(scaffoldPlan.value.appDir);
    if (input.verify) {
      hookDir = input.workspace
        ? Result.ok(scaffoldPlan.value.dir)
        : await resolveVerifyHookDir(scaffoldPlan.value.appDir);
    }
    if (hookDir.isErr()) {
      return hookDir;
    }

    const surfaceEntryFiles = resolveSurfaceEntryFiles(
      scaffoldPlan.value.appDir,
      input.surfaces,
      plansLocalTsconfig(scaffoldPlan.value)
    );
    if (surfaceEntryFiles.isErr()) {
      return surfaceEntryFiles;
    }

    const plannedOperations = collectCreateOperations(
      scaffoldPlan.value,
      input,
      surfaceEntryFiles.value,
      hookDir.value
    );
    if (plannedOperations.isErr()) {
      return plannedOperations;
    }

    if (ctx.dryRun === true) {
      return Result.ok({
        appDir: scaffoldPlan.value.appDir,
        created: [],
        dir: scaffoldPlan.value.dir,
        dryRun: true,
        guidance: createGuidance(input),
        layout: scaffoldPlan.value.layout,
        name: input.name,
        plannedOperations: plannedOperations.value,
      });
    }

    const scaffolded = await ctx.compose<ScaffoldedProject>(
      'create.scaffold',
      buildScaffoldInput({ ...input, dryRun: false })
    );
    if (scaffolded.isErr()) {
      return scaffolded;
    }

    const finishCreate = async (): Promise<Result<CreateResult, Error>> => {
      const surfaceFiles = await collectSurfaceFiles(
        input.surfaces,
        (surface) =>
          ctx.compose<SurfaceResult>(
            'add.surface',
            buildSurfaceInput(scaffolded.value.appDir, surface)
          )
      );
      if (surfaceFiles.isErr()) {
        return surfaceFiles;
      }

      const verifyFiles = await collectVerifyFiles(input.verify, () =>
        ctx.compose<{ created: string[] }>(
          'add.verify',
          buildVerifyInput({
            dir: dirname(scaffolded.value.appDir),
            name: basename(scaffolded.value.appDir),
            verify: input.verify,
          })
        )
      );
      if (verifyFiles.isErr()) {
        return verifyFiles;
      }

      const readmeFile = await writeReadme(
        input,
        scaffolded.value.dir,
        surfaceEntryFiles.value,
        new Set(surfaceFiles.value),
        new Set(scaffolded.value.created)
      );
      if (readmeFile.isErr()) {
        return readmeFile;
      }

      return Result.ok({
        appDir: scaffolded.value.appDir,
        created: collectCreatedFiles(
          scaffolded.value.created,
          surfaceFiles.value.map((path) =>
            projectRelativeAppPath(scaffolded.value.appRoot, path)
          ),
          verifyFiles.value.map((path) =>
            projectRelativeVerifyPath(scaffolded.value, hookDir.value, path)
          ),
          readmeFile.value
        ),
        dir: scaffolded.value.dir,
        dryRun: false,
        guidance: createGuidance(input),
        layout: scaffolded.value.layout,
        name: input.name,
        plannedOperations: plannedOperations.value,
      });
    };

    return finishCreate();
  },
  input: z.object({
    dir: z.string().optional().describe('Parent directory'),
    name: z
      .string()
      .regex(PROJECT_NAME_PATTERN, PROJECT_NAME_MESSAGE)
      .describe('Project name'),
    starter: z
      .enum(['hello', 'entity', 'empty'])
      .default('hello')
      .describe('Starter trail'),
    surfaces: z
      .array(z.enum(['cli', 'http', 'mcp']))
      .min(1)
      .default(['cli'])
      .describe('Surfaces'),
    verify: z.boolean().default(true).describe('Include testing + warden'),
    workspace: z
      .boolean()
      .default(false)
      .describe('Create a configured workspace with one app'),
  }),
  output: z.object({
    appDir: z.string(),
    created: z.array(z.string()),
    dir: z.string(),
    dryRun: z.boolean(),
    guidance: z.array(z.string()),
    layout: z.enum(['standalone', 'workspace']),
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
});
