import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadGovernedVocabularyHistory } from '../regrade-history.js';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
};

const hash = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');

const plan = {
  from: 'projection',
  id: 'v1-projection-derive-render',
  kind: 'vocabulary',
  to: 'derive',
} as const;

const planProvenance = {
  fields: {
    from: 'authored',
    id: 'authored',
    kind: 'derived',
    to: 'authored',
  },
} as const;

const planContentHash = hash({ plan, provenance: planProvenance });

const receiptForms = [
  {
    disposition: 'unresolved',
    form: 'derivationist',
    reason: 'unclassified-neighbor',
    representative: { line: 5, path: 'src/example.ts' },
  },
] as const;

const receiptCompletion = {
  counts: {
    dispositions: { 'in-family-unresolved': 1 },
    matched: 1,
    preserved: 0,
    review: 1,
    rewritten: 0,
    skippedByReason: {},
    unknown: 1,
  },
  gate: {
    reasons: ['deferred-forms-or-occurrences'],
    remaining: 1,
    status: 'open',
  },
  metrics: { filesChanged: 0, formsMapped: 0, occurrencesRewritten: 0 },
} as const;

const receiptEvidence = {
  changedFiles: [],
  detailEvidenceHash: 'a'.repeat(64),
  lockStateHash: 'b'.repeat(64),
  policyHash: 'c'.repeat(64),
  sourceRevision: 'd'.repeat(40),
  sourceStateHash: 'e'.repeat(64),
  toolVersion: '1.0.0-beta.test',
} as const;

const receiptRun = (overrides: Record<string, unknown> = {}) => ({
  classifiedState: {
    caseSensitive: false,
    forms: receiptForms,
    kind: 'embedded',
    stateHash: hash({ caseSensitive: false, forms: receiptForms }),
  },
  completion: receiptCompletion,
  evidence: receiptEvidence,
  intent: {
    kind: 'embedded',
    plan,
    planContentHash,
    provenance: planProvenance,
  },
  project: { root: '.' },
  runId: 'receipt-original',
  runKind: 'original',
  timestamp: '2026-07-16T20:00:00.000Z',
  transitionId: 'v1-projection-derive-render',
  ...overrides,
});

const withHistory = (
  run: Record<string, unknown> | readonly Record<string, unknown>[],
  exercise: (rootDir: string) => void,
  overrides: Record<string, unknown> = {}
): void => {
  const rootDir = mkdtempSync(join(tmpdir(), 'warden-regrade-history-'));
  const directory = join(rootDir, '.trails', 'regrade', 'history');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'projection-to-derive.json'),
    `${JSON.stringify(
      {
        id: 'history-id',
        kind: 'regrade-history',
        path: '.trails/regrade/history/projection-to-derive.json',
        runs: Array.isArray(run) ? run : [run],
        schemaVersion: 2,
        ...overrides,
      },
      null,
      2
    )}\n`
  );
  try {
    exercise(rootDir);
  } finally {
    rmSync(rootDir, { force: true, recursive: true });
  }
};

describe('loadGovernedVocabularyHistory', () => {
  test('rejects legacy v2 history artifacts after governed conversion', () => {
    withHistory(receiptRun(), (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);
      expect(index.byTransitionId.size).toBe(0);
      expect(index.issues).toEqual([
        expect.objectContaining({
          message: expect.stringContaining('invalid deterministic evidence'),
        }),
      ]);
    });
  });

  test('indexes independently validated compact v3 receipts', () => {
    const original = receiptRun();
    withHistory(
      [
        original,
        receiptRun({
          classifiedState: {
            kind: 'reference',
            stateHash: hash({ caseSensitive: false, forms: receiptForms }),
          },
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
          intent: { kind: 'reference', planContentHash },
          runId: 'receipt-proof',
          runKind: 'proof',
          timestamp: '2026-07-16T20:01:00.000Z',
        }),
      ],
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);
        expect(index.issues).toEqual([]);
        expect(
          index.byTransitionId.get('v1-projection-derive-render')
        ).toMatchObject({
          caseSensitive: false,
          latestFormJudgments: receiptForms,
          runCount: 2,
          transitionId: 'v1-projection-derive-render',
        });
      },
      {
        id: 'v1-projection-derive-render',
        schemaVersion: 3,
      }
    );
  });

  test('validates compact receipt completion evidence independently', () => {
    withHistory(
      receiptRun({
        completion: {
          ...receiptCompletion,
          gate: {
            reasons: ['missing-expected-policy-evidence'],
            remaining: 0,
            status: 'open',
          },
        },
      }),
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);
        expect(index.issues).toEqual([]);
        expect(index.byTransitionId.size).toBe(1);
      },
      { id: 'v1-projection-derive-render', schemaVersion: 3 }
    );

    for (const unresolvedCounts of [
      { review: 1, unknown: 0 },
      { review: 0, unknown: 1 },
    ]) {
      withHistory(
        receiptRun({
          completion: {
            ...receiptCompletion,
            counts: {
              ...receiptCompletion.counts,
              ...unresolvedCounts,
            },
            gate: { reasons: [], remaining: 0, status: 'green' },
          },
        }),
        (rootDir) => {
          const index = loadGovernedVocabularyHistory(rootDir);
          expect(index.byTransitionId.size).toBe(0);
          expect(index.issues).toEqual([
            expect.objectContaining({
              message: expect.stringContaining('incoherent completion facts'),
            }),
          ]);
        },
        { id: 'v1-projection-derive-render', schemaVersion: 3 }
      );
    }

    withHistory(
      [
        receiptRun(),
        receiptRun({
          classifiedState: {
            kind: 'reference',
            stateHash: hash({ caseSensitive: false, forms: receiptForms }),
          },
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
              formsMapped: 1,
              occurrencesRewritten: 0,
            },
          },
          intent: { kind: 'reference', planContentHash },
          runId: 'receipt-invalid-proof',
          runKind: 'proof',
          timestamp: '2026-07-16T20:01:00.000Z',
        }),
      ],
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);
        expect(index.byTransitionId.size).toBe(0);
        expect(index.issues).toEqual([
          expect.objectContaining({
            message: expect.stringContaining('invalid proof receipt'),
          }),
        ]);
      },
      { id: 'v1-projection-derive-render', schemaVersion: 3 }
    );
  });

  test('fails closed on broken compact receipt hashes', () => {
    withHistory(
      receiptRun({
        intent: {
          kind: 'embedded',
          plan,
          planContentHash: 'f'.repeat(64),
          provenance: planProvenance,
        },
      }),
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);
        expect(index.byTransitionId.size).toBe(0);
        expect(index.issues).toEqual([
          expect.objectContaining({
            message: expect.stringContaining('invalid embedded plan'),
          }),
        ]);
      },
      { id: 'v1-projection-derive-render', schemaVersion: 3 }
    );
  });

  test('rejects invented receipt plan dispositions independently', () => {
    const inventedPlan = {
      ...plan,
      preserve: [{ disposition: 'invented', pattern: 'projection' }],
    };
    withHistory(
      receiptRun({
        intent: {
          kind: 'embedded',
          plan: inventedPlan,
          planContentHash: hash({
            plan: inventedPlan,
            provenance: planProvenance,
          }),
          provenance: planProvenance,
        },
      }),
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);
        expect(index.byTransitionId.size).toBe(0);
        expect(index.issues).toEqual([
          expect.objectContaining({
            message: expect.stringContaining('invalid evidence shape'),
          }),
        ]);
      },
      { id: 'v1-projection-derive-render', schemaVersion: 3 }
    );
  });
});
