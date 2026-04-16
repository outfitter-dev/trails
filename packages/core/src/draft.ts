import type { AnyContour } from './contour.js';
import { getContourReferences } from './contour.js';
import { ValidationError } from './errors.js';
import type { AnySignal } from './signal.js';
import type { AnyResource } from './resource.js';
import { Result } from './result.js';
import type { Topo } from './topo.js';
import type { AnyTrail } from './trail.js';

export const DRAFT_ID_PREFIX = '_draft.';

export type DraftDependencyKind =
  | 'cross'
  | 'contour'
  | 'resource'
  | 'replaced-by'
  | 'schema-reference'
  | 'signal-from';

export interface DraftDependency {
  readonly fromId: string;
  readonly kind: DraftDependencyKind;
  readonly toId: string;
}

export interface DraftFinding {
  readonly id: string;
  readonly kind: 'contour' | 'resource' | 'signal' | 'trail' | 'unknown';
  readonly message: string;
  readonly rule: 'draft-contamination' | 'draft-id';
  readonly via?: DraftDependencyKind | undefined;
  readonly dependsOn?: string | undefined;
}

export interface DraftReport {
  readonly contaminatedIds: ReadonlySet<string>;
  readonly declaredDraftIds: ReadonlySet<string>;
  readonly dependencies: readonly DraftDependency[];
  readonly findings: readonly DraftFinding[];
}

interface DraftReason {
  readonly dependsOn: string;
  readonly via: DraftDependencyKind;
}

type TopoNode = AnyContour | AnyResource | AnySignal | AnyTrail;

const replacedByTarget = (value: TopoNode): string | undefined => {
  const raw = value as unknown as { replacedBy?: unknown };
  return typeof raw.replacedBy === 'string' ? raw.replacedBy : undefined;
};

export const isDraftId = (id: string): boolean =>
  id.startsWith(DRAFT_ID_PREFIX);

const dependenciesFromIds = (
  fromId: string,
  toIds: readonly string[],
  kind: DraftDependencyKind
): DraftDependency[] =>
  toIds.map((toId) => ({
    fromId,
    kind,
    toId,
  }));

const dependencyFromTarget = (
  fromId: string,
  toId: string | undefined,
  kind: DraftDependencyKind
): DraftDependency[] =>
  toId === undefined
    ? []
    : [
        {
          fromId,
          kind,
          toId,
        },
      ];

const trailDependencies = (trail: AnyTrail): DraftDependency[] => [
  ...dependenciesFromIds(
    trail.id,
    (trail.contours ?? []).map((contour) => contour.name),
    'contour'
  ),
  ...dependenciesFromIds(trail.id, trail.crosses, 'cross'),
  ...dependenciesFromIds(
    trail.id,
    trail.resources.map(({ id }) => id),
    'resource'
  ),
  ...dependencyFromTarget(trail.id, replacedByTarget(trail), 'replaced-by'),
];

const contourDependencies = (contour: AnyContour): DraftDependency[] =>
  dependenciesFromIds(
    contour.name,
    getContourReferences(contour).map((reference) => reference.contour),
    'schema-reference'
  );

const signalDependencies = (signal: AnySignal): DraftDependency[] => [
  ...dependenciesFromIds(signal.id, signal.from ?? [], 'signal-from'),
  ...dependencyFromTarget(signal.id, replacedByTarget(signal), 'replaced-by'),
];

const resourceDependencies = (resource: AnyResource): DraftDependency[] =>
  dependencyFromTarget(resource.id, replacedByTarget(resource), 'replaced-by');

const nodeKind = (
  id: string,
  contours: ReadonlyMap<string, AnyContour>,
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>,
  resources: ReadonlyMap<string, AnyResource>
): DraftFinding['kind'] => {
  if (contours.has(id)) {
    return 'contour';
  }
  if (trails.has(id)) {
    return 'trail';
  }
  if (signals.has(id)) {
    return 'signal';
  }
  if (resources.has(id)) {
    return 'resource';
  }
  return 'unknown';
};

const displayKind = (kind: DraftFinding['kind']): string =>
  kind === 'unknown' ? 'Node' : kind[0]?.toUpperCase() + kind.slice(1);

const draftIdsFromKeys = (keys: Iterable<string>): string[] =>
  [...keys].filter(isDraftId);

const collectDeclaredDraftIds = (topo: Topo): ReadonlySet<string> =>
  new Set([
    ...draftIdsFromKeys(topo.contours.keys()),
    ...draftIdsFromKeys(topo.trails.keys()),
    ...draftIdsFromKeys(topo.signals.keys()),
    ...draftIdsFromKeys(topo.resources.keys()),
  ]);

const findingForDraftId = (
  id: string,
  kind: DraftFinding['kind']
): DraftFinding => ({
  id,
  kind,
  message: `${displayKind(id ? kind : 'unknown')} "${id}" is draft and cannot appear in the established graph.`,
  rule: 'draft-id',
});

const findingForContamination = (
  id: string,
  kind: DraftFinding['kind'],
  reason: DraftReason
): DraftFinding => {
  const dependencyLabel = isDraftId(reason.dependsOn)
    ? `draft "${reason.dependsOn}"`
    : `draft-contaminated "${reason.dependsOn}"`;

  return {
    dependsOn: reason.dependsOn,
    id,
    kind,
    message:
      `Established ${kind} "${id}" depends on ${dependencyLabel} ` +
      `via ${reason.via} and cannot appear in the established graph.`,
    rule: 'draft-contamination',
    via: reason.via,
  };
};

const contaminationReason = (
  dependency: DraftDependency,
  contaminatedIds: ReadonlySet<string>
): DraftReason | undefined => {
  if (contaminatedIds.has(dependency.fromId)) {
    return undefined;
  }

  if (!isDraftId(dependency.toId) && !contaminatedIds.has(dependency.toId)) {
    return undefined;
  }

  return {
    dependsOn: dependency.toId,
    via: dependency.kind,
  };
};

const markContaminatedDependency = (
  dependency: DraftDependency,
  contaminatedIds: Set<string>,
  reasons: Map<string, DraftReason>
): boolean => {
  const reason = contaminationReason(dependency, contaminatedIds);

  if (reason === undefined) {
    return false;
  }

  contaminatedIds.add(dependency.fromId);
  reasons.set(dependency.fromId, reason);
  return true;
};

const propagateContaminatedIds = (
  declaredDraftIds: ReadonlySet<string>,
  dependencies: readonly DraftDependency[]
): { contaminatedIds: Set<string>; reasons: Map<string, DraftReason> } => {
  const contaminatedIds = new Set<string>(declaredDraftIds);
  const reasons = new Map<string, DraftReason>();

  const visit = (): void => {
    if (
      dependencies.some((dependency) =>
        markContaminatedDependency(dependency, contaminatedIds, reasons)
      )
    ) {
      visit();
    }
  };

  visit();
  return { contaminatedIds, reasons };
};

const contaminationFindingForId = (
  id: string,
  declaredDraftIds: ReadonlySet<string>,
  reasons: ReadonlyMap<string, DraftReason>,
  contours: ReadonlyMap<string, AnyContour>,
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>,
  resources: ReadonlyMap<string, AnyResource>
): DraftFinding | undefined => {
  if (declaredDraftIds.has(id)) {
    return undefined;
  }

  const reason = reasons.get(id);
  if (reason === undefined) {
    return undefined;
  }

  return findingForContamination(
    id,
    nodeKind(id, contours, trails, signals, resources),
    reason
  );
};

const collectFindings = (
  declaredDraftIds: ReadonlySet<string>,
  contaminatedIds: ReadonlySet<string>,
  reasons: ReadonlyMap<string, DraftReason>,
  contours: ReadonlyMap<string, AnyContour>,
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>,
  resources: ReadonlyMap<string, AnyResource>
): DraftFinding[] => [
  ...[...declaredDraftIds]
    .toSorted()
    .map((id) =>
      findingForDraftId(id, nodeKind(id, contours, trails, signals, resources))
    ),
  ...[...contaminatedIds].toSorted().flatMap((id) => {
    const finding = contaminationFindingForId(
      id,
      declaredDraftIds,
      reasons,
      contours,
      trails,
      signals,
      resources
    );

    return finding === undefined ? [] : [finding];
  }),
];

const collectDependencies = (topo: Topo): DraftDependency[] => [
  ...[...topo.contours.values()].flatMap(contourDependencies),
  ...[...topo.trails.values()].flatMap(trailDependencies),
  ...[...topo.signals.values()].flatMap(signalDependencies),
  ...[...topo.resources.values()].flatMap(resourceDependencies),
];

export const deriveDraftReport = (topo: Topo): DraftReport => {
  const declaredDraftIds = collectDeclaredDraftIds(topo);
  const dependencies = collectDependencies(topo);
  const { contaminatedIds, reasons } = propagateContaminatedIds(
    declaredDraftIds,
    dependencies
  );
  const findings = collectFindings(
    declaredDraftIds,
    contaminatedIds,
    reasons,
    topo.contours,
    topo.trails,
    topo.signals,
    topo.resources
  );

  return {
    contaminatedIds,
    declaredDraftIds,
    dependencies,
    findings,
  };
};

export const validateDraftFreeTopo = (
  topo: Topo
): Result<void, ValidationError> => {
  const analysis = deriveDraftReport(topo);

  if (analysis.findings.length === 0) {
    return Result.ok();
  }

  return Result.err(
    new ValidationError(
      `Established topo validation failed with ${analysis.findings.length} draft issue(s)`,
      {
        context: { issues: analysis.findings },
      }
    )
  );
};
