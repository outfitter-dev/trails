/**
 * Merge a file's locally-defined contour IDs with the project-wide set.
 *
 * Rules that run with a `ProjectContext` need to treat both local and
 * project-wide contour definitions as "known" so that declarations and
 * references resolve correctly. When no project context is available — e.g.
 * single-file lint runs via `check` — the local set is returned as-is.
 */
export const mergeKnownContourIds = (
  localContourIds: ReadonlySet<string>,
  projectContourIds?: ReadonlySet<string>
): ReadonlySet<string> =>
  projectContourIds
    ? new Set([...projectContourIds, ...localContourIds])
    : localContourIds;
