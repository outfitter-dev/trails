import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  findTrailsConfigPaths,
  readTrailsProjectIdentity,
  resolveTrailsProjectRoot,
  trailsAppEntryRelativePath,
  trailsLockFileName,
} from '@ontrails/config';
import type {
  ReadTrailsProjectIdentityResult,
  ResolvedTrailsWorkspaceApp,
  TrailsProjectRootResolution,
} from '@ontrails/config';
import { Result, ValidationError } from '@ontrails/core';
import { deriveWorkspaceView } from '@ontrails/topography';

export type OperatorModuleSource = 'config' | 'convention' | 'module';
export type OperatorSelectionProvenance = 'app' | 'cwd' | 'root-dir';

export interface OperatorProjectApp {
  readonly configured: boolean;
  readonly id?: string | undefined;
  readonly lockPath: string;
  readonly modulePath: string;
  readonly moduleSource: OperatorModuleSource;
  readonly root: string;
  readonly rootDir: string;
}

interface OperatorProjectContextBase {
  readonly boundaryDir: string;
  readonly identity: ReadTrailsProjectIdentityResult;
  readonly projectRoot: string;
  readonly selectionProvenance: OperatorSelectionProvenance;
}

export interface OperatorAppProjectContext extends OperatorProjectContextBase {
  readonly app: OperatorProjectApp;
  readonly selectedExtent: 'configured-app' | 'standalone-app';
}

export interface OperatorWorkspaceProjectContext extends OperatorProjectContextBase {
  readonly apps: readonly OperatorProjectApp[];
  readonly selectedExtent: 'workspace';
}

export type OperatorProjectContext =
  | OperatorAppProjectContext
  | OperatorWorkspaceProjectContext;

export interface OperatorProjectContextInput {
  readonly app?: string | undefined;
  readonly module?: string | undefined;
  readonly rootDir?: string | undefined;
}

export interface OperatorProjectContextRuntime {
  readonly cwd?: string | undefined;
}

const isInside = (root: string, target: string): boolean => {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

const canonicalPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

const projectContextError = (
  message: string,
  reason:
    | 'compile-needs-app'
    | 'invalid-binding'
    | 'outside-project'
    | 'unknown-app',
  context: Record<string, unknown>
): ValidationError =>
  new ValidationError(message, { context: { ...context, reason } });

const readGitWorkingTreeBoundary = (cwd: string): string | undefined => {
  try {
    const result = Bun.spawnSync({
      cmd: ['git', '-C', cwd, 'rev-parse', '--show-toplevel'],
      env: process.env,
      stderr: 'ignore',
      stdout: 'pipe',
    });
    if (!result.success) {
      return undefined;
    }
    const root = Buffer.from(result.stdout).toString('utf8').trim();
    return root === '' ? undefined : resolve(root);
  } catch {
    return undefined;
  }
};

const resolveNonGitCollectionBoundary = async (
  cwd: string
): Promise<string> => {
  let current = cwd;
  let nearestConfigRoot: string | undefined;
  while (true) {
    if (findTrailsConfigPaths(current).length > 0) {
      nearestConfigRoot ??= current;
      const identity = await readTrailsProjectIdentity({
        boundaryDir: current,
        startDir: current,
      });
      if (identity.workspace !== undefined) {
        return identity.rootDir;
      }
    }
    if (existsSync(join(current, '.git'))) {
      return nearestConfigRoot ?? current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return (
    nearestConfigRoot ?? resolveTrailsProjectRoot({ startDir: cwd }).rootDir
  );
};

const configuredApp = (
  app: ResolvedTrailsWorkspaceApp,
  moduleOverride?: string | undefined
): OperatorProjectApp => {
  let moduleSource: OperatorModuleSource = 'module';
  if (moduleOverride === undefined) {
    moduleSource = app.entrySource === 'explicit' ? 'config' : 'convention';
  }
  return {
    configured: true,
    id: app.id,
    lockPath: join(app.rootDir, trailsLockFileName),
    modulePath: moduleOverride ?? app.entry,
    moduleSource,
    root: app.root,
    rootDir: app.rootDir,
  };
};

const standaloneApp = (
  projectRoot: string,
  moduleOverride: string | undefined
): OperatorProjectApp => ({
  configured: false,
  lockPath: join(projectRoot, trailsLockFileName),
  modulePath: moduleOverride ?? trailsAppEntryRelativePath,
  moduleSource: moduleOverride === undefined ? 'convention' : 'module',
  root: '.',
  rootDir: projectRoot,
});

const unknownAppError = (
  requestedAppId: string,
  configuredAppIds: readonly string[],
  projectRoot: string
): ValidationError =>
  projectContextError(
    configuredAppIds.length === 0
      ? `App "${requestedAppId}" is not configured. This project has no workspace.apps catalog; omit --app or add the app to workspace.apps.`
      : `Unknown app "${requestedAppId}". Configured apps: ${configuredAppIds.join(', ')}. Use --app <id> with one of those IDs.`,
    'unknown-app',
    { configuredAppIds, projectRoot, requestedAppId }
  );

const configuredSelection = (
  input: OperatorProjectContextInput,
  cwd: string,
  boundaryDir: string,
  identity: ReadTrailsProjectIdentityResult,
  explicitRoot: boolean
): OperatorProjectContext => {
  const configuredAppIds = identity.apps.map((app) => app.id);
  if (input.app !== undefined) {
    const selected = identity.apps.find((app) => app.id === input.app);
    if (selected === undefined) {
      throw unknownAppError(input.app, configuredAppIds, identity.rootDir);
    }
    return {
      app: configuredApp(selected, input.module),
      boundaryDir,
      identity,
      projectRoot: identity.rootDir,
      selectedExtent: 'configured-app',
      selectionProvenance: 'app',
    };
  }

  const canonicalBoundary = canonicalPath(boundaryDir);
  const canonicalCwd = canonicalPath(cwd);
  const selectedByCwd =
    canonicalCwd !== canonicalBoundary &&
    isInside(canonicalBoundary, canonicalCwd);
  const selectionPoint = selectedByCwd ? cwd : boundaryDir;
  let selectionProvenance: OperatorSelectionProvenance = explicitRoot
    ? 'root-dir'
    : 'cwd';
  if (selectedByCwd) {
    selectionProvenance = 'cwd';
  }
  if (canonicalPath(selectionPoint) === canonicalPath(identity.rootDir)) {
    if (input.module !== undefined) {
      throw projectContextError(
        '--module cannot select one app from a workspace extent. Add --app <id> before refining its module.',
        'invalid-binding',
        {
          configuredAppIds,
          module: input.module,
          projectRoot: identity.rootDir,
        }
      );
    }
    return {
      apps: identity.apps.map((app) => configuredApp(app)),
      boundaryDir,
      identity,
      projectRoot: identity.rootDir,
      selectedExtent: 'workspace',
      selectionProvenance,
    };
  }

  const containingApps = identity.apps.filter((app) =>
    isInside(canonicalPath(app.rootDir), canonicalPath(selectionPoint))
  );
  if (containingApps.length !== 1) {
    throw projectContextError(
      containingApps.length === 0
        ? `Current directory ${selectionPoint} is inside workspace ${identity.rootDir} but not inside a configured app root. Run from the workspace root for workspace extent or pass --app <id>.`
        : `Current directory ${selectionPoint} is inside overlapping configured app roots: ${containingApps.map((app) => app.id).join(', ')}. Make workspace.apps roots non-overlapping.`,
      containingApps.length === 0 ? 'outside-project' : 'invalid-binding',
      {
        configuredAppIds,
        cwd: selectionPoint,
        matchingAppIds: containingApps.map((app) => app.id),
        projectRoot: identity.rootDir,
      }
    );
  }

  return {
    app: configuredApp(
      containingApps[0] as ResolvedTrailsWorkspaceApp,
      input.module
    ),
    boundaryDir,
    identity,
    projectRoot: identity.rootDir,
    selectedExtent: 'configured-app',
    selectionProvenance,
  };
};

const resolveStandaloneRoot = (
  startDir: string,
  boundaryDir: string,
  explicitRoot: boolean
): TrailsProjectRootResolution =>
  resolveTrailsProjectRoot({
    boundaryDir,
    ...(explicitRoot ? { explicitRootDir: boundaryDir } : {}),
    startDir,
  });

export const resolveOperatorProjectContext = async (
  input: OperatorProjectContextInput,
  runtime: OperatorProjectContextRuntime
): Promise<Result<OperatorProjectContext, Error>> => {
  try {
    const explicitRoot = input.rootDir !== undefined;
    const invocationCwd = resolve(runtime.cwd ?? process.cwd());
    const cwd = explicitRoot ? invocationCwd : canonicalPath(invocationCwd);
    const boundaryDir = explicitRoot
      ? resolve(cwd, input.rootDir)
      : (readGitWorkingTreeBoundary(cwd) ??
        (await resolveNonGitCollectionBoundary(cwd)));
    if (!existsSync(boundaryDir)) {
      throw projectContextError(
        `Project root ${boundaryDir} does not exist.`,
        'outside-project',
        { boundaryDir, cwd }
      );
    }
    const startDir = explicitRoot ? boundaryDir : cwd;
    const identity = await readTrailsProjectIdentity({
      boundaryDir,
      startDir,
    });
    if (identity.workspace !== undefined) {
      return Result.ok(
        configuredSelection(input, cwd, boundaryDir, identity, explicitRoot)
      );
    }
    if (input.app !== undefined) {
      throw unknownAppError(input.app, [], identity.rootDir);
    }

    const root = resolveStandaloneRoot(startDir, boundaryDir, explicitRoot);
    return Result.ok({
      app: standaloneApp(root.rootDir, input.module),
      boundaryDir,
      identity: { ...identity, rootDir: root.rootDir },
      projectRoot: root.rootDir,
      selectedExtent: 'standalone-app',
      selectionProvenance: explicitRoot ? 'root-dir' : 'cwd',
    });
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? error
        : new ValidationError('Unable to resolve Trails project context.', {
            context: { detail: String(error) },
          })
    );
  }
};

export const compileNeedsAppError = (
  context: OperatorWorkspaceProjectContext
): ValidationError => {
  const configuredAppIds = context.apps.map((app) => app.id as string);
  return projectContextError(
    `Workspace compile requires one app and never fans out. Choose: ${configuredAppIds.map((id) => `--app ${id}`).join(', ')}.`,
    'compile-needs-app',
    { configuredAppIds, projectRoot: context.projectRoot }
  );
};

export const assertConfiguredAppBinding = (
  context: OperatorAppProjectContext,
  actualAppId: string
): Result<void, ValidationError> => {
  const expectedAppId = context.app.id;
  if (expectedAppId === undefined || expectedAppId === actualAppId) {
    return Result.ok();
  }
  return Result.err(
    projectContextError(
      `Configured app "${expectedAppId}" loaded topo "${actualAppId}". Align workspace.apps, the app topo name, and ${context.app.modulePath}.`,
      'invalid-binding',
      {
        actualAppId,
        expectedAppId,
        modulePath: context.app.modulePath,
        projectRoot: context.projectRoot,
      }
    )
  );
};

export const assertObservableProjectApps = async (
  context: OperatorProjectContext
): Promise<Result<void, ValidationError>> => {
  if (context.identity.workspace === undefined) {
    return Result.ok();
  }
  const selectedAppIds =
    context.selectedExtent === 'workspace'
      ? context.apps.map((app) => app.id as string)
      : [context.app.id as string];
  let view: Awaited<ReturnType<typeof deriveWorkspaceView>>;
  try {
    view = await deriveWorkspaceView({
      identity: context.identity,
      selectedAppIds,
    });
  } catch (error) {
    return Result.err(
      projectContextError(
        `Unable to observe configured app collection boundaries: ${error instanceof Error ? error.message : String(error)}.`,
        'invalid-binding',
        {
          appIds: selectedAppIds,
          detail: error instanceof Error ? error.message : String(error),
          projectRoot: context.projectRoot,
        }
      )
    );
  }
  const unavailable = view.evidence.apps.filter(
    (app) => selectedAppIds.includes(app.id) && app.status === 'unavailable'
  );
  if (unavailable.length === 0) {
    return Result.ok();
  }
  return Result.err(
    projectContextError(
      `Configured app collection boundary is unavailable: ${unavailable.map((app) => `${app.id} (${app.detail ?? app.status})`).join(', ')}.`,
      'invalid-binding',
      {
        appIds: selectedAppIds,
        collectionSkips: view.evidence.collectionSkips,
        projectRoot: context.projectRoot,
        unavailable,
      }
    )
  );
};
