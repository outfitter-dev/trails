import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import { checkAdapters } from '../check.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

const expectedAdapters = [
  {
    conformancePath:
      'adapters/cloudflare/src/workers/__tests__/conformance.test.ts',
    key: '@ontrails/cloudflare',
    ownerPackage: '@ontrails/http',
    packageName: '@ontrails/cloudflare',
    placement: 'extracted',
    target: 'http',
    targetKey: '@ontrails/http:http',
    testingImport: '@ontrails/http/testing',
  },
  {
    conformancePath: 'adapters/cloudflare/src/d1/__tests__/d1.test.ts',
    key: '@ontrails/cloudflare/d1',
    ownerPackage: '@ontrails/store',
    packageName: '@ontrails/cloudflare/d1',
    placement: 'extracted',
    target: 'store',
    targetKey: '@ontrails/store:store',
    testingImport: '@ontrails/store/testing',
  },
  {
    conformancePath: 'adapters/drizzle/src/__tests__/drizzle.test.ts',
    key: '@ontrails/drizzle',
    ownerPackage: '@ontrails/store',
    packageName: '@ontrails/drizzle',
    placement: 'extracted',
    target: 'store',
    targetKey: '@ontrails/store:store',
    testingImport: '@ontrails/store/testing',
  },
  {
    conformancePath: 'adapters/hono/src/__tests__/conformance.test.ts',
    key: '@ontrails/hono',
    ownerPackage: '@ontrails/http',
    packageName: '@ontrails/hono',
    placement: 'extracted',
    target: 'http',
    targetKey: '@ontrails/http:http',
    testingImport: '@ontrails/http/testing',
  },
  {
    conformancePath: 'packages/http/src/bun.conformance.test.ts',
    key: '@ontrails/http/bun',
    ownerPackage: '@ontrails/http',
    packageName: '@ontrails/http/bun',
    placement: 'subpath',
    target: 'http',
    targetKey: '@ontrails/http:http',
    testingImport: '@ontrails/http/testing',
  },
  {
    conformancePath: 'packages/store/src/jsonfile/conformance.test.ts',
    key: '@ontrails/store/jsonfile',
    ownerPackage: '@ontrails/store',
    packageName: '@ontrails/store/jsonfile',
    placement: 'subpath',
    target: 'store',
    targetKey: '@ontrails/store:store',
    testingImport: '@ontrails/store/testing',
  },
] as const;

describe('first-party adapter dogfood', () => {
  test('verified first-party adapters declare and prove owner targets', () => {
    const report = checkAdapters(repoRoot);

    expect(report.targets.map((target) => target.key)).toEqual([
      '@ontrails/http:http',
      '@ontrails/store:store',
    ]);

    for (const expected of expectedAdapters) {
      const subject = report.subjects.find(
        (candidate) => candidate.packageName === expected.packageName
      );

      expect(subject).toMatchObject({
        key: expected.key,
        ownerPackage: expected.ownerPackage,
        placement: expected.placement,
        target: expected.target,
        targetKey: expected.targetKey,
        testingImport: expected.testingImport,
      });
      expect(subject?.conformanceTestPaths).toEqual([
        expect.stringContaining(expected.conformancePath),
      ]);

      expect(report.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: `${expected.packageName}:${expected.target}:configured`,
            kind: 'configured',
            packageName: expected.packageName,
            target: expected.target,
            targetKey: expected.targetKey,
          }),
          expect.objectContaining({
            key: `${expected.packageName}:${expected.target}:used`,
            kind: 'used',
            packageName: expected.packageName,
            provenance: expect.objectContaining({
              paths: [expect.stringContaining(expected.conformancePath)],
              source: 'conformance-test',
            }),
            target: expected.target,
            targetKey: expected.targetKey,
          }),
        ])
      );
    }

    expect(report.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: '@ontrails/http:http:available',
          kind: 'available',
          ownerPackage: '@ontrails/http',
          target: 'http',
          targetKey: '@ontrails/http:http',
        }),
        expect.objectContaining({
          key: '@ontrails/store:store:available',
          kind: 'available',
          ownerPackage: '@ontrails/store',
          target: 'store',
          targetKey: '@ontrails/store:store',
        }),
      ])
    );
    expect(report.facts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'observed' })])
    );
    expect(report.diagnostics).toEqual([]);
  });
});
