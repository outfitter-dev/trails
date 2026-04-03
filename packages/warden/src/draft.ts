import { basename } from 'node:path';

export const DRAFT_FILE_PREFIX = '_draft.';
export const DRAFT_FILE_SEGMENT = '.draft.';

const DRAFT_TRAILING_SEGMENT = /\.draft(?=\.[^.]+$)/;

export const isDraftMarkedFile = (filePath: string): boolean => {
  const fileName = basename(filePath);
  return (
    fileName.startsWith(DRAFT_FILE_PREFIX) ||
    fileName.includes(DRAFT_FILE_SEGMENT)
  );
};

export const stripDraftFileMarkers = (fileName: string): string => {
  if (fileName.startsWith(DRAFT_FILE_PREFIX)) {
    return fileName.slice(DRAFT_FILE_PREFIX.length);
  }

  return fileName.replace(DRAFT_TRAILING_SEGMENT, '');
};
