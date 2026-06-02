import { describe, expect, test } from 'bun:test';

import {
  isTestFile,
  isWardenSourceScanTarget,
  isWardenTestScanTarget,
} from '../rules/scan.js';

describe('warden scan target helpers', () => {
  test('isTestFile only matches the plural __tests__ convention', () => {
    expect(isTestFile('src/__tests__/foo.ts')).toBe(true);
    expect(isTestFile('src/foo.test.ts')).toBe(true);
    // The absolute-path rule predicate must not treat a singular __test__
    // directory as a test convention.
    expect(isTestFile('src/__test__/foo.ts')).toBe(false);
  });

  test('isTestFile ignores a __test__ ancestor in the absolute scan root', () => {
    // runWarden may be pointed at a root whose absolute path contains __test__;
    // rule predicates receive that absolute path and must not classify every
    // source file under it as a test.
    expect(isTestFile('/tmp/__test__/repo/src/foo.ts')).toBe(false);
    expect(isWardenSourceScanTarget('src/foo.ts')).toBe(true);
  });

  test('root-relative scan helper keeps __test__ CLI compatibility', () => {
    expect(isWardenTestScanTarget('src/__test__/foo.ts')).toBe(true);
    expect(isWardenTestScanTarget('src/__tests__/foo.ts')).toBe(true);
    expect(isWardenTestScanTarget('./src/__test__/foo.ts')).toBe(true);
    expect(isWardenTestScanTarget('src/foo.ts')).toBe(false);
  });
});
