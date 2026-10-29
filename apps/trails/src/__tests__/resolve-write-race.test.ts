import { afterEach, expect, spyOn, test } from 'bun:test';
import fs, {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictError } from '@ontrails/core';

import { resolveProjectLocks } from '../trails/resolve.js';
import {
  closeResolvedLock,
  openResolvedLock,
  writeResolvedLock,
} from '../trails/resolve-write.js';
import { compile, trailSource, writeStandaloneApp } from './resolve-fixture.js';

const directories: string[] = [];
const temporaryDirectory = (): string => {
  const path = realpathSync(
    mkdtempSync(join(tmpdir(), 'trails-resolve-write-race-'))
  );
  directories.push(path);
  return path;
};

afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

test('a swap after the last pathname check still cannot redirect a descriptor write', () => {
  const root = temporaryDirectory();
  const path = join(root, 'trails.lock');
  const outside = join(temporaryDirectory(), 'outside.txt');
  const original = '{"before":true}\n';
  const next = '{"after":true}\n';
  const outsideBytes = 'Outside sentinel\n';
  writeFileSync(path, original);
  writeFileSync(outside, outsideBytes);
  const opened = openResolvedLock(path);
  expect(opened.isOk()).toBe(true);
  if (opened.isErr()) {
    throw opened.error;
  }
  const originalWrite = fs.writeSync;
  let swapped = false;
  const writeSpy = spyOn(fs, 'writeSync').mockImplementation((...args) => {
    if (args[0] === opened.value.descriptor && !swapped) {
      unlinkSync(path);
      symlinkSync(outside, path);
      swapped = true;
    }
    return Reflect.apply(originalWrite, fs, args);
  });
  try {
    const result = writeResolvedLock(opened.value, original, next);
    expect(swapped).toBe(true);
    expect(readFileSync(outside, 'utf8')).toBe(outsideBytes);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConflictError);
    }
  } finally {
    writeSpy.mockRestore();
    expect(closeResolvedLock(opened.value).isOk()).toBe(true);
  }
});

test('a symlink swap after the final byte read cannot redirect the lock write', async () => {
  const root = temporaryDirectory();
  const outside = join(temporaryDirectory(), 'outside.txt');
  const previousState = process.env.TRAILS_STATE_HOME;
  process.env.TRAILS_STATE_HOME = temporaryDirectory();
  let readSpy: ReturnType<typeof spyOn> | undefined;
  try {
    writeStandaloneApp(root);
    await compile(root);
    const lockPath = join(root, 'trails.lock');
    const outsideBytes = 'Outside evidence must remain untouched.\n';
    writeFileSync(outside, outsideBytes);
    writeFileSync(
      join(root, 'alpha.ts'),
      trailSource('alpha', 'resolved description')
    );
    const originalFile = Bun.file.bind(Bun);
    let lockReads = 0;
    let swapped = false;
    readSpy = spyOn(Bun, 'file').mockImplementation((path, options) => {
      const file = originalFile(path, options);
      if (path !== lockPath) {
        return file;
      }
      return new Proxy(file, {
        get(target, key) {
          if (key === 'text') {
            return async () => {
              const bytes = await target.text();
              lockReads += 1;
              // Evidence was read first. Swap immediately after the final
              // pre-write byte snapshot, so a separate path check is stale.
              if (lockReads === 2) {
                unlinkSync(lockPath);
                symlinkSync(outside, lockPath);
                swapped = true;
              }
              return bytes;
            };
          }
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
    const result = await resolveProjectLocks(
      { module: './app.ts', rootDir: root },
      root
    );
    expect(swapped).toBe(true);
    expect(readFileSync(outside, 'utf8')).toBe(outsideBytes);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConflictError);
    }
  } finally {
    readSpy?.mockRestore();
    if (previousState === undefined) {
      delete process.env.TRAILS_STATE_HOME;
    } else {
      process.env.TRAILS_STATE_HOME = previousState;
    }
  }
});
