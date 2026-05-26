import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectProjectImportResolutions } from '../project-context.js';
import { resolvedImportBoundary } from '../rules/resolved-import-boundary.js';
import type { ProjectContext } from '../rules/types.js';

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

interface BoundaryFixture {
  readonly appImporterPath: string;
  readonly appRoot: string;
  readonly coreRoot: string;
  readonly rootDir: string;
}

const createBoundaryFixture = (sourceCode: string): BoundaryFixture => {
  const rootDir = makeTempDir('warden-resolved-boundary');
  const appRoot = join(rootDir, 'packages', 'app');
  const coreRoot = join(rootDir, 'packages', 'core');
  const appImporterPath = join(appRoot, 'src', 'app.ts');
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
  writeSource(appImporterPath, sourceCode);
  symlinkSync(
    coreRoot,
    join(rootDir, 'node_modules', '@fixture', 'core'),
    'dir'
  );

  return { appImporterPath, appRoot, coreRoot, rootDir };
};

const collectContext = (
  fixture: BoundaryFixture,
  sourceCode: string,
  filePath = fixture.appImporterPath
): ProjectContext => {
  const normalizedSourceCode = sourceCode.trimStart();
  return {
    importResolutionsByFile: collectProjectImportResolutions({
      rootDir: fixture.rootDir,
      sourceFiles: [
        {
          filePath,
          kind: 'typescript',
          sourceCode: normalizedSourceCode,
        },
      ],
    }),
    knownTrailIds: new Set<string>(),
  };
};

const checkFixture = (
  sourceCode: string,
  options: { readonly filePath?: string } = {}
) => {
  const fixture = createBoundaryFixture(sourceCode);
  try {
    const filePath = options.filePath ?? fixture.appImporterPath;
    const context = collectContext(fixture, sourceCode, filePath);
    return resolvedImportBoundary.checkWithContext(
      sourceCode.trimStart(),
      filePath,
      context
    );
  } finally {
    rmSync(fixture.rootDir, { force: true, recursive: true });
  }
};

describe('resolved-import-boundary', () => {
  test('stays quiet without resolver-backed project context', () => {
    const diagnostics = resolvedImportBoundary.checkWithContext(
      "import { secret } from '@fixture/core/internal/secret';\n",
      'packages/app/src/app.ts',
      { knownTrailIds: new Set<string>() }
    );

    expect(diagnostics).toEqual([]);
  });

  test('allows exported package roots and subpaths', () => {
    const diagnostics = checkFixture(`
      import { value } from '@fixture/core';
      import { pub } from '@fixture/core/public';
    `);

    expect(diagnostics).toEqual([]);
  });

  test('flags package subpaths blocked by the target export map', () => {
    const diagnostics = checkFixture(`
      import { secret } from '@fixture/core/internal/secret';
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      line: 1,
      message:
        'Import "@fixture/core/internal/secret" is not exported by @fixture/core. Import the package root or an exported subpath instead.',
      rule: 'resolved-import-boundary',
      severity: 'error',
    });
  });

  test('flags unrecognized failed compose-boundary bare specifiers', () => {
    const filePath = 'packages/app/src/app.ts';
    const diagnostics = resolvedImportBoundary.checkWithContext(
      "import { value } from '@fixture/core/unknown';\n",
      filePath,
      {
        importResolutionsByFile: new Map([
          [
            filePath,
            [
              {
                crossesPackageBoundary: true,
                errorKind: 'other',
                importSource: '@fixture/core/unknown',
                importerPath: filePath,
                isInternalTarget: false,
                line: 1,
                packageName: '@fixture/core',
                usesPublicExport: false,
              },
            ],
          ],
        ]),
        knownTrailIds: new Set<string>(),
      }
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message:
          'Import "@fixture/core/unknown" is not exported by @fixture/core. Import the package root or an exported subpath instead.',
      }),
    ]);
  });

  test('flags relative imports composing into another package', () => {
    const diagnostics = checkFixture(`
      import { pub } from '../../core/src/public';
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toBe(
      'Local import "../../core/src/public" composes into @fixture/core. Import the target package public surface instead.'
    );
  });

  test('labels absolute compose-package paths as local imports', () => {
    const fixture = createBoundaryFixture('');
    const absolutePublicPath = join(fixture.coreRoot, 'src', 'public.ts');
    const sourceCode = `import { pub } from '${absolutePublicPath}';\n`;
    writeSource(fixture.appImporterPath, sourceCode);

    try {
      const context = collectContext(fixture, sourceCode);
      const diagnostics = resolvedImportBoundary.checkWithContext(
        sourceCode,
        fixture.appImporterPath,
        context
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toBe(
        `Local import "${absolutePublicPath}" composes into @fixture/core. Import the target package public surface instead.`
      );
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('flags compose-package imports into internal or private targets', () => {
    const diagnostics = checkFixture(`
      import { secret } from '../../core/src/internal/secret';
    `);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toBe(
      'Import "../../core/src/internal/secret" targets internal/private files in @fixture/core. Import the target package public surface instead.'
    );
  });

  test('allows same-package relative imports into local internals', () => {
    const sourceCode = `
      import { helper } from './internal/helper';
    `;
    const fixture = createBoundaryFixture(sourceCode);
    const helperPath = join(fixture.appRoot, 'src', 'internal', 'helper.ts');
    mkdirSync(join(fixture.appRoot, 'src', 'internal'), { recursive: true });
    writeSource(helperPath, 'export const helper = 1;\n');

    try {
      const context = collectContext(fixture, sourceCode);
      const diagnostics = resolvedImportBoundary.checkWithContext(
        sourceCode.trimStart(),
        fixture.appImporterPath,
        context
      );

      expect(diagnostics).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('allows test, fixture, and migration files as explicit local exceptions', () => {
    const sourceCode = `
      import { pub } from '../../core/src/public';
    `;
    const fixture = createBoundaryFixture(sourceCode);
    const exceptionFiles = [
      join(fixture.appRoot, 'src', 'app.test.ts'),
      join(fixture.appRoot, 'fixtures', 'fixture.ts'),
      join(fixture.appRoot, 'migrations', 'one.ts'),
    ];

    try {
      for (const filePath of exceptionFiles) {
        const context = collectContext(fixture, sourceCode, filePath);
        const diagnostics = resolvedImportBoundary.checkWithContext(
          sourceCode.trimStart(),
          filePath,
          context
        );
        expect(diagnostics).toEqual([]);
      }
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('supports warden-ignore-next-line for intentional package seams', () => {
    const diagnostics = checkFixture(`
      // warden-ignore-next-line
      import { pub } from '../../core/src/public';
    `);

    expect(diagnostics).toEqual([]);
  });

  test('uses the real package root when reporting workspace symlink imports', () => {
    const sourceCode = `
      import { pub } from '../../core/src/public';
    `;
    const fixture = createBoundaryFixture(sourceCode);

    try {
      const context = collectContext(fixture, sourceCode);
      const [resolution] =
        context.importResolutionsByFile?.get(fixture.appImporterPath) ?? [];
      expect(resolution?.packageRoot).toBe(realpathSync(fixture.coreRoot));
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });
});
