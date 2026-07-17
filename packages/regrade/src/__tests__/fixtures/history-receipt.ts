import {
  regradeClassifiedStateHash,
  regradeReceiptContentHash,
  regradeReceiptPlanContentHash,
} from '../../history-receipt.js';
import type {
  RegradeFormJudgment,
  RegradeHistoryReceipt,
  RegradeReceiptPlan,
} from '../../history-receipt.js';

export const receiptPlanFixture: RegradeReceiptPlan = {
  fileRenames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
  from: 'old',
  id: 'fixture-old-new',
  intent:
    'Move the governed fixture vocabulary. Route /v1 remains authored prose.',
  kind: 'vocabulary',
  preserve: [
    {
      forms: ['old'],
      paths: ['docs/history/**'],
      pattern: 'old route /v1',
      reason: 'Historical teaching evidence',
    },
  ],
  scope: {
    exclude: ['dist/**'],
    include: ['docs/**', 'src/**'],
    policyClassified: [
      {
        disposition: 'historical-by-policy',
        paths: ['docs/history/**'],
        reason: 'Preserve accepted history',
      },
    ],
    teachingSurfaces: ['docs/current/**'],
  },
  to: 'new',
};

export const receiptPlanProvenanceFixture = {
  fields: {
    fileRenames: 'authored' as const,
    from: 'authored' as const,
    id: 'authored' as const,
    intent: 'authored' as const,
    kind: 'derived' as const,
    preserve: 'authored' as const,
    scope: 'authored' as const,
    to: 'authored' as const,
  },
};

export const receiptFormsFixture: RegradeFormJudgment[] = [
  { disposition: 'mapped', form: 'old', target: 'new' },
  {
    disposition: 'unresolved',
    form: 'Oldish',
    reason: 'unclassified-neighbor',
    representative: { line: 7, path: 'src/example.ts' },
  },
];

const planContentHash = regradeReceiptPlanContentHash({
  plan: receiptPlanFixture,
  provenance: receiptPlanProvenanceFixture,
});
const stateHash = regradeClassifiedStateHash({
  caseSensitive: false,
  forms: receiptFormsFixture,
});

const completion = {
  counts: {
    dispositions: {
      'in-family-modified': 1,
      'in-family-unresolved': 1,
    },
    matched: 2,
    preserved: 0,
    review: 1,
    rewritten: 1,
    skippedByReason: {},
    unknown: 1,
  },
  gate: {
    reasons: ['deferred-forms-or-occurrences'],
    remaining: 1,
    status: 'open' as const,
  },
  metrics: { filesChanged: 1, formsMapped: 1, occurrencesRewritten: 1 },
};

const evidence = {
  changedFiles: [
    {
      afterBlobHash: 'b'.repeat(40),
      afterPath: 'src/example.ts',
      beforeBlobHash: 'a'.repeat(40),
      beforePath: 'src/example.ts',
    },
  ],
  detailEvidenceHash: regradeReceiptContentHash({ fixture: 'detail' }),
  lockStateHash: regradeReceiptContentHash({ fixture: 'lock' }),
  policyHash: regradeReceiptContentHash({ fixture: 'policy' }),
  sourceRevision: 'c'.repeat(40),
  sourceStateHash: regradeReceiptContentHash({ fixture: 'source' }),
  toolVersion: '1.0.0-beta.fixture',
};

export const historyReceiptFixture: RegradeHistoryReceipt = {
  conversion: {
    convertedAt: '2026-07-16T20:00:00.000Z',
    fromSchemaVersion: 2,
    sourceContentHash: 'd'.repeat(64),
    toolVersion: '1.0.0-beta.fixture',
  },
  id: 'fixture-old-new',
  kind: 'regrade-history',
  path: '.trails/regrade/history/fixture-old-new.json',
  runs: [
    {
      classifiedState: {
        caseSensitive: false,
        forms: receiptFormsFixture,
        kind: 'embedded',
        stateHash,
      },
      completion,
      evidence,
      intent: {
        kind: 'embedded',
        plan: receiptPlanFixture,
        planContentHash,
        provenance: receiptPlanProvenanceFixture,
      },
      project: { root: '.' },
      runId: 'fixture-original',
      runKind: 'original',
      timestamp: '2026-07-16T20:00:00.000Z',
      transitionId: 'fixture-old-new',
    },
    {
      classifiedState: { kind: 'reference', stateHash },
      completion: {
        counts: {
          dispositions: {},
          matched: 0,
          preserved: 0,
          review: 0,
          rewritten: 0,
          skippedByReason: {},
          unknown: 0,
        },
        gate: { reasons: [], remaining: 0, status: 'green' },
        metrics: {
          filesChanged: 0,
          formsMapped: 0,
          occurrencesRewritten: 0,
        },
      },
      evidence: { ...evidence, changedFiles: [] },
      intent: { kind: 'reference', planContentHash },
      project: { root: '.' },
      runId: 'fixture-proof',
      runKind: 'proof',
      timestamp: '2026-07-16T20:01:00.000Z',
      transitionId: 'fixture-old-new',
    },
  ],
  schemaVersion: 3,
};
