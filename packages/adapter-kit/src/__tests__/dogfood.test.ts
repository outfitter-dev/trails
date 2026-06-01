import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import { checkAdapters } from '../check.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

describe('first-party adapter dogfood', () => {
  test('@ontrails/hono declares and proves the HTTP adapter target', () => {
    const report = checkAdapters(repoRoot);
    const hono = report.subjects.find(
      (subject) => subject.packageName === '@ontrails/hono'
    );

    expect(hono).toMatchObject({
      key: '@ontrails/hono',
      ownerPackage: '@ontrails/http',
      placement: 'extracted',
      target: 'http',
      targetKey: '@ontrails/http:http',
      testingImport: '@ontrails/http/testing',
    });
    expect(hono?.conformanceTestPaths).toEqual([
      expect.stringContaining(
        'adapters/hono/src/__tests__/conformance.test.ts'
      ),
    ]);
    expect(report.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: '@ontrails/hono',
        }),
      ])
    );
  });
});
