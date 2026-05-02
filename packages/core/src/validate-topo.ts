/**
 * Structural validation for a Topo graph.
 *
 * Checks trail crossing references, example input validity, signal origin
 * references, activation source kinds, and output schema completeness. Returns
 * a Result with all issues collected into a single ValidationError.
 */

import type { AnyContour } from './contour.js';
import { getContourReferences } from './contour.js';
import { ValidationError } from './errors.js';
import { isKnownActivationSourceKind } from './activation-source.js';
import { isDraftId } from './draft.js';
import type { AnySignal } from './signal.js';
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

/** Build an adjacency list and initial color map from trails with crossings. */
const buildCrossGraph = (
  trails: ReadonlyMap<string, AnyTrail>
): {
  graph: Map<string, readonly string[]>;
  color: Map<string, number>;
} => {
  const graph = new Map<string, readonly string[]>();
  for (const [id, t] of trails) {
    if (t.crosses.length > 0) {
      graph.set(id, t.crosses);
    }
  }
  const color = new Map<string, number>();
  for (const id of graph.keys()) {
    color.set(id, WHITE);
  }
  return { color, graph };
};

/** Detect multi-node cycles in the trail crossing graph via DFS. */
const detectCrossCycles = (
  trails: ReadonlyMap<string, AnyTrail>
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  const { color, graph } = buildCrossGraph(trails);

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
          rule: 'cross-cycle',
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

const checkCrosses = (
  trails: ReadonlyMap<string, AnyTrail>,
  topo: Topo
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  for (const [id, trail] of trails) {
    for (const crossedId of trail.crosses) {
      if (crossedId === id) {
        issues.push({
          message: `Trail crosses itself`,
          rule: 'no-self-cross',
          trailId: id,
        });
      } else if (!topo.has(crossedId) && !isDraftId(crossedId)) {
        issues.push({
          message: `Crosses "${crossedId}" which is not in the topo`,
          rule: 'cross-exists',
          trailId: id,
        });
      }
    }
  }
  issues.push(...detectCrossCycles(trails));
  return issues;
};

const checkResources = (
  trails: ReadonlyMap<string, AnyTrail>,
  topo: Topo
): TopoIssue[] => {
  const issues: TopoIssue[] = [];

  for (const [id, trail] of trails) {
    for (const declaredResource of trail.resources) {
      if (
        !topo.hasResource(declaredResource.id) &&
        !isDraftId(declaredResource.id)
      ) {
        issues.push({
          message: `Resource "${declaredResource.id}" is not in the topo`,
          rule: 'resource-exists',
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

const checkSignalOrigins = (
  signals: ReadonlyMap<string, AnySignal>,
  topo: Topo
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  for (const [id, evt] of signals) {
    if (!evt.from) {
      continue;
    }
    for (const originId of evt.from) {
      if (!topo.has(originId) && !isDraftId(originId)) {
        issues.push({
          message: `Signal origin "${originId}" is not in the topo`,
          rule: 'signal-origin-exists',
          trailId: id,
        });
      }
    }
  }
  return issues;
};

const checkSignalReferences = (
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>
): TopoIssue[] => {
  const issues: TopoIssue[] = [];

  for (const [id, trail] of trails) {
    for (const signalId of trail.fires ?? []) {
      if (!signals.has(signalId) && !isDraftId(signalId)) {
        issues.push({
          message: `Trail fires signal "${signalId}" which is not in the topo`,
          rule: 'signal-fire-exists',
          trailId: id,
        });
      }
    }

    for (const signalId of trail.on ?? []) {
      if (!signals.has(signalId) && !isDraftId(signalId)) {
        issues.push({
          message: `Trail declares on signal "${signalId}" which is not in the topo`,
          rule: 'signal-on-exists',
          trailId: id,
        });
      }
    }
  }

  return issues;
};

const checkActivationSources = (
  trails: ReadonlyMap<string, AnyTrail>
): TopoIssue[] => {
  const issues: TopoIssue[] = [];

  for (const [id, trail] of trails) {
    for (const activation of trail.activationSources ?? []) {
      if (!isKnownActivationSourceKind(activation.source.kind)) {
        issues.push({
          message: `Trail declares on source "${activation.source.id}" with unsupported source kind "${activation.source.kind}"`,
          rule: 'activation-source-kind-known',
          trailId: id,
        });
      }
    }
  }

  return issues;
};

const checkContourReferences = (
  contours: ReadonlyMap<string, AnyContour>,
  topo: Topo
): TopoIssue[] => {
  const issues: TopoIssue[] = [];

  for (const [name, contourDef] of contours) {
    for (const ref of getContourReferences(contourDef)) {
      if (!topo.hasContour(ref.contour) && !isDraftId(ref.contour)) {
        issues.push({
          message: `Contour "${name}" references "${ref.contour}" which is not in the topo`,
          rule: 'contour-reference-exists',
          trailId: name,
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
 * Checks crossing references, example inputs, signal origins, activation
 * source kinds, and output schema presence. Returns `Result.ok()` when no
 * issues are found, or
 * `Result.err(ValidationError)` with all issues in the error context.
 */
export const validateTopo = (topo: Topo): Result<void, ValidationError> => {
  const issues = [
    ...checkCrosses(topo.trails, topo),
    ...checkResources(topo.trails, topo),
    ...checkContourReferences(topo.contours, topo),
    ...checkExamples(topo.trails),
    ...checkSignalOrigins(topo.signals, topo),
    ...checkSignalReferences(topo.trails, topo.signals),
    ...checkActivationSources(topo.trails),
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
