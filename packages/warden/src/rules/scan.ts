const TEST_FILE_PATTERN =
  /(?:^|\/)__tests__(?:\/|$)|(?:\.test|\.spec)\.[cm]?[jt]sx?$/;

const FRAMEWORK_INTERNAL_SEGMENTS = [
  '/packages/testing/',
  '/packages/warden/',
] as const;

const normalizeFilePath = (filePath: string): string =>
  filePath.replaceAll('\\', '/');

const maskText = (text: string): string => text.replaceAll(/[^\n]/g, ' ');

const stripPattern = (sourceCode: string, pattern: RegExp): string =>
  sourceCode.replaceAll(pattern, (match) => maskText(match));

export const isTestFile = (filePath: string): boolean =>
  TEST_FILE_PATTERN.test(normalizeFilePath(filePath));

export const isFrameworkInternalFile = (filePath: string): boolean => {
  const normalized = normalizeFilePath(filePath);
  return FRAMEWORK_INTERNAL_SEGMENTS.some((segment) =>
    normalized.includes(segment)
  );
};

/**
 * Replace quoted content and comments with whitespace while preserving line
 * breaks so simple line-based scanners do not match examples or messages.
 */
export const stripQuotedContent = (sourceCode: string): string => {
  let sanitized = sourceCode;
  const patterns = [
    /\/\/[^\n]*/g,
    /\/\*[\s\S]*?\*\//g,
    /'[^'\\\n]*(?:\\.[^'\\\n]*)*'/g,
    /"[^"\\\n]*(?:\\.[^"\\\n]*)*"/g,
    /`[\s\S]*?`/g,
  ];

  for (const pattern of patterns) {
    sanitized = stripPattern(sanitized, pattern);
  }

  return sanitized;
};
