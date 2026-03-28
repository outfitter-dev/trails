/**
 * Structural validation for a Topo graph.
 *
 * Checks hike follows references, example input validity, event origin
 * references, and output schema completeness. Returns a Result with all
 * issues collected into a single ValidationError.
 */

import { ValidationError } from './errors.js';
import type { AnyEvent } from './event.js';
import type { AnyHike } from './hike.js';
import { Result } from './result.js';
import type { Topo } from './topo.js';
import type { AnyTrail } from './trail.js';
import { validateInput } from './validation.js';

// ---------------------------------------------------------------------------
// Issue shape
// ---------------------------------------------------------------------------

export interface TopoIssue {
  readonly trailId: string;
  readonly rule: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/** Build an adjacency list and initial color map from hikes. */
const buildFollowGraph = (
  hikes: ReadonlyMap<string, AnyHike>
): {
  graph: Map<string, readonly string[]>;
  color: Map<string, number>;
} => {
  const graph = new Map<string, readonly string[]>();
  for (const [id, h] of hikes) {
    graph.set(id, h.follows);
  }
  const color = new Map<string, number>();
  for (const id of graph.keys()) {
    color.set(id, WHITE);
  }
  return { color, graph };
};

/** Detect multi-node cycles in the hike follow graph via DFS. */
const detectFollowCycles = (
  hikes: ReadonlyMap<string, AnyHike>
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  const { color, graph } = buildFollowGraph(hikes);

  const dfs = (node: string, path: string[]): void => {
    color.set(node, GRAY);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) {
        continue;
      }
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const cycle = [...path.slice(path.indexOf(next)), next];
        issues.push({
          message: `Cycle detected: ${cycle.join(' → ')}`,
          rule: 'follow-cycle',
          trailId: next,
        });
      } else if (c === WHITE) {
        dfs(next, [...path, next]);
      }
    }
    color.set(node, BLACK);
  };

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) {
      dfs(id, [id]);
    }
  }
  return issues;
};

const checkFollows = (
  hikes: ReadonlyMap<string, AnyHike>,
  topo: Topo
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  for (const [id, hike] of hikes) {
    for (const followId of hike.follows) {
      if (followId === id) {
        issues.push({
          message: `Hike follows itself`,
          rule: 'no-self-follow',
          trailId: id,
        });
      } else if (!topo.has(followId)) {
        issues.push({
          message: `Follows "${followId}" which is not in the topo`,
          rule: 'follows-exist',
          trailId: id,
        });
      }
    }
  }
  issues.push(...detectFollowCycles(hikes));
  return issues;
};

const checkOneExample = (
  id: string,
  example: {
    name: string;
    input: unknown;
    expected?: unknown | undefined;
    error?: string | undefined;
  },
  inputSchema: { safeParse: (data: unknown) => { success: boolean } },
  hasOutput: boolean
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  const result = validateInput(inputSchema as AnyTrail['input'], example.input);
  if (result.isErr() && example.error !== 'ValidationError') {
    issues.push({
      message: `Example "${example.name}" input does not parse against schema`,
      rule: 'example-input-valid',
      trailId: id,
    });
  }
  if (example.expected !== undefined && !hasOutput) {
    issues.push({
      message: `Example "${example.name}" has expected output but trail has no output schema`,
      rule: 'output-schema-present',
      trailId: id,
    });
  }
  return issues;
};

const checkExamples = (trails: ReadonlyMap<string, AnyTrail>): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  for (const [id, trail] of trails) {
    if (!trail.examples) {
      continue;
    }
    for (const example of trail.examples) {
      issues.push(...checkOneExample(id, example, trail.input, !!trail.output));
    }
  }
  return issues;
};

const checkEventOrigins = (
  events: ReadonlyMap<string, AnyEvent>,
  topo: Topo
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  for (const [id, evt] of events) {
    if (!evt.from) {
      continue;
    }
    for (const originId of evt.from) {
      if (!topo.has(originId)) {
        issues.push({
          message: `Event origin "${originId}" is not in the topo`,
          rule: 'event-origin-exists',
          trailId: id,
        });
      }
    }
  }
  return issues;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate the structural integrity of a Topo graph.
 *
 * Checks follows references, example inputs, event origins, and output
 * schema presence. Returns `Result.ok()` when no issues are found, or
 * `Result.err(ValidationError)` with all issues in the error context.
 */
export const validateTopo = (topo: Topo): Result<void, ValidationError> => {
  const issues = [
    ...checkFollows(topo.hikes, topo),
    ...checkExamples(topo.trails),
    ...checkEventOrigins(topo.events, topo),
  ];

  if (issues.length === 0) {
    return Result.ok();
  }

  return Result.err(
    new ValidationError(
      `Topo validation failed with ${issues.length} issue(s)`,
      {
        context: { issues },
      }
    )
  );
};
