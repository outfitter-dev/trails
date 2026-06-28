import { z } from 'zod';

const NONE_EXTENSION = '<none>';

/** Files grouped by extension for a Regrade scan. */
export interface RegradeScanExtensionBucket {
  /** File extension, or `<none>` when the path has no extension. */
  readonly extension: string;
  /** Matched files in this extension bucket. */
  readonly files: number;
  /** Matched occurrences in this extension bucket, when occurrence data exists. */
  readonly occurrences?: number;
}

/** Files grouped by top-level path segment for a Regrade scan. */
export interface RegradeScanDirectoryBucket {
  /** Top-level root-relative path segment, or `.` for root files. */
  readonly path: string;
  /** Matched files in this directory bucket. */
  readonly files: number;
  /** Matched occurrences in this directory bucket, when occurrence data exists. */
  readonly occurrences?: number;
}

/** Agent-facing inventory summary for a Regrade scan. */
export interface RegradeScanSummary {
  /** File-level scan totals. */
  readonly files: {
    /** Files whose report outcome was rewrite or review. */
    readonly matched: number;
    /** Files inspected after collection and scope filters. */
    readonly scanned: number;
    /** Files or directories skipped before actionable matching. */
    readonly skipped: number;
  };
  /** Matched files grouped by extension. */
  readonly byExtension: readonly RegradeScanExtensionBucket[];
  /** Matched files grouped by top-level directory/path segment. */
  readonly byDirectory: readonly RegradeScanDirectoryBucket[];
  /** Skipped entries grouped by reason. */
  readonly skippedByReason: Readonly<Record<string, number>>;
}

interface RegradeScanSummaryInput {
  readonly matchedPaths: readonly string[];
  readonly occurrencePaths?: readonly string[];
  readonly scanned: number;
  readonly skipped: number;
  readonly skippedByReason: Readonly<Record<string, number>>;
}

const extensionForPath = (path: string): string => {
  const name = path.split('/').at(-1) ?? path;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return NONE_EXTENSION;
  }
  return name.slice(dot);
};

const topLevelForPath = (path: string): string => {
  const [segment] = path.split('/');
  return segment === undefined || segment.length === 0 ? '.' : segment;
};

const countFiles = (
  paths: readonly string[],
  keyForPath: (path: string) => string
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const path of new Set(paths)) {
    const key = keyForPath(path);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const countOccurrences = (
  paths: readonly string[] | undefined,
  keyForPath: (path: string) => string
): Map<string, number> | undefined => {
  if (paths === undefined) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const path of paths) {
    const key = keyForPath(path);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const sortBuckets = <T extends { readonly files: number }>(
  left: T & { readonly key: string },
  right: T & { readonly key: string }
): number => right.files - left.files || left.key.localeCompare(right.key);

export const buildRegradeScanSummary = ({
  matchedPaths,
  occurrencePaths,
  scanned,
  skipped,
  skippedByReason,
}: RegradeScanSummaryInput): RegradeScanSummary => {
  const extensionFiles = countFiles(matchedPaths, extensionForPath);
  const extensionOccurrences = countOccurrences(
    occurrencePaths,
    extensionForPath
  );
  const directoryFiles = countFiles(matchedPaths, topLevelForPath);
  const directoryOccurrences = countOccurrences(
    occurrencePaths,
    topLevelForPath
  );

  return {
    byDirectory: [...directoryFiles.entries()]
      .map(([path, files]) => ({
        files,
        path,
        ...(directoryOccurrences === undefined
          ? {}
          : { occurrences: directoryOccurrences.get(path) ?? 0 }),
        key: path,
      }))
      .toSorted(sortBuckets)
      .map(({ key: _key, ...bucket }) => bucket),
    byExtension: [...extensionFiles.entries()]
      .map(([extension, files]) => ({
        extension,
        files,
        ...(extensionOccurrences === undefined
          ? {}
          : { occurrences: extensionOccurrences.get(extension) ?? 0 }),
        key: extension,
      }))
      .toSorted(sortBuckets)
      .map(({ key: _key, ...bucket }) => bucket),
    files: {
      matched: new Set(matchedPaths).size,
      scanned,
      skipped,
    },
    skippedByReason,
  };
};

export const regradeScanSummaryOutput = z.object({
  byDirectory: z
    .array(
      z.object({
        files: z.number().describe('Matched files in this directory bucket'),
        occurrences: z
          .number()
          .optional()
          .describe('Matched occurrences in this directory bucket'),
        path: z
          .string()
          .describe(
            'Top-level root-relative path segment, or . for root files'
          ),
      })
    )
    .describe('Matched files grouped by top-level directory/path segment'),
  byExtension: z
    .array(
      z.object({
        extension: z.string().describe('File extension, or <none>'),
        files: z.number().describe('Matched files in this extension bucket'),
        occurrences: z
          .number()
          .optional()
          .describe('Matched occurrences in this extension bucket'),
      })
    )
    .describe('Matched files grouped by extension'),
  files: z
    .object({
      matched: z
        .number()
        .describe('Files whose report outcome was rewrite or review'),
      scanned: z
        .number()
        .describe('Files inspected after collection and scope filters'),
      skipped: z
        .number()
        .describe('Files or directories skipped before actionable matching'),
    })
    .describe('File-level scan totals'),
  skippedByReason: z
    .record(z.string(), z.number())
    .describe('Skipped entries grouped by reason'),
});
