const TEST_FILE_PATTERN =
  /(?:^|\/)__tests__(?:\/|$)|(?:\.test|\.spec)\.[cm]?[jt]sx?$/;

const FRAMEWORK_INTERNAL_SEGMENTS = [
  '/packages/testing/',
  '/packages/warden/',
] as const;

const normalizeFilePath = (filePath: string): string =>
  filePath.replaceAll('\\', '/');

export const isTestFile = (filePath: string): boolean =>
  TEST_FILE_PATTERN.test(normalizeFilePath(filePath));

export const isFrameworkInternalFile = (filePath: string): boolean => {
  const normalized = normalizeFilePath(filePath);
  return FRAMEWORK_INTERNAL_SEGMENTS.some((segment) =>
    normalized.includes(segment)
  );
};
