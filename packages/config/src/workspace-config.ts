import { existsSync, statSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
} from 'node:path';

import { NotFoundError, ValidationError } from '@ontrails/core';

import {
  trailsAppEntryRelativePath,
  trailsLocalConfigFileCandidates,
} from './trails-conventions.js';
import { canonicalBoundaryPath, isWithinBoundary } from './path-boundary.js';
import {
  collectConfigBoundariesThroughPaths,
  collectConfigPathsWithinBoundary,
  combineConfigPaths,
  findConfigPathsThroughBoundary,
} from './workspace-config-collection.js';
import {
  parseTrailsProjectConfigFile,
  staticIdentityError,
} from './workspace-config-source.js';

/** One authored lock-owning app in a Trails workspace. */
export interface TrailsWorkspaceAppConfig {
  /** App-root-relative entry override. Omit to use the shared convention. */
  readonly entry?: string | undefined;
  /** Project-relative app root. */
  readonly root: string;
}

/** Static workspace identity authored outside runtime config resolution. */
export interface TrailsWorkspaceConfig {
  readonly apps: Readonly<Record<string, TrailsWorkspaceAppConfig>>;
}

/** A normalized workspace app ready for downstream project consumers. */
export interface ResolvedTrailsWorkspaceApp {
  /** Normalized app-root-relative app entry. */
  readonly entry: string;
  /** Absolute resolved app entry path. */
  readonly entryPath: string;
  /** Whether the entry was authored or supplied by convention. */
  readonly entrySource: 'convention' | 'explicit';
  /** Deterministic stable app ID from the authored map key. */
  readonly id: string;
  /** Normalized project-relative module path. */
  readonly modulePath: string;
  /** Normalized project-relative app root. */
  readonly root: string;
  /** Absolute resolved app root. */
  readonly rootDir: string;
}

/** Non-executing static identity read from the nearest authored config. */
export interface ReadTrailsProjectIdentityResult {
  readonly apps: readonly ResolvedTrailsWorkspaceApp[];
  readonly configPath?: string | undefined;
  readonly rootDir: string;
  readonly workspace?: TrailsWorkspaceConfig | undefined;
}

export interface ReadTrailsProjectIdentityOptions {
  /** Inclusive discovery ceiling supplied by the collection-boundary owner. */
  readonly boundaryDir: string;
  /** Explicit config path, resolved from `startDir`. */
  readonly configPath?: string | undefined;
  /** Directory from which authored config discovery starts. */
  readonly startDir?: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const localConfigFileNames = new Set<string>(trailsLocalConfigFileCandidates);

const compareStrings = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const normalizeProjectRelativePath = (
  value: unknown,
  label: string,
  filePath: string,
  boundaryLabel = 'project root',
  allowCurrentDirectory = false
): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw staticIdentityError(
      `${label} must be a non-empty path relative to the ${boundaryLabel} in ${filePath}.`,
      filePath,
      'invalid-path',
      { value }
    );
  }

  const portable = value.replaceAll('\\', '/');
  if (
    isAbsolute(portable) ||
    portable.startsWith('/') ||
    portable.includes('\0')
  ) {
    throw staticIdentityError(
      `${label} must stay relative to the ${boundaryLabel}; received "${value}".`,
      filePath,
      'invalid-path',
      { value }
    );
  }

  const normalized = posix.normalize(portable);
  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(normalized)) {
    throw staticIdentityError(
      `${label} must stay relative to the ${boundaryLabel}; received "${value}".`,
      filePath,
      'invalid-path',
      { value }
    );
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw staticIdentityError(
      `${label} must not escape the ${boundaryLabel}; received "${value}".`,
      filePath,
      'invalid-path',
      { value }
    );
  }
  const relativePath = normalized.replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (relativePath === '' || relativePath === '.') {
    if (allowCurrentDirectory) {
      return '.';
    }
    throw staticIdentityError(
      `${label} must name a module entry within the ${boundaryLabel}; received "${value}".`,
      filePath,
      'invalid-path',
      { value }
    );
  }
  return relativePath;
};

const normalizeWorkspace = (
  value: unknown,
  filePath: string,
  rootDir: string,
  collectionBoundaryDir: string
): Pick<ReadTrailsProjectIdentityResult, 'apps' | 'workspace'> => {
  if (!isRecord(value) || !isRecord(value['apps'])) {
    throw staticIdentityError(
      `workspace.apps must be an object keyed by stable app ID in ${filePath}.`,
      filePath,
      'invalid-shape'
    );
  }
  const workspaceFields = Object.keys(value).filter((key) => key !== 'apps');
  if (workspaceFields.length > 0) {
    throw staticIdentityError(
      `workspace contains unsupported fields: ${workspaceFields.join(', ')}. Project identity currently owns only apps.`,
      filePath,
      'invalid-shape',
      { fields: workspaceFields }
    );
  }

  const rawApps = value['apps'];
  const authoredApps = new Map<string, TrailsWorkspaceAppConfig>();
  const roots = new Map<
    string,
    { readonly id: string; readonly root: string }
  >();
  const canonicalWorkspaceRoot = canonicalBoundaryPath(rootDir);
  const apps = Object.keys(rawApps)
    .toSorted(compareStrings)
    .map((id): ResolvedTrailsWorkspaceApp => {
      if (id.trim() === '') {
        throw staticIdentityError(
          `workspace.apps contains an empty app ID in ${filePath}.`,
          filePath,
          'invalid-app'
        );
      }
      const rawApp = rawApps[id];
      if (!isRecord(rawApp)) {
        throw staticIdentityError(
          `workspace.apps.${id} must be an object with a project-relative root.`,
          filePath,
          'invalid-app',
          { appId: id }
        );
      }
      const unknownKeys = Object.keys(rawApp).filter(
        (key) => key !== 'entry' && key !== 'root'
      );
      if (unknownKeys.length > 0) {
        throw staticIdentityError(
          `workspace.apps.${id} contains unsupported fields: ${unknownKeys.join(', ')}. Use only root and the optional entry override.`,
          filePath,
          'invalid-app',
          { appId: id, fields: unknownKeys }
        );
      }

      const appRoot = normalizeProjectRelativePath(
        rawApp['root'],
        `workspace.apps.${id}.root`,
        filePath,
        'project root',
        true
      );
      const resolvedAppRoot = resolve(rootDir, appRoot);
      const canonicalAppRoot = canonicalBoundaryPath(resolvedAppRoot);
      if (!isWithinBoundary(canonicalWorkspaceRoot, canonicalAppRoot)) {
        throw staticIdentityError(
          `workspace.apps.${id}.root resolves outside the workspace trust boundary: "${appRoot}".`,
          filePath,
          'invalid-path',
          { appId: id, root: appRoot }
        );
      }
      const explicitEntry =
        rawApp['entry'] === undefined
          ? undefined
          : normalizeProjectRelativePath(
              rawApp['entry'],
              `workspace.apps.${id}.entry`,
              filePath,
              'app root'
            );
      const entry = explicitEntry ?? trailsAppEntryRelativePath;
      const modulePath = posix.join(appRoot, entry);
      const resolvedEntryPath = resolve(rootDir, modulePath);
      const canonicalEntryPath = canonicalBoundaryPath(resolvedEntryPath);
      const relevantCollectionBoundaries = collectConfigBoundariesThroughPaths(
        collectionBoundaryDir,
        [resolvedAppRoot, resolvedEntryPath]
      );
      const appCollectionEdge = relevantCollectionBoundaries.find((boundary) =>
        isWithinBoundary(boundary.canonicalPath, canonicalAppRoot)
      );
      if (appCollectionEdge !== undefined) {
        throw staticIdentityError(
          `workspace.apps.${id}.root traverses a ${appCollectionEdge.reason} collection edge at "${appCollectionEdge.path}": "${appRoot}".`,
          filePath,
          'invalid-path',
          {
            appId: id,
            boundaryPath: appCollectionEdge.path,
            boundaryReason: appCollectionEdge.reason,
            root: appRoot,
          }
        );
      }
      const existingRootOwner = roots.get(canonicalAppRoot);
      if (existingRootOwner !== undefined) {
        throw staticIdentityError(
          `workspace.apps.${id}.root resolves to "${appRoot}", which is already owned by "${existingRootOwner.id}". App roots must be unique.`,
          filePath,
          'invalid-app',
          {
            appId: id,
            conflictingAppId: existingRootOwner.id,
            root: appRoot,
          }
        );
      }
      const overlappingRootOwner = [...roots.entries()].find(
        ([canonicalRoot]) =>
          isWithinBoundary(canonicalRoot, canonicalAppRoot) ||
          isWithinBoundary(canonicalAppRoot, canonicalRoot)
      );
      if (overlappingRootOwner !== undefined) {
        const [, owner] = overlappingRootOwner;
        throw staticIdentityError(
          `workspace.apps.${id}.root resolves to "${appRoot}", which overlaps root "${owner.root}" owned by "${owner.id}". App roots must not overlap.`,
          filePath,
          'invalid-app',
          {
            appId: id,
            conflictingAppId: owner.id,
            conflictingRoot: owner.root,
            root: appRoot,
          }
        );
      }
      roots.set(canonicalAppRoot, { id, root: appRoot });
      if (!isWithinBoundary(canonicalAppRoot, canonicalEntryPath)) {
        throw staticIdentityError(
          `workspace.apps.${id}.entry resolves outside its app root trust boundary: "${entry}".`,
          filePath,
          'invalid-path',
          { appId: id, entry, root: appRoot }
        );
      }
      const entryCollectionEdge = relevantCollectionBoundaries.find(
        (boundary) =>
          isWithinBoundary(boundary.canonicalPath, canonicalEntryPath)
      );
      if (entryCollectionEdge !== undefined) {
        throw staticIdentityError(
          `workspace.apps.${id}.entry traverses a ${entryCollectionEdge.reason} collection edge at "${entryCollectionEdge.path}": "${entry}".`,
          filePath,
          'invalid-path',
          {
            appId: id,
            boundaryPath: entryCollectionEdge.path,
            boundaryReason: entryCollectionEdge.reason,
            entry,
            root: appRoot,
          }
        );
      }
      let appRootIsDirectory = false;
      try {
        appRootIsDirectory = statSync(resolvedAppRoot).isDirectory();
      } catch {
        appRootIsDirectory = false;
      }
      if (!appRootIsDirectory) {
        throw staticIdentityError(
          `workspace.apps.${id}.root must resolve to an existing directory within the workspace: "${appRoot}".`,
          filePath,
          'invalid-path',
          { appId: id, root: appRoot }
        );
      }
      authoredApps.set(id, {
        ...(explicitEntry === undefined ? {} : { entry: explicitEntry }),
        root: appRoot,
      });
      return {
        entry,
        entryPath: resolvedEntryPath,
        entrySource: explicitEntry === undefined ? 'convention' : 'explicit',
        id,
        modulePath,
        root: appRoot,
        rootDir: resolvedAppRoot,
      };
    });

  return { apps, workspace: { apps: Object.fromEntries(authoredApps) } };
};

const readIdentityAtConfigPath = async (
  configPath: string,
  resolvedBoundary: string,
  canonicalBoundary: string
): Promise<ReadTrailsProjectIdentityResult> => {
  const canonicalConfigPath = canonicalBoundaryPath(configPath);
  const canonicalConfigDirectory = dirname(canonicalConfigPath);
  if (!isWithinBoundary(canonicalBoundary, canonicalConfigDirectory)) {
    throw new ValidationError(
      `Trails config file "${configPath}" is outside discovery boundary "${resolvedBoundary}".`,
      { context: { boundaryDir: resolvedBoundary, configPath } }
    );
  }
  if (!existsSync(configPath)) {
    throw new NotFoundError(`Trails config file not found: ${configPath}`, {
      context: { path: configPath },
    });
  }
  if (
    localConfigFileNames.has(basename(configPath)) ||
    localConfigFileNames.has(basename(canonicalConfigPath))
  ) {
    throw new ValidationError(
      `Trails local config override "${configPath}" cannot establish static project identity. Local overrides are deployment input and never own workspace.apps.`,
      { context: { canonicalConfigPath, configPath } }
    );
  }
  const rootDir = resolve(
    resolvedBoundary,
    relative(canonicalBoundary, canonicalConfigDirectory)
  );
  const config = await parseTrailsProjectConfigFile(canonicalConfigPath);
  if (isRecord(config) && config['workspace'] !== undefined) {
    return {
      ...normalizeWorkspace(
        config['workspace'],
        configPath,
        rootDir,
        resolvedBoundary
      ),
      configPath,
      rootDir,
    };
  }
  return { apps: [], configPath, rootDir };
};

/**
 * Read source-static workspace identity without importing a config module.
 *
 * Discovery walks authored config markers independently of app-local lock
 * markers, so a nested app CWD still resolves the owning workspace config.
 */
export const readTrailsProjectIdentity = async (
  options: ReadTrailsProjectIdentityOptions
): Promise<ReadTrailsProjectIdentityResult> => {
  if (
    options === undefined ||
    typeof options.boundaryDir !== 'string' ||
    options.boundaryDir.trim() === ''
  ) {
    throw new ValidationError(
      'Static project identity requires an explicit collection boundaryDir.'
    );
  }
  const { boundaryDir, configPath, startDir = process.cwd() } = options;
  const resolvedStart = resolve(startDir);
  const resolvedBoundary = resolve(boundaryDir);
  const canonicalBoundary = canonicalBoundaryPath(resolvedBoundary);
  let selectedPaths: readonly string[];
  if (configPath === undefined) {
    selectedPaths = findConfigPathsThroughBoundary(
      resolvedStart,
      resolvedBoundary
    );
  } else {
    const explicitPath = resolve(resolvedStart, configPath);
    const canonicalExplicitDirectory = dirname(
      canonicalBoundaryPath(explicitPath)
    );
    if (!isWithinBoundary(canonicalBoundary, canonicalExplicitDirectory)) {
      throw new ValidationError(
        `Trails config file "${explicitPath}" is outside discovery boundary "${resolvedBoundary}".`,
        { context: { boundaryDir: resolvedBoundary, configPath: explicitPath } }
      );
    }
    const lexicalTargetDirectory = resolve(
      resolvedBoundary,
      relative(canonicalBoundary, canonicalExplicitDirectory)
    );
    const throughBoundary = combineConfigPaths(
      findConfigPathsThroughBoundary(lexicalTargetDirectory, resolvedBoundary),
      [explicitPath]
    );
    const canonicalExplicitPath = canonicalBoundaryPath(explicitPath);
    selectedPaths = [
      explicitPath,
      ...throughBoundary.filter(
        (path) => canonicalBoundaryPath(path) !== canonicalExplicitPath
      ),
    ];
  }
  const selectedIdentities: ReadTrailsProjectIdentityResult[] = [];
  for (const selectedPath of selectedPaths) {
    selectedIdentities.push(
      await readIdentityAtConfigPath(
        selectedPath,
        resolvedBoundary,
        canonicalBoundary
      )
    );
  }
  const selectedWorkspace = selectedIdentities.find(
    (identity) => identity.workspace !== undefined
  );
  if (selectedWorkspace !== undefined) {
    const selectedRoot = canonicalBoundaryPath(selectedWorkspace.rootDir);
    const selectedAncestors = selectedPaths.filter((selectedPath) => {
      const candidateRoot = dirname(canonicalBoundaryPath(selectedPath));
      return isWithinBoundary(candidateRoot, selectedRoot);
    });
    const relevantPaths = combineConfigPaths(
      collectConfigPathsWithinBoundary(
        selectedWorkspace.rootDir,
        selectedWorkspace.apps.map((app) => app.rootDir),
        resolvedBoundary
      ),
      selectedAncestors
    );
    const workspaceResults: ReadTrailsProjectIdentityResult[] = [];
    for (const relevantPath of relevantPaths) {
      const identity = await readIdentityAtConfigPath(
        relevantPath,
        resolvedBoundary,
        canonicalBoundary
      );
      if (identity.workspace !== undefined) {
        workspaceResults.push(identity);
      }
    }
    const selectedConfigPath = canonicalBoundaryPath(
      selectedWorkspace.configPath as string
    );
    const validatedSelectedWorkspace = workspaceResults.find(
      (result) =>
        canonicalBoundaryPath(result.configPath as string) ===
        selectedConfigPath
    );
    if (validatedSelectedWorkspace === undefined) {
      throw new ValidationError(
        `Unable to validate selected Trails workspace config "${selectedWorkspace.configPath}" inside its collection boundary.`,
        {
          context: {
            configPath: selectedWorkspace.configPath,
            rootDir: selectedWorkspace.rootDir,
          },
        }
      );
    }
    const overlappingWorkspaces = workspaceResults.filter((result) => {
      if (
        canonicalBoundaryPath(result.configPath as string) ===
        selectedConfigPath
      ) {
        return false;
      }
      const candidateRoot = canonicalBoundaryPath(result.rootDir);
      return (
        isWithinBoundary(selectedRoot, candidateRoot) ||
        isWithinBoundary(candidateRoot, selectedRoot)
      );
    });
    if (overlappingWorkspaces.length === 0) {
      return validatedSelectedWorkspace;
    }
    const conflictingWorkspaces = [
      validatedSelectedWorkspace,
      ...overlappingWorkspaces,
    ];
    const roots = conflictingWorkspaces.map((result) => result.rootDir);
    throw new ValidationError(
      `Nested Trails workspaces are not supported. Found workspace identity at: ${roots.join(', ')}. Keep one workspace.apps owner within the collection boundary.`,
      {
        context: {
          configPaths: conflictingWorkspaces.map((result) => result.configPath),
          roots,
        },
      }
    );
  }

  const [nearest] = selectedIdentities;
  if (nearest === undefined) {
    return { apps: [], rootDir: resolvedStart };
  }
  return nearest;
};
