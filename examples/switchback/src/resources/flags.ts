import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import { Result, resource } from '@ontrails/core';
import { z } from 'zod';

import { fixtureFlags } from '../fixtures.js';
import { flagSchema } from '../model.js';
import type { Flag } from '../model.js';

/**
 * Flag definition source. Deliberately not a database: the real store is a
 * JSON file (`switchback.flags.json`) reloaded on every read, so external
 * edits to the file are picked up by the next evaluation.
 */
export interface FlagStore {
  /** All flag definitions, including archived ones. */
  list(): Promise<readonly Flag[]>;
  /** One flag by key, or undefined when no definition exists. */
  get(key: string): Promise<Flag | undefined>;
  /** Insert or replace a flag definition by key. */
  put(flag: Flag): Promise<void>;
}

const flagFileSchema = z.array(flagSchema);

const sortByKey = (flags: readonly Flag[]): Flag[] =>
  [...flags].toSorted((a, b) => a.key.localeCompare(b.key));

/** File-backed store: reads the JSON file on every access, writes on `put`. */
export const createFileFlagStore = (filePath: string): FlagStore => {
  const load = async (): Promise<Flag[]> => {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    return flagFileSchema.parse(JSON.parse(raw));
  };
  const save = async (flags: readonly Flag[]): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify(sortByKey(flags), null, 2)}\n`,
      'utf8'
    );
  };
  return {
    get: async (key) => {
      const flags = await load();
      return flags.find((flag) => flag.key === key);
    },
    list: () => load(),
    put: async (flag) => {
      const existing = await load();
      const flags = existing.filter((entry) => entry.key !== flag.key);
      flags.push(flag);
      await save(flags);
    },
  };
};

/** In-memory store used by the mock factory and isolated tests. */
export const createMemoryFlagStore = (
  seed: readonly Flag[] = fixtureFlags()
): FlagStore => {
  const flags = new Map(
    structuredClone([...seed]).map((flag) => [flag.key, flag])
  );
  return {
    get: (key) => Promise.resolve(flags.get(key)),
    list: () => Promise.resolve(sortByKey([...flags.values()])),
    put: (flag) => {
      flags.set(flag.key, structuredClone(flag));
      return Promise.resolve();
    },
  };
};

/** Default flag definition file, relative to the process working directory. */
export const FLAGS_FILE = 'switchback.flags.json';

const resolveFlagsPath = (
  cwd: string,
  configured: string | undefined
): string => {
  if (configured === undefined) {
    return join(cwd, FLAGS_FILE);
  }
  return isAbsolute(configured) ? configured : join(cwd, configured);
};

export const flagsResource = resource('flags', {
  create: (resourceCtx) => {
    const cwd = resourceCtx.cwd ?? process.cwd();
    const configured = resourceCtx.env?.['SWITCHBACK_FLAGS_PATH'];
    return Result.ok(createFileFlagStore(resolveFlagsPath(cwd, configured)));
  },
  description:
    'File-backed flag definition source (switchback.flags.json), reloaded on every read. Deliberately not a database.',
  mock: () => createMemoryFlagStore(),
});
