import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectProjectDocumentationImportResolutions,
  collectProjectImportResolutions,
  collectPublicWorkspaces,
} from '../project-context.js';
import { publicInternalDeepImports } from '../rules/public-internal-deep-imports.js';
import type { ProjectContext } from '../rules/types.js';
import type {
  WardenProjectContextSourceFile,
  WardenPublicWorkspace,
} from '../project-context.js';

const makeTempDir = (prefix: string): string => {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const writeSource = (path: string, source: string): void => {
  writeFileSync(path, source.trimStart());
};

interface PublicSurfaceFixture {
  readonly appImporterPath: string;
  readonly coreImporterPath: string;
  readonly coreRoot: string;
  readonly readmePath: string;
  readonly rootDir: string;
  readonly storeRoot: string;
  readonly trailsPackageJsonPath: string;
  readonly trailsRoot: string;
}

const createFixture = (): PublicSurfaceFixture => {
  const rootDir = makeTempDir('warden-public-surface');
  const coreRoot = join(rootDir, 'packages', 'core');
  const storeRoot = join(rootDir, 'packages', 'store');
  const commanderRoot = join(rootDir, 'adapters', 'commander');
  const trailsRoot = join(rootDir, 'apps', 'trails');
  const privateRoot = join(rootDir, 'packages', 'oxlint-plugin');
  const appImporterPath = join(storeRoot, 'src', 'app.ts');
  const coreImporterPath = join(coreRoot, 'src', 'local.ts');
  const readmePath = join(rootDir, 'packages', 'warden', 'README.md');
  const trailsPackageJsonPath = join(trailsRoot, 'package.json');

  mkdirSync(join(coreRoot, 'src', 'internal'), { recursive: true });
  mkdirSync(join(storeRoot, 'src'), { recursive: true });
  mkdirSync(join(commanderRoot, 'src'), { recursive: true });
  mkdirSync(join(trailsRoot, 'bin'), { recursive: true });
  mkdirSync(join(rootDir, 'packages', 'warden'), { recursive: true });
  mkdirSync(privateRoot, { recursive: true });
  mkdirSync(join(rootDir, 'node_modules', '@ontrails'), { recursive: true });

  writeJson(join(rootDir, 'package.json'), {
    private: true,
    type: 'module',
    workspaces: ['packages/*', 'adapters/*', 'apps/*'],
  });
  writeJson(join(coreRoot, 'package.json'), {
    exports: {
      '.': './src/index.ts',
      './trails': './src/trails.ts',
    },
    name: '@ontrails/core',
    type: 'module',
  });
  writeJson(join(storeRoot, 'package.json'), {
    dependencies: { '@ontrails/core': 'workspace:*' },
    exports: { '.': './src/index.ts' },
    name: '@ontrails/store',
    type: 'module',
  });
  writeJson(join(commanderRoot, 'package.json'), {
    exports: { '.': './src/index.ts' },
    name: '@ontrails/commander',
    type: 'module',
  });
  writeJson(trailsPackageJsonPath, {
    bin: { trails: './bin/trails.ts' },
    files: ['bin/**/*.ts', 'README.md'],
    name: '@ontrails/trails',
    type: 'module',
  });
  writeJson(join(privateRoot, 'package.json'), {
    name: '@ontrails/oxlint-plugin',
    private: true,
    type: 'module',
  });

  writeSource(join(coreRoot, 'src', 'index.ts'), 'export const value = 1;\n');
  writeSource(join(coreRoot, 'src', 'trails.ts'), 'export const trail = 1;\n');
  writeSource(
    join(coreRoot, 'src', 'internal', 'secret.ts'),
    'export const secret = 1;\n'
  );
  writeSource(join(storeRoot, 'src', 'index.ts'), 'export const store = 1;\n');
  writeSource(
    join(commanderRoot, 'src', 'index.ts'),
    'export const commander = 1;\n'
  );
  writeSource(join(trailsRoot, 'bin', 'trails.ts'), 'export {};\n');

  for (const [name, target] of [
    ['core', coreRoot],
    ['store', storeRoot],
    ['commander', commanderRoot],
    ['trails', trailsRoot],
  ] as const) {
    symlinkSync(
      target,
      join(rootDir, 'node_modules', '@ontrails', name),
      'dir'
    );
  }

  return {
    appImporterPath,
    coreImporterPath,
    coreRoot,
    readmePath,
    rootDir,
    storeRoot,
    trailsPackageJsonPath,
    trailsRoot,
  };
};

const collectContext = (
  fixture: PublicSurfaceFixture,
  sourceFiles: readonly WardenProjectContextSourceFile[],
  options: {
    readonly publicWorkspaces?: ReadonlyMap<string, WardenPublicWorkspace>;
  } = {}
): ProjectContext => ({
  documentedImportResolutionsByFile:
    collectProjectDocumentationImportResolutions({
      ...(options.publicWorkspaces
        ? { publicWorkspaces: options.publicWorkspaces }
        : {}),
      rootDir: fixture.rootDir,
      sourceFiles,
    }),
  importResolutionsByFile: collectProjectImportResolutions({
    ...(options.publicWorkspaces
      ? { publicWorkspaces: options.publicWorkspaces }
      : {}),
    rootDir: fixture.rootDir,
    sourceFiles,
  }),
  knownTrailIds: new Set<string>(),
  publicWorkspaces:
    options.publicWorkspaces ?? collectPublicWorkspaces(fixture.rootDir),
});

const checkFixture = (
  fixture: PublicSurfaceFixture,
  sourceFile: WardenProjectContextSourceFile
) =>
  publicInternalDeepImports.checkWithContext(
    sourceFile.sourceCode,
    sourceFile.filePath,
    collectContext(fixture, [sourceFile])
  );

describe('public-internal-deep-imports', () => {
  test('discovers public packages, adapters, and bin-only apps from root workspaces', () => {
    const fixture = createFixture();
    try {
      const workspaces = collectPublicWorkspaces(fixture.rootDir);

      expect([...workspaces.keys()].toSorted()).toEqual([
        '@ontrails/commander',
        '@ontrails/core',
        '@ontrails/store',
        '@ontrails/trails',
      ]);
      expect(workspaces.get('@ontrails/trails')?.hasExports).toBe(false);
      expect(workspaces.get('@ontrails/trails')?.bin).toEqual({
        trails: './bin/trails.ts',
      });
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('discovers nested conditional export targets', () => {
    const fixture = createFixture();
    try {
      writeSource(
        join(fixture.coreRoot, 'src', 'conditional.ts'),
        'export const conditional = 1;\n'
      );
      writeJson(join(fixture.coreRoot, 'package.json'), {
        exports: {
          '.': './src/index.ts',
          './conditional': { bun: { import: './src/conditional.ts' } },
        },
        name: '@ontrails/core',
        type: 'module',
      });

      const workspaces = collectPublicWorkspaces(fixture.rootDir);
      const target =
        workspaces.get('@ontrails/core')?.exportTargets?.[
          '@ontrails/core/conditional'
        ];

      expect(target?.endsWith('/src/conditional.ts')).toBe(true);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('honors scope excludes for project-derived workspace facts', () => {
    const fixture = createFixture();
    try {
      const workspaces = collectPublicWorkspaces(fixture.rootDir, {
        exclude: ['packages/core/**'],
      });
      const sourceCode =
        'Use `@ontrails/core/internal/secret` only if it is public.\\n';
      writeSource(fixture.readmePath, sourceCode);
      const sourceFile = {
        filePath: fixture.readmePath,
        kind: 'documentation' as const,
        sourceCode,
      };

      expect([...workspaces.keys()]).not.toContain('@ontrails/core');
      expect(
        publicInternalDeepImports.checkWithContext(
          sourceCode,
          fixture.readmePath,
          collectContext(fixture, [sourceFile], {
            publicWorkspaces: workspaces,
          })
        )
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('uses the unscoped local name for string-form scoped package bins', () => {
    const fixture = createFixture();
    try {
      writeJson(fixture.trailsPackageJsonPath, {
        bin: './bin/trails.ts',
        files: ['bin/**/*.ts', 'README.md'],
        name: '@ontrails/trails',
        type: 'module',
      });

      const workspaces = collectPublicWorkspaces(fixture.rootDir);

      expect(workspaces.get('@ontrails/trails')?.bin).toEqual({
        trails: './bin/trails.ts',
      });
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('uses resolver facts to allow exported code subpaths', () => {
    const fixture = createFixture();
    try {
      const sourceCode = "import { trail } from '@ontrails/core/trails';\n";
      writeSource(fixture.appImporterPath, sourceCode);

      expect(
        checkFixture(fixture, {
          filePath: fixture.appImporterPath,
          kind: 'typescript',
          sourceCode,
        })
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('flags compose-package code subpaths blocked by the export map', () => {
    const fixture = createFixture();
    try {
      const sourceCode =
        "import { secret } from '@ontrails/core/internal/secret';\n";
      writeSource(fixture.appImporterPath, sourceCode);
      const diagnostics = checkFixture(fixture, {
        filePath: fixture.appImporterPath,
        kind: 'typescript',
        sourceCode,
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain(
        '@ontrails/core/internal/secret'
      );
      expect(diagnostics[0]?.message).toContain('owner export follow-up');
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('flags type import and require subpaths blocked by the export map', () => {
    const fixture = createFixture();
    try {
      const sourceCode = `
        type Secret = import('@ontrails/core/internal/secret').Secret;
        const secret = require('@ontrails/core/internal/secret');
      `;
      writeSource(fixture.appImporterPath, sourceCode);
      const diagnostics = checkFixture(fixture, {
        filePath: fixture.appImporterPath,
        kind: 'typescript',
        sourceCode: sourceCode.trimStart(),
      });

      expect(diagnostics).toHaveLength(2);
      expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([1, 2]);
      expect(
        diagnostics.every((diagnostic) =>
          diagnostic.message.includes('@ontrails/core/internal/secret')
        )
      ).toBe(true);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('allows package-local private package imports in code', () => {
    const fixture = createFixture();
    try {
      const sourceCode =
        "import { secret } from '@ontrails/core/internal/secret';\n";
      writeSource(fixture.coreImporterPath, sourceCode);

      expect(
        checkFixture(fixture, {
          filePath: fixture.coreImporterPath,
          kind: 'typescript',
          sourceCode,
        })
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('flags documentation subpaths that are not public exports', () => {
    const fixture = createFixture();
    try {
      const sourceCode =
        'Use `@ontrails/core/internal/secret` only if it is public.\\n';
      writeSource(fixture.readmePath, sourceCode);
      const diagnostics = checkFixture(fixture, {
        filePath: fixture.readmePath,
        kind: 'documentation',
        sourceCode,
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.line).toBe(1);
      expect(diagnostics[0]?.message).toContain(
        '@ontrails/core/internal/secret'
      );
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('allows documentation ignores for intentional legacy migration examples', () => {
    const fixture = createFixture();
    try {
      const sourceCode = `
<!-- warden-ignore-next-line -->
- Before: \`import { x } from '@ontrails/core/internal/secret'\`
`;
      writeSource(fixture.readmePath, sourceCode);

      expect(
        checkFixture(fixture, {
          filePath: fixture.readmePath,
          kind: 'documentation',
          sourceCode: sourceCode.trimStart(),
        })
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('flags root barrel re-exports from package internals', () => {
    const fixture = createFixture();
    try {
      const indexPath = join(fixture.coreRoot, 'src', 'index.ts');
      const sourceCode = "export { secret } from './internal/secret.js';\n";
      writeSource(indexPath, sourceCode);
      const diagnostics = checkFixture(fixture, {
        filePath: indexPath,
        kind: 'typescript',
        sourceCode,
      });

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('root barrel re-exports');
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('uses the resolved root export target for root barrel checks', () => {
    const fixture = createFixture();
    try {
      const mainPath = join(fixture.coreRoot, 'src', 'main.ts');
      const sourceCode = "export { secret } from './internal/secret.js';\n";
      writeJson(join(fixture.coreRoot, 'package.json'), {
        exports: { '.': './src/main.ts' },
        name: '@ontrails/core',
        type: 'module',
      });
      writeSource(mainPath, sourceCode);

      const diagnostics = checkFixture(fixture, {
        filePath: mainPath,
        kind: 'typescript',
        sourceCode,
      });

      expect(diagnostics[0]?.message).toContain('root barrel re-exports');
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('allows root barrel re-export ignores for intentional package seams', () => {
    const fixture = createFixture();
    try {
      const indexPath = join(fixture.coreRoot, 'src', 'index.ts');
      const sourceCode = `
// warden-ignore-next-line
export { secret } from './internal/secret.js';
`;
      writeSource(indexPath, sourceCode);

      expect(
        checkFixture(fixture, {
          filePath: indexPath,
          kind: 'typescript',
          sourceCode: sourceCode.trimStart(),
        })
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('accepts bin-only public app packages with included bin targets', () => {
    const fixture = createFixture();
    try {
      const sourceCode = readFileSync(fixture.trailsPackageJsonPath, 'utf8');
      expect(
        checkFixture(fixture, {
          filePath: fixture.trailsPackageJsonPath,
          kind: 'text',
          sourceCode,
        })
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('accepts files lists that cover bin target directories by name', () => {
    const fixture = createFixture();
    try {
      mkdirSync(join(fixture.trailsRoot, 'bin', 'sub'), { recursive: true });
      writeSource(
        join(fixture.trailsRoot, 'bin', 'sub', 'trails.ts'),
        'export {};\n'
      );
      writeJson(fixture.trailsPackageJsonPath, {
        bin: { trails: './bin/sub/trails.ts' },
        files: ['bin', 'README.md'],
        name: '@ontrails/trails',
        type: 'module',
      });
      const sourceCode = readFileSync(fixture.trailsPackageJsonPath, 'utf8');

      expect(
        checkFixture(fixture, {
          filePath: fixture.trailsPackageJsonPath,
          kind: 'text',
          sourceCode,
        })
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('accepts files lists that cover bin targets with single-star wildcards', () => {
    const fixture = createFixture();
    try {
      writeJson(fixture.trailsPackageJsonPath, {
        bin: { trails: './bin/trails.ts' },
        files: ['bin/*.ts', 'README.md'],
        name: '@ontrails/trails',
        type: 'module',
      });
      const sourceCode = readFileSync(fixture.trailsPackageJsonPath, 'utf8');

      expect(
        checkFixture(fixture, {
          filePath: fixture.trailsPackageJsonPath,
          kind: 'text',
          sourceCode,
        })
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('accepts files lists that cover nested bin targets with deep segment wildcards', () => {
    const fixture = createFixture();
    try {
      mkdirSync(join(fixture.trailsRoot, 'bin', 'sub'), { recursive: true });
      writeSource(
        join(fixture.trailsRoot, 'bin', 'sub', 'trails.ts'),
        'export {};\n'
      );
      writeJson(fixture.trailsPackageJsonPath, {
        bin: { trails: './bin/sub/trails.ts' },
        files: ['**/*.ts', 'README.md'],
        name: '@ontrails/trails',
        type: 'module',
      });
      const sourceCode = readFileSync(fixture.trailsPackageJsonPath, 'utf8');

      expect(
        checkFixture(fixture, {
          filePath: fixture.trailsPackageJsonPath,
          kind: 'text',
          sourceCode,
        })
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('flags files lists when deep wildcard concrete filenames do not match', () => {
    const fixture = createFixture();
    try {
      mkdirSync(join(fixture.trailsRoot, 'bin', 'sub'), { recursive: true });
      writeSource(
        join(fixture.trailsRoot, 'bin', 'sub', 'entrails.ts'),
        'export {};\n'
      );
      writeJson(fixture.trailsPackageJsonPath, {
        bin: { trails: './bin/sub/entrails.ts' },
        files: ['bin/**/trails.ts', 'README.md'],
        name: '@ontrails/trails',
        type: 'module',
      });
      const sourceCode = readFileSync(fixture.trailsPackageJsonPath, 'utf8');

      expect(
        checkFixture(fixture, {
          filePath: fixture.trailsPackageJsonPath,
          kind: 'text',
          sourceCode,
        })
      ).toEqual([
        expect.objectContaining({
          message: expect.stringContaining(
            'the package files list does not include that target'
          ),
        }),
      ]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('flags files lists when negation patterns exclude bin targets', () => {
    const fixture = createFixture();
    try {
      writeSource(join(fixture.trailsRoot, 'bin', 'cli.ts'), 'export {};\n');
      writeJson(fixture.trailsPackageJsonPath, {
        bin: { trails: './bin/cli.ts' },
        files: ['**/*.ts', '!bin/cli.ts', 'README.md'],
        name: '@ontrails/trails',
        type: 'module',
      });
      const sourceCode = readFileSync(fixture.trailsPackageJsonPath, 'utf8');

      expect(
        checkFixture(fixture, {
          filePath: fixture.trailsPackageJsonPath,
          kind: 'text',
          sourceCode,
        })
      ).toEqual([
        expect.objectContaining({
          message: expect.stringContaining(
            'the package files list does not include that target'
          ),
        }),
      ]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('accepts files lists that cover nested bin targets with trailing double-star wildcards', () => {
    const fixture = createFixture();
    try {
      mkdirSync(join(fixture.trailsRoot, 'bin', 'sub'), { recursive: true });
      writeSource(
        join(fixture.trailsRoot, 'bin', 'sub', 'trails.ts'),
        'export {};\n'
      );
      writeJson(fixture.trailsPackageJsonPath, {
        bin: { trails: './bin/sub/trails.ts' },
        files: ['bin/**', 'README.md'],
        name: '@ontrails/trails',
        type: 'module',
      });
      const sourceCode = readFileSync(fixture.trailsPackageJsonPath, 'utf8');

      expect(
        checkFixture(fixture, {
          filePath: fixture.trailsPackageJsonPath,
          kind: 'text',
          sourceCode,
        })
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });
});
