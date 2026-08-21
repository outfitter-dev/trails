import { existsSync } from 'node:fs';
import { dirname, isAbsolute, posix, resolve } from 'node:path';

import { NotFoundError, ValidationError } from '@ontrails/core';

import { trailsAppEntryRelativePath } from './trails-conventions.js';
import {
  collectConfigPathsWithinBoundary,
  combineConfigPaths,
  findConfigPathsThroughBoundary,
  isWithinBoundary,
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
  const relativePath = normalized.replace(/^\.\//u, '');
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
  rootDir: string
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
  const roots = new Map<string, string>();
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
      const existingRootOwner = roots.get(appRoot);
      if (existingRootOwner !== undefined) {
        throw staticIdentityError(
          `workspace.apps.${id}.root resolves to "${appRoot}", which is already owned by "${existingRootOwner}". App roots must be unique.`,
          filePath,
          'invalid-app',
          { appId: id, conflictingAppId: existingRootOwner, root: appRoot }
        );
      }
      roots.set(appRoot, id);
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
      authoredApps.set(id, {
        ...(explicitEntry === undefined ? {} : { entry: explicitEntry }),
        root: appRoot,
      });
      return {
        entry,
        entryPath: resolve(rootDir, modulePath),
        entrySource: explicitEntry === undefined ? 'convention' : 'explicit',
        id,
        modulePath,
        root: appRoot,
        rootDir: resolve(rootDir, appRoot),
      };
    });

  return { apps, workspace: { apps: Object.fromEntries(authoredApps) } };
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
  const selectedPaths =
    configPath === undefined
      ? findConfigPathsThroughBoundary(resolvedStart, resolvedBoundary)
      : [resolve(resolvedStart, configPath)];
  const collectedPaths = collectConfigPathsWithinBoundary(resolvedBoundary);
  const locatedPaths = combineConfigPaths(collectedPaths, selectedPaths);

  const workspaceResults: ReadTrailsProjectIdentityResult[] = [];
  for (const located of locatedPaths) {
    if (!isWithinBoundary(resolvedBoundary, dirname(located))) {
      throw new ValidationError(
        `Trails config file "${located}" is outside discovery boundary "${resolvedBoundary}".`,
        { context: { boundaryDir: resolvedBoundary, configPath: located } }
      );
    }
    if (!existsSync(located)) {
      throw new NotFoundError(`Trails config file not found: ${located}`, {
        context: { path: located },
      });
    }
    const rootDir = dirname(located);
    const config = await parseTrailsProjectConfigFile(located);
    if (isRecord(config) && config['workspace'] !== undefined) {
      workspaceResults.push({
        ...normalizeWorkspace(config['workspace'], located, rootDir),
        configPath: located,
        rootDir,
      });
    }
  }

  if (workspaceResults.length > 1) {
    const roots = workspaceResults.map((result) => result.rootDir);
    throw new ValidationError(
      `Nested Trails workspaces are not supported. Found workspace identity at: ${roots.join(', ')}. Keep one workspace.apps owner within the collection boundary.`,
      {
        context: {
          configPaths: workspaceResults.map((result) => result.configPath),
          roots,
        },
      }
    );
  }
  if (workspaceResults[0] !== undefined) {
    const selectedWorkspace = workspaceResults.find((result) =>
      selectedPaths.includes(result.configPath as string)
    );
    if (selectedWorkspace !== undefined) {
      return selectedWorkspace;
    }
  }

  const [nearest] = selectedPaths;
  if (nearest === undefined) {
    return { apps: [], rootDir: resolvedStart };
  }
  return { apps: [], configPath: nearest, rootDir: dirname(nearest) };
};
