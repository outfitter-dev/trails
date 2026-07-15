/**
 * Post-execution trace tree renderer.
 *
 * Pure rendering of a flat `TraceRecord[]` into a multi-line string suitable
 * for stderr. The renderer is intentionally side-effect free: callers (such as
 * the CLI's `--trace` flag) own the actual write to stderr. Live streaming is
 * deferred per ADR-0028; this renderer assumes the records are complete.
 *
 * The output follows the trace tree shape documented in ADR-0041:
 *
 * ```
 * ● booking.confirm
 *   ├── availability.reserve
 *   │   └─ ✓ 45ms
 *   ├── billing.charge
 *   │   └─ ✗ ConflictError (90ms)
 *   └─ ✓ 380ms
 * ```
 *
 * Status glyphs:
 *   - `✓` ok
 *   - `✗` err (with error category)
 *   - `⊘` cancelled
 *
 * Parallel siblings (overlapping `[startedAt, endedAt]` intervals) are
 * bracketed with `┌` / `├` / `└` and followed by a parallel summary line.
 *
 * @see {@link https://github.com/outfitter-dev/trails/blob/main/docs/adr/0041-unified-observability.md | ADR-0041: Unified Observability}
 */

import type { TraceRecord } from '@ontrails/core';

/** Glyph used to mark the root of a rendered tree. */
const ROOT_GLYPH = '●';

/** Status glyph for an `ok` outcome. */
const OK_GLYPH = '✓';

/** Status glyph for an `err` outcome. */
const ERR_GLYPH = '✗';

/** Status glyph for a `cancelled` outcome. */
const CANCELLED_GLYPH = '⊘';

/** Branch prefix for a non-last child in a regular (non-parallel) group. */
const BRANCH_MID = '├── ';

/** Branch prefix for the last child in a regular (non-parallel) group. */
const BRANCH_LAST = '└── ';

/** Continuation prefix for descendants under a non-last child. */
const CONTINUATION_MID = '│   ';

/** Continuation prefix for descendants under the last child. */
const CONTINUATION_LAST = '    ';

/** Prefix for a parallel-group leader. */
const PARALLEL_FIRST = '┌ ';

/** Prefix for a middle entry in a parallel group. */
const PARALLEL_MID = '├ ';

/** Prefix for the final entry in a parallel group. */
const PARALLEL_LAST = '└ ';

interface ChildBlockArgs {
  readonly children: readonly TraceRecord[];
  readonly childrenByParent: ReadonlyMap<string, readonly TraceRecord[]>;
  readonly indent: string;
  readonly lines: string[];
}

interface GroupArgs extends ChildBlockArgs {
  readonly group: readonly TraceRecord[];
  readonly isLastGroup: boolean;
  readonly renderDescendants: (
    child: TraceRecord,
    continuation: string
  ) => void;
}

interface ParallelRun {
  readonly kind: 'parallel' | 'serial';
  readonly records: readonly TraceRecord[];
}

const durationOf = (record: TraceRecord): number => {
  if (record.endedAt === undefined) {
    return 0;
  }
  return Math.max(0, record.endedAt - record.startedAt);
};

const computeWallTime = (records: readonly TraceRecord[]): number => {
  if (records.length === 0) {
    return 0;
  }
  let earliest = Number.POSITIVE_INFINITY;
  let latest = 0;
  for (const record of records) {
    if (record.startedAt < earliest) {
      earliest = record.startedAt;
    }
    const end = record.endedAt ?? record.startedAt;
    if (end > latest) {
      latest = end;
    }
  }
  return Math.max(0, latest - earliest);
};

const computeTotalTime = (records: readonly TraceRecord[]): number => {
  let total = 0;
  for (const record of records) {
    total += durationOf(record);
  }
  return total;
};

const decorationForKind = (record: TraceRecord): string => {
  switch (record.kind) {
    case 'signal': {
      return record.attrs['emit'] === true ? '↑ ' : '';
    }
    case 'activation': {
      return '→ ';
    }
    case 'span':
    case 'trail': {
      return '';
    }
    default: {
      // Forward-compatible: render unknown kinds as plain spans.
      return '';
    }
  }
};

const formatRecordHeader = (record: TraceRecord): string => {
  const decoration = decorationForKind(record);
  return `${decoration}${record.name}`;
};

const formatStatus = (record: TraceRecord): string => {
  const ms = durationOf(record);
  switch (record.status) {
    case 'ok': {
      return `${OK_GLYPH} ${ms}ms`;
    }
    case 'err': {
      const category = record.errorCategory ?? 'Error';
      return `${ERR_GLYPH} ${category} (${ms}ms)`;
    }
    case 'cancelled': {
      return `${CANCELLED_GLYPH} ${ms}ms`;
    }
    default: {
      // Forward-compatible: unknown future statuses render as a neutral note.
      return `${ms}ms`;
    }
  }
};

const sortByStartedAt = (
  records: readonly TraceRecord[]
): readonly TraceRecord[] => {
  const copy = [...records];
  copy.sort((left, right) => {
    if (left.startedAt !== right.startedAt) {
      return left.startedAt - right.startedAt;
    }
    if (left.id < right.id) {
      return -1;
    }
    if (left.id > right.id) {
      return 1;
    }
    return 0;
  });
  return copy;
};

const parallelInnerBranch = (index: number, count: number): string => {
  if (index === 0) {
    return PARALLEL_FIRST;
  }
  if (index === count - 1) {
    return PARALLEL_LAST;
  }
  return PARALLEL_MID;
};

const groupParallelRuns = (
  children: readonly TraceRecord[]
): readonly ParallelRun[] => {
  const [head, ...rest] = children;
  if (head === undefined) {
    return [];
  }
  const runs: ParallelRun[] = [];
  let bucket: TraceRecord[] = [head];
  let bucketEnd = head.endedAt ?? Number.POSITIVE_INFINITY;
  let bucketIsParallel = false;
  for (const current of rest) {
    const overlaps = current.startedAt < bucketEnd;
    if (overlaps && bucket.length === 1 && !bucketIsParallel) {
      bucket.push(current);
      bucketEnd = Math.max(
        bucketEnd,
        current.endedAt ?? Number.POSITIVE_INFINITY
      );
      bucketIsParallel = true;
      continue;
    }
    if (overlaps && bucketIsParallel) {
      bucket.push(current);
      bucketEnd = Math.max(
        bucketEnd,
        current.endedAt ?? Number.POSITIVE_INFINITY
      );
      continue;
    }
    runs.push({
      kind: bucketIsParallel ? 'parallel' : 'serial',
      records: bucket,
    });
    bucket = [current];
    bucketEnd = current.endedAt ?? Number.POSITIVE_INFINITY;
    bucketIsParallel = false;
  }
  runs.push({
    kind: bucketIsParallel ? 'parallel' : 'serial',
    records: bucket,
  });
  return runs;
};

const appendParallelGroup = (args: GroupArgs): void => {
  const { group, indent, isLastGroup, lines, renderDescendants } = args;
  let index = 0;
  for (const child of group) {
    const branch = parallelInnerBranch(index, group.length);
    const isLastEntryOfLastGroup = index === group.length - 1 && isLastGroup;
    const outerBranch = isLastEntryOfLastGroup ? BRANCH_LAST : BRANCH_MID;
    const continuation = isLastEntryOfLastGroup
      ? CONTINUATION_LAST
      : CONTINUATION_MID;
    const header = formatRecordHeader(child);
    const status = formatStatus(child);
    lines.push(`${indent}${outerBranch}${branch}${header} ${status}`);
    renderDescendants(child, continuation);
    index += 1;
  }
  const wall = computeWallTime(group);
  const total = computeTotalTime(group);
  const continuation = isLastGroup ? CONTINUATION_LAST : CONTINUATION_MID;
  lines.push(
    `${indent}${continuation}(parallel: ${wall}ms wall, ${total}ms total)`
  );
};

/**
 * Render a contiguous block of sibling children, splitting them into runs
 * of sequential and parallel groups. Self-recursive: parallel groups render
 * as flat brackets, and serial entries recurse for grandchildren.
 */
const appendChildBlock = (args: ChildBlockArgs): void => {
  const { childrenByParent, children, indent, lines } = args;
  if (children.length === 0) {
    return;
  }
  const groups = groupParallelRuns(children);
  let groupIndex = 0;
  for (const group of groups) {
    const isLastGroup = groupIndex === groups.length - 1;
    if (group.kind === 'parallel') {
      appendParallelGroup({
        ...args,
        group: group.records,
        isLastGroup,
        renderDescendants: (child, continuation) => {
          const grandchildren = sortByStartedAt(
            childrenByParent.get(child.id) ?? []
          );
          appendChildBlock({
            children: grandchildren,
            childrenByParent,
            indent: `${indent}${continuation}`,
            lines,
          });
        },
      });
      groupIndex += 1;
      continue;
    }
    let entryIndex = 0;
    for (const child of group.records) {
      const isLastChild =
        isLastGroup && entryIndex === group.records.length - 1;
      const branch = isLastChild ? BRANCH_LAST : BRANCH_MID;
      const continuation = isLastChild ? CONTINUATION_LAST : CONTINUATION_MID;
      lines.push(`${indent}${branch}${formatRecordHeader(child)}`);
      const grandchildren = sortByStartedAt(
        childrenByParent.get(child.id) ?? []
      );
      appendChildBlock({
        children: grandchildren,
        childrenByParent,
        indent: `${indent}${continuation}`,
        lines,
      });
      lines.push(`${indent}${continuation}└─ ${formatStatus(child)}`);
      entryIndex += 1;
    }
    groupIndex += 1;
  }
};

const renderRoot = (
  root: TraceRecord,
  childrenByParent: ReadonlyMap<string, readonly TraceRecord[]>
): string => {
  const header = `${ROOT_GLYPH} ${formatRecordHeader(root)}`;
  const lines: string[] = [header];
  const children = sortByStartedAt(childrenByParent.get(root.id) ?? []);
  appendChildBlock({
    children,
    childrenByParent,
    indent: '  ',
    lines,
  });
  lines.push(`  └─ ${formatStatus(root)}`);
  return lines.join('\n');
};

/**
 * Render a flat array of trace records as a tree string.
 *
 * Returns an empty string for empty input. When multiple records have no
 * `parentId`, each is rendered as a separate top-level tree joined by a
 * blank line.
 *
 * @param records - Flat list of trace records, in any order.
 * @returns Multi-line string. No trailing newline.
 */
export const renderTraceTree = (records: readonly TraceRecord[]): string => {
  if (records.length === 0) {
    return '';
  }

  const byId = new Map<string, TraceRecord>();
  for (const record of records) {
    byId.set(record.id, record);
  }

  const childrenByParent = new Map<string, TraceRecord[]>();
  const roots: TraceRecord[] = [];
  for (const record of records) {
    if (record.parentId !== undefined && byId.has(record.parentId)) {
      const siblings = childrenByParent.get(record.parentId) ?? [];
      siblings.push(record);
      childrenByParent.set(record.parentId, siblings);
      continue;
    }
    roots.push(record);
  }

  const sortedRoots = sortByStartedAt(roots);
  const renderedTrees = sortedRoots.map((root) =>
    renderRoot(root, childrenByParent)
  );
  return renderedTrees.join('\n\n');
};
