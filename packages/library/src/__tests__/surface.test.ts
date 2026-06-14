import { describe, expect, test } from 'bun:test';

import { surface } from '../surface.js';
import type {
  LibraryClient,
  LibraryMethod,
  LibraryResultMethod,
} from '../surface.js';
import { fixtureApp } from './fixtures/app.js';

// The fixture's write trail declares a permit; the in-memory surface owns the
// runtime context, so parity runs with a permit covering the fixture's scopes.
const surfaceOptions = {
  ctx: { permit: { id: 'test-permit', scopes: ['widget:write'] } },
};

const requireMethod = (lib: LibraryClient, name: string): LibraryMethod => {
  const method = lib.call[name];
  if (!method) {
    throw new Error(`expected library export "${name}"`);
  }
  return method;
};

const requireResultMethod = (
  lib: LibraryClient,
  name: string
): LibraryResultMethod => {
  const method = lib.result[name];
  if (!method) {
    throw new Error(`expected library result export "${name}"`);
  }
  return method;
};

describe('library surface', () => {
  test('exposes one callable method per projected export', async () => {
    const lib = await surface(fixtureApp, surfaceOptions);
    expect(Object.keys(lib.call).toSorted()).toEqual([
      'widgetAdd',
      'widgetCheck',
      'widgetGet',
      'widgetGreet',
      'widgetPing',
    ]);
    expect(Object.keys(lib.result).toSorted()).toEqual(
      Object.keys(lib.call).toSorted()
    );
  });

  test('the client call maps are frozen', async () => {
    const lib = await surface(fixtureApp, surfaceOptions);
    expect(Object.isFrozen(lib.call)).toBe(true);
    expect(Object.isFrozen(lib.result)).toBe(true);
  });

  test('unwraps Result.ok to a return value', async () => {
    const lib = await surface(fixtureApp, surfaceOptions);
    expect(await requireMethod(lib, 'widgetPing')({ message: 'hi' })).toEqual({
      echo: 'hi',
    });
    expect(await requireMethod(lib, 'widgetGet')({ id: '1' })).toEqual({
      id: '1',
      name: 'Example',
    });
  });

  test('throws the typed error on Result.err (root API mapping)', async () => {
    const lib = await surface(fixtureApp, surfaceOptions);
    await expect(
      requireMethod(lib, 'widgetGet')({ id: 'missing' })
    ).rejects.toThrow('not found');
  });

  test('exposes a no-throw result lane', async () => {
    const lib = await surface(fixtureApp, surfaceOptions);

    const ok = await requireResultMethod(lib, 'widgetPing')({ message: 'hi' });
    expect(ok.isOk()).toBe(true);
    expect(ok.value).toEqual({ echo: 'hi' });

    const err = await requireResultMethod(lib, 'widgetGet')({ id: 'missing' });
    expect(err.isErr()).toBe(true);
    expect(err.error.name).toBe('NotFoundError');
  });

  test('domain-negative output is a returned value, not a throw', async () => {
    const lib = await surface(fixtureApp, surfaceOptions);
    expect(await requireMethod(lib, 'widgetCheck')({ name: '' })).toEqual({
      issues: ['name is empty'],
      status: 'fail',
    });
  });

  // `abortSignal` is a thin pass-through (surface -> kernel -> run options).
  // Abort *semantics* are core's contract, tested in core's execute suite; a
  // trivial blaze completes before any abort check, so asserting abort behavior
  // here would test core through the library rather than the forwarding itself.
  test('accepts an abort signal without breaking normal execution', async () => {
    const lib = await surface(fixtureApp, {
      ...surfaceOptions,
      abortSignal: new AbortController().signal,
    });
    expect(await requireMethod(lib, 'widgetPing')({ message: 'hi' })).toEqual({
      echo: 'hi',
    });
  });
});

describe('library surface parity with authored examples', () => {
  test('every exported method honors its trail examples', async () => {
    const lib = await surface(fixtureApp, surfaceOptions);

    expect(lib.projection.exports.length).toBeGreaterThan(0);
    let assertionsRun = 0;

    for (const entry of lib.projection.exports) {
      const trail = fixtureApp.get(entry.trailId);
      const method = requireMethod(lib, entry.exportName);
      const examples = trail?.examples ?? [];
      // Every export must carry at least one example (parity fuel).
      expect(examples.length).toBeGreaterThan(0);

      for (const example of examples) {
        if (example.error) {
          let thrown: unknown;
          try {
            await method(example.input);
          } catch (error) {
            thrown = error;
          }
          expect((thrown as Error | undefined)?.name).toBe(example.error);
          assertionsRun += 1;
          continue;
        }

        const output = await method(example.input);
        if (example.expected !== undefined) {
          expect(output).toEqual(example.expected);
          assertionsRun += 1;
          continue;
        }
        if (example.expectedMatch !== undefined) {
          expect(output).toMatchObject(
            example.expectedMatch as Record<string, unknown>
          );
          assertionsRun += 1;
          continue;
        }
        // A success example with no expectation is an under-specified example,
        // not a pass — fail loudly rather than silently.
        throw new Error(
          `example "${example.name}" on ${entry.trailId} has no expected/expectedMatch/error`
        );
      }
    }

    // The loop must have actually asserted something across all exports.
    expect(assertionsRun).toBeGreaterThan(0);
  });
});
