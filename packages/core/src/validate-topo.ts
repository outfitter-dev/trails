/**
 * Structural validation for a Topo graph.
 *
 * Checks trail composing references, example input validity, signal origin
 * references, activation source kinds, and output schema completeness. Returns
 * a Result with all issues collected into a single ValidationError.
 */

import type { ActivationSchemaIssue } from './activation-source-compatibility.js';
import { getActivationSourceInputCompatibilityIssues } from './activation-source-compatibility.js';
import {
  activationSourceDeclarationSignature,
  activationSourceKey,
} from './activation-source-projection.js';
import type { AnyContour } from './contour.js';
import { getContourReferences } from './contour.js';
import { ValidationError } from './errors.js';
import type { ActivationEntry } from './activation-source.js';
import { isKnownActivationSourceKind } from './activation-source.js';
import { isDraftId } from './draft.js';
import type { AnySignal } from './signal.js';
import { validateScheduleSource } from './schedule.js';
import { Result } from './result.js';
import type { Topo } from './topo.js';
import type { AnyTrail, TrailVersionForkEntry } from './trail.js';
import {
  getTrailVersionEntryKind,
  isArchivedTrailVersionEntry,
} from './trail.js';
import { validateInput } from './validation.js';
import { validateWebhookSource } from './webhook.js';

// ---------------------------------------------------------------------------
// Issue shape
// ---------------------------------------------------------------------------

export interface TopoIssue {
  readonly trailId: string;
  readonly rule: string;
  readonly message: string;
  readonly inputPath?: readonly (string | number)[];
  readonly schemaIssues?: readonly TopoSchemaIssue[];
  readonly sourceId?: string;
  readonly sourceKind?: string;
}

export type TopoSchemaIssue = ActivationSchemaIssue;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/** Build an adjacency list and initial color map from trails with compositions. */
const buildComposeGraph = (
  trails: ReadonlyMap<string, AnyTrail>
): {
  graph: Map<string, readonly string[]>;
  color: Map<string, number>;
} => {
  const graph = new Map<string, readonly string[]>();
  for (const [id, trail] of trails) {
    const composedIds = new Set<string>(trail.composes);
    for (const entry of Object.values(trail.versions ?? {})) {
      if (
        isArchivedTrailVersionEntry(entry) ||
        getTrailVersionEntryKind(entry) !== 'fork'
      ) {
        continue;
      }

      const fork = entry as TrailVersionForkEntry;
      for (const composed of fork.composes ?? []) {
        composedIds.add(typeof composed === 'string' ? composed : composed.id);
      }
    }

    if (composedIds.size > 0) {
      graph.set(id, [...composedIds]);
    }
  }
  const color = new Map<string, number>();
  for (const id of graph.keys()) {
    color.set(id, WHITE);
  }
  return { color, graph };
};

/** Detect multi-node cycles in the trail composing graph via DFS. */
const detectComposeCycles = (
  trails: ReadonlyMap<string, AnyTrail>
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  const { color, graph } = buildComposeGraph(trails);

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
          rule: 'compose-cycle',
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

const checkComposes = (
  trails: ReadonlyMap<string, AnyTrail>,
  topo: Topo
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  for (const [id, trail] of trails) {
    for (const composedId of trail.composes) {
      if (composedId === id) {
        issues.push({
          message: `Trail composes itself`,
          rule: 'no-self-compose',
          trailId: id,
        });
      } else if (!topo.has(composedId) && !isDraftId(composedId)) {
        issues.push({
          message: `Composes "${composedId}" which is not in the topo`,
          rule: 'compose-exists',
          trailId: id,
        });
      }
    }
    for (const [rawVersion, entry] of Object.entries(trail.versions ?? {})) {
      if (
        isArchivedTrailVersionEntry(entry) ||
        getTrailVersionEntryKind(entry) !== 'fork'
      ) {
        continue;
      }

      const version = Number(rawVersion);
      const fork = entry as TrailVersionForkEntry;
      for (const composed of fork.composes ?? []) {
        const composedId =
          typeof composed === 'string' ? composed : composed.id;
        if (composedId === id) {
          issues.push({
            message: `Trail version ${version} composes itself`,
            rule: 'no-self-compose',
            trailId: id,
          });
        } else if (!topo.has(composedId) && !isDraftId(composedId)) {
          issues.push({
            message: `Version ${version} composes "${composedId}" which is not in the topo`,
            rule: 'compose-exists',
            trailId: id,
          });
        }
      }
    }
  }
  issues.push(...detectComposeCycles(trails));
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
    for (const [rawVersion, entry] of Object.entries(trail.versions ?? {})) {
      if (
        isArchivedTrailVersionEntry(entry) ||
        getTrailVersionEntryKind(entry) !== 'fork'
      ) {
        continue;
      }

      const version = Number(rawVersion);
      const fork = entry as TrailVersionForkEntry;
      for (const declaredResource of fork.resources ?? []) {
        if (
          !topo.hasResource(declaredResource.id) &&
          !isDraftId(declaredResource.id)
        ) {
          issues.push({
            message: `Version ${version} resource "${declaredResource.id}" is not in the topo`,
            rule: 'resource-exists',
            trailId: id,
          });
        }
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
  hasOutput: boolean,
  label = `Example "${example.name}"`
): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  const result = validateInput(inputSchema as AnyTrail['input'], example.input);
  if (result.isErr() && example.error !== 'ValidationError') {
    issues.push({
      message: `${label} input does not parse against schema`,
      rule: 'example-input-valid',
      trailId: id,
    });
  }
  if (example.expected !== undefined && !hasOutput) {
    issues.push({
      message: `${label} has expected output but trail has no output schema`,
      rule: 'output-schema-present',
      trailId: id,
    });
  }
  return issues;
};

const checkVersionExamples = (id: string, trail: AnyTrail): TopoIssue[] =>
  Object.entries(trail.versions ?? {}).flatMap(([version, entry]) => {
    if (isArchivedTrailVersionEntry(entry)) {
      return [];
    }

    return (entry.examples ?? []).flatMap((example) =>
      checkOneExample(
        id,
        example,
        entry.input,
        true,
        `Example "${example.name}" on version ${version}`
      )
    );
  });

const checkExamples = (trails: ReadonlyMap<string, AnyTrail>): TopoIssue[] => {
  const issues: TopoIssue[] = [];
  for (const [id, trail] of trails) {
    if (trail.examples) {
      for (const example of trail.examples) {
        issues.push(
          ...checkOneExample(id, example, trail.input, !!trail.output)
        );
      }
    }
    issues.push(...checkVersionExamples(id, trail));
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
  const sourceDeclarations = new Map<
    string,
    {
      readonly signature: string;
      readonly trailId: string;
    }
  >();
  const trailSourceEdges = new Set<string>();

  for (const [id, trail] of trails) {
    for (const activation of trail.activationSources ?? []) {
      if (!isKnownActivationSourceKind(activation.source.kind)) {
        issues.push({
          message: `Trail declares on source "${activation.source.id}" with unsupported source kind "${activation.source.kind}"`,
          rule: 'activation-source-kind-known',
          trailId: id,
        });
        continue;
      }

      const sourceKey = activationSourceKey(activation.source);
      const edgeKey = `${id}\0${sourceKey}`;
      if (trailSourceEdges.has(edgeKey)) {
        issues.push({
          message: `Trail declares activation source "${activation.source.id}" (${activation.source.kind}) more than once. Keep one source-to-trail activation edge, or split distinct activation behavior into distinct source ids.`,
          rule: 'activation-source-edge-unique',
          sourceId: activation.source.id,
          sourceKind: activation.source.kind,
          trailId: id,
        });
      } else {
        trailSourceEdges.add(edgeKey);
      }

      if (!isDraftId(activation.source.id)) {
        const signature = activationSourceDeclarationSignature(
          activation.source
        );
        const previous = sourceDeclarations.get(sourceKey);
        if (previous === undefined) {
          sourceDeclarations.set(sourceKey, { signature, trailId: id });
        } else if (previous.signature !== signature) {
          issues.push({
            message: `Activation source "${activation.source.id}" (${activation.source.kind}) is declared with conflicting source options by trails "${previous.trailId}" and "${id}". Use one canonical source declaration per source id, or give distinct source configurations distinct ids.`,
            rule: 'activation-source-definition-unique',
            sourceId: activation.source.id,
            sourceKind: activation.source.kind,
            trailId: id,
          });
        }
      }

      const scheduleIssues = validateScheduleSource(activation.source);
      for (const issue of scheduleIssues) {
        issues.push({
          inputPath: [issue.field],
          message: `Trail declares schedule source "${activation.source.id}" with invalid ${issue.field}: ${issue.message}`,
          rule: 'activation-schedule-valid',
          schemaIssues: [
            { code: issue.field, message: issue.message, path: [issue.field] },
          ],
          sourceId: activation.source.id,
          sourceKind: activation.source.kind,
          trailId: id,
        });
      }

      const webhookIssues = validateWebhookSource(activation.source);
      for (const issue of webhookIssues) {
        issues.push({
          inputPath: [issue.field],
          message: `Trail declares webhook source "${activation.source.id}" with invalid ${issue.field}: ${issue.message}`,
          rule: 'activation-webhook-valid',
          schemaIssues: [
            { code: issue.field, message: issue.message, path: [issue.field] },
          ],
          sourceId: activation.source.id,
          sourceKind: activation.source.kind,
          trailId: id,
        });
      }
    }
  }

  return issues;
};

const issuePathText = (path: readonly (string | number)[]): string =>
  path.length > 0 ? path.join('.') : '<root>';

const createSourceCompatibilityIssue = (
  trailId: string,
  activation: ActivationEntry,
  schemaIssues: readonly TopoSchemaIssue[]
): TopoIssue => {
  const [firstIssue] = schemaIssues;
  const inputPath = firstIssue?.path ?? Object.freeze([]);
  return {
    inputPath,
    message: `Activation source "${activation.source.id}" (${activation.source.kind}) does not satisfy trail input at ${issuePathText(inputPath)}: ${firstIssue?.message ?? 'source payload is incompatible with trail input'}`,
    rule: 'activation-source-input-compatible',
    schemaIssues,
    sourceId: activation.source.id,
    sourceKind: activation.source.kind,
    trailId,
  };
};

const checkSourcePayloadCompatibility = (
  trail: AnyTrail,
  activation: ActivationEntry,
  signals: ReadonlyMap<string, AnySignal>
): TopoIssue | undefined => {
  if (
    !isKnownActivationSourceKind(activation.source.kind) ||
    isDraftId(activation.source.id)
  ) {
    return undefined;
  }

  const schemaIssues = getActivationSourceInputCompatibilityIssues(
    trail.input,
    activation.source,
    signals
  );
  if (!schemaIssues) {
    return undefined;
  }

  return schemaIssues.length > 0
    ? createSourceCompatibilityIssue(trail.id, activation, schemaIssues)
    : undefined;
};

const checkActivationSourceInputCompatibility = (
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>
): TopoIssue[] => {
  const issues: TopoIssue[] = [];

  for (const trail of trails.values()) {
    for (const activation of trail.activationSources ?? []) {
      const issue = checkSourcePayloadCompatibility(trail, activation, signals);
      if (issue) {
        issues.push(issue);
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
 * Checks composing references, example inputs, signal origins, activation
 * source kinds, and output schema presence. Returns `Result.ok()` when no
 * issues are found, or
 * `Result.err(ValidationError)` with all issues in the error context.
 */
export const validateTopo = (topo: Topo): Result<void, ValidationError> => {
  const issues = [
    ...checkComposes(topo.trails, topo),
    ...checkResources(topo.trails, topo),
    ...checkContourReferences(topo.contours, topo),
    ...checkExamples(topo.trails),
    ...checkSignalOrigins(topo.signals, topo),
    ...checkSignalReferences(topo.trails, topo.signals),
    ...checkActivationSources(topo.trails),
    ...checkActivationSourceInputCompatibility(topo.trails, topo.signals),
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
