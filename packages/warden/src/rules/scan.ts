const TEST_FILE_PATTERN =
  /(?:^|\/)__tests__(?:\/|$)|(?:\.test|\.spec)\.[cm]?[jt]sx?$/;

// The CLI scan-target contract also recognizes a singular `__test__` directory.
// That compatibility stays scoped to the root-relative scan helpers: it must not
// reach the absolute-path `isTestFile` rule predicate, where an ancestor
// directory named `__test__` would otherwise misclassify every source file.
const SCAN_TARGET_TEST_FILE_PATTERN =
  /(?:^|\/)__tests?__(?:\/|$)|(?:\.test|\.spec)\.[cm]?[jt]sx?$/;

const FRAMEWORK_INTERNAL_SEGMENTS = [
  '/packages/testing/',
  '/packages/warden/',
] as const;

const normalizeFilePath = (filePath: string): string =>
  filePath.replaceAll('\\', '/');

const toRootRelativeScanPath = (filePath: string): string =>
  normalizeFilePath(filePath).replace(/^\.\//, '');

export const isTestFile = (filePath: string): boolean =>
  TEST_FILE_PATTERN.test(normalizeFilePath(filePath));

export const isWardenTestScanTarget = (filePath: string): boolean =>
  SCAN_TARGET_TEST_FILE_PATTERN.test(toRootRelativeScanPath(filePath));

export const isWardenInfrastructureScanTarget = (filePath: string): boolean => {
  const match = toRootRelativeScanPath(filePath);
  return (
    match.endsWith('.d.ts') ||
    match.startsWith('node_modules/') ||
    match.startsWith('dist/') ||
    match.startsWith('.git/')
  );
};

/**
 * Whether a root-relative path should receive Warden committed-source checks.
 *
 * Warden's CLI glob runner passes root-relative matches here. Consumers that
 * already have a root-relative source path should use the same helper before
 * invoking Warden-owned rules directly so diagnostics do not drift from the
 * CLI runner's scan target contract.
 */
export const isWardenSourceScanTarget = (filePath: string): boolean =>
  !isWardenInfrastructureScanTarget(filePath) &&
  !isWardenTestScanTarget(filePath);

export const isWardenDevPermitTestScanTarget = (filePath: string): boolean =>
  !isWardenInfrastructureScanTarget(filePath) &&
  isWardenTestScanTarget(filePath);

export const isFrameworkInternalFile = (filePath: string): boolean => {
  const normalized = normalizeFilePath(filePath);
  return FRAMEWORK_INTERNAL_SEGMENTS.some((segment) =>
    normalized.includes(segment)
  );
};
