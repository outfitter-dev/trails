/**
 * `run` trail -- Direct trail invocation by ID.
 *
 * Resolves a trail in the current app's topo and executes it through the
 * shared `run()` pipeline from `@ontrails/core`. The CLI surface drives this
 * trail with `trails run <id> [--app <name>] [inline-json]`.
 *
 * Resolution order:
 *
 *  1. If `module` is provided, load that module directly. This preserves the
 *     single-app code path used by `testExamples` and tests that hand-build a
 *     workspace fixture.
 *  2. Otherwise, build the workspace trail-id index via
 *     {@link buildWorkspaceTrailIndex}.
 *     - If `app` is provided, resolve `app -> appDir -> module` and load that
 *       app's topo. The trail id must exist in the chosen app.
 *     - Else if the trail id has exactly one owner in the workspace index, use
 *       that owner.
 *     - Else if the trail id collides across multiple apps, return
 *       `Result.err(AmbiguousError)`. The CLI surface decides whether to prompt
 *       (TTY) or surface the error (non-TTY); the trail itself stays
 *       surface-agnostic.
 *     - Else return `Result.err(NotFoundError)`.
 *
 * The trail's output keeps a typed discriminator around the heterogeneous
 * inner trail value. The value itself remains `unknown` because direct
 * invocation can target any trail in the loaded app.
 */

import { join } from 'node:path';

import {
  AmbiguousError,
  NotFoundError,
  Result,
  run,
  trail,
} from '@ontrails/core';
import { buildWorkspaceTrailIndex } from '@ontrails/topographer';
import type {
  WorkspaceTrailCollision,
  WorkspaceTrailEntry,
} from '@ontrails/topographer';
import { z } from 'zod';

import {
  createIsolatedExampleRoot,
  writeIsolatedExampleJsonFile,
  writeIsolatedExampleTextFile,
} from '../local-state-io.js';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveTrailRootDir } from './root-dir.js';
import { createIsolatedExampleInput } from './topo-support.js';

export const INNER_TRAIL_RESULT_KIND = 'inner-trail-result' as const;

export const innerTrailResultSchema = z.object({
  kind: z.literal(INNER_TRAIL_RESULT_KIND),
  trailId: z.string(),
  value: z.unknown(),
});

export type InnerTrailResult = z.infer<typeof innerTrailResultSchema>;

// ---------------------------------------------------------------------------
// Resolution outcomes
// ---------------------------------------------------------------------------

type ResolveAppOutcome =
  | { readonly kind: 'resolved'; readonly module: string }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly string[];
    }
  | {
      readonly kind: 'wrong-app';
      readonly actualOwner: string;
      readonly requestedApp: string;
    }
  | { readonly kind: 'not-found'; readonly requestedApp?: string | undefined };

const collectCandidates = (
  trailId: string,
  index: Readonly<Record<string, WorkspaceTrailEntry>>,
  collision: WorkspaceTrailCollision | undefined
): readonly string[] => {
  if (collision !== undefined) {
    return collision.apps;
  }
  const sole = index[trailId];
  return sole === undefined ? [] : [sole.appName];
};

const findOwner = (
  trailId: string,
  index: Readonly<Record<string, WorkspaceTrailEntry>>,
  collision: WorkspaceTrailCollision | undefined,
  appName: string
): WorkspaceTrailEntry | undefined => {
  const sole = index[trailId];
  if (sole?.appName === appName) {
    return sole;
  }
  return collision?.owners.find((owner) => owner.appName === appName);
};

const resolveOwningAppViaIndex = async (
  workspaceRoot: string,
  trailId: string,
  appOverride: string | undefined
): Promise<ResolveAppOutcome> => {
  const result = await buildWorkspaceTrailIndex({ cwd: workspaceRoot });

  const matchingCollision = result.collisions.find(
    (entry) => entry.trailId === trailId
  );

  // Honor an explicit app override when provided.
  if (appOverride !== undefined) {
    const candidatesForId = collectCandidates(
      trailId,
      result.index,
      matchingCollision
    );
    if (candidatesForId.length > 0 && !candidatesForId.includes(appOverride)) {
      // Sole-owner mismatch: trail is owned uniquely by another app.
      // Surface a wrong-app outcome so the user sees the actual owner,
      // not an "ambiguous" message that doesn't apply.
      if (candidatesForId.length === 1) {
        const [actualOwner] = candidatesForId;
        if (actualOwner !== undefined) {
          return {
            actualOwner,
            kind: 'wrong-app',
            requestedApp: appOverride,
          };
        }
      }
      return { candidates: candidatesForId, kind: 'ambiguous' };
    }
    const owner = findOwner(
      trailId,
      result.index,
      matchingCollision,
      appOverride
    );
    if (owner === undefined) {
      return { kind: 'not-found', requestedApp: appOverride };
    }
    return { kind: 'resolved', module: owner.modulePath };
  }

  if (matchingCollision !== undefined) {
    return {
      candidates: matchingCollision.apps,
      kind: 'ambiguous',
    };
  }

  const owner = result.index[trailId];
  if (owner === undefined) {
    return { kind: 'not-found' };
  }

  return { kind: 'resolved', module: owner.modulePath };
};

const ambiguousMessage = (
  trailId: string,
  candidates: readonly string[]
): string =>
  `Trail ID '${trailId}' exists in apps: ${candidates.join(', ')}. Re-run with --app <name>.`;

export const resolveRunModulePath = async (
  rootDir: string,
  module: string | undefined,
  trailId: string,
  app: string | undefined
): Promise<Result<string, Error>> => {
  if (module !== undefined) {
    return Result.ok(module);
  }

  const outcome = await resolveOwningAppViaIndex(rootDir, trailId, app);
  if (outcome.kind === 'resolved') {
    return Result.ok(outcome.module);
  }
  if (outcome.kind === 'ambiguous') {
    return Result.err(
      new AmbiguousError(ambiguousMessage(trailId, outcome.candidates), {
        context: { candidates: outcome.candidates, trailId },
      })
    );
  }
  if (outcome.kind === 'wrong-app') {
    return Result.err(
      new NotFoundError(
        `Trail '${trailId}' is owned by '${outcome.actualOwner}', not '${outcome.requestedApp}'.`,
        {
          context: {
            actualOwner: outcome.actualOwner,
            requestedApp: outcome.requestedApp,
            trailId,
          },
        }
      )
    );
  }
  const appContext =
    outcome.requestedApp === undefined
      ? ''
      : ` for app '${outcome.requestedApp}'`;
  return Result.err(
    new NotFoundError(
      `Trail '${trailId}' was not found${appContext} in any workspace app under ${rootDir}.`,
      {
        context: {
          ...(outcome.requestedApp === undefined
            ? {}
            : { requestedApp: outcome.requestedApp }),
          rootDir,
          trailId,
        },
      }
    )
  );
};

// ---------------------------------------------------------------------------
// Ambiguous-example workspace fixture
// ---------------------------------------------------------------------------

const buildStubTopoSource = (appName: string): string =>
  [
    `const sharedIds = ['shared.id'];`,
    `export const app = {`,
    `  name: '${appName}',`,
    `  ids: () => sharedIds,`,
    `};`,
    '',
  ].join('\n');

const writeAmbiguousWorkspaceFixture = (workspaceRoot: string): void => {
  // Root package.json declaring two workspace apps.
  writeIsolatedExampleJsonFile(workspaceRoot, 'package.json', {
    name: 'run-ambiguous-fixture',
    private: true,
    type: 'module',
    workspaces: ['apps/*'],
  });

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

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const runTrail = trail('run', {
  args: ['id'],
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const rootDir = rootDirResult.value;

    // Single-app back-compat: if the caller provided `module`, trust it.
    const moduleResolution = await resolveRunModulePath(
      rootDir,
      input.module,
      input.id,
      input.app
    );
    if (moduleResolution.isErr()) {
      return moduleResolution;
    }
    const modulePath = moduleResolution.value;

    const leaseResult = await tryLoadFreshAppLease(modulePath, rootDir);
    if (leaseResult.isErr()) {
      return leaseResult;
    }
    const lease = leaseResult.value;

    try {
      const result = await run(lease.app, input.id, input.input, {
        ctx: ctx.permit === undefined ? {} : { permit: ctx.permit },
      });
      if (result.isErr()) {
        return Result.err(result.error);
      }
      return Result.ok({
        kind: INNER_TRAIL_RESULT_KIND,
        trailId: input.id,
        value: result.value,
      });
    } finally {
      lease.release();
    }
  },
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
  input: z.object({
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
  }),
  intent: 'write',
  output: innerTrailResultSchema,
  permit: { scopes: ['trails:run'] },
});
