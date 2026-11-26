import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';

import { ADR_DIR, DRAFTS_DIR, ROOT } from './paths.ts';

/** Active files are direct, regular children of the two authored roots, never aliases into history. */
const isActiveFilePath = (path: string): boolean => {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (parent !== ADR_DIR && parent !== DRAFTS_DIR) {
    return false;
  }
  try {
    const entry = lstatSync(absolute, { throwIfNoEntry: false });
    if (entry && !entry.isFile()) {
      return false;
    }
    let ancestor = absolute;
    while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
      ancestor = dirname(ancestor);
    }
    // Compare against the canonical repo root so /tmp aliases remain valid,
    // while symlinked source files or parent directories cannot escape ownership.
    return (
      realpathSync(ancestor) ===
      resolve(realpathSync(ROOT), relative(ROOT, ancestor))
    );
  } catch {
    return false;
  }
};

/** Recognize only active numbered decisions and active draft Markdown, excluding indexes. */
export const isActiveAdrPath = (path: string): boolean => {
  const absolute = resolve(path);
  const filename = basename(absolute);
  const named =
    dirname(absolute) === ADR_DIR
      ? /^\d+-.*\.md$/.test(filename)
      : filename.endsWith('.md') && filename !== 'README.md';
  return named && isActiveFilePath(absolute);
};

/** Reject an authored or generated path before reading or writing outside the active roots. */
export const requireActivePath = (path: string): void => {
  if (!isActiveFilePath(path)) {
    console.error(
      `Error: use a regular active ADR file directly under docs/adr/ or docs/adr/drafts/; historical paths and symlink aliases are read-only: ${path}`
    );
    process.exit(1);
  }
};
