import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectImportSpecifiers,
  createWardenResolver,
  defaultWardenResolveOptions,
  packagePathNotExportedErrorFragment,
} from '../resolve.js';
import { collectProjectImportResolutions } from '../project-context.js';

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

interface WorkspaceFixture {
  readonly appRoot: string;
  readonly coreRoot: string;
  readonly importerPath: string;
  readonly rootDir: string;
}

const createWorkspaceFixture = (): WorkspaceFixture => {
  const rootDir = makeTempDir('warden-resolve-workspace');
  const appRoot = join(rootDir, 'packages', 'app');
  const coreRoot = join(rootDir, 'packages', 'core');
  const importerPath = join(appRoot, 'src', 'app.ts');
  mkdirSync(join(appRoot, 'src'), { recursive: true });
  mkdirSync(join(coreRoot, 'src', 'internal'), { recursive: true });
  mkdirSync(join(rootDir, 'node_modules', '@fixture'), { recursive: true });

  writeJson(join(rootDir, 'package.json'), {
    private: true,
    type: 'module',
    workspaces: ['packages/*'],
  });
  writeJson(join(appRoot, 'package.json'), {
    dependencies: { '@fixture/core': 'workspace:*' },
    name: '@fixture/app',
    type: 'module',
  });
  writeJson(join(coreRoot, 'package.json'), {
    exports: {
      '.': './src/index.ts',
      './public': './src/public.ts',
    },
    name: '@fixture/core',
    type: 'module',
  });
  writeSource(join(coreRoot, 'src', 'index.ts'), 'export const value = 1;\n');
  writeSource(join(coreRoot, 'src', 'public.ts'), 'export const pub = 1;\n');
  writeSource(
    join(coreRoot, 'src', 'internal', 'secret.ts'),
    'export const secret = 1;\n'
  );
  writeSource(
    importerPath,
    `
      import { value } from '@fixture/core';
      import { pub } from '@fixture/core/public';
      import { secret } from '@fixture/core/internal/secret';
    `
  );
  symlinkSync(
    coreRoot,
    join(rootDir, 'node_modules', '@fixture', 'core'),
    'dir'
  );

  return { appRoot, coreRoot, importerPath, rootDir };
};

const createPackedFixture = (): WorkspaceFixture => {
  const rootDir = makeTempDir('warden-resolve-packed');
  const appRoot = join(rootDir, 'app');
  const coreRoot = join(rootDir, 'node_modules', '@fixture', 'core');
  const importerPath = join(appRoot, 'src', 'app.ts');
  mkdirSync(join(appRoot, 'src'), { recursive: true });
  mkdirSync(join(coreRoot, 'src', 'internal'), { recursive: true });

  writeJson(join(appRoot, 'package.json'), {
    dependencies: { '@fixture/core': '1.0.0' },
    name: '@fixture/app',
    type: 'module',
  });
  writeJson(join(coreRoot, 'package.json'), {
    exports: {
      '.': './src/index.ts',
    },
    name: '@fixture/core',
    type: 'module',
  });
  writeSource(join(coreRoot, 'src', 'index.ts'), 'export const value = 1;\n');
  writeSource(
    join(coreRoot, 'src', 'internal', 'secret.ts'),
    'export const secret = 1;\n'
  );
  writeSource(
    importerPath,
    "import { secret } from '@fixture/core/internal/secret';\n"
  );

  return { appRoot, coreRoot, importerPath, rootDir };
};

describe('Warden resolver substrate', () => {
  test('collects static import and re-export specifiers with source lines', () => {
    const source = `
      import { value } from '@fixture/core';
      export { pub } from '@fixture/core/public';
      export * from '@fixture/core/extra';
      const lazy = import('@fixture/core/lazy');
      type Hidden = import('@fixture/core/internal/hidden').Hidden;
      const required = require('@fixture/core/required');
      const dynamic = import(source);
      const dynamicRequire = require(source);
    `;

    expect(collectImportSpecifiers('example.ts', source)).toEqual([
      { importSource: '@fixture/core', line: 2 },
      { importSource: '@fixture/core/public', line: 3 },
      { importSource: '@fixture/core/extra', line: 4 },
      { importSource: '@fixture/core/lazy', line: 5 },
      { importSource: '@fixture/core/internal/hidden', line: 6 },
      { importSource: '@fixture/core/required', line: 7 },
    ]);
  });

  test('resolves Bun workspace package exports to real package roots', () => {
    const fixture = createWorkspaceFixture();
    try {
      const resolver = createWardenResolver({ rootDir: fixture.rootDir });

      const root = resolver.resolveImport(
        fixture.importerPath,
        '@fixture/core',
        1
      );
      const publicSubpath = resolver.resolveImport(
        fixture.importerPath,
        '@fixture/core/public',
        2
      );

      expect(root.resolvedPath).toBe(
        realpathSync(join(fixture.coreRoot, 'src', 'index.ts'))
      );
      expect(root.packageName).toBe('@fixture/core');
      expect(root.packageRoot).toBe(realpathSync(fixture.coreRoot));
      expect(root.crossesPackageBoundary).toBe(true);
      expect(root.usesPublicExport).toBe(true);
      expect(root.isInternalTarget).toBe(false);

      expect(publicSubpath.resolvedPath).toBe(
        realpathSync(join(fixture.coreRoot, 'src', 'public.ts'))
      );
      expect(publicSubpath.usesPublicExport).toBe(true);
      expect(publicSubpath.crossesPackageBoundary).toBe(true);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('classifies package subpaths blocked by the export map', () => {
    const fixture = createWorkspaceFixture();
    try {
      const resolver = createWardenResolver({ rootDir: fixture.rootDir });

      const blocked = resolver.resolveImport(
        fixture.importerPath,
        '@fixture/core/internal/secret',
        3
      );

      expect(blocked.resolvedPath).toBeUndefined();
      expect(blocked.packageName).toBe('@fixture/core');
      expect(blocked.packageRoot).toBe(realpathSync(fixture.coreRoot));
      expect(blocked.crossesPackageBoundary).toBe(true);
      expect(blocked.usesPublicExport).toBe(false);
      expect(blocked.errorKind).toBe('package-path-not-exported');
      expect(blocked.errorMessage).toContain(
        `"./internal/secret" ${packagePathNotExportedErrorFragment} ["bun", "node", "import", "default"] from package`
      );
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('marks relative imports that compose package boundaries and target internals', () => {
    const fixture = createWorkspaceFixture();
    try {
      const resolver = createWardenResolver({ rootDir: fixture.rootDir });

      const relative = resolver.resolveImport(
        fixture.importerPath,
        '../../core/src/internal/secret.ts',
        4
      );

      expect(relative.resolvedPath).toBe(
        realpathSync(join(fixture.coreRoot, 'src', 'internal', 'secret.ts'))
      );
      expect(relative.packageName).toBe('@fixture/core');
      expect(relative.packageRoot).toBe(realpathSync(fixture.coreRoot));
      expect(relative.crossesPackageBoundary).toBe(true);
      expect(relative.usesPublicExport).toBe(false);
      expect(relative.isInternalTarget).toBe(true);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('preserves the published-package error when a packed file exists but is not exported', () => {
    const fixture = createPackedFixture();
    try {
      const resolver = createWardenResolver({ rootDir: fixture.rootDir });
      const internalPath = join(
        fixture.coreRoot,
        'src',
        'internal',
        'secret.ts'
      );

      const blocked = resolver.resolveImport(
        fixture.importerPath,
        '@fixture/core/internal/secret',
        1
      );

      expect(existsSync(internalPath)).toBe(true);
      expect(blocked.resolvedPath).toBeUndefined();
      expect(blocked.packageRoot).toBe(realpathSync(fixture.coreRoot));
      expect(blocked.errorKind).toBe('package-path-not-exported');
      expect(blocked.errorMessage).toContain(
        `"./internal/secret" ${packagePathNotExportedErrorFragment} ["bun", "node", "import", "default"] from package`
      );
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('normalizes importer paths before cache lookup and result reporting', () => {
    const fixture = createWorkspaceFixture();
    try {
      const linkedAppRoot = join(fixture.rootDir, 'linked-app');
      symlinkSync(fixture.appRoot, linkedAppRoot, 'dir');
      const linkedImporterPath = join(linkedAppRoot, 'src', 'app.ts');
      const resolver = createWardenResolver({ rootDir: fixture.rootDir });

      const viaLink = resolver.resolveImport(
        linkedImporterPath,
        '@fixture/core',
        1
      );
      const viaRealPath = resolver.resolveImport(
        fixture.importerPath,
        '@fixture/core',
        2
      );

      expect(viaLink.importerPath).toBe(realpathSync(fixture.importerPath));
      expect(viaRealPath.importerPath).toBe(viaLink.importerPath);
      expect(viaRealPath.resolvedPath).toBe(viaLink.resolvedPath);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('extends default resolver option arrays when callers add options', () => {
    const resolver = createWardenResolver({
      resolveOptions: {
        conditionNames: ['custom'],
        extensionAlias: {
          '.js': ['.custom.js'],
        },
        extensions: ['.custom'],
      },
    });

    expect(resolver.resolveOptions.conditionNames).toEqual([
      ...defaultWardenResolveOptions.conditionNames,
      'custom',
    ]);
    expect(resolver.resolveOptions.extensions).toContain('.custom');
    expect(resolver.resolveOptions.extensionAlias?.['.js']).toEqual([
      ...defaultWardenResolveOptions.extensionAlias['.js'],
      '.custom.js',
    ]);
  });

  test('collects import resolutions once into project context maps', () => {
    const fixture = createWorkspaceFixture();
    try {
      const sourceCode = readFileSync(fixture.importerPath, 'utf8');
      const resolutionsByFile = collectProjectImportResolutions({
        rootDir: fixture.rootDir,
        sourceFiles: [
          {
            filePath: fixture.importerPath,
            kind: 'typescript',
            sourceCode,
          },
        ],
      });
      const resolutions =
        resolutionsByFile.get(fixture.importerPath) ??
        (() => {
          throw new Error('missing import resolutions for fixture importer');
        })();

      expect(resolutions.map((resolution) => resolution.importSource)).toEqual([
        '@fixture/core',
        '@fixture/core/public',
        '@fixture/core/internal/secret',
      ]);
      expect(resolutions[2]?.errorKind).toBe('package-path-not-exported');
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('passes custom resolver options through project import collection', () => {
    const fixture = createWorkspaceFixture();
    try {
      const importerPath = join(fixture.appRoot, 'src', 'custom.ts');
      const targetPath = join(fixture.appRoot, 'src', 'local.custom');
      writeSource(targetPath, 'export const local = 1;\n');
      writeSource(importerPath, "import { local } from './local';\n");

      const resolutionsByFile = collectProjectImportResolutions({
        resolveOptions: { extensions: ['.custom'] },
        rootDir: fixture.rootDir,
        sourceFiles: [
          {
            filePath: importerPath,
            kind: 'typescript',
            sourceCode: readFileSync(importerPath, 'utf8'),
          },
        ],
      });
      const resolution = resolutionsByFile.get(importerPath)?.[0];

      expect(resolution?.resolvedPath).toBe(realpathSync(targetPath));
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('keys project import resolutions by normalized real paths', () => {
    const fixture = createWorkspaceFixture();
    const linkedAppRoot = join(fixture.rootDir, 'linked-app');
    try {
      symlinkSync(fixture.appRoot, linkedAppRoot, 'dir');
      const linkedImporterPath = join(linkedAppRoot, 'src', 'app.ts');
      const realImporterPath = realpathSync(linkedImporterPath);
      const sourceCode = readFileSync(linkedImporterPath, 'utf8');
      const resolutionsByFile = collectProjectImportResolutions({
        rootDir: fixture.rootDir,
        sourceFiles: [
          {
            filePath: linkedImporterPath,
            kind: 'typescript',
            sourceCode,
          },
        ],
      });

      const normalizedResolutions = resolutionsByFile.get(realImporterPath);
      expect(normalizedResolutions?.[0]?.importerPath).toBe(realImporterPath);
      expect(resolutionsByFile.get(linkedImporterPath)).toBe(
        normalizedResolutions
      );
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });
});
