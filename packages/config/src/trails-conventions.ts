import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const trailsConfigModuleCandidates = [
  'trails.config.ts',
  'trails.config.mts',
  'trails.config.js',
  'trails.config.mjs',
] as const;

export const trailsConfigDataCandidates = [
  'trails.config.json',
  'trails.config.jsonc',
  'trails.config.yaml',
  'trails.config.toml',
] as const;

export const trailsConfigFileCandidates = [
  ...trailsConfigModuleCandidates,
  ...trailsConfigDataCandidates,
] as const;

export const trailsLocalConfigModuleCandidates = [
  'trails.config.local.ts',
  'trails.config.local.mts',
  'trails.config.local.js',
  'trails.config.local.mjs',
] as const;

export const trailsLocalConfigDataCandidates = [
  'trails.config.local.json',
  'trails.config.local.jsonc',
  'trails.config.local.yaml',
  'trails.config.local.toml',
] as const;

export const trailsLocalConfigFileCandidates = [
  ...trailsLocalConfigModuleCandidates,
  ...trailsLocalConfigDataCandidates,
] as const;

export const trailsLockFileName = 'trails.lock' as const;

export const trailsSourceRootCandidates = ['src/trails', 'trails'] as const;

export type TrailsProjectRootMarker =
  | 'config'
  | 'explicit'
  | 'fallback'
  | 'lock'
  | 'source';

export interface TrailsProjectRootResolution {
  readonly marker: TrailsProjectRootMarker;
  readonly markerPath?: string | undefined;
  readonly rootDir: string;
}

export interface FindTrailsProjectRootOptions {
  readonly startDir?: string | undefined;
}

export interface ResolveTrailsProjectRootOptions extends FindTrailsProjectRootOptions {
  readonly explicitRootDir?: string | undefined;
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const firstExistingCandidate = (
  rootDir: string,
  candidates: readonly string[]
): string | undefined =>
  candidates.map((entry) => resolve(rootDir, entry)).find(isFile);

const existingCandidates = (
  rootDir: string,
  candidates: readonly string[]
): readonly string[] =>
  candidates.map((entry) => resolve(rootDir, entry)).filter(isFile);

export const findTrailsConfigPaths = (rootDir: string): readonly string[] =>
  existingCandidates(rootDir, trailsConfigFileCandidates);

export const findTrailsLocalConfigPaths = (
  rootDir: string
): readonly string[] =>
  existingCandidates(rootDir, trailsLocalConfigFileCandidates);

export const findTrailsConfigModulePath = ({
  configPath,
  rootDir,
}: {
  readonly configPath?: string | undefined;
  readonly rootDir: string;
}): string | undefined => {
  if (configPath !== undefined) {
    return resolve(rootDir, configPath);
  }
  return firstExistingCandidate(rootDir, trailsConfigFileCandidates);
};

export const findTrailsLocalConfigModulePath = (
  rootDir: string
): string | undefined =>
  firstExistingCandidate(rootDir, trailsLocalConfigFileCandidates);

const firstExistingSourceRoot = (rootDir: string): string | undefined =>
  trailsSourceRootCandidates
    .map((entry) => join(rootDir, entry))
    .find(isDirectory);

const findProjectRootMarkerIn = (
  rootDir: string
): Omit<TrailsProjectRootResolution, 'rootDir'> | undefined => {
  const configPath = findTrailsConfigModulePath({ rootDir });
  if (configPath !== undefined) {
    return { marker: 'config', markerPath: configPath };
  }

  const lockPath = join(rootDir, trailsLockFileName);
  if (isFile(lockPath)) {
    return { marker: 'lock', markerPath: lockPath };
  }

  return undefined;
};

const findSourceRootMarkerIn = (
  rootDir: string
): Omit<TrailsProjectRootResolution, 'rootDir'> | undefined => {
  const sourcePath = firstExistingSourceRoot(rootDir);
  if (sourcePath !== undefined) {
    return { marker: 'source', markerPath: sourcePath };
  }

  return undefined;
};

export const findTrailsProjectRoot = ({
  startDir = process.cwd(),
}: FindTrailsProjectRootOptions = {}):
  | TrailsProjectRootResolution
  | undefined => {
  let current = resolve(startDir);
  let sourceFallback: TrailsProjectRootResolution | undefined;

  while (true) {
    const marker = findProjectRootMarkerIn(current);
    if (marker !== undefined) {
      return { ...marker, rootDir: current };
    }

    const sourceMarker = findSourceRootMarkerIn(current);
    if (sourceMarker !== undefined) {
      sourceFallback = { ...sourceMarker, rootDir: current };
    }

    const parent = dirname(current);
    if (parent === current) {
      return sourceFallback;
    }
    current = parent;
  }
};

export const resolveTrailsProjectRoot = ({
  explicitRootDir,
  startDir = process.cwd(),
}: ResolveTrailsProjectRootOptions = {}): TrailsProjectRootResolution => {
  if (explicitRootDir !== undefined) {
    return {
      marker: 'explicit',
      rootDir: resolve(startDir, explicitRootDir),
    };
  }

  return (
    findTrailsProjectRoot({ startDir }) ?? {
      marker: 'fallback',
      rootDir: resolve(startDir),
    }
  );
};
