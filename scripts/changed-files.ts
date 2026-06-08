export interface ChangedFileInfo {
  readonly filename: string;
  readonly previousFilename?: string;
  readonly status?: string;
}

export type ChangedFileInput = string | ChangedFileInfo;

const normalizePath = (path: string): string =>
  path.replaceAll('\\', '/').replace(/^\.\//u, '');

export const normalizeChangedFileInfo = (
  input: ChangedFileInput
): ChangedFileInfo => {
  if (typeof input === 'string') {
    return { filename: normalizePath(input) };
  }

  const previousFilename = input.previousFilename?.trim();
  const status = input.status?.trim();

  return {
    filename: normalizePath(input.filename),
    ...(previousFilename
      ? { previousFilename: normalizePath(previousFilename) }
      : {}),
    ...(status ? { status } : {}),
  };
};

export const changedFileFilenames = (
  inputs: readonly ChangedFileInput[]
): readonly string[] =>
  inputs.map((input) => normalizeChangedFileInfo(input).filename);

export const changedFilePackagePaths = (
  inputs: readonly ChangedFileInput[]
): readonly string[] => [
  ...new Set(
    inputs.flatMap((input) => {
      const info = normalizeChangedFileInfo(input);
      return info.previousFilename
        ? [info.filename, info.previousFilename]
        : [info.filename];
    })
  ),
];
