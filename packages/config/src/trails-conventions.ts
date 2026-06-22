import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const trailsConfigModuleCandidates = [
  'trails.config.ts',
  'trails.config.mts',
  'trails.config.js',
  'trails.config.mjs',
] as const;

export const trailsLocalConfigModuleCandidates = [
  'trails.config.local.ts',
  'trails.config.local.mts',
  'trails.config.local.js',
  'trails.config.local.mjs',
] as const;

const firstExistingCandidate = (
  rootDir: string,
  candidates: readonly string[]
): string | undefined =>
  candidates.map((entry) => resolve(rootDir, entry)).find(existsSync);

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
  return firstExistingCandidate(rootDir, trailsConfigModuleCandidates);
};

export const findTrailsLocalConfigModulePath = (
  rootDir: string
): string | undefined =>
  firstExistingCandidate(rootDir, trailsLocalConfigModuleCandidates);
