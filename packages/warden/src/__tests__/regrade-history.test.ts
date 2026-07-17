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

const rawHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

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

const report = {
  entries: [1, 2, 3].map((index) => ({
    outcome: 'rewrite',
    path: `src/example-${index}.ts`,
  })),
  matched: 3,
  review: 0,
  rewritten: 3,
  root: '.',
  scan: {
    byDirectory: [],
    byExtension: [],
    files: { matched: 3, scanned: 3, skipped: 0 },
    skippedByReason: {},
  },
  scanned: 3,
  selectedClassIds: [],
  skipped: 0,
  skipsByReason: {},
  unknownClassIds: [],
};

const completionReport = {
  entries: [],
  matched: 0,
  review: 0,
  rewritten: 0,
  root: '.',
  scan: {
    byDirectory: [],
    byExtension: [],
    files: { matched: 0, scanned: 0, skipped: 0 },
    skippedByReason: {},
  },
  scanned: 0,
  selectedClassIds: [],
  skipped: 0,
  skipsByReason: {},
  unknownClassIds: [],
};

type TestReport = (typeof report | typeof completionReport) & {
  readonly run?: {
    readonly ledger: {
      readonly cycle: number;
      readonly forms: Readonly<Record<string, string>>;
      readonly occurrences: readonly Record<string, unknown>[];
    };
    readonly report: Record<string, unknown>;
  };
};

const withNumericFileRenameEvidence = (value: TestReport): TestReport => ({
  ...value,
  run: {
    ledger: { cycle: 1, forms: {}, occurrences: [] },
    report: {
      fileRenames: [
        {
          deferred: 0,
          from: 'src/projection.ts',
          historical: 2,
          preserved: 1,
          rewritten: 1,
          skipped: 1,
          to: 'src/derivation.ts',
        },
      ],
    },
  },
});

const sourceHash = (value: TestReport): string =>
  hash({
    entries: value.entries,
    fileRenames: value.run?.report.fileRenames,
    ledger: value.run?.ledger,
    selectedClassIds: value.selectedClassIds,
  });

const legacyNumericEvidenceSourceHash = (
  value: ReturnType<typeof withNumericFileRenameEvidence>
): string =>
  hash({
    entries: value.entries,
    fileRenames: value.run.report.fileRenames.map(
      ({ deferred, from, rewritten, to }) => ({
        deferred,
        from,
        rewritten,
        to,
      })
    ),
    ledger: value.run.ledger,
    selectedClassIds: value.selectedClassIds,
  });

const policyOccurrence = {
  disposition: 'historical-by-policy',
  form: 'projection',
  line: 1,
  path: 'docs/adr/0050.md',
  reason: 'Published decisions remain immutable.',
  scopeTier: 'policy-classified',
  verdict: 'skipped',
} as const;

const unrelatedNestedJsonPolicyOccurrence = {
  ...policyOccurrence,
  path: 'examples/app/evidence/policy.json',
} as const;

const withPolicyEvidence = (
  value: typeof report | typeof completionReport
) => ({
  ...value,
  run: {
    ledger: {
      cycle: 1,
      forms: { projection: 'skipped' },
      occurrences: [
        policyOccurrence,
        {
          ...policyOccurrence,
          path: '.trails/regrade/projection-to-derive.json',
        },
        {
          ...policyOccurrence,
          path: 'examples/app/.trails/regrade/projection-to-derive.json',
        },
        unrelatedNestedJsonPolicyOccurrence,
      ],
    },
    report: {},
  },
});

const policyEvidenceSourceHash = (
  value: ReturnType<typeof withPolicyEvidence>
): string =>
  hash({
    entries: value.entries,
    fileRenames: undefined,
    ledger: {
      cycle: value.run.ledger.cycle,
      forms: value.run.ledger.forms,
      occurrences: [policyOccurrence, unrelatedNestedJsonPolicyOccurrence],
    },
    selectedClassIds: value.selectedClassIds,
  });

const rawPolicyEvidenceSourceHash = (
  value: ReturnType<typeof withPolicyEvidence>
): string =>
  rawHash({
    entries: value.entries,
    fileRenames: undefined,
    ledger: {
      cycle: value.run.ledger.cycle,
      forms: value.run.ledger.forms,
      occurrences: [policyOccurrence, unrelatedNestedJsonPolicyOccurrence],
    },
    selectedClassIds: value.selectedClassIds,
  });

const legacyPolicyEvidenceSourceHash = (
  value: ReturnType<typeof withPolicyEvidence>
): string =>
  hash({
    entries: value.entries,
    fileRenames: undefined,
    ledger: {
      cycle: value.run.ledger.cycle,
      forms: {},
      occurrences: [],
    },
    selectedClassIds: value.selectedClassIds,
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

const run = (
  provenance = true,
  reportValue: TestReport = report,
  completionValue: TestReport = completionReport
): Record<string, unknown> => ({
  completionReport: completionValue,
  completionReportHash: sourceHash(completionValue),
  lockHashAtRun: sourceHash(reportValue),
  plan: {
    kind: 'regrade-plan',
    path: '.trails/regrade/projection-to-derive.json',
    plan,
    provenance: { fields: {} },
    schemaVersion: 1,
    sourceHash: sourceHash(reportValue),
    transitionId: 'v1-projection-derive-render',
  },
  planContentHash: hash(plan),
  ...(provenance
    ? {
        provenance: {
          disposition: 'applied-clean',
          kind: 'governed-vocabulary',
          planContentHash: hash(plan),
          reviewPending: 0,
          safeApplied: reportValue.rewritten,
          sourceHashAfter: sourceHash(completionValue),
          sourceHashBefore: sourceHash(reportValue),
          transitionId: 'v1-projection-derive-render',
        },
      }
    : {}),
  report: reportValue,
});

const runWithNumericFileRenameEvidence = (
  sourceHashFor = numericEvidenceSourceHash
): Record<string, unknown> => {
  const before = withNumericFileRenameEvidence(report);
  const after = withNumericFileRenameEvidence(completionReport);
  return {
    ...run(),
    completionReport: after,
    completionReportHash: sourceHashFor(after),
    lockHashAtRun: sourceHashFor(before),
    provenance: {
      disposition: 'applied-clean',
      kind: 'governed-vocabulary',
      planContentHash: hash(plan),
      reviewPending: 0,
      safeApplied: 3,
      sourceHashAfter: sourceHashFor(after),
      sourceHashBefore: sourceHashFor(before),
      transitionId: 'v1-projection-derive-render',
    },
    report: before,
  };
};
const runWithPolicyEvidence = (
  sourceHashFor = policyEvidenceSourceHash
): Record<string, unknown> => {
  const before = withPolicyEvidence(report);
  const after = withPolicyEvidence(completionReport);
  return {
    ...run(),
    completionReport: after,
    completionReportHash: sourceHashFor(after),
    lockHashAtRun: sourceHashFor(before),
    provenance: {
      disposition: 'applied-clean',
      kind: 'governed-vocabulary',
      planContentHash: hash(plan),
      reviewPending: 0,
      safeApplied: 3,
      sourceHashAfter: sourceHashFor(after),
      sourceHashBefore: sourceHashFor(before),
      transitionId: 'v1-projection-derive-render',
    },
    report: before,
  };
};
describe('loadGovernedVocabularyHistory', () => {
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

  test('indexes validated committed provenance once per transition', () => {
    withHistory(run(), (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.issues).toEqual([]);
      expect(
        index.byTransitionId.get('v1-projection-derive-render')
      ).toMatchObject({
        caseSensitive: false,
        id: 'history-id',
        latestFormJudgments: [],
        path: '.trails/regrade/history/projection-to-derive.json',
        runCount: 1,
        transitionId: 'v1-projection-derive-render',
      });
    });
  });

  test('indexes id-less governed plans from stamped provenance', () => {
    const idlessRun = run();
    const artifact = idlessRun.plan as {
      plan: Record<string, unknown>;
    };
    const idlessPlan = {
      from: plan.from,
      kind: plan.kind,
      to: plan.to,
    };
    artifact.plan = idlessPlan;
    idlessRun.planContentHash = hash(idlessPlan);
    const provenance = idlessRun.provenance as Record<string, unknown>;
    provenance.planContentHash = hash(idlessPlan);

    withHistory(idlessRun, (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.issues).toEqual([]);
      expect(
        index.byTransitionId.get('v1-projection-derive-render')
      ).toMatchObject({
        id: 'history-id',
        transitionId: 'v1-projection-derive-render',
      });
    });
  });

  test('indexes custom-id governed plans from stamped provenance', () => {
    const customRun = run();
    const artifact = customRun.plan as {
      plan: Record<string, unknown>;
    };
    const customPlan = { ...plan, id: 'local-plan' };
    artifact.plan = customPlan;
    customRun.planContentHash = hash(customPlan);
    const provenance = customRun.provenance as Record<string, unknown>;
    provenance.planContentHash = hash(customPlan);

    withHistory(customRun, (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.issues).toEqual([]);
      expect(
        index.byTransitionId.get('v1-projection-derive-render')
      ).toMatchObject({
        id: 'history-id',
        transitionId: 'v1-projection-derive-render',
      });
    });
  });

  test('accepts authoritative numeric file-rename evidence', () => {
    withHistory(
      run(
        true,
        withNumericFileRenameEvidence(report),
        withNumericFileRenameEvidence(completionReport)
      ),
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);

        expect(index.issues).toEqual([]);
        expect(
          index.byTransitionId.get('v1-projection-derive-render')
        ).toBeDefined();
      }
    );
  });

  test('indexes latest-run vocabulary form observations', () => {
    const preApplyObservation = {
      column: 7,
      context: 'const projectionist = true;',
      disposition: 'in-family-unresolved',
      end: 20,
      form: 'projectionist',
      line: 3,
      path: 'src/example.ts',
      reason: 'unclassified-neighbor',
      scopeTier: 'in-scope',
      start: 6,
      verdict: 'deferred',
    };
    const completionObservation = {
      ...preApplyObservation,
      form: 'derivationist',
      line: 5,
    };
    const reportWithObservation: TestReport = {
      ...report,
      run: {
        ledger: {
          cycle: 1,
          forms: { projectionist: 'deferred' },
          occurrences: [preApplyObservation],
        },
        report: {},
      },
    };
    const completionWithObservation: TestReport = {
      ...completionReport,
      run: {
        ledger: {
          cycle: 2,
          forms: { derivationist: 'deferred' },
          occurrences: [completionObservation],
        },
        report: {},
      },
    };

    withHistory(
      run(true, reportWithObservation, completionWithObservation),
      (rootDir) => {
        const history = loadGovernedVocabularyHistory(
          rootDir
        ).byTransitionId.get('v1-projection-derive-render');

        expect(history?.latestFormJudgments).toEqual([
          {
            disposition: 'unresolved',
            form: 'derivationist',
            reason: 'unclassified-neighbor',
            representative: { line: 5, path: 'src/example.ts' },
          },
        ]);
      }
    );
  });

  test('accepts legacy minimal occurrences without projecting observations', () => {
    const legacyCompletionReport: TestReport = {
      ...completionReport,
      run: {
        ledger: {
          cycle: 1,
          forms: { projectionist: 'skipped' },
          occurrences: [
            {
              form: 'projectionist',
              path: 'docs/history.md',
              scopeTier: 'legacy-policy',
            },
          ],
        },
        report: {},
      },
    };

    withHistory(run(true, report, legacyCompletionReport), (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.issues).toEqual([]);
      expect(
        index.byTransitionId.get('v1-projection-derive-render')
          ?.latestFormJudgments
      ).toEqual([]);
    });
  });

  test('accepts immutable histories stamped before complete file evidence hashing', () => {
    withHistory(
      runWithNumericFileRenameEvidence(legacyNumericEvidenceSourceHash),
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);

        expect(index.issues).toEqual([]);
        expect(
          index.byTransitionId.get('v1-projection-derive-render')
        ).toBeDefined();
      }
    );
  });

  test('accepts external policy evidence while excluding generated Regrade artifacts', () => {
    withHistory(runWithPolicyEvidence(), (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.issues).toEqual([]);
      expect(
        index.byTransitionId.get('v1-projection-derive-render')
      ).toBeDefined();
    });
  });

  test('accepts immutable histories stamped before policy evidence hashing', () => {
    withHistory(
      runWithPolicyEvidence(legacyPolicyEvidenceSourceHash),
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);

        expect(index.issues).toEqual([]);
        expect(
          index.byTransitionId.get('v1-projection-derive-render')
        ).toBeDefined();
      }
    );
  });

  test('accepts raw legacy hashes before passthrough occurrences are parsed', () => {
    withHistory(
      runWithPolicyEvidence(rawPolicyEvidenceSourceHash),
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);

        expect(index.issues).toEqual([]);
        expect(
          index.byTransitionId.get('v1-projection-derive-render')
        ).toBeDefined();
      }
    );
  });

  test('rejects required histories without governed provenance', () => {
    withHistory(run(false), (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.byTransitionId.size).toBe(0);
      expect(index.issues).toEqual([
        {
          message:
            'Committed Regrade history lacks required governed provenance.',
          path: '.trails/regrade/history/projection-to-derive.json',
          transitionId: 'v1-projection-derive-render',
        },
      ]);
    });
  });

  test('rejects required histories when any recorded run lacks provenance', () => {
    withHistory([run(false), run()], (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.byTransitionId.size).toBe(0);
      expect(index.issues[0]?.message).toBe(
        'Committed Regrade history lacks required governed provenance.'
      );
    });
  });

  test('rejects provenance whose deterministic counts were hand-authored', () => {
    const tampered = run();
    const provenance = tampered.provenance as Record<string, unknown>;
    provenance.safeApplied = 99;

    withHistory(tampered, (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.byTransitionId.size).toBe(0);
      expect(index.issues[0]?.message).toBe(
        'Committed Regrade history has invalid deterministic run evidence.'
      );
    });
  });

  test('rejects required history with an invented occurrence classification', () => {
    const reportWithInvalidClassification = {
      ...report,
      run: {
        ledger: {
          cycle: 1,
          forms: { projectionist: 'deferred' },
          occurrences: [
            {
              column: 7,
              context: 'const projectionist = true;',
              disposition: 'invented-classification',
              end: 20,
              form: 'projectionist',
              line: 3,
              path: 'src/example.ts',
              reason: 'unclassified-neighbor',
              scopeTier: 'in-scope',
              start: 6,
              verdict: 'deferred',
            },
          ],
        },
        report: {},
      },
    } as TestReport;

    withHistory(run(true, reportWithInvalidClassification), (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.byTransitionId.size).toBe(0);
      expect(index.issues[0]?.message).toBe(
        'Committed Regrade history has invalid deterministic run evidence.'
      );
    });
  });

  test('rejects modern occurrences with an invented scope tier', () => {
    const reportWithInvalidScopeTier = {
      ...report,
      run: {
        ledger: {
          cycle: 1,
          forms: { projectionist: 'deferred' },
          occurrences: [
            {
              column: 7,
              context: 'const projectionist = true;',
              disposition: 'in-family-unresolved',
              end: 20,
              form: 'projectionist',
              line: 3,
              path: 'src/example.ts',
              reason: 'unclassified-neighbor',
              scopeTier: 'legacy-policy',
              start: 6,
              verdict: 'deferred',
            },
          ],
        },
        report: {},
      },
    } as TestReport;

    withHistory(run(true, reportWithInvalidScopeTier), (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.byTransitionId.size).toBe(0);
      expect(index.issues[0]?.message).toBe(
        'Committed Regrade history has invalid deterministic run evidence.'
      );
    });
  });

  test('rejects source and plan stamps that do not match recorded evidence', () => {
    const tampered = run();
    tampered.planContentHash = 'a'.repeat(64);

    withHistory(tampered, (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.byTransitionId.size).toBe(0);
      expect(index.issues[0]?.message).toBe(
        'Committed Regrade history has invalid deterministic run evidence.'
      );
    });
  });

  test('rejects history artifacts without the authoritative schema version', () => {
    withHistory(
      run(),
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);

        expect(index.byTransitionId.size).toBe(0);
        expect(index.issues[0]?.message).toBe(
          'Committed Regrade history has an invalid evidence shape.'
        );
      },
      { schemaVersion: undefined }
    );
  });

  test('rejects partial plan artifacts that Regrade cannot read', () => {
    const partial = run();
    partial.plan = { plan };

    withHistory(partial, (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.byTransitionId.size).toBe(0);
      expect(index.issues[0]?.message).toBe(
        'Committed Regrade history has an invalid evidence shape.'
      );
    });
  });

  test('rejects history whose embedded path differs from the observed file', () => {
    withHistory(
      run(),
      (rootDir) => {
        const index = loadGovernedVocabularyHistory(rootDir);

        expect(index.byTransitionId.size).toBe(0);
        expect(index.issues[0]?.message).toBe(
          'Committed Regrade history path does not match its observed file.'
        );
      },
      { path: '.trails/regrade/history/other.json' }
    );
  });
});
