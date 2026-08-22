/**
 * `run` trail -- Direct trail invocation by ID.
 *
 * Resolves a trail through the shared operator project context and executes it
 * through the `run()` pipeline from `@ontrails/core`. The CLI surface drives
 * this trail with `trails run <id> [--app <id>] [inline-json]`.
 *
 * Resolution order:
 *
 *  1. Resolve Config-owned project/app identity through the shared selector.
 *  2. A selected app loads only that app for execution; an absent ID receives
 *     wrong-app or collision coaching from a complete live Config-owned view.
 *     Unavailable unrelated apps leave that coaching explicitly incomplete
 *     without replacing the selected app's result.
 *  3. An unqualified workspace selection derives the complete ownership view
 *     live before choosing one owner. Missing apps fail closed and collisions
 *     return `AmbiguousError` for the CLI's optional TTY recovery.
 *  4. `module` refines the selected app entry; it never replaces the selected
 *     app identity or collection boundary.
 *
 * The trail's output keeps a typed discriminator around the heterogeneous
 * inner trail value. The value itself remains `unknown` because direct
 * invocation can target any trail in the loaded app.
 */

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AmbiguousError,
  NotFoundError,
  Result,
  ValidationError,
  run,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import {
  createIsolatedExampleRoot,
  writeIsolatedExampleJsonFile,
  writeIsolatedExampleTextFile,
} from '../local-state-io.js';

import { withFreshAppLease } from './operator-context.js';
import {
  assertConfiguredAppBinding,
  assertObservableProjectApps,
  resolveOperatorAppModuleContext,
  resolveOperatorProjectContext,
} from './project-context.js';
import type {
  OperatorAppProjectContext,
  OperatorProjectApp,
  OperatorProjectContext,
  OperatorWorkspaceProjectContext,
} from './project-context.js';
import {
  operatorProjectContextOutput,
  operatorProjectContextOutputSchema,
} from './project-context-output.js';
import { createIsolatedExampleInput } from './topo-support.js';

export const INNER_TRAIL_RESULT_KIND = 'inner-trail-result' as const;

export const innerTrailResultSchema = z.object({
  executedAppId: z.string(),
  kind: z.literal(INNER_TRAIL_RESULT_KIND),
  project: operatorProjectContextOutputSchema,
  trailId: z.string(),
  value: z.unknown(),
});

export type InnerTrailResult = z.infer<typeof innerTrailResultSchema>;

// ---------------------------------------------------------------------------
// Resolution outcomes
// ---------------------------------------------------------------------------

const ambiguousMessage = (
  trailId: string,
  candidates: readonly string[]
): string =>
  `Trail ID '${trailId}' exists in apps: ${candidates.join(', ')}. Re-run with --app <id>.`;

const configuredApps = (
  context: OperatorProjectContext
): readonly OperatorProjectApp[] =>
  context.selectedExtent === 'workspace'
    ? context.apps
    : context.identity.apps.map((app) => ({
        configured: true,
        id: app.id,
        lockPath: join(app.rootDir, 'trails.lock'),
        modulePath: app.entry,
        moduleSource: app.entrySource === 'explicit' ? 'config' : 'convention',
        root: app.root,
        rootDir: app.rootDir,
      }));

interface LiveOwnershipView {
  readonly owners: readonly string[];
  readonly unavailableAppIds: readonly string[];
}

const collectLiveOwners = async (
  context: OperatorProjectContext,
  trailId: string
): Promise<Result<LiveOwnershipView, Error>> => {
  const owners: string[] = [];
  const unavailableAppIds: string[] = [];
  for (const app of configuredApps(context)) {
    if (app.id === undefined) {
      return Result.err(
        new ValidationError(
          'Configured ownership discovery requires a stable app ID.',
          {
            context: {
              modulePath: app.modulePath,
              reason: 'invalid-binding',
              rootDir: app.rootDir,
            },
          }
        )
      );
    }
    const appId = app.id;
    const loaded = await withFreshAppLease(
      app.modulePath,
      app.rootDir,
      (lease) => {
        if (lease.app.name !== appId) {
          return Result.err(
            new ValidationError(
              `Configured app "${appId}" loaded topo "${lease.app.name}" while resolving trail ownership.`,
              {
                context: {
                  actualAppId: lease.app.name,
                  expectedAppId: appId,
                  modulePath: app.modulePath,
                  reason: 'invalid-binding',
                },
              }
            )
          );
        }
        if (lease.app.get(trailId) !== undefined) {
          owners.push(appId);
        }
        return Result.ok();
      }
    );
    if (loaded.isErr()) {
      if (context.selectedExtent === 'workspace') {
        return loaded;
      }
      unavailableAppIds.push(appId);
    }
  }
  return Result.ok({
    owners: owners.toSorted(),
    unavailableAppIds: unavailableAppIds.toSorted(),
  });
};

const ownerError = (
  context: OperatorProjectContext,
  trailId: string,
  owners: readonly string[]
): Error => {
  if (owners.length > 1) {
    return new AmbiguousError(ambiguousMessage(trailId, owners), {
      context: { candidates: owners, trailId },
    });
  }
  const requestedApp =
    context.selectedExtent === 'configured-app' ? context.app.id : undefined;
  const [actualOwner] = owners;
  if (
    requestedApp !== undefined &&
    actualOwner !== undefined &&
    actualOwner !== requestedApp
  ) {
    return new NotFoundError(
      `Trail '${trailId}' is owned by '${actualOwner}', not '${requestedApp}'.`,
      { context: { actualOwner, requestedApp, trailId } }
    );
  }
  if (
    requestedApp !== undefined &&
    actualOwner === requestedApp &&
    context.selectedExtent === 'configured-app'
  ) {
    return new NotFoundError(
      `Trail '${trailId}' is not exposed by module '${context.app.modulePath}' selected for app '${requestedApp}', but the app's Config-owned default entry does expose it. Remove --module or select a module that exposes the trail.`,
      {
        context: {
          modulePath: context.app.modulePath,
          requestedApp,
          trailId,
        },
      }
    );
  }
  const appContext =
    requestedApp === undefined ? '' : ` for app '${requestedApp}'`;
  return new NotFoundError(
    `Trail '${trailId}' was not found${appContext} in any configured app under ${context.projectRoot}.`,
    {
      context: {
        ...(requestedApp === undefined ? {} : { requestedApp }),
        rootDir: context.projectRoot,
        trailId,
      },
    }
  );
};

const incompleteConfiguredOwnerError = (
  context: OperatorAppProjectContext,
  trailId: string,
  ownership: LiveOwnershipView
): Error => {
  const requestedApp = context.app.id;
  if (requestedApp !== undefined && ownership.owners.includes(requestedApp)) {
    return ownerError(context, trailId, [requestedApp]);
  }
  return new NotFoundError(
    `Trail '${trailId}' is not exposed by the selected app${requestedApp === undefined ? '' : ` '${requestedApp}'`}. Ownership coaching is incomplete because configured apps are unavailable: ${ownership.unavailableAppIds.join(', ')}.`,
    {
      context: {
        ...(requestedApp === undefined ? {} : { requestedApp }),
        rootDir: context.projectRoot,
        trailId,
        unavailableAppIds: ownership.unavailableAppIds,
      },
    }
  );
};

const selectedOwnerContext = (
  context: OperatorWorkspaceProjectContext,
  appId: string
): Result<OperatorAppProjectContext, ValidationError> => {
  const app = context.apps.find((candidate) => candidate.id === appId);
  return app === undefined
    ? Result.err(
        new ValidationError(
          `Resolved trail owner "${appId}" is not present in configured project context.`,
          { context: { appId, reason: 'invalid-binding' } }
        )
      )
    : Result.ok({
        app,
        boundaryDir: context.boundaryDir,
        identity: context.identity,
        projectRoot: context.projectRoot,
        selectedExtent: 'configured-app',
        selectionProvenance: context.selectionProvenance,
      });
};

const resolveRunContext = async (
  context: OperatorProjectContext,
  trailId: string
): Promise<Result<OperatorAppProjectContext, Error>> => {
  if (context.selectedExtent === 'standalone-app') {
    return resolveOperatorAppModuleContext(context);
  }
  if (context.selectedExtent === 'configured-app') {
    const owns = await withFreshAppLease(
      context.app.modulePath,
      context.app.rootDir,
      (lease) => {
        const binding = assertConfiguredAppBinding(context, lease.app.name);
        return binding.isErr()
          ? binding
          : Result.ok(lease.app.get(trailId) !== undefined);
      }
    );
    if (owns.isErr()) {
      return owns;
    }
    if (owns.value) {
      return Result.ok(context);
    }
  }
  const owners = await collectLiveOwners(context, trailId);
  if (owners.isErr()) {
    return owners;
  }
  if (context.selectedExtent === 'configured-app') {
    return Result.err(
      owners.value.unavailableAppIds.length === 0
        ? ownerError(context, trailId, owners.value.owners)
        : incompleteConfiguredOwnerError(context, trailId, owners.value)
    );
  }
  const [owner] = owners.value.owners;
  if (owners.value.owners.length !== 1 || owner === undefined) {
    return Result.err(ownerError(context, trailId, owners.value.owners));
  }
  return context.selectedExtent === 'workspace'
    ? selectedOwnerContext(context, owner)
    : Result.err(
        new ValidationError('Unable to resolve workspace run context.', {
          context: { reason: 'invalid-binding' },
        })
      );
};

interface RunTargetInput {
  readonly app?: string | undefined;
  readonly module?: string | undefined;
  readonly rootDir?: string | undefined;
}

interface RunTargetRuntime {
  readonly cwd?: string | undefined;
}

export interface RunTargetProject {
  readonly modulePath: string;
  readonly rootDir: string;
}

/** Resolve one run target without collapsing inferred CWD into explicit root selection. */
export const resolveRunTargetProject = async (
  input: RunTargetInput,
  trailId: string,
  runtime: RunTargetRuntime
): Promise<Result<RunTargetProject, Error>> => {
  const context = await resolveOperatorProjectContext(input, runtime);
  if (context.isErr()) {
    return context;
  }
  const observable = await assertObservableProjectApps(context.value);
  if (observable.isErr()) {
    return observable;
  }
  const selected = await resolveRunContext(context.value, trailId);
  if (selected.isErr()) {
    return selected;
  }
  return Result.ok({
    modulePath: selected.value.app.modulePath,
    rootDir: selected.value.app.rootDir,
  });
};

// ---------------------------------------------------------------------------
// Ambiguous-example workspace fixture
// ---------------------------------------------------------------------------

const buildStubTopoSource = (appName: string): string => {
  // Keep example fixture construction cold-startable in the bundled CLI. The
  // absolute source URL is only imported if this repo-local example runs; it
  // does not ask the extracted release archive to resolve a workspace package
  // while merely rendering `--help` or `--version`.
  const core = pathToFileURL(
    resolve(import.meta.dir, '../../../../packages/core/src/index.ts')
  ).href;
  return [
    `import { Result, topo, trail } from ${JSON.stringify(core)};`,
    `const shared = trail('shared.id', { implementation: () => Result.ok(${JSON.stringify(appName)}), intent: 'read' });`,
    `export const app = topo(${JSON.stringify(appName)}, [shared]);`,
    '',
  ].join('\n');
};

const writeAmbiguousWorkspaceFixture = (workspaceRoot: string): void => {
  // Root package.json declaring two workspace apps.
  writeIsolatedExampleJsonFile(workspaceRoot, 'package.json', {
    name: 'run-ambiguous-fixture',
    private: true,
    type: 'module',
    workspaces: ['apps/*'],
  });
  writeIsolatedExampleTextFile(
    workspaceRoot,
    'trails.config.ts',
    `export default { workspace: { apps: { 'app-a': { root: 'apps/app-a' }, 'app-b': { root: 'apps/app-b' } } } };\n`
  );

  // Each app declares a Trails-app shape so discovery picks it up. The
  // discovery layer only calls `topo.ids()` and reads `topo.name`, so a
  // hand-rolled stub satisfies the `isTopo` shape without pulling in
  // `@ontrails/core` from a temp directory that has no node_modules.
  for (const appName of ['app-a', 'app-b'] as const) {
    writeIsolatedExampleJsonFile(
      workspaceRoot,
      join('apps', appName, 'package.json'),
      {
        name: appName,
        private: true,
        trails: { module: 'src/app.ts' },
        type: 'module',
      }
    );
    writeIsolatedExampleTextFile(
      workspaceRoot,
      join('apps', appName, 'src/app.ts'),
      buildStubTopoSource(appName)
    );
  }
};

// ---------------------------------------------------------------------------
// Example input helpers
// ---------------------------------------------------------------------------

const buildHappyExampleInput = (): {
  readonly input: { readonly module: string; readonly rootDir: string };
  readonly id: string;
  readonly module: string;
  readonly rootDir: string;
} => {
  const isolated = createIsolatedExampleInput('run-happy');
  return {
    id: 'survey.brief',
    input: { module: isolated.module, rootDir: isolated.rootDir },
    module: isolated.module,
    rootDir: isolated.rootDir,
  };
};

const buildNotFoundExampleInput = (): {
  readonly id: string;
  readonly module: string;
  readonly rootDir: string;
} => ({
  ...createIsolatedExampleInput('run-not-found'),
  id: 'does.not.exist',
});

const uniqueAmbiguousExampleName = (): string =>
  `run-ambiguous-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const buildAmbiguousExampleInput = (): {
  readonly id: string;
  readonly rootDir: string;
} => {
  const root = createIsolatedExampleRoot(uniqueAmbiguousExampleName());
  writeAmbiguousWorkspaceFixture(root);
  return { id: 'shared.id', rootDir: root };
};

const runTrailInputSchema = z
  .object({
    app: z
      .string()
      .optional()
      .describe(
        'Workspace app to resolve the trail ID against; required when the ID is exposed by more than one app'
      ),
    id: z.string().describe('Trail ID to invoke'),
    input: z
      .unknown()
      .optional()
      .describe(
        'Parsed input for the resolved trail; the CLI surface JSON.parses the inline argument before passing it through'
      ),
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  })
  .catchall(z.unknown());

type RunTrailInput = z.output<typeof runTrailInputSchema>;

const RUN_TRAIL_CONTROL_KEYS = new Set([
  'app',
  'id',
  'input',
  'module',
  'rootDir',
]);

const directInputEntries = (
  input: RunTrailInput
): readonly (readonly [string, unknown])[] =>
  Object.entries(input).filter(([key]) => !RUN_TRAIL_CONTROL_KEYS.has(key));

const resolveInnerTrailInput = (
  input: RunTrailInput
): Result<unknown, ValidationError> => {
  const entries = directInputEntries(input);
  if (entries.length === 0) {
    return Result.ok(input.input);
  }
  if (Object.hasOwn(input, 'input')) {
    return Result.err(
      new ValidationError(
        'trails run received both direct input fields and an explicit input wrapper. Use one shape: either {"name":"Alpha"} or {"input":{"name":"Alpha"}}.'
      )
    );
  }
  return Result.ok(Object.fromEntries(entries));
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const runTrail = trail('run', {
  args: ['id'],
  description:
    'Resolve a trail by ID in the current app and execute it through the shared pipeline',
  examples: [
    {
      description:
        'Resolve and execute a trail by ID, returning the inner trail Result value',
      input: buildHappyExampleInput(),
      name: 'Run trail by ID',
    },
    {
      description: 'Reject an unknown trail ID with NotFoundError',
      error: 'NotFoundError',
      input: buildNotFoundExampleInput(),
      name: 'Reject unknown trail ID',
    },
    {
      description:
        'Reject an ambiguous trail ID without --app with AmbiguousError so non-TTY callers see exit code 1',
      error: 'AmbiguousError',
      input: buildAmbiguousExampleInput(),
      name: 'Reject ambiguous trail ID without --app',
    },
  ],
  implementation: async (
    input: RunTrailInput,
    ctx
  ): Promise<Result<InnerTrailResult, Error>> => {
    const contextResult = await resolveOperatorProjectContext(input, {
      cwd: ctx.cwd,
    });
    if (contextResult.isErr()) {
      return contextResult;
    }
    const context = contextResult.value;
    const observable = await assertObservableProjectApps(context);
    if (observable.isErr()) {
      return observable;
    }
    const resolved = await resolveRunContext(context, input.id);
    if (resolved.isErr()) {
      return resolved;
    }
    const selected = resolved.value;
    const innerInput = resolveInnerTrailInput(input);
    if (innerInput.isErr()) {
      return innerInput;
    }
    return withFreshAppLease(
      selected.app.modulePath,
      selected.app.rootDir,
      async (lease) => {
        const binding = assertConfiguredAppBinding(selected, lease.app.name);
        if (binding.isErr()) {
          return binding;
        }
        const result = await run(lease.app, input.id, innerInput.value, {
          ctx: {
            cwd: selected.app.rootDir,
            ...(ctx.permit === undefined ? {} : { permit: ctx.permit }),
          },
        });
        if (result.isErr()) {
          return result;
        }
        return Result.ok({
          executedAppId: lease.app.name,
          kind: INNER_TRAIL_RESULT_KIND,
          project: operatorProjectContextOutput(selected),
          trailId: input.id,
          value: result.value,
        });
      }
    );
  },
  input: runTrailInputSchema,
  intent: 'write',
  output: innerTrailResultSchema,
  permit: { scopes: ['trails:run'] },
});
