import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import {
  __matchesExportPatternForTest,
  publicInternalDeepImports,
} from '../rules/public-internal-deep-imports.js';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const workspaceFile = (...segments: readonly string[]) =>
  resolve(WORKSPACE_ROOT, ...segments);

const STORE_FILE = workspaceFile('packages/store/src/example.ts');
const CORE_FILE = workspaceFile('packages/core/src/example.ts');
const APP_FILE = workspaceFile('apps/trails/src/example.ts');

const check = (sourceCode: string, filePath = STORE_FILE) =>
  publicInternalDeepImports.check(sourceCode, filePath);

describe('public-internal-deep-imports', () => {
  test('wildcard exports match exactly one subpath segment', () => {
    const extensionPattern = {
      prefix: '@ontrails/example/',
      suffix: '.js',
    };
    const suffixlessPattern = {
      prefix: '@ontrails/example/',
      suffix: '',
    };

    expect(
      __matchesExportPatternForTest(
        '@ontrails/example/feature.js',
        extensionPattern
      )
    ).toBe(true);
    expect(
      __matchesExportPatternForTest(
        '@ontrails/example/feature/nested.js',
        extensionPattern
      )
    ).toBe(false);
    expect(
      __matchesExportPatternForTest(
        '@ontrails/example/feature',
        suffixlessPattern
      )
    ).toBe(true);
    expect(
      __matchesExportPatternForTest(
        '@ontrails/example/feature/nested',
        suffixlessPattern
      )
    ).toBe(false);
    expect(
      __matchesExportPatternForTest('@ontrails/example/', suffixlessPattern)
    ).toBe(false);
  });

  test('allows package roots and exported package subpaths', () => {
    const diagnostics = check(`
import { trail } from '@ontrails/core';
import { deriveTrail } from '@ontrails/core/trails';
import { createJwtConnector } from '@ontrails/permits/jwt';
import { parse } from '@ontrails/warden/ast';
`);

    expect(diagnostics).toEqual([]);
  });

  test('allows package-local private imports', () => {
    const diagnostics = check(
      "import { hidden } from '@ontrails/core/src/internal/hidden';\n",
      CORE_FILE
    );

    expect(diagnostics).toEqual([]);
  });

  test('flags cross-package imports into src internals', () => {
    const diagnostics = check(
      "import { hidden } from '@ontrails/core/src/internal/hidden';\n"
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      'cross-package import "@ontrails/core/src/internal/hidden" is not exported'
    );
    expect(diagnostics[0]?.message).toContain('owner export follow-up');
  });

  test('flags cross-package imports into non-exported internal subpaths', () => {
    const diagnostics = check(
      "import { openWriteTrailsDb } from '@ontrails/core/internal/trails-db';\n"
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      '@ontrails/core/internal/trails-db'
    );
  });

  test('checks publishable app workspaces from the root workspace map', () => {
    const diagnostics = check(
      "import { hidden } from '@ontrails/trails/src/internal/hidden';\n"
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('@ontrails/trails');
  });

  test('allows local private imports inside publishable app workspaces', () => {
    const diagnostics = check(
      "import { hidden } from '@ontrails/trails/src/internal/hidden';\n",
      APP_FILE
    );

    expect(diagnostics).toEqual([]);
  });

  test('flags non-exported children below public subpaths', () => {
    const diagnostics = check(
      "import { deriveTrail } from '@ontrails/core/trails/derive-trail';\n"
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('checks export-from declarations and dynamic imports', () => {
    const diagnostics = check(`
export { hidden } from '@ontrails/core/src/internal/hidden';
const hidden = await import('@ontrails/permits/src/internal/hidden');
type Hidden = import('@ontrails/tracing/src/internal/hidden').Hidden;
`);

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([2, 3, 4]);
  });

  test('ignores relative imports and unknown external @ontrails packages', () => {
    const diagnostics = check(
      "import { helper } from './internal/helper.js';\nimport { x } from '@ontrails/with-example/internal/x';\n",
      APP_FILE
    );

    expect(diagnostics).toEqual([]);
  });
});
