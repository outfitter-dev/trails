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

const withNumericFileRenameEvidence = (
  value: typeof report | typeof completionReport
) => ({
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

const numericEvidenceSourceHash = (
  value: ReturnType<typeof withNumericFileRenameEvidence>
): string =>
  hash({
    entries: value.entries,
    fileRenames: value.run.report.fileRenames,
    ledger: value.run.ledger,
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

const sourceHash = (value: typeof report | typeof completionReport): string =>
  hash({
    entries: value.entries,
    fileRenames: undefined,
    ledger: undefined,
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

const run = (provenance = true): Record<string, unknown> => ({
  completionReport,
  completionReportHash: sourceHash(completionReport),
  lockHashAtRun: sourceHash(report),
  plan: {
    kind: 'regrade-plan',
    path: '.trails/regrade/projection-to-derive.json',
    plan,
    provenance: { fields: {} },
    schemaVersion: 1,
    sourceHash: sourceHash(report),
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
          safeApplied: 3,
          sourceHashAfter: sourceHash(completionReport),
          sourceHashBefore: sourceHash(report),
          transitionId: 'v1-projection-derive-render',
        },
      }
    : {}),
  report,
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
  test('indexes validated committed provenance once per transition', () => {
    withHistory(run(), (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.issues).toEqual([]);
      expect(
        index.byTransitionId.get('v1-projection-derive-render')
      ).toMatchObject({
        id: 'history-id',
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
    withHistory(runWithNumericFileRenameEvidence(), (rootDir) => {
      const index = loadGovernedVocabularyHistory(rootDir);

      expect(index.issues).toEqual([]);
      expect(
        index.byTransitionId.get('v1-projection-derive-render')
      ).toBeDefined();
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
