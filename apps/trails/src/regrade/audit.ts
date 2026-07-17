import {
  InternalError,
  isPlainObject,
  matchesAnyPathGlob,
  NotFoundError,
  Result,
  ValidationError,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import {
  listVocabularyRegradeAuditPlansFromRegistry,
  regradeReportOutput,
  runVocabularyRegrade,
  vocabularyDispositionValues,
  vocabularyRegradePlanForInput,
  vocabularyRegradeTransitionForInput,
} from '@ontrails/regrade';
import type { VocabularyRegradePlan } from '@ontrails/regrade';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';

import { deriveLiveApiPreserveInventory } from './live-api-preserve.js';
import {
  readRegradeHistoryArtifact,
  regradeHistoryPathForPlan,
} from './history.js';
import { rootRelativePath } from './plan-artifact.js';

const sourceCommentExtensions = [
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
] as const;

export const regradeAuditInputSchema = z.object({
  failOnOpen: z
    .boolean()
    .default(false)
    .describe('Fail when a completed transition has current-tree residue'),
  includeEntries: z
    .enum(['actionable', 'all'])
    .default('actionable')
    .describe('Report entry detail to include for each audited transition'),
  rootDir: z.string().optional().describe('Workspace root directory'),
  transitionIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Governed transition ids to audit; defaults to applied history'),
});

const regradeAuditTransitionSchema = z.object({
  report: z
    .object({
      dispositions: z
        .partialRecord(
          z.enum(vocabularyDispositionValues),
          z.number().int().nonnegative()
        )
        .describe('Current source occurrence counts by classification'),
      entries: regradeReportOutput.shape.entries
        .readonly()
        .describe('Actionable file-level residue details'),
      occurrences: z
        .number()
        .int()
        .nonnegative()
        .describe('Total classified current-source occurrences'),
      open: z
        .number()
        .int()
        .nonnegative()
        .describe('Unresolved current-source occurrences'),
      scanned: z.number().int().nonnegative().describe('Files scanned'),
      status: z.enum(['green', 'open']).describe('Transition audit status'),
    })
    .describe('Concise current-tree audit of the latest applied plan'),
  source: z.string().describe('Committed Regrade history artifact'),
  transitionId: z.string().describe('Stable Regrade transition identity'),
});

export const regradeAuditOutputSchema = z.object({
  gate: z.object({
    open: z
      .number()
      .int()
      .nonnegative()
      .describe('Current-tree unresolved occurrence count'),
    status: z
      .enum(['green', 'open'])
      .describe('Whether every audited transition remains complete'),
  }),
  transitions: z
    .array(regradeAuditTransitionSchema)
    .describe('Applied vocabulary transitions audited against current source'),
});

export type RegradeAuditInput = z.output<typeof regradeAuditInputSchema>;
export type RegradeAuditOutput = z.output<typeof regradeAuditOutputSchema>;

interface RegradeAuditCandidate {
  readonly plan: VocabularyRegradePlan;
  readonly source: string;
  readonly transitionId: string;
}

/**
 * Read the governed transition id from legacy history or v3 embedded intent.
 *
 * @internal
 */
export const historyTransitionId = (
  rawHistory: unknown
): string | undefined => {
  if (!isPlainObject(rawHistory)) {
    return undefined;
  }
  const { id, runs } = rawHistory;
  const historyRuns = Array.isArray(runs) ? runs : [];
  const latestRun = historyRuns.at(-1);
  const planArtifact = isPlainObject(latestRun) ? latestRun['plan'] : undefined;
  const plan = isPlainObject(planArtifact) ? planArtifact['plan'] : undefined;
  const planId = isPlainObject(plan) ? plan['id'] : undefined;
  if (typeof planId === 'string') {
    return planId;
  }
  for (const run of historyRuns.toReversed()) {
    const intent = isPlainObject(run) ? run['intent'] : undefined;
    const intentPlan = isPlainObject(intent) ? intent['plan'] : undefined;
    const intentPlanId = isPlainObject(intentPlan)
      ? intentPlan['id']
      : undefined;
    if (typeof intentPlanId === 'string') {
      return intentPlanId;
    }
  }
  return typeof id === 'string' ? id : undefined;
};

const selectedHistoryFileNamesFor = (
  selectedTransitionIds: ReadonlySet<string> | null,
  registryPlansById: ReadonlyMap<string, VocabularyRegradePlan>
): ReadonlySet<string> =>
  new Set(
    selectedTransitionIds === null
      ? []
      : [...selectedTransitionIds].flatMap((transitionId) => {
          const plan = registryPlansById.get(transitionId);
          return plan === undefined
            ? []
            : [basename(regradeHistoryPathForPlan('.', plan))];
        })
  );

const historyIsSelected = (
  rawHistory: unknown,
  historyFile: string,
  selectedTransitionIds: ReadonlySet<string> | null,
  selectedHistoryFileNames: ReadonlySet<string>
): boolean =>
  selectedTransitionIds === null ||
  selectedTransitionIds.has(historyTransitionId(rawHistory) ?? '') ||
  selectedHistoryFileNames.has(basename(historyFile));

export const mergeAuditPlan = (
  latestPlan: VocabularyRegradePlan,
  registryPlan: VocabularyRegradePlan | undefined
): VocabularyRegradePlan => {
  if (registryPlan === undefined) {
    return latestPlan;
  }
  const policyClassified = [
    ...(latestPlan.scope?.policyClassified ?? []),
    ...(registryPlan.scope?.policyClassified ?? []),
  ];
  const teachingSurfaces = [
    ...new Set([
      ...(latestPlan.scope?.teachingSurfaces ?? []),
      ...(registryPlan.scope?.teachingSurfaces ?? []),
    ]),
  ].toSorted();
  const scope =
    latestPlan.scope === undefined && registryPlan.scope === undefined
      ? undefined
      : {
          ...registryPlan.scope,
          ...latestPlan.scope,
          ...(policyClassified.length === 0 ? {} : { policyClassified }),
          ...(teachingSurfaces.length === 0 ? {} : { teachingSurfaces }),
        };
  return {
    ...registryPlan,
    ...latestPlan,
    preserve: [
      ...(latestPlan.preserve ?? []),
      ...(registryPlan.preserve ?? []),
    ],
    ...(scope === undefined ? {} : { scope }),
  };
};

const readRegradeAuditCandidates = (
  rootDir: string,
  selectedTransitionIds: ReadonlySet<string> | null
): TrailsResult<readonly RegradeAuditCandidate[], Error> => {
  const historyDir = join(rootDir, '.trails', 'regrade', 'history');
  if (!existsSync(historyDir)) {
    return Result.ok([]);
  }
  let historyFiles: readonly string[];
  try {
    historyFiles = readdirSync(historyDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => join(historyDir, entry.name))
      .toSorted();
  } catch (error) {
    return Result.err(
      new InternalError('Failed to list Regrade history artifacts.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { historyDir },
      })
    );
  }
  const registryPlansById = new Map(
    listVocabularyRegradeAuditPlansFromRegistry().flatMap((plan) =>
      plan.id === undefined ? [] : [[plan.id, plan] as const]
    )
  );
  const selectedHistoryFileNames = selectedHistoryFileNamesFor(
    selectedTransitionIds,
    registryPlansById
  );
  const selectedHistoriesHaveCanonicalFileNames =
    selectedTransitionIds !== null &&
    selectedHistoryFileNames.size === selectedTransitionIds.size;
  const candidates: RegradeAuditCandidate[] = [];
  for (const historyFile of historyFiles) {
    if (
      selectedHistoriesHaveCanonicalFileNames &&
      !selectedHistoryFileNames.has(basename(historyFile))
    ) {
      continue;
    }
    let rawHistory: unknown;
    try {
      rawHistory = JSON.parse(readFileSync(historyFile, 'utf8'));
    } catch (error) {
      return Result.err(
        new InternalError('Failed to read Regrade history audit plan.', {
          ...(error instanceof Error ? { cause: error } : {}),
          context: { historyFile },
        })
      );
    }
    if (
      !historyIsSelected(
        rawHistory,
        historyFile,
        selectedTransitionIds,
        selectedHistoryFileNames
      )
    ) {
      continue;
    }
    const history = readRegradeHistoryArtifact(historyFile);
    if (history.isErr()) {
      return history;
    }
    const latestPlan = history.value.runs.at(-1)?.plan.plan as
      | VocabularyRegradePlan
      | undefined;
    if (latestPlan?.kind !== 'vocabulary') {
      continue;
    }
    const transitionId = latestPlan.id ?? history.value.id;
    if (
      selectedTransitionIds !== null &&
      !selectedTransitionIds.has(transitionId)
    ) {
      continue;
    }
    const registryPlan =
      registryPlansById.get(transitionId) ??
      vocabularyRegradePlanForInput(latestPlan.from, latestPlan.to) ??
      undefined;
    candidates.push({
      plan: mergeAuditPlan(latestPlan, registryPlan),
      source: rootRelativePath(rootDir, historyFile),
      transitionId,
    });
  }
  return Result.ok(
    candidates.toSorted((left, right) =>
      left.transitionId.localeCompare(right.transitionId)
    )
  );
};

type VocabularyPolicyClassified = NonNullable<
  NonNullable<VocabularyRegradePlan['scope']>['policyClassified']
>;

/**
 * Select full evidence for classified paths and comments elsewhere.
 *
 * @internal
 */
export const sourceKindForRegradeAuditPath = (
  path: string,
  policyClassified: VocabularyPolicyClassified | undefined
): 'all' | 'comments' => {
  const isPolicyClassified = policyClassified?.some((policy) =>
    matchesAnyPathGlob(path, policy.paths)
  );
  return sourceCommentExtensions.includes(
    extname(path) as (typeof sourceCommentExtensions)[number]
  ) && !isPolicyClassified
    ? 'comments'
    : 'all';
};

export const projectPolicyClassifiedForMarkdownAudit = (
  plan: VocabularyRegradePlan,
  includeCodeComments = false
): VocabularyPolicyClassified | undefined => {
  const auditedExtensions = new Set<string>([
    '.md',
    '.mdx',
    ...(includeCodeComments ? sourceCommentExtensions : []),
  ]);
  return plan.scope?.policyClassified
    ?.map((policy) => ({
      ...policy,
      paths: policy.paths.filter(
        (path) =>
          !plan.scope?.exclude?.some(
            (excludedPath) =>
              excludedPath === path || matchesAnyPathGlob(path, [excludedPath])
          )
      ),
    }))
    .filter((policy) => policy.paths.length > 0)
    .map((policy) => {
      const hasAuditablePath = policy.paths.some((path) => {
        const extension = extname(path);
        if (auditedExtensions.has(extension)) {
          return true;
        }
        const terminalPattern = basename(path);
        const trailingWildcards = terminalPattern.match(/[*?]+$/)?.[0];
        const canSelectAuditedExtension =
          extension === '' &&
          trailingWildcards !== undefined &&
          [...auditedExtensions].some(
            (auditedExtension) =>
              trailingWildcards.includes('*') ||
              (trailingWildcards.length >= auditedExtension.length &&
                (terminalPattern.length > trailingWildcards.length ||
                  trailingWildcards.length > auditedExtension.length))
          );
        return (
          includeCodeComments &&
          (canSelectAuditedExtension ||
            [...auditedExtensions].some((auditedExtension) =>
              matchesAnyPathGlob(auditedExtension, [extension])
            ))
        );
      });
      if (policy.expectMatches !== true || hasAuditablePath) {
        return policy;
      }
      // An extension-filtered audit cannot prove evidence for a path whose
      // authored pattern does not identify one of the audited file families.
      const { expectMatches: _, ...markdownPolicy } = policy;
      return markdownPolicy;
    });
};

export const projectExcludesForMarkdownAudit = (
  plan: VocabularyRegradePlan,
  policyClassified: VocabularyPolicyClassified | undefined
): readonly string[] | undefined =>
  plan.scope?.exclude?.filter(
    (excludedPath) =>
      !policyClassified?.some((policy) =>
        policy.paths.some((path) => matchesAnyPathGlob(excludedPath, [path]))
      )
  );

export const projectIncludesForMarkdownAudit = (
  plan: VocabularyRegradePlan,
  policyClassified: VocabularyPolicyClassified | undefined
): readonly string[] | undefined => {
  if (plan.scope?.include === undefined) {
    return undefined;
  }
  return [
    ...new Set([
      ...plan.scope.include,
      ...(policyClassified?.flatMap((policy) => policy.paths) ?? []),
      ...(plan.scope.teachingSurfaces ?? []),
    ]),
  ].toSorted();
};

const runRegradeAuditCandidate = async (
  candidate: RegradeAuditCandidate,
  input: RegradeAuditInput,
  rootDir: string
): Promise<TrailsResult<RegradeAuditOutput['transitions'][number], Error>> => {
  const includeCodeComments =
    vocabularyRegradeTransitionForInput(candidate.plan.from, candidate.plan.to)
      ?.target.kind === 'classified';
  const policyClassified = projectPolicyClassifiedForMarkdownAudit(
    candidate.plan,
    includeCodeComments
  );
  const exclude = projectExcludesForMarkdownAudit(
    candidate.plan,
    policyClassified
  );
  const include = projectIncludesForMarkdownAudit(
    candidate.plan,
    policyClassified
  );
  const auditPlan: VocabularyRegradePlan = {
    ...candidate.plan,
    scope: {
      ...candidate.plan.scope,
      extensions: [
        '.md',
        '.mdx',
        ...(includeCodeComments ? sourceCommentExtensions : []),
      ],
      ...(exclude === undefined ? {} : { exclude }),
      ...(include === undefined ? {} : { include }),
      ...(policyClassified === undefined ? {} : { policyClassified }),
    },
  };
  const preserveResult = await deriveLiveApiPreserveInventory(
    auditPlan,
    rootDir
  );
  if (preserveResult.isErr()) {
    return preserveResult;
  }
  const reportResult = runVocabularyRegrade({
    apply: false,
    includeEntries: input.includeEntries,
    plan: auditPlan,
    ...(preserveResult.value.length === 0
      ? {}
      : { preserveInventory: preserveResult.value }),
    root: rootDir,
    ...(includeCodeComments
      ? {
          sourceKindForPath: (path: string) =>
            sourceKindForRegradeAuditPath(path, policyClassified),
        }
      : {}),
  });
  if (reportResult.isErr()) {
    return reportResult;
  }
  if (reportResult.value === null) {
    return Result.err(
      new NotFoundError('Regrade audit root could not be collected.', {
        context: { rootDir },
      })
    );
  }
  const { run } = reportResult.value;
  if (run === undefined) {
    return Result.err(
      new InternalError('Regrade audit did not produce a vocabulary run.', {
        context: { transitionId: candidate.transitionId },
      })
    );
  }
  const output = regradeAuditTransitionSchema.safeParse({
    report: {
      dispositions: run.report.dispositions,
      entries: reportResult.value.entries,
      occurrences: run.ledger.occurrences.length,
      open: run.report.open,
      scanned: reportResult.value.scanned,
      status: run.report.gate.status,
    },
    source: candidate.source,
    transitionId: candidate.transitionId,
  });
  if (!output.success) {
    return Result.err(
      new InternalError('Regrade audit produced an invalid transition.', {
        context: {
          issues: output.error.issues,
          transitionId: candidate.transitionId,
        },
      })
    );
  }
  return Result.ok(output.data);
};

export const auditRegradeHistory = async (
  input: RegradeAuditInput,
  rootDir: string
): Promise<TrailsResult<RegradeAuditOutput, Error>> => {
  const selectedTransitionIds =
    input.transitionIds === undefined ? null : new Set(input.transitionIds);
  const candidatesResult = readRegradeAuditCandidates(
    rootDir,
    selectedTransitionIds
  );
  if (candidatesResult.isErr()) {
    return candidatesResult;
  }
  const candidates = candidatesResult.value;
  if (selectedTransitionIds !== null) {
    const auditedTransitionIds = new Set(
      candidates.map((candidate) => candidate.transitionId)
    );
    const missingTransitionIds = [...selectedTransitionIds].filter(
      (transitionId) => !auditedTransitionIds.has(transitionId)
    );
    if (missingTransitionIds.length > 0) {
      return Result.err(
        new ValidationError(
          'Selected Regrade audit transitions do not have committed history.',
          { context: { transitionIds: missingTransitionIds.toSorted() } }
        )
      );
    }
  }
  const transitions: RegradeAuditOutput['transitions'][number][] = [];
  for (const candidate of candidates) {
    const transitionResult = await runRegradeAuditCandidate(
      candidate,
      input,
      rootDir
    );
    if (transitionResult.isErr()) {
      return transitionResult;
    }
    transitions.push(transitionResult.value);
  }
  const open = transitions.reduce(
    (total, transition) => total + transition.report.open,
    0
  );
  return Result.ok({
    gate: {
      open,
      status: transitions.some(
        (transition) => transition.report.status === 'open'
      )
        ? 'open'
        : 'green',
    },
    transitions,
  });
};
