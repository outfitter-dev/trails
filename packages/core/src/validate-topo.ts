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
  if (result.isErr() && example.error === undefined) {
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
