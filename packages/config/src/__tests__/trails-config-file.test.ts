import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  loadTrailsConfigFileValue,
  loadTrailsConfigValue,
} from '../trails-config-file.js';

const makeTempDir = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'trails-config-file-'));

const writeFile = async (
  rootDir: string,
  relativePath: string,
  content: string
): Promise<string> => {
  const filePath = join(rootDir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, content);
  return filePath;
};

describe('Trails config file loading', () => {
  test('loads JSON config files', async () => {
    const rootDir = await makeTempDir();
    try {
      const configPath = await writeFile(
        rootDir,
        'trails.config.json',
        '{"release":{"rules":[]}}\n'
      );

      await expect(loadTrailsConfigFileValue(configPath)).resolves.toEqual({
        release: { rules: [] },
      });
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test('loads module config files', async () => {
    const rootDir = await makeTempDir();
    try {
      const configPath = await writeFile(
        rootDir,
        'trails.config.ts',
        'export default { release: { rules: [] } };\n'
      );

      await expect(loadTrailsConfigFileValue(configPath)).resolves.toEqual({
        release: { rules: [] },
      });
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test('rejects multiple sibling Trails config files', async () => {
    const rootDir = await makeTempDir();
    try {
      await writeFile(rootDir, 'trails.config.ts', 'export default {};\n');
      await writeFile(rootDir, 'trails.config.json', '{}\n');

      await expect(loadTrailsConfigValue({ rootDir })).rejects.toThrow(
        'Multiple Trails config files found'
      );
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });
});
