import { describe, expect, test } from 'bun:test';

import { collectProjectExportedSymbolDefinitions } from '../project-context.js';
import { duplicateExportedSymbol } from '../rules/duplicate-exported-symbol.js';
import type {
  ProjectContext,
  WardenExportedSymbolDefinition,
} from '../rules/types.js';
import type { WardenPublicWorkspace } from '../workspaces.js';

const coreRoot = '/repo/packages/core';
const storeRoot = '/repo/packages/store';

const coreWorkspace: WardenPublicWorkspace = {
  exportTargets: {
    '@ontrails/core': `${coreRoot}/src/index.ts`,
  },
  hasExports: true,
  name: '@ontrails/core',
  packageJsonPath: `${coreRoot}/package.json`,
  rootDir: coreRoot,
};

const storeWorkspace: WardenPublicWorkspace = {
  exportTargets: {
    '@ontrails/store': `${storeRoot}/src/index.ts`,
  },
  hasExports: true,
  name: '@ontrails/store',
  packageJsonPath: `${storeRoot}/package.json`,
  rootDir: storeRoot,
};

const publicWorkspaces = new Map([
  [coreWorkspace.name, coreWorkspace],
  [storeWorkspace.name, storeWorkspace],
]);

const definition = (
  overrides: Partial<WardenExportedSymbolDefinition>
): WardenExportedSymbolDefinition => ({
  filePath: `${coreRoot}/src/index.ts`,
  kind: 'function',
  line: 1,
  name: 'createClient',
  workspaceName: coreWorkspace.name,
  workspaceRoot: coreRoot,
  ...overrides,
});

describe('duplicate-exported-symbol', () => {
  test('collects public export target definitions and named re-exports', () => {
    const definitions = collectProjectExportedSymbolDefinitions({
      publicWorkspaces,
      rootDir: '/repo',
      sourceFiles: [
        {
          filePath: `${coreRoot}/src/index.ts`,
          kind: 'typescript',
          sourceCode: `
export function createClient() {}
export class TrailClient {}
export enum TrailClientState {
  Ready = 'ready',
}
export interface TrailClientOptions {}
export type TrailClientInput = {};
export const trailClientVersion = '1';
export { publicHelper } from './helpers.js';
`,
        },
        {
          filePath: `${coreRoot}/src/helpers.ts`,
          kind: 'typescript',
          sourceCode: `
export function publicHelper() {}
export function internalOnly() {}
`,
        },
      ],
    });

    expect([...definitions.keys()].toSorted()).toEqual([
      'TrailClient',
      'TrailClientInput',
      'TrailClientOptions',
      'TrailClientState',
      'createClient',
      'publicHelper',
      'trailClientVersion',
    ]);
    expect(definitions.get('internalOnly')).toBeUndefined();
    expect(definitions.get('createClient')?.[0]).toEqual(
      expect.objectContaining({
        kind: 'function',
        line: 2,
        name: 'createClient',
        workspaceName: '@ontrails/core',
      })
    );
    expect(definitions.get('publicHelper')?.[0]).toEqual(
      expect.objectContaining({
        kind: 'export',
        name: 'publicHelper',
        workspaceName: '@ontrails/core',
      })
    );
    expect(definitions.get('TrailClientState')?.[0]).toEqual(
      expect.objectContaining({
        kind: 'enum',
        name: 'TrailClientState',
        workspaceName: '@ontrails/core',
      })
    );
  });

  test('ignores internal source files that are not public export targets', () => {
    const definitions = collectProjectExportedSymbolDefinitions({
      publicWorkspaces,
      rootDir: '/repo',
      sourceFiles: [
        {
          filePath: `${coreRoot}/src/internal.ts`,
          kind: 'typescript',
          sourceCode: `export function createClient() {}`,
        },
      ],
    });

    expect(definitions.size).toBe(0);
  });

  test('ignores files outside public workspaces', () => {
    const definitions = collectProjectExportedSymbolDefinitions({
      publicWorkspaces,
      rootDir: '/repo',
      sourceFiles: [
        {
          filePath: '/repo/apps/trails/src/index.ts',
          kind: 'typescript',
          sourceCode: `export function createClient() {}`,
        },
      ],
    });

    expect(definitions.size).toBe(0);
  });

  test('warns for duplicate exported definitions across first-party packages', () => {
    const context: ProjectContext = {
      exportedSymbolDefinitionsByName: new Map([
        [
          'createClient',
          [
            definition({}),
            definition({
              filePath: `${storeRoot}/src/index.ts`,
              line: 3,
              workspaceName: storeWorkspace.name,
              workspaceRoot: storeRoot,
            }),
          ],
        ],
      ]),
      knownTrailIds: new Set(),
    };

    const diagnostics = duplicateExportedSymbol.checkWithContext(
      'export function createClient() {}',
      `${coreRoot}/src/index.ts`,
      context
    );

    expect(diagnostics).toEqual([
      {
        filePath: `${coreRoot}/src/index.ts`,
        line: 1,
        message:
          'Exported symbol "createClient" is defined by @ontrails/core and also by @ontrails/store (/repo/packages/store/src/index.ts:3). Keep one package as the owner, rename one side, or document a deliberate ownership mirror before exporting both symbols.',
        rule: 'duplicate-exported-symbol',
        severity: 'warn',
      },
    ]);
  });

  test('stays quiet when duplicates stay inside one package', () => {
    const context: ProjectContext = {
      exportedSymbolDefinitionsByName: new Map([
        [
          'createClient',
          [
            definition({}),
            definition({
              filePath: `${coreRoot}/src/client.ts`,
              line: 4,
            }),
          ],
        ],
      ]),
      knownTrailIds: new Set(),
    };

    const diagnostics = duplicateExportedSymbol.checkWithContext(
      'export function createClient() {}',
      `${coreRoot}/src/index.ts`,
      context
    );

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet for documented peer surface entry points', () => {
    const context: ProjectContext = {
      exportedSymbolDefinitionsByName: new Map([
        [
          'surface',
          [
            definition({
              name: 'surface',
              workspaceName: '@ontrails/http',
            }),
            definition({
              filePath: '/repo/packages/mcp/src/surface.ts',
              name: 'surface',
              workspaceName: '@ontrails/mcp',
              workspaceRoot: '/repo/packages/mcp',
            }),
          ],
        ],
      ]),
      knownTrailIds: new Set(),
    };

    const diagnostics = duplicateExportedSymbol.checkWithContext(
      'export const surface = async () => {}',
      `${coreRoot}/src/index.ts`,
      context
    );

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet for documented compatibility mirrors', () => {
    const context: ProjectContext = {
      exportedSymbolDefinitionsByName: new Map([
        [
          'TraceRecord',
          [
            definition({
              filePath: `${coreRoot}/src/index.ts`,
              name: 'TraceRecord',
              workspaceName: '@ontrails/core',
            }),
            definition({
              filePath: '/repo/packages/observability/src/index.ts',
              name: 'TraceRecord',
              workspaceName: '@ontrails/observability',
              workspaceRoot: '/repo/packages/observability',
            }),
          ],
        ],
      ]),
      knownTrailIds: new Set(),
    };

    const diagnostics = duplicateExportedSymbol.checkWithContext(
      'export type { TraceRecord } from "@ontrails/core";',
      `${coreRoot}/src/index.ts`,
      context
    );

    expect(diagnostics).toEqual([]);
  });

  test('still warns for unlisted duplicates in a documented mirror package pair', () => {
    const context: ProjectContext = {
      exportedSymbolDefinitionsByName: new Map([
        [
          'UndocumentedMirror',
          [
            definition({
              name: 'UndocumentedMirror',
              workspaceName: '@ontrails/core',
            }),
            definition({
              filePath: '/repo/packages/library/src/index.ts',
              name: 'UndocumentedMirror',
              workspaceName: '@ontrails/library',
              workspaceRoot: '/repo/packages/library',
            }),
          ],
        ],
      ]),
      knownTrailIds: new Set(),
    };

    const diagnostics = duplicateExportedSymbol.checkWithContext(
      'export type { UndocumentedMirror } from "@ontrails/core";',
      `${coreRoot}/src/index.ts`,
      context
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('UndocumentedMirror');
  });
});
