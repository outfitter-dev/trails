import { afterEach, expect, spyOn, test } from 'bun:test';
import fs, {
  chmodSync,
  statSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictError, InternalError } from '@ontrails/core';

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
    if (!swapped) {
      expect(args[0]).not.toBe(opened.value.descriptor);
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

for (const changed of [false, true]) {
  test(`a read-only lock ${changed ? 'rejects changed recovery without modifying bytes' : 'allows byte-identical recovery'}`, async () => {
    const root = temporaryDirectory();
    const previousState = process.env.TRAILS_STATE_HOME;
    process.env.TRAILS_STATE_HOME = temporaryDirectory();
    const lockPath = join(root, 'trails.lock');
    let openSpy: ReturnType<typeof spyOn> | undefined;
    let closeSpy: ReturnType<typeof spyOn> | undefined;
    try {
      writeStandaloneApp(root);
      await compile(root);
      const original = readFileSync(lockPath, 'utf8');
      if (changed) {
        writeFileSync(
          join(root, 'alpha.ts'),
          trailSource('alpha', 'changed description')
        );
      }
      chmodSync(lockPath, 0o444);
      const descriptors = new Set<number>();
      const originalOpen = fs.openSync;
      const originalClose = fs.closeSync;
      openSpy = spyOn(fs, 'openSync').mockImplementation((...args) => {
        const descriptor = Reflect.apply(originalOpen, fs, args);
        if (args[0] === lockPath) {
          descriptors.add(descriptor);
        }
        return descriptor;
      });
      closeSpy = spyOn(fs, 'closeSync').mockImplementation((descriptor) => {
        originalClose(descriptor);
        descriptors.delete(descriptor);
      });
      const result = await resolveProjectLocks(
        { module: './app.ts', rootDir: root },
        root
      );
      expect(descriptors.size).toBe(0);
      expect(result.isOk()).toBe(!changed);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InternalError);
        expect(result.error).toMatchObject({ cause: { code: 'EACCES' } });
      }
      expect(readFileSync(lockPath, 'utf8')).toBe(original);
      expect(statSync(lockPath).mode.toString(8).endsWith('444')).toBe(true);
    } finally {
      openSpy?.mockRestore();
      closeSpy?.mockRestore();
      chmodSync(lockPath, 0o644);
      if (previousState === undefined) {
        delete process.env.TRAILS_STATE_HOME;
      } else {
        process.env.TRAILS_STATE_HOME = previousState;
      }
    }
  });
}

test('a replacement during writable open fails identity verification without writing it', () => {
  const root = temporaryDirectory();
  const path = join(root, 'trails.lock');
  const replacement = join(root, 'replacement.lock');
  const original = '{"before":true}\n';
  const replacementBytes = original;
  writeFileSync(path, original);
  writeFileSync(replacement, replacementBytes);
  const opened = openResolvedLock(path);
  expect(opened.isOk()).toBe(true);
  if (opened.isErr()) {
    throw opened.error;
  }
  const originalOpen = fs.openSync;
  let swapped = false;
  let writable: number | undefined;
  const openSpy = spyOn(fs, 'openSync').mockImplementation((...args) => {
    if (args[0] === path && !swapped) {
      renameSync(replacement, path);
      swapped = true;
    }
    writable = Reflect.apply(originalOpen, fs, args);
    return writable;
  });
  try {
    const result = writeResolvedLock(
      opened.value,
      original,
      '{"after":true}\n'
    );
    expect(swapped).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(replacementBytes);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ConflictError);
    }
    expect(writable).toBeDefined();
    if (writable === undefined) {
      throw new Error('Writable descriptor was not acquired');
    }
    const closedDescriptor = writable;
    expect(() => fs.fstatSync(closedDescriptor)).toThrow();
  } finally {
    openSpy.mockRestore();
    expect(closeResolvedLock(opened.value).isOk()).toBe(true);
  }
});
