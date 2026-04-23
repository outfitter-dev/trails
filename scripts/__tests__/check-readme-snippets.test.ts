import { describe, expect, test } from 'bun:test';

import { parseImportedBindings } from '../check-readme-snippets.ts';

describe('parseImportedBindings', () => {
  test('captures multiline named imports', () => {
    const bindings = parseImportedBindings(`import {
  createMemorySink,
  registerTraceSink,
} from '@ontrails/tracing';`);

    expect(bindings).toEqual([
      {
        moduleSpecifier: '@ontrails/tracing',
        name: 'createMemorySink',
      },
      {
        moduleSpecifier: '@ontrails/tracing',
        name: 'registerTraceSink',
      },
    ]);
  });

  test('skips type-only imports while keeping runtime bindings', () => {
    const bindings = parseImportedBindings(`import {
  type MemorySink,
  createMemorySink as makeMemorySink,
  registerTraceSink,
} from '@ontrails/tracing';
import type { Topo } from '@ontrails/core';`);

    expect(bindings).toEqual([
      {
        moduleSpecifier: '@ontrails/tracing',
        name: 'createMemorySink',
      },
      {
        moduleSpecifier: '@ontrails/tracing',
        name: 'registerTraceSink',
      },
    ]);
  });
});
