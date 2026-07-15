/**
 * Saved Regrade plan artifact shape plus the slug, path, and hash helpers
 * shared by the `regrade` trails and the consolidated Regrade history module.
 */

import { isPlainObject } from '@ontrails/core';
import { vocabularyRegradePlanSchema } from '@ontrails/regrade';
import type {
  RegradeReport,
  RegradeReportEntry,
  VocabularyRegradePlan,
} from '@ontrails/regrade';
import { createHash } from 'node:crypto';
import { join, normalize, relative } from 'node:path';
import { z } from 'zod';

export const REGRADE_PLAN_SCHEMA_VERSION = 1;

const regradePlanProvenanceValueSchema = z.enum(['authored', 'derived']);

const classRegradePlanScopeSchema = z
  .object({
    exclude: z
      .array(z.string())
      .optional()
      .describe('Root-relative path globs excluded from the class run'),
    extensions: z
      .array(z.string())
      .optional()
      .describe('Source file extensions scanned by the class run'),
    include: z
      .array(z.string())
      .optional()
      .describe('Root-relative path globs collected during the class run'),
  })
  .strict();

/**
 * A saved class-mode Regrade plan: which classes run, over what scope, and
 * why. The parallel payload to {@link vocabularyRegradePlanSchema} — the
 * `kind` discriminant keeps existing vocabulary plan artifacts
 * byte-compatible.
 */
const classRegradePlanSchema = z.object({
  classIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Regrade class ids this plan runs'),
  id: z.string().min(1).describe('Stable Regrade plan identifier'),
  intent: z
    .string()
    .optional()
    .describe('Human-authored migration intent for the class run'),
  kind: z.literal('class').describe('Regrade plan kind'),
  name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Authored transition name; keys the saved plan and consolidated history filenames'
    ),
  scope: classRegradePlanScopeSchema
    .optional()
    .describe('Collection scope for the class run'),
});

export type ClassRegradePlan = z.output<typeof classRegradePlanSchema>;

const regradePlanBodySchema = z.discriminatedUnion('kind', [
  vocabularyRegradePlanSchema,
  classRegradePlanSchema,
]);

export type RegradePlanBody = VocabularyRegradePlan | ClassRegradePlan;

const regradeExpansionCandidateSchema = z.union([
  z.object({
    evidence: z
      .array(
        z.object({
          column: z.number().optional(),
          detail: z.string().optional(),
          line: z.number().optional(),
          path: z.string(),
        })
      )
      .default([]),
    kind: z.enum(['file-rename', 'form', 'namespace', 'preserve']),
    reason: z.string().optional(),
    status: z.enum(['pending', 'rejected']).default('pending'),
    suggestedClassification: z.string(),
    value: z.string(),
  }),
  z
    .object({
      detail: z.string().optional(),
      path: z.string(),
      status: z.enum(['pending', 'rejected']).default('pending'),
    })
    .transform((candidate) => ({
      evidence: [
        {
          ...(candidate.detail === undefined
            ? {}
            : { detail: candidate.detail }),
          path: candidate.path,
        },
      ],
      kind: 'file-rename' as const,
      ...(candidate.detail === undefined ? {} : { reason: candidate.detail }),
      status: candidate.status,
      suggestedClassification: 'legacy-path-candidate',
      value: candidate.path,
    })),
]);

export const regradePlanArtifactSchema = z
  .object({
    expansion: z
      .object({
        candidates: z.array(regradeExpansionCandidateSchema).default([]),
      })
      .optional(),
    kind: z.literal('regrade-plan'),
    path: z.string(),
    plan: regradePlanBodySchema,
    provenance: z.object({
      fields: z.record(z.string(), regradePlanProvenanceValueSchema),
    }),
    schemaVersion: z.literal(REGRADE_PLAN_SCHEMA_VERSION),
    sourceHash: z.string(),
    transitionId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Stable transition identity this plan re-runs; preserves the consolidated history spine'
      ),
  })
  .strict();

export interface RegradePlanExpansion {
  readonly candidates: readonly {
    readonly evidence: readonly {
      readonly column?: number | undefined;
      readonly detail?: string | undefined;
      readonly line?: number | undefined;
      readonly path: string;
    }[];
    readonly kind: 'file-rename' | 'form' | 'namespace' | 'preserve';
    readonly reason?: string | undefined;
    readonly status: 'pending' | 'rejected';
    readonly suggestedClassification: string;
    readonly value: string;
  }[];
}

export interface RegradePlanArtifact {
  readonly expansion?: RegradePlanExpansion | undefined;
  readonly kind: 'regrade-plan';
  readonly path: string;
  readonly plan: RegradePlanBody;
  readonly provenance: {
    readonly fields: Readonly<Record<string, 'authored' | 'derived'>>;
  };
  readonly schemaVersion: typeof REGRADE_PLAN_SCHEMA_VERSION;
  readonly sourceHash: string;
  readonly transitionId?: string | undefined;
}

/** A plan artifact narrowed to a vocabulary plan body. */
export type VocabularyRegradePlanArtifact = RegradePlanArtifact & {
  readonly plan: VocabularyRegradePlan;
};

const regradeSlugText = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

const regradePlanSlug = (plan: Pick<VocabularyRegradePlan, 'from' | 'to'>) =>
  regradeSlugText(`${plan.from}-to-${plan.to}`);

export const regradePlanSlugForBody = (plan: RegradePlanBody): string =>
  plan.kind === 'class'
    ? regradeSlugText(plan.name ?? plan.classIds.join('-'))
    : regradePlanSlug(plan);

const normalizeRelativePath = (path: string): string =>
  normalize(path).replaceAll('\\', '/');

export const rootRelativePath = (
  rootDir: string,
  absolutePath: string
): string => normalizeRelativePath(relative(rootDir, absolutePath));

export const regradePlanDirectory = (rootDir: string): string =>
  join(rootDir, '.trails', 'regrade');

export const regradePlanPathForPlan = (
  rootDir: string,
  plan: RegradePlanBody
): string =>
  join(regradePlanDirectory(rootDir), `${regradePlanSlugForBody(plan)}.json`);

const sourceHashEntryFacts = (
  entries: readonly RegradeReportEntry[]
): readonly Pick<
  RegradeReportEntry,
  'classId' | 'notes' | 'outcome' | 'path' | 'reason' | 'reviewDetails'
>[] =>
  entries
    .filter(
      (entry) => entry.outcome === 'rewrite' || entry.outcome === 'needs-review'
    )
    .map(({ classId, notes, outcome, path, reason, reviewDetails }) => ({
      ...(classId === undefined ? {} : { classId }),
      ...(notes === undefined ? {} : { notes }),
      outcome,
      path,
      ...(reason === undefined ? {} : { reason }),
      ...(reviewDetails === undefined ? {} : { reviewDetails }),
    }));

const canonicalizeJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonicalizeJsonValue(value[key])])
    );
  }
  return value;
};

/**
 * JSON.stringify with recursively sorted object keys so structurally equal
 * values serialize identically regardless of key insertion order. Arrays keep
 * their authored order.
 */
export const canonicalJsonStringify = (value: unknown): string =>
  JSON.stringify(canonicalizeJsonValue(value));

export const isGeneratedRegradeArtifactPath = (path: string): boolean =>
  /(?:^|\/)\.trails\/regrade\/.+\.json$/u.test(path);

const sourceHashLedgerFacts = (report: RegradeReport): unknown => {
  const ledger = report.run?.ledger;
  if (ledger === undefined) {
    return undefined;
  }
  // The active plan is written after its source hash and must not stale itself.
  const occurrences = ledger.occurrences.filter(
    (occurrence) =>
      occurrence.scopeTier !== 'policy-classified' ||
      !isGeneratedRegradeArtifactPath(occurrence.path)
  );
  const forms = new Set(occurrences.map((occurrence) => occurrence.form));
  return {
    cycle: ledger.cycle,
    forms: Object.fromEntries(
      Object.entries(ledger.forms).filter(([form]) => forms.has(form))
    ),
    occurrences,
  };
};

const regradeSourceHashFacts = (report: RegradeReport): unknown => ({
  entries: sourceHashEntryFacts(report.entries),
  ledger: sourceHashLedgerFacts(report),
  selectedClassIds: report.selectedClassIds,
});

const hashSerializedSourceFacts = (serialized: string): string =>
  createHash('sha256').update(serialized).digest('hex');

export const regradeSourceHash = (report: RegradeReport): string =>
  hashSerializedSourceFacts(
    canonicalJsonStringify(regradeSourceHashFacts(report))
  );

export const legacyRegradeSourceHash = (report: RegradeReport): string =>
  hashSerializedSourceFacts(JSON.stringify(regradeSourceHashFacts(report)));

/** Match source evidence written before canonical JSON hashing. */
export const regradeSourceHashMatches = (
  stampedHash: string,
  report: RegradeReport
): boolean =>
  stampedHash === regradeSourceHash(report) ||
  stampedHash === legacyRegradeSourceHash(report);

export const regradeSourceHashes = (
  report: RegradeReport
): readonly string[] => [
  ...new Set([regradeSourceHash(report), legacyRegradeSourceHash(report)]),
];

/**
 * Canonical content hash of a resolved Regrade plan body — the authored
 * migration intent. Stable across key insertion order; changes on any edit to
 * the plan contents.
 */
export const regradePlanContentHash = (plan: RegradePlanBody): string =>
  createHash('sha256').update(canonicalJsonStringify(plan)).digest('hex');
