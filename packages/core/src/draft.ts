import type { AnyEntity } from './entity.js';
import { getEntityReferences } from './entity.js';
import { ValidationError } from './errors.js';
import type { AnySignal } from './signal.js';
import type { AnyResource } from './resource.js';
import { Result } from './result.js';
import type { Topo } from './topo.js';
import type { AnyTrail } from './trail.js';

export const DRAFT_ID_PREFIX = '_draft.';

export type DraftDependencyKind =
  | 'compose'
  | 'entity'
  | 'resource'
  | 'replaced-by'
  | 'schema-reference'
  | 'signal-fire'
  | 'signal-on'
  | 'signal-from';

export interface DraftDependency {
  readonly fromId: string;
  readonly kind: DraftDependencyKind;
  readonly toId: string;
}

export interface DraftDiagnostic {
  readonly id: string;
  readonly kind: 'entity' | 'resource' | 'signal' | 'trail' | 'unknown';
  readonly message: string;
  readonly rule: 'draft-contamination' | 'draft-id';
  readonly via?: DraftDependencyKind | undefined;
  readonly dependsOn?: string | undefined;
}

/**
 * @deprecated Use {@link DraftDiagnostic}. Kept as a source-compatible alias
 * during the v1 vocabulary cutover.
 */
export interface DraftFinding extends DraftDiagnostic {
  readonly id: DraftDiagnostic['id'];
}

export interface DraftReport {
  readonly contaminatedIds: ReadonlySet<string>;
  readonly declaredDraftIds: ReadonlySet<string>;
  readonly dependencies: readonly DraftDependency[];
  readonly findings: readonly DraftDiagnostic[];
}

interface DraftReason {
  readonly dependsOn: string;
  readonly via: DraftDependencyKind;
}

type TopoNode = AnyEntity | AnyResource | AnySignal | AnyTrail;

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
    (trail.entities ?? []).map((entity) => entity.name),
    'entity'
  ),
  ...dependenciesFromIds(trail.id, trail.composes, 'compose'),
  ...dependenciesFromIds(
    trail.id,
    trail.resources.map(({ id }) => id),
    'resource'
  ),
  ...dependenciesFromIds(trail.id, trail.fires ?? [], 'signal-fire'),
  ...dependenciesFromIds(trail.id, trail.on ?? [], 'signal-on'),
  ...dependencyFromTarget(trail.id, replacedByTarget(trail), 'replaced-by'),
];

const entityDependencies = (entity: AnyEntity): DraftDependency[] =>
  dependenciesFromIds(
    entity.name,
    getEntityReferences(entity).map((reference) => reference.entity),
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
  entities: ReadonlyMap<string, AnyEntity>,
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>,
  resources: ReadonlyMap<string, AnyResource>
): DraftDiagnostic['kind'] => {
  if (entities.has(id)) {
    return 'entity';
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

const displayKind = (kind: DraftDiagnostic['kind']): string =>
  kind === 'unknown' ? 'Node' : kind[0]?.toUpperCase() + kind.slice(1);

const draftIdsFromKeys = (keys: Iterable<string>): string[] =>
  [...keys].filter(isDraftId);

const collectDeclaredDraftIds = (topo: Topo): ReadonlySet<string> =>
  new Set([
    ...draftIdsFromKeys(topo.entities.keys()),
    ...draftIdsFromKeys(topo.trails.keys()),
    ...draftIdsFromKeys(topo.signals.keys()),
    ...draftIdsFromKeys(topo.resources.keys()),
  ]);

const findingForDraftId = (
  id: string,
  kind: DraftDiagnostic['kind']
): DraftDiagnostic => ({
  id,
  kind,
  message: `${displayKind(id ? kind : 'unknown')} "${id}" is draft and cannot appear in the established graph.`,
  rule: 'draft-id',
});

const findingForContamination = (
  id: string,
  kind: DraftDiagnostic['kind'],
  reason: DraftReason
): DraftDiagnostic => {
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
  entities: ReadonlyMap<string, AnyEntity>,
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>,
  resources: ReadonlyMap<string, AnyResource>
): DraftDiagnostic | undefined => {
  if (declaredDraftIds.has(id)) {
    return undefined;
  }

  const reason = reasons.get(id);
  if (reason === undefined) {
    return undefined;
  }

  return findingForContamination(
    id,
    nodeKind(id, entities, trails, signals, resources),
    reason
  );
};

const collectFindings = (
  declaredDraftIds: ReadonlySet<string>,
  contaminatedIds: ReadonlySet<string>,
  reasons: ReadonlyMap<string, DraftReason>,
  entities: ReadonlyMap<string, AnyEntity>,
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>,
  resources: ReadonlyMap<string, AnyResource>
): DraftDiagnostic[] => [
  ...[...declaredDraftIds]
    .toSorted()
    .map((id) =>
      findingForDraftId(id, nodeKind(id, entities, trails, signals, resources))
    ),
  ...[...contaminatedIds].toSorted().flatMap((id) => {
    const finding = contaminationFindingForId(
      id,
      declaredDraftIds,
      reasons,
      entities,
      trails,
      signals,
      resources
    );

    return finding === undefined ? [] : [finding];
  }),
];

const collectDependencies = (topo: Topo): DraftDependency[] => [
  ...[...topo.entities.values()].flatMap(entityDependencies),
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
    topo.entities,
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
