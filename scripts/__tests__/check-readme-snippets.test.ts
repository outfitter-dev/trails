import { describe, expect, test } from 'bun:test';

import {
  extractSnippets,
  listDuplicateReadmeConfigs,
  listUnexpectedReadmeConfigs,
  listUnconfiguredReadmes,
  parseImportedBindings,
  README_SNIPPET_CONFIGS,
} from '../check-readme-snippets.ts';

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

describe('extractSnippets', () => {
  test('captures TypeScript fence metadata with source lines', () => {
    const snippets = extractSnippets(`# Example

\`\`\`typescript
const value = 1;
\`\`\`

\`\`\`tsx
const element = <div />;
\`\`\`
`);

    expect(snippets).toEqual([
      {
        code: 'const value = 1;',
        extension: 'ts',
        line: 4,
      },
      {
        code: 'const element = <div />;',
        extension: 'tsx',
        line: 8,
      },
    ]);
  });

  test('reports the opening line for unclosed TypeScript fences', () => {
    expect(() =>
      extractSnippets('```typescript\nconst value = 1;', 'README.md')
    ).toThrow(
      'Unclosed TypeScript code fence in README.md (opened at line 1).'
    );
  });
});

describe('README_SNIPPET_CONFIGS', () => {
  test('classifies every package, app, and adapter README in the v1 inventory', () => {
    expect(listUnconfiguredReadmes(README_SNIPPET_CONFIGS)).toEqual([]);
    expect(listUnexpectedReadmeConfigs(README_SNIPPET_CONFIGS)).toEqual([]);
    expect(listDuplicateReadmeConfigs(README_SNIPPET_CONFIGS)).toEqual([]);
  });

  test('reports duplicate README snippet configs', () => {
    const [firstConfig] = README_SNIPPET_CONFIGS;

    expect(
      listDuplicateReadmeConfigs([
        ...README_SNIPPET_CONFIGS,
        firstConfig,
        firstConfig,
      ])
    ).toEqual([firstConfig.readmePath]);
  });
});
