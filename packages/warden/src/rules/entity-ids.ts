/**
 * Merge a file's locally-defined entity IDs with the project-wide set.
 *
 * Rules that run with a `ProjectContext` need to treat both local and
 * project-wide entity definitions as "known" so that declarations and
 * references resolve correctly. When no project context is available — e.g.
 * single-file lint runs via `check` — the local set is returned as-is.
 */
export const mergeKnownEntityIds = (
  localEntityIds: ReadonlySet<string>,
  projectEntityIds?: ReadonlySet<string>
): ReadonlySet<string> =>
  projectEntityIds
    ? new Set([...projectEntityIds, ...localEntityIds])
    : localEntityIds;
