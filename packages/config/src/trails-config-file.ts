import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { NotFoundError, ValidationError } from '@ontrails/core';

import {
  findTrailsConfigPaths,
  findTrailsLocalConfigPaths,
} from './trails-conventions.js';

export interface LoadedTrailsConfigValue {
  readonly configPath?: string | undefined;
  readonly value?: unknown;
}

const MODULE_EXTENSIONS = new Set(['.ts', '.mts', '.js', '.mjs']);
const DATA_EXTENSIONS = new Set(['.json', '.jsonc', '.yaml', '.toml']);

const extensionFor = (filePath: string): string | undefined => {
  for (const extension of [...MODULE_EXTENSIONS, ...DATA_EXTENSIONS]) {
    if (filePath.endsWith(extension)) {
      return extension;
    }
  }
  return undefined;
};

const isModuleExtension = (extension: string | undefined): boolean =>
  extension !== undefined && MODULE_EXTENSIONS.has(extension);

const parseDataConfig = (filePath: string, text: string): unknown => {
  const extension = extensionFor(filePath);
  try {
    switch (extension) {
      case '.json': {
        return JSON.parse(text);
      }
      case '.jsonc': {
        return Bun.JSONC.parse(text);
      }
      case '.toml': {
        return Bun.TOML.parse(text);
      }
      case '.yaml': {
        return Bun.YAML.parse(text);
      }
      default: {
        throw new ValidationError(
          `Unsupported Trails config file: ${filePath}`
        );
      }
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(
      `Failed to parse Trails config file: ${filePath}`,
      {
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { path: filePath },
      }
    );
  }
};

export const loadTrailsConfigFileValue = async (
  filePath: string
): Promise<unknown> => {
  const extension = extensionFor(filePath);
  if (isModuleExtension(extension)) {
    const url = pathToFileURL(filePath);
    url.searchParams.set('t', Date.now().toString());
    const mod = (await import(url.href)) as Record<string, unknown>;
    return mod['default'] ?? mod;
  }

  const text = await Bun.file(filePath).text();
  return parseDataConfig(filePath, text);
};

const findSingleConfigPath = (
  paths: readonly string[],
  label: string
): string | undefined => {
  if (paths.length <= 1) {
    return paths[0];
  }
  throw new ValidationError(
    `Multiple ${label} config files found: ${paths.join(', ')}. Keep one config file per project root.`
  );
};

export const loadTrailsConfigValue = async ({
  configPath,
  rootDir,
}: {
  readonly configPath?: string | undefined;
  readonly rootDir: string;
}): Promise<LoadedTrailsConfigValue> => {
  const located =
    configPath === undefined
      ? findSingleConfigPath(findTrailsConfigPaths(rootDir), 'Trails')
      : resolve(rootDir, configPath);

  if (located === undefined) {
    return {};
  }
  if (!existsSync(located)) {
    throw new NotFoundError(`Trails config file not found: ${located}`, {
      context: { path: located },
    });
  }

  return {
    configPath: located,
    value: await loadTrailsConfigFileValue(located),
  };
};

export const loadTrailsLocalConfigValue = async (
  rootDir: string
): Promise<LoadedTrailsConfigValue> => {
  const located = findSingleConfigPath(
    findTrailsLocalConfigPaths(rootDir),
    'Trails local'
  );

  return located === undefined
    ? {}
    : { configPath: located, value: await loadTrailsConfigFileValue(located) };
};
