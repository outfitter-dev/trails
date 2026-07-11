import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectProjectImportResolutions,
  collectPublicWorkspaces,
} from '../project-context.js';
import { capturedKernel } from '../rules/captured-kernel.js';
import type { ProjectContext } from '../rules/types.js';
import type { WardenProjectContextSourceFile } from '../project-context.js';

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

interface CapturedKernelFixture {
  readonly cliImporterPath: string;
  readonly coreKernelPath: string;
  readonly coreRoot: string;
  readonly rootDir: string;
  readonly storeImporterPath: string;
  readonly trailsImporterPath: string;
  readonly wardenTestImporterPath: string;
}

const createFixture = (): CapturedKernelFixture => {
  const rootDir = makeTempDir('warden-captured-kernel');
  const coreRoot = join(rootDir, 'packages', 'core');
  const storeRoot = join(rootDir, 'packages', 'store');
  const cliRoot = join(rootDir, 'packages', 'cli');
  const trailsRoot = join(rootDir, 'apps', 'trails');
  const wardenRoot = join(rootDir, 'packages', 'warden');
  const topographerRoot = join(rootDir, 'packages', 'topographer');
  const coreKernelPath = join(coreRoot, 'src', 'kernel.ts');
  const storeImporterPath = join(storeRoot, 'src', 'store.ts');
  const cliImporterPath = join(cliRoot, 'src', 'cli.ts');
  const trailsImporterPath = join(trailsRoot, 'src', 'main.ts');
  const wardenTestImporterPath = join(
    wardenRoot,
    'src',
    '__tests__',
    'backend-support.test.ts'
  );

  for (const dir of [
    join(coreRoot, 'src', 'internal'),
    join(storeRoot, 'src'),
    join(cliRoot, 'src'),
    join(trailsRoot, 'src'),
    join(wardenRoot, 'src', '__tests__'),
    join(topographerRoot, 'src', 'internal'),
    join(rootDir, 'node_modules', '@ontrails'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  writeJson(join(rootDir, 'package.json'), {
    private: true,
    type: 'module',
    workspaces: ['packages/*', 'apps/*'],
  });
  writeJson(join(coreRoot, 'package.json'), {
    exports: {
      '.': './src/index.ts',
      './kernel': './src/kernel.ts',
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
  writeJson(join(cliRoot, 'package.json'), {
    dependencies: { '@ontrails/core': 'workspace:*' },
    exports: { '.': './src/index.ts' },
    name: '@ontrails/cli',
    type: 'module',
  });
  writeJson(join(trailsRoot, 'package.json'), {
    dependencies: { '@ontrails/topographer': 'workspace:*' },
    name: '@ontrails/trails',
    type: 'module',
  });
  writeJson(join(wardenRoot, 'package.json'), {
    dependencies: { '@ontrails/topographer': 'workspace:*' },
    exports: { '.': './src/index.ts' },
    name: '@ontrails/warden',
    type: 'module',
  });
  writeJson(join(topographerRoot, 'package.json'), {
    exports: {
      '.': './src/index.ts',
      './backend-support': './src/backend-support.ts',
    },
    name: '@ontrails/topographer',
    type: 'module',
  });

  writeSource(join(coreRoot, 'src', 'index.ts'), 'export const core = 1;\n');
  writeSource(
    join(coreRoot, 'src', 'internal', 'kernel.ts'),
    'export const kernel = 1;\n'
  );
  writeSource(
    coreKernelPath,
    "export { kernel } from './internal/kernel.js';\n"
  );
  writeSource(join(storeRoot, 'src', 'index.ts'), 'export const store = 1;\n');
  writeSource(join(cliRoot, 'src', 'index.ts'), 'export const cli = 1;\n');
  writeSource(
    join(wardenRoot, 'src', 'index.ts'),
    'export const warden = 1;\n'
  );
  writeSource(
    join(topographerRoot, 'src', 'index.ts'),
    'export const topographer = 1;\n'
  );
  writeSource(
    join(topographerRoot, 'src', 'internal', 'backend-support.ts'),
    'export const backend = 1;\n'
  );
  writeSource(
    join(topographerRoot, 'src', 'backend-support.ts'),
    "export { backend } from './internal/backend-support.js';\n"
  );

  for (const [name, target] of [
    ['core', coreRoot],
    ['store', storeRoot],
    ['cli', cliRoot],
    ['trails', trailsRoot],
    ['warden', wardenRoot],
    ['topographer', topographerRoot],
  ] as const) {
    symlinkSync(
      target,
      join(rootDir, 'node_modules', '@ontrails', name),
      'dir'
    );
  }

  return {
    cliImporterPath,
    coreKernelPath,
    coreRoot,
    rootDir,
    storeImporterPath,
    trailsImporterPath,
    wardenTestImporterPath,
  };
};

const collectContext = (
  fixture: CapturedKernelFixture,
  sourceFiles: readonly WardenProjectContextSourceFile[]
): ProjectContext => {
  const publicWorkspaces = collectPublicWorkspaces(fixture.rootDir);
  return {
    importResolutionsByFile: collectProjectImportResolutions({
      publicWorkspaces,
      rootDir: fixture.rootDir,
      sourceFiles,
    }),
    knownTrailIds: new Set<string>(),
    publicWorkspaces,
  };
};

const checkFixture = (
  fixture: CapturedKernelFixture,
  sourceFile: WardenProjectContextSourceFile,
  sourceFiles: readonly WardenProjectContextSourceFile[]
) =>
  capturedKernel.checkWithContext(
    sourceFile.sourceCode,
    sourceFile.filePath,
    collectContext(fixture, sourceFiles)
  );

const checkKernelWithProductionConsumers = (
  fixture: CapturedKernelFixture,
  kernelPath: string,
  kernelSource: string,
  consumerSource = "import { kernel } from '@ontrails/core/kernel';\n"
) => {
  const storeSource = consumerSource;
  const cliSource = consumerSource;
  writeSource(kernelPath, kernelSource);
  writeSource(fixture.storeImporterPath, storeSource);
  writeSource(fixture.cliImporterPath, cliSource);
  const kernelFile = {
    filePath: kernelPath,
    kind: 'typescript' as const,
    sourceCode: kernelSource,
  };
  return checkFixture(fixture, kernelFile, [
    kernelFile,
    {
      filePath: fixture.storeImporterPath,
      kind: 'typescript',
      sourceCode: storeSource,
    },
    {
      filePath: fixture.cliImporterPath,
      kind: 'typescript',
      sourceCode: cliSource,
    },
  ]);
};

describe('captured-kernel', () => {
  test('warns when a non-root public subpath re-exports internals consumed by two production packages', () => {
    const fixture = createFixture();
    try {
      const kernelSource = "export { kernel } from './internal/kernel.js';\n";
      const storeSource = "import { kernel } from '@ontrails/core/kernel';\n";
      const cliSource = "import { kernel } from '@ontrails/core/kernel';\n";
      writeSource(fixture.storeImporterPath, storeSource);
      writeSource(fixture.cliImporterPath, cliSource);

      const kernelFile = {
        filePath: fixture.coreKernelPath,
        kind: 'typescript' as const,
        sourceCode: kernelSource,
      };
      const diagnostics = checkFixture(fixture, kernelFile, [
        kernelFile,
        {
          filePath: fixture.storeImporterPath,
          kind: 'typescript',
          sourceCode: storeSource,
        },
        {
          filePath: fixture.cliImporterPath,
          kind: 'typescript',
          sourceCode: cliSource,
        },
      ]);

      expect(diagnostics).toEqual([
        expect.objectContaining({
          filePath: fixture.coreKernelPath,
          line: 1,
          message: expect.stringContaining(
            '@ontrails/core export target "@ontrails/core/kernel"'
          ),
          rule: 'captured-kernel',
          severity: 'warn',
        }),
      ]);
      expect(diagnostics[0]?.message).toContain('@ontrails/cli');
      expect(diagnostics[0]?.message).toContain('@ontrails/store');
      expect(diagnostics[0]?.message).not.toContain('mismatch');
      expect(diagnostics[0]?.guidance?.steps?.join('\n')).toContain(
        '@ontrails/source'
      );
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('warns when an internal import is re-exported through a local binding', () => {
    const fixture = createFixture();
    try {
      const diagnostics = checkKernelWithProductionConsumers(
        fixture,
        fixture.coreKernelPath,
        [
          "import { kernel as captured } from './internal/kernel.js';",
          'export { captured as kernel };',
          '',
        ].join('\n')
      );

      expect(diagnostics).toEqual([
        expect.objectContaining({
          line: 2,
          message: expect.stringContaining(
            'internal target "./internal/kernel.js"'
          ),
          rule: 'captured-kernel',
        }),
      ]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('warns when a default internal import is re-exported as default', () => {
    const fixture = createFixture();
    try {
      const diagnostics = checkKernelWithProductionConsumers(
        fixture,
        fixture.coreKernelPath,
        [
          "import kernel from './internal/kernel.js';",
          'export default kernel;',
          '',
        ].join('\n'),
        "import kernel from '@ontrails/core/kernel';\n"
      );

      expect(diagnostics).toEqual([
        expect.objectContaining({
          line: 2,
          message: expect.stringContaining(
            'internal target "./internal/kernel.js"'
          ),
          rule: 'captured-kernel',
        }),
      ]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('does not connect erased type imports to local value exports', () => {
    const fixture = createFixture();
    try {
      expect(
        checkKernelWithProductionConsumers(
          fixture,
          fixture.coreKernelPath,
          [
            "import type { kernel } from './internal/kernel.js';",
            'const kernel = 1;',
            'export { kernel };',
            '',
          ].join('\n')
        )
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('honors an ignore pragma on the local export line', () => {
    const fixture = createFixture();
    try {
      expect(
        checkKernelWithProductionConsumers(
          fixture,
          fixture.coreKernelPath,
          [
            "import { kernel } from './internal/kernel.js';",
            '// warden-ignore-next-line',
            'export { kernel };',
            '',
          ].join('\n')
        )
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('deduplicates several exported bindings from one internal import', () => {
    const fixture = createFixture();
    try {
      const diagnostics = checkKernelWithProductionConsumers(
        fixture,
        fixture.coreKernelPath,
        [
          "import { helper, kernel } from './internal/kernel.js';",
          'export { helper, kernel };',
          '',
        ].join('\n')
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        line: 2,
        rule: 'captured-kernel',
      });
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('does not treat an internal import as captured until it is exported', () => {
    const fixture = createFixture();
    try {
      expect(
        checkKernelWithProductionConsumers(
          fixture,
          fixture.coreKernelPath,
          [
            "import { kernel } from './internal/kernel.js';",
            'export const wrapper = () => kernel;',
            '',
          ].join('\n')
        )
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('trusts resolver-proven internal targets below an intermediate directory', () => {
    const fixture = createFixture();
    try {
      const targetPath = join(
        fixture.coreRoot,
        'src',
        'foo',
        'internal',
        'kernel.ts'
      );
      mkdirSync(join(fixture.coreRoot, 'src', 'foo', 'internal'), {
        recursive: true,
      });
      writeSource(targetPath, 'export const kernel = 1;\n');

      expect(
        checkKernelWithProductionConsumers(
          fixture,
          fixture.coreKernelPath,
          "export { kernel } from './foo/internal/kernel.js';\n"
        )
      ).toHaveLength(1);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('trusts resolver-proven internal targets reached through deeper relative paths', () => {
    const fixture = createFixture();
    try {
      const nestedKernelPath = join(
        fixture.coreRoot,
        'src',
        'nested',
        'public',
        'kernel.ts'
      );
      mkdirSync(join(fixture.coreRoot, 'src', 'nested', 'public'), {
        recursive: true,
      });
      writeJson(join(fixture.coreRoot, 'package.json'), {
        exports: {
          '.': './src/index.ts',
          './kernel': './src/nested/public/kernel.ts',
        },
        name: '@ontrails/core',
        type: 'module',
      });

      expect(
        checkKernelWithProductionConsumers(
          fixture,
          nestedKernelPath,
          "export { kernel } from '../../internal/kernel.js';\n"
        )
      ).toHaveLength(1);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('does not claim resolver-proven internals owned by another package', () => {
    const fixture = createFixture();
    try {
      expect(
        checkKernelWithProductionConsumers(
          fixture,
          fixture.coreKernelPath,
          "export { backend } from '../../topographer/src/internal/backend-support.js';\n"
        )
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('deduplicates repeated imports from the same external package', () => {
    const fixture = createFixture();
    try {
      const storeOtherPath = join(
        fixture.coreRoot,
        '..',
        'store',
        'src',
        'other.ts'
      );
      const kernelSource = "export { kernel } from './internal/kernel.js';\n";
      const storeSource = "import { kernel } from '@ontrails/core/kernel';\n";
      const cliSource = "import { kernel } from '@ontrails/core/kernel';\n";
      writeSource(fixture.storeImporterPath, storeSource);
      writeSource(storeOtherPath, storeSource);
      writeSource(fixture.cliImporterPath, cliSource);

      const kernelFile = {
        filePath: fixture.coreKernelPath,
        kind: 'typescript' as const,
        sourceCode: kernelSource,
      };
      const diagnostics = checkFixture(fixture, kernelFile, [
        kernelFile,
        {
          filePath: fixture.storeImporterPath,
          kind: 'typescript',
          sourceCode: storeSource,
        },
        {
          filePath: storeOtherPath,
          kind: 'typescript',
          sourceCode: storeSource,
        },
        {
          filePath: fixture.cliImporterPath,
          kind: 'typescript',
          sourceCode: cliSource,
        },
      ]);

      const message = diagnostics[0]?.message ?? '';
      expect(diagnostics).toHaveLength(1);
      expect(message.match(/@ontrails\/store/g) ?? []).toHaveLength(1);
      expect(message.match(/@ontrails\/cli/g) ?? []).toHaveLength(1);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('does not warn for root export targets', () => {
    const fixture = createFixture();
    try {
      const rootIndexPath = join(fixture.coreRoot, 'src', 'index.ts');
      const rootSource = "export { kernel } from './internal/kernel.js';\n";
      const storeSource = "import { core } from '@ontrails/core';\n";
      const cliSource = "import { core } from '@ontrails/core';\n";
      writeJson(join(fixture.coreRoot, 'package.json'), {
        exports: {
          '.': './src/index.ts',
          './kernel': './src/kernel.ts',
        },
        name: '@ontrails/core',
        type: 'module',
      });
      writeSource(rootIndexPath, rootSource);
      writeSource(fixture.storeImporterPath, storeSource);
      writeSource(fixture.cliImporterPath, cliSource);

      const rootFile = {
        filePath: rootIndexPath,
        kind: 'typescript' as const,
        sourceCode: rootSource,
      };

      expect(
        checkFixture(fixture, rootFile, [
          rootFile,
          {
            filePath: fixture.storeImporterPath,
            kind: 'typescript',
            sourceCode: storeSource,
          },
          {
            filePath: fixture.cliImporterPath,
            kind: 'typescript',
            sourceCode: cliSource,
          },
        ])
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('does not warn when the public subpath re-exports non-internal code', () => {
    const fixture = createFixture();
    try {
      const publicKernelPath = join(
        fixture.coreRoot,
        'src',
        'public-kernel.ts'
      );
      const kernelSource = "export { kernel } from './public-kernel.js';\n";
      const publicKernelSource = 'export const kernel = 1;\n';
      const storeSource = "import { kernel } from '@ontrails/core/kernel';\n";
      const cliSource = "import { kernel } from '@ontrails/core/kernel';\n";
      writeSource(fixture.coreKernelPath, kernelSource);
      writeSource(publicKernelPath, publicKernelSource);
      writeSource(fixture.storeImporterPath, storeSource);
      writeSource(fixture.cliImporterPath, cliSource);

      const kernelFile = {
        filePath: fixture.coreKernelPath,
        kind: 'typescript' as const,
        sourceCode: kernelSource,
      };

      expect(
        checkFixture(fixture, kernelFile, [
          kernelFile,
          {
            filePath: publicKernelPath,
            kind: 'typescript',
            sourceCode: publicKernelSource,
          },
          {
            filePath: fixture.storeImporterPath,
            kind: 'typescript',
            sourceCode: storeSource,
          },
          {
            filePath: fixture.cliImporterPath,
            kind: 'typescript',
            sourceCode: cliSource,
          },
        ])
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('requires two distinct external production consumer packages', () => {
    const fixture = createFixture();
    try {
      const kernelSource = "export { kernel } from './internal/kernel.js';\n";
      const storeSource = "import { kernel } from '@ontrails/core/kernel';\n";
      const testSource = "import { kernel } from '@ontrails/core/kernel';\n";
      writeSource(fixture.storeImporterPath, storeSource);
      writeSource(fixture.wardenTestImporterPath, testSource);

      const kernelFile = {
        filePath: fixture.coreKernelPath,
        kind: 'typescript' as const,
        sourceCode: kernelSource,
      };

      expect(
        checkFixture(fixture, kernelFile, [
          kernelFile,
          {
            filePath: fixture.storeImporterPath,
            kind: 'typescript',
            sourceCode: storeSource,
          },
          {
            filePath: fixture.wardenTestImporterPath,
            kind: 'typescript',
            sourceCode: testSource,
          },
        ])
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('excludes same-package consumers and non-production evidence paths', () => {
    const fixture = createFixture();
    try {
      const coreLocalPath = join(fixture.coreRoot, 'src', 'local.ts');
      const nonProductionImporters = [
        {
          label: 'test',
          path: join(
            fixture.rootDir,
            'packages',
            'warden',
            'src',
            '__tests__',
            'captured-kernel-consumer.test.ts'
          ),
        },
        {
          label: 'fixture',
          path: join(
            fixture.rootDir,
            'packages',
            'warden',
            'src',
            '__fixtures__',
            'captured-kernel-consumer.ts'
          ),
        },
        {
          label: 'migration',
          path: join(
            fixture.rootDir,
            'packages',
            'warden',
            'src',
            'migrations',
            'captured-kernel-consumer.ts'
          ),
        },
        {
          label: 'historical',
          path: join(
            fixture.rootDir,
            'packages',
            'warden',
            'src',
            'historical',
            'captured-kernel-consumer.ts'
          ),
        },
        {
          label: 'changeset',
          path: join(fixture.rootDir, '.changeset', 'captured-kernel.ts'),
        },
      ] as const;
      mkdirSync(join(fixture.rootDir, '.changeset'), { recursive: true });
      mkdirSync(
        join(fixture.rootDir, 'packages', 'warden', 'src', '__fixtures__'),
        { recursive: true }
      );
      mkdirSync(
        join(fixture.rootDir, 'packages', 'warden', 'src', 'migrations'),
        { recursive: true }
      );
      mkdirSync(
        join(fixture.rootDir, 'packages', 'warden', 'src', 'historical'),
        { recursive: true }
      );
      const kernelSource = "export { kernel } from './internal/kernel.js';\n";
      const storeSource = "import { kernel } from '@ontrails/core/kernel';\n";
      const coreLocalSource =
        "import { kernel } from '@ontrails/core/kernel';\n";
      const nonProductionSource =
        "import { kernel } from '@ontrails/core/kernel';\n";
      writeSource(fixture.storeImporterPath, storeSource);
      writeSource(coreLocalPath, coreLocalSource);
      for (const importer of nonProductionImporters) {
        expect(importer.label).toMatch(
          /^(?:test|fixture|migration|historical|changeset)$/
        );
        writeSource(importer.path, nonProductionSource);
      }

      const kernelFile = {
        filePath: fixture.coreKernelPath,
        kind: 'typescript' as const,
        sourceCode: kernelSource,
      };

      expect(
        checkFixture(fixture, kernelFile, [
          kernelFile,
          {
            filePath: fixture.storeImporterPath,
            kind: 'typescript',
            sourceCode: storeSource,
          },
          {
            filePath: coreLocalPath,
            kind: 'typescript',
            sourceCode: coreLocalSource,
          },
          ...nonProductionImporters.map((importer) => ({
            filePath: importer.path,
            kind: 'typescript' as const,
            sourceCode: nonProductionSource,
          })),
        ])
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('excludes test, fixture, migration, and historical consumers from the threshold', () => {
    const fixture = createFixture();
    try {
      const cliFixturePath = join(
        fixture.rootDir,
        'packages',
        'cli',
        'fixtures',
        'kernel.ts'
      );
      const trailsMigrationPath = join(
        fixture.rootDir,
        'apps',
        'trails',
        'migrations',
        'kernel.ts'
      );
      const wardenHistoricalPath = join(
        fixture.rootDir,
        'packages',
        'warden',
        'historical',
        'kernel.ts'
      );
      mkdirSync(join(fixture.rootDir, 'packages', 'cli', 'fixtures'), {
        recursive: true,
      });
      mkdirSync(join(fixture.rootDir, 'apps', 'trails', 'migrations'), {
        recursive: true,
      });
      mkdirSync(join(fixture.rootDir, 'packages', 'warden', 'historical'), {
        recursive: true,
      });

      const kernelSource = "export { kernel } from './internal/kernel.js';\n";
      const storeSource = "import { kernel } from '@ontrails/core/kernel';\n";
      const excludedSource =
        "import { kernel } from '@ontrails/core/kernel';\n";
      writeSource(fixture.storeImporterPath, storeSource);
      writeSource(fixture.wardenTestImporterPath, excludedSource);
      writeSource(cliFixturePath, excludedSource);
      writeSource(trailsMigrationPath, excludedSource);
      writeSource(wardenHistoricalPath, excludedSource);

      const kernelFile = {
        filePath: fixture.coreKernelPath,
        kind: 'typescript' as const,
        sourceCode: kernelSource,
      };

      expect(
        checkFixture(fixture, kernelFile, [
          kernelFile,
          {
            filePath: fixture.storeImporterPath,
            kind: 'typescript',
            sourceCode: storeSource,
          },
          {
            filePath: fixture.wardenTestImporterPath,
            kind: 'typescript',
            sourceCode: excludedSource,
          },
          {
            filePath: cliFixturePath,
            kind: 'typescript',
            sourceCode: excludedSource,
          },
          {
            filePath: trailsMigrationPath,
            kind: 'typescript',
            sourceCode: excludedSource,
          },
          {
            filePath: wardenHistoricalPath,
            kind: 'typescript',
            sourceCode: excludedSource,
          },
        ])
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });

  test('keeps backend-support below threshold when only apps/trails is a production consumer', () => {
    const fixture = createFixture();
    try {
      const backendPath = join(
        fixture.rootDir,
        'packages',
        'topographer',
        'src',
        'backend-support.ts'
      );
      const backendSource =
        "export { backend } from './internal/backend-support.js';\n";
      const trailsSource =
        "import { backend } from '@ontrails/topographer/backend-support';\n";
      const wardenTestSource =
        "import { backend } from '@ontrails/topographer/backend-support';\n";
      writeSource(fixture.trailsImporterPath, trailsSource);
      writeSource(fixture.wardenTestImporterPath, wardenTestSource);

      const backendFile = {
        filePath: backendPath,
        kind: 'typescript' as const,
        sourceCode: backendSource,
      };

      expect(
        checkFixture(fixture, backendFile, [
          backendFile,
          {
            filePath: fixture.trailsImporterPath,
            kind: 'typescript',
            sourceCode: trailsSource,
          },
          {
            filePath: fixture.wardenTestImporterPath,
            kind: 'typescript',
            sourceCode: wardenTestSource,
          },
        ])
      ).toEqual([]);
    } finally {
      rmSync(fixture.rootDir, { force: true, recursive: true });
    }
  });
});
