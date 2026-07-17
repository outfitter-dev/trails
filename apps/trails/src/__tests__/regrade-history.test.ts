import type { RegradeReport } from '@ontrails/regrade';
import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  appendRegradeHistoryRun,
  consumeActiveRegradePlanAfterHistoryWrite,
  mintTransitionId,
  readRegradeHistoryArtifact,
  regradeHistoryPathForPlan,
  verifyRegradeHistoryRuns,
  writeRegradeHistoryFileAtomically,
} from '../regrade/history.js';
import {
  captureRegradeChangedFilesBefore,
  completeRegradeChangedFiles,
  readRegradeReceipt,
  serializeRegradeHistoryReceipt,
} from '../regrade/receipt-history.js';
import {
  currentRegradeSourceHashMatches,
  legacyRegradeSourceHash,
  regradePlanContentHash,
  regradePlanSlugForBody,
  regradeSourceHash,
  regradeSourceHashMatches,
  regradeSourceHashes,
} from '../regrade/plan-artifact.js';
import type {
  RegradePlanArtifact,
  RegradePlanBody,
} from '../regrade/plan-artifact.js';

type VocabularyPlanBody = Extract<RegradePlanBody, { kind: 'vocabulary' }>;

const withFixtureDir = (exercise: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'regrade-history-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Trails Test',
        '-c',
        'user.email=trails@example.test',
        'commit',
        '--allow-empty',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: dir }
    );
    exercise(dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

const makePlanBody = (): VocabularyPlanBody => ({
  from: 'facet',
  intent: 'Rename facet to trailhead everywhere.',
  kind: 'vocabulary',
  to: 'trailhead',
});

const makePlanArtifact = (plan: RegradePlanBody): RegradePlanArtifact => ({
  kind: 'regrade-plan',
  path: '.trails/regrade/facet-to-trailhead.json',
  plan,
  provenance: {
    fields: { from: 'authored', kind: 'derived', to: 'authored' },
  },
  schemaVersion: 1,
  sourceHash: 'source-hash-fixture',
});

const makeReport = (selectedClassIds: readonly string[]): RegradeReport => ({
  entries: [],
  matched: 0,
  review: 0,
  rewritten: 0,
  root: '/tmp/regrade-history-fixture',
  scan: {
    byDirectory: [],
    byExtension: [],
    files: { matched: 0, scanned: 1, skipped: 0 },
    skippedByReason: {},
  },
  scanned: 1,
  selectedClassIds,
  skipped: 0,
  skipsByReason: {},
  unknownClassIds: [],
});

const makeReportWithReviewDetail = (): RegradeReport => ({
  ...makeReport(['term-rewrite:no-retired-cross-vocabulary']),
  entries: [
    {
      classId: 'term-rewrite:no-retired-cross-vocabulary',
      outcome: 'needs-review',
      path: 'packages/example/src/trail.ts',
      reason: 'term-review',
      reviewDetails: [
        {
          classId: 'term-rewrite:no-retired-cross-vocabulary',
          matchedForm: 'facet',
          preserveCautions: ['ambiguous context', 'public docs'],
          reason: 'ambiguous-term',
          signals: ['term-rewrite', 'identifier'],
          // oxlint-disable-next-line sort-keys -- non-canonical nested insertion order proves source hashing is order-stable
          span: { start: 12, line: 2, end: 17, column: 13 },
          symbol: 'facet',
        },
      ],
    },
  ],
  matched: 1,
  review: 1,
});

const makeReportWithFileRenameEvidence = (): RegradeReport => ({
  ...makeReportWithReviewDetail(),
  run: {
    ledger: { cycle: 1, forms: {}, occurrences: [] },
    plan: {
      fileRenames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
      from: 'old',
      kind: 'vocabulary',
      to: 'new',
    },
    report: {
      applied: 0,
      deferred: 0,
      dispositions: {},
      fileRenames: [
        {
          deferred: 0,
          from: 'docs/old.md',
          historical: 1,
          preserved: 0,
          rewritten: 0,
          skipped: 1,
          to: 'docs/new.md',
        },
      ],
      filesChanged: 0,
      gate: {
        reasons: [],
        remaining: 0,
        remainingByDisposition: {},
        status: 'green',
      },
      modified: 0,
      open: 0,
      scopeTiers: { 'in-scope': 0, 'policy-classified': 0 },
      skipped: 1,
      teachingSurfaces: { expected: [], missing: [], touched: [] },
    },
  },
});

describe('writeRegradeHistoryFileAtomically', () => {
  test('preserves the prior receipt and removes its temp file when replacement fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'regrade-history-write-'));
    const historyPath = join(dir, 'transition.json');
    try {
      writeFileSync(historyPath, 'prior receipt bytes\n');

      const written = writeRegradeHistoryFileAtomically({
        absolutePath: historyPath,
        content: 'replacement receipt bytes\n',
        diagnosticPath: '.trails/regrade/history/transition.json',
        replace: () => {
          throw new Error('simulated atomic replacement failure');
        },
      });

      expect(written.isErr()).toBe(true);
      expect(readFileSync(historyPath, 'utf8')).toBe('prior receipt bytes\n');
      expect(readdirSync(dir)).toEqual(['transition.json']);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('leaves a new receipt absent when replacement fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'regrade-history-write-'));
    const historyPath = join(dir, 'transition.json');
    try {
      const written = writeRegradeHistoryFileAtomically({
        absolutePath: historyPath,
        content: 'new receipt bytes\n',
        diagnosticPath: '.trails/regrade/history/transition.json',
        replace: () => {
          throw new Error('simulated atomic replacement failure');
        },
      });

      expect(written.isErr()).toBe(true);
      expect(existsSync(historyPath)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('surfaces atomic history rollback failure after plan removal fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'regrade-history-consume-'));
    const historyPath = join(dir, 'transition.json');
    const planPath = join(dir, 'plan.json');
    try {
      writeFileSync(historyPath, 'appended receipt bytes\n');
      writeFileSync(planPath, 'active plan bytes\n');

      const consumed = consumeActiveRegradePlanAfterHistoryWrite({
        absoluteHistoryPath: historyPath,
        absolutePlanPath: planPath,
        historyPath: '.trails/regrade/history/transition.json',
        planPath: '.trails/regrade/transition.json',
        priorHistoryBytes: 'prior receipt bytes\n',
        remove: () => {
          throw new Error('simulated plan removal failure');
        },
        replace: () => {
          throw new Error('simulated history rollback failure');
        },
      });

      expect(consumed.isErr()).toBe(true);
      if (consumed.isErr()) {
        expect(consumed.error.context).toEqual({
          history: '.trails/regrade/history/transition.json',
          historyRollback: 'Failed to atomically write Regrade history.',
          plan: '.trails/regrade/transition.json',
        });
      }
      expect(readFileSync(historyPath, 'utf8')).toBe(
        'appended receipt bytes\n'
      );
      expect(readFileSync(planPath, 'utf8')).toBe('active plan bytes\n');
      expect(readdirSync(dir).toSorted()).toEqual([
        'plan.json',
        'transition.json',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('regradePlanContentHash', () => {
  test('is stable for unchanged plans and changes on any edit', () => {
    const plan = makePlanBody();
    const first = regradePlanContentHash(plan);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(regradePlanContentHash(makePlanBody())).toBe(first);

    // oxlint-disable-next-line sort-keys -- key insertion order is the subject under test
    const reordered: RegradePlanBody = {
      to: 'trailhead',
      kind: 'vocabulary',
      intent: 'Rename facet to trailhead everywhere.',
      from: 'facet',
    };
    expect(regradePlanContentHash(reordered)).toBe(first);

    expect(
      regradePlanContentHash({ ...plan, intent: 'A different intent.' })
    ).not.toBe(first);

    expect(
      regradePlanContentHash({
        ...plan,
        preserve: [{ pattern: 'facet-flag', reason: 'External API name.' }],
      })
    ).not.toBe(first);
  });
});

describe('regradeSourceHash', () => {
  test('is stable across nested report key insertion order while preserving array order', () => {
    const sourceReport = makeReportWithReviewDetail();
    const reorderedReport: RegradeReport = {
      ...sourceReport,
      entries: [
        {
          classId: 'term-rewrite:no-retired-cross-vocabulary',
          outcome: 'needs-review',
          path: 'packages/example/src/trail.ts',
          reason: 'term-review',
          reviewDetails: [
            // oxlint-disable-next-line sort-keys -- alternate nested insertion order is the subject under test
            {
              symbol: 'facet',
              // oxlint-disable-next-line sort-keys -- alternate nested insertion order is the subject under test
              span: { column: 13, end: 17, line: 2, start: 12 },
              signals: ['term-rewrite', 'identifier'],
              reason: 'ambiguous-term',
              preserveCautions: ['ambiguous context', 'public docs'],
              matchedForm: 'facet',
              classId: 'term-rewrite:no-retired-cross-vocabulary',
            },
          ],
        },
      ],
    };
    const reorderedArrayReport: RegradeReport = {
      ...sourceReport,
      entries: [
        {
          ...sourceReport.entries[0],
          reviewDetails: [
            {
              ...sourceReport.entries[0]?.reviewDetails?.[0],
              preserveCautions: ['public docs', 'ambiguous context'],
            },
          ],
        },
      ],
    };

    expect(regradeSourceHash(reorderedReport)).toBe(
      regradeSourceHash(sourceReport)
    );
    expect(regradeSourceHash(reorderedArrayReport)).not.toBe(
      regradeSourceHash(sourceReport)
    );

    const compatibleHashes = regradeSourceHashes(sourceReport);
    expect(compatibleHashes).toHaveLength(2);
    expect(
      compatibleHashes.every((hash) =>
        regradeSourceHashMatches(hash, sourceReport)
      )
    ).toBe(true);
    expect(
      currentRegradeSourceHashMatches(
        regradeSourceHash(sourceReport),
        sourceReport
      )
    ).toBe(true);
    const compatibilityHash = compatibleHashes.find(
      (hash) => hash !== regradeSourceHash(sourceReport)
    );
    expect(compatibilityHash).toBeDefined();
    expect(
      currentRegradeSourceHashMatches(compatibilityHash ?? '', sourceReport)
    ).toBe(false);
  });

  test('changes when protected file-reference evidence changes', () => {
    const sourceReport: RegradeReport = {
      ...makeReport([]),
      run: {
        ledger: { cycle: 1, forms: {}, occurrences: [] },
        plan: {
          fileRenames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
          from: 'old',
          kind: 'vocabulary',
          to: 'new',
        },
        report: {
          applied: 0,
          deferred: 0,
          dispositions: {},
          fileRenames: [
            {
              deferred: 0,
              from: 'docs/old.md',
              historical: 1,
              preserved: 0,
              rewritten: 0,
              skipped: 1,
              to: 'docs/new.md',
            },
          ],
          filesChanged: 0,
          gate: {
            reasons: [],
            remaining: 0,
            remainingByDisposition: {},
            status: 'green',
          },
          modified: 0,
          open: 0,
          scopeTiers: { 'in-scope': 0, 'policy-classified': 1 },
          skipped: 1,
          teachingSurfaces: { expected: [], missing: [], touched: [] },
        },
      },
    };
    const changedReport: RegradeReport = {
      ...sourceReport,
      run: {
        ...sourceReport.run,
        report: {
          ...sourceReport.run?.report,
          fileRenames: sourceReport.run?.report.fileRenames?.map((rename) => ({
            ...rename,
            historical: rename.historical + 1,
            skipped: rename.skipped + 1,
          })),
        },
      },
    };

    expect(regradeSourceHash(changedReport)).not.toBe(
      regradeSourceHash(sourceReport)
    );
    const compatibleHashes = regradeSourceHashes(sourceReport);
    expect(
      compatibleHashes.every((hash) =>
        regradeSourceHashMatches(hash, sourceReport)
      )
    ).toBe(true);
  });
});

describe('appendRegradeHistoryRun', () => {
  test('persists canonical v3 receipts with exact Git blob evidence and hash references', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const relativePath = 'src/example.ts';
      const absolutePath = join(dir, relativePath);
      mkdirSync(join(dir, 'src'));
      writeFileSync(absolutePath, 'const facet = true;\n');
      const report: RegradeReport = {
        ...makeReport([]),
        entries: [{ outcome: 'rewrite', path: relativePath }],
        matched: 1,
        rewritten: 1,
      };
      const before = captureRegradeChangedFilesBefore({
        artifact,
        report,
        rootDir: dir,
      });
      if (before.isErr()) {
        throw before.error;
      }
      const expectedBefore = execFileSync('git', ['hash-object', '--stdin'], {
        cwd: dir,
        encoding: 'utf8',
        input: 'const facet = true;\n',
      }).trim();
      writeFileSync(absolutePath, 'const trailhead = true;\n');
      const changedFiles = completeRegradeChangedFiles({
        before: before.value,
        rootDir: dir,
      });
      if (changedFiles.isErr()) {
        throw changedFiles.error;
      }
      const expectedAfter = execFileSync('git', ['hash-object', '--stdin'], {
        cwd: dir,
        encoding: 'utf8',
        input: 'const trailhead = true;\n',
      }).trim();

      const appended = appendRegradeHistoryRun({
        artifact,
        changedFiles: changedFiles.value,
        completedReport: makeReport([]),
        report,
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }
      expect(appended.value.schemaVersion).toBe(3);

      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const persisted = readFileSync(historyPath, 'utf8');
      expect(persisted).not.toContain(dir);
      expect(persisted).not.toContain('completionReport');
      expect(persisted).not.toContain('ledger');
      const raw = JSON.parse(persisted) as {
        runs: Record<string, unknown>[];
        schemaVersion: number;
      };
      expect(raw.schemaVersion).toBe(3);
      expect(raw.runs[0]?.['evidence']).toMatchObject({
        changedFiles: [
          {
            afterBlobHash: expectedAfter,
            afterPath: relativePath,
            beforeBlobHash: expectedBefore,
            beforePath: relativePath,
          },
        ],
      });

      const resolved = readRegradeReceipt(historyPath);
      if (resolved.isErr()) {
        throw resolved.error;
      }
      const serialized = serializeRegradeHistoryReceipt(
        resolved.value.artifact
      );
      if (serialized.isErr()) {
        throw serialized.error;
      }
      expect(serialized.value).toBe(persisted);
      const mismatchedPath = join(
        dir,
        '.trails/regrade/history/unrelated.json'
      );
      writeFileSync(mismatchedPath, persisted);
      const mismatched = readRegradeHistoryArtifact(mismatchedPath);
      expect(mismatched.isErr()).toBe(true);
      if (mismatched.isErr()) {
        expect(mismatched.error.message).toContain(
          'does not match its observed file'
        );
      }
      const projected = readRegradeHistoryArtifact(historyPath);
      if (projected.isErr()) {
        throw projected.error;
      }
      const verified = verifyRegradeHistoryRuns(projected.value);
      if (verified.isErr()) {
        throw verified.error;
      }
      expect(verified.value).toEqual({ runs: 1 });

      const replay = appendRegradeHistoryRun({
        artifact,
        changedFiles: [],
        report: makeReport([]),
        rootDir: dir,
      });
      if (replay.isErr()) {
        throw replay.error;
      }
      expect(replay.value.status).toBe('replay');
      const replayRaw = JSON.parse(readFileSync(historyPath, 'utf8')) as {
        runs: {
          classifiedState: { kind: string };
          intent: { kind: string };
          runKind: string;
        }[];
      };
      expect(replayRaw.runs[1]).toMatchObject({
        classifiedState: { kind: 'reference' },
        intent: { kind: 'reference' },
        runKind: 'proof',
      });
      const replayProjected = readRegradeHistoryArtifact(historyPath);
      if (replayProjected.isErr()) {
        throw replayProjected.error;
      }
      const replayVerified = verifyRegradeHistoryRuns(replayProjected.value);
      if (replayVerified.isErr()) {
        throw replayVerified.error;
      }
      expect(replayVerified.value).toEqual({ runs: 2 });
    });
  });

  test('records changes hidden by review entries and omits unchanged reviews', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const relativePath = 'src/example.ts';
      const absolutePath = join(dir, relativePath);
      mkdirSync(join(dir, 'src'));
      writeFileSync(absolutePath, 'const facet = true;\n');
      const report: RegradeReport = {
        ...makeReport([]),
        entries: [{ outcome: 'needs-review', path: relativePath }],
        matched: 1,
        review: 1,
      };
      const before = captureRegradeChangedFilesBefore({
        artifact,
        report,
        rootDir: dir,
      });
      if (before.isErr()) {
        throw before.error;
      }

      const unchanged = completeRegradeChangedFiles({
        before: before.value,
        rootDir: dir,
      });
      if (unchanged.isErr()) {
        throw unchanged.error;
      }
      expect(unchanged.value).toEqual([]);

      writeFileSync(absolutePath, 'const trailhead = true;\n');
      const changed = completeRegradeChangedFiles({
        before: before.value,
        rootDir: dir,
      });
      if (changed.isErr()) {
        throw changed.error;
      }
      expect(changed.value).toHaveLength(1);
      expect(changed.value[0]).toMatchObject({
        afterPath: relativePath,
        beforePath: relativePath,
      });
      expect(changed.value[0]?.afterBlobHash).not.toBe(
        changed.value[0]?.beforeBlobHash
      );
    });
  });

  test('does not record a reason-only open completion gate as proof', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const relativePath = 'src/example.ts';
      const absolutePath = join(dir, relativePath);
      mkdirSync(join(dir, 'src'));
      writeFileSync(absolutePath, 'const facet = true;\n');
      const report: RegradeReport = {
        ...makeReport([]),
        entries: [{ outcome: 'rewrite', path: relativePath }],
        matched: 1,
        rewritten: 1,
      };
      const before = captureRegradeChangedFilesBefore({
        artifact,
        report,
        rootDir: dir,
      });
      if (before.isErr()) {
        throw before.error;
      }
      writeFileSync(absolutePath, 'const trailhead = true;\n');
      const changedFiles = completeRegradeChangedFiles({
        before: before.value,
        rootDir: dir,
      });
      if (changedFiles.isErr()) {
        throw changedFiles.error;
      }
      const baseline = appendRegradeHistoryRun({
        artifact,
        changedFiles: changedFiles.value,
        completedReport: makeReport([]),
        report,
        rootDir: dir,
        sourceRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      });
      if (baseline.isErr()) {
        throw baseline.error;
      }

      const openCompletedReport: RegradeReport = {
        ...makeReport([]),
        run: {
          ledger: { cycle: 1, forms: {}, occurrences: [] },
          plan: {
            from: 'facet',
            kind: 'vocabulary',
            to: 'trailhead',
          },
          report: {
            applied: 0,
            deferred: 0,
            dispositions: {},
            filesChanged: 0,
            gate: {
              reasons: ['expected-teaching-surfaces-missing'],
              remaining: 0,
              remainingByDisposition: {},
              status: 'open',
            },
            modified: 0,
            open: 0,
            scopeTiers: { 'in-scope': 0, 'policy-classified': 0 },
            skipped: 0,
            teachingSurfaces: { expected: [], missing: [], touched: [] },
          },
        },
      };
      const rerun = appendRegradeHistoryRun({
        artifact,
        changedFiles: [],
        completedReport: openCompletedReport,
        report: makeReport([]),
        rootDir: dir,
        sourceRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      });
      if (rerun.isErr()) {
        throw rerun.error;
      }

      expect(rerun.value.status).toBe('applied');
      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const receipt = readRegradeReceipt(historyPath);
      if (receipt.isErr()) {
        throw receipt.error;
      }
      expect(receipt.value.artifact.runs.at(-1)).toMatchObject({
        completion: {
          gate: {
            reasons: ['expected-teaching-surfaces-missing'],
            remaining: 0,
            status: 'open',
          },
        },
        runKind: 'adjust',
      });
    });
  });

  test('fails closed when either side of changed-file evidence is missing', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const missingReport: RegradeReport = {
        ...makeReport([]),
        entries: [{ outcome: 'rewrite', path: 'src/missing.ts' }],
        matched: 1,
        rewritten: 1,
      };
      const missingBefore = captureRegradeChangedFilesBefore({
        artifact,
        report: missingReport,
        rootDir: dir,
      });
      expect(missingBefore.isErr()).toBe(true);

      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'src/existing.ts'), 'facet\n');
      const existingReport: RegradeReport = {
        ...missingReport,
        entries: [{ outcome: 'rewrite', path: 'src/existing.ts' }],
      };
      const before = captureRegradeChangedFilesBefore({
        artifact,
        report: existingReport,
        rootDir: dir,
      });
      if (before.isErr()) {
        throw before.error;
      }
      rmSync(join(dir, 'src/existing.ts'));
      const missingAfter = completeRegradeChangedFiles({
        before: before.value,
        rootDir: dir,
      });
      expect(missingAfter.isErr()).toBe(true);
    });
  });

  test('embeds changed zero-action intent as an adjustment instead of a proof', () => {
    withFixtureDir((dir) => {
      const firstArtifact = makePlanArtifact(makePlanBody());
      const first = appendRegradeHistoryRun({
        artifact: firstArtifact,
        changedFiles: [],
        report: makeReport([]),
        rootDir: dir,
      });
      if (first.isErr()) {
        throw first.error;
      }
      const adjustedArtifact = makePlanArtifact({
        ...makePlanBody(),
        intent: 'Changed authored intent with no current matches.',
      });
      const pinnedAdjustedArtifact = {
        ...adjustedArtifact,
        transitionId: first.value.id,
      };
      const adjusted = appendRegradeHistoryRun({
        artifact: pinnedAdjustedArtifact,
        changedFiles: [],
        report: makeReport([]),
        rootDir: dir,
      });
      if (adjusted.isErr()) {
        throw adjusted.error;
      }
      expect(adjusted.value.status).toBe('applied');
      const path = regradeHistoryPathForPlan(dir, pinnedAdjustedArtifact.plan);
      const receipt = readRegradeReceipt(path);
      if (receipt.isErr()) {
        throw receipt.error;
      }
      expect(receipt.value.artifact.runs.at(-1)).toMatchObject({
        classifiedState: { kind: 'reference' },
        intent: { kind: 'embedded' },
        runKind: 'adjust',
      });
    });
  });

  test('persists deterministic governed provenance for safe apply and review follow-up', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact({
        ...makePlanBody(),
        id: 'v1-facet-trailhead',
      });
      const report = {
        ...makeReportWithReviewDetail(),
        apply: {
          applied: 2,
          filesChanged: 2,
          review: 1,
          skipped: 0,
          unknown: 0,
        },
      };
      const completedReport = makeReport([
        'term-rewrite:no-retired-cross-vocabulary',
      ]);

      const appended = appendRegradeHistoryRun({
        artifact,
        completedReport,
        report,
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }
      expect(appended.value.id).toMatch(/^[0-9a-f]{12}$/);
      expect(appended.value.provenance).toEqual({
        disposition: 'review-follow-up',
        kind: 'governed-vocabulary',
        planContentHash: regradePlanContentHash(artifact.plan),
        reviewPending: 1,
        safeApplied: 2,
        sourceHashAfter: regradeSourceHash(completedReport),
        sourceHashBefore: regradeSourceHash(report),
        transitionId: 'v1-facet-trailhead',
      });

      const history = readRegradeHistoryArtifact(
        regradeHistoryPathForPlan(dir, artifact.plan)
      );
      if (history.isErr()) {
        throw history.error;
      }
      expect(history.value.runs[0]?.provenance).toEqual(
        appended.value.provenance
      );
      expect(verifyRegradeHistoryRuns(history.value).isOk()).toBe(true);
    });
  });

  test('resolves governed provenance from an id-less plan pair', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const report = makeReport(['term-rewrite:no-retired-cross-vocabulary']);

      const appended = appendRegradeHistoryRun({
        artifact,
        report,
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }

      expect(appended.value.provenance?.transitionId).toBe(
        'v1-facet-trailhead'
      );
    });
  });

  test('resolves governed provenance from a plan pair with a custom id', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact({
        ...makePlanBody(),
        id: 'local-plan',
      });
      const report = makeReport(['term-rewrite:no-retired-cross-vocabulary']);

      const appended = appendRegradeHistoryRun({
        artifact,
        report,
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }

      expect(appended.value.provenance?.transitionId).toBe(
        'v1-facet-trailhead'
      );
    });
  });

  test('rejects an id-less plan with a governed source and unknown target', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact({
        ...makePlanBody(),
        to: 'unknown-target',
      });

      const appended = appendRegradeHistoryRun({
        artifact,
        report: makeReport([]),
        rootDir: dir,
      });

      expect(appended.isErr()).toBe(true);
      if (appended.isErr()) {
        expect(appended.error.message).toContain(
          'does not match its registry transition'
        );
      }
    });
  });

  test('appends runs per transition, recognizes replays, and never overwrites unrecognized files', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const firstReport = makeReport(['first-class']);

      const first = appendRegradeHistoryRun({
        artifact,
        report: firstReport,
        rootDir: dir,
      });
      expect(first.isOk()).toBe(true);
      if (first.isErr()) {
        throw first.error;
      }
      expect(first.value).toMatchObject({
        path: '.trails/regrade/history/facet-to-trailhead.json',
        schemaVersion: 2,
        status: 'applied',
      });
      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      expect(existsSync(historyPath)).toBe(true);

      const written = readRegradeHistoryArtifact(historyPath);
      if (written.isErr()) {
        throw written.error;
      }
      expect(written.value.runs).toHaveLength(1);
      expect(written.value.runs[0]?.completionReport).toEqual(firstReport);
      expect(written.value.runs[0]?.completionReportHash).toBe(
        regradeSourceHash(firstReport)
      );
      expect(written.value.id).toMatch(/^[0-9a-f]{12}$/);
      expect(written.value.id).toBe(
        mintTransitionId(
          regradePlanSlugForBody(artifact.plan),
          regradePlanContentHash(artifact.plan),
          regradeSourceHash(firstReport)
        )
      );

      const second = appendRegradeHistoryRun({
        artifact,
        report: makeReport(['second-class']),
        rootDir: dir,
      });
      if (second.isErr()) {
        throw second.error;
      }
      expect(second.value.status).toBe('applied');
      const afterSecond = readRegradeHistoryArtifact(historyPath);
      if (afterSecond.isErr()) {
        throw afterSecond.error;
      }
      expect(afterSecond.value.runs).toHaveLength(2);
      expect(afterSecond.value.id).toBe(written.value.id);

      const bytesBeforeReplay = readFileSync(historyPath, 'utf8');
      const replay = appendRegradeHistoryRun({
        artifact,
        report: makeReport(['second-class']),
        rootDir: dir,
      });
      if (replay.isErr()) {
        throw replay.error;
      }
      expect(replay.value.status).toBe('replay');
      expect(readFileSync(historyPath, 'utf8')).toBe(bytesBeforeReplay);

      writeFileSync(historyPath, 'not json\n');
      const corrupted = appendRegradeHistoryRun({
        artifact,
        report: makeReport(['third-class']),
        rootDir: dir,
      });
      expect(corrupted.isErr()).toBe(true);
      expect(readFileSync(historyPath, 'utf8')).toBe('not json\n');
    });
  });

  test('recognizes the completed source state without discarding pre-apply evidence', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const beforeApply = makeReport(['before-apply']);
      const afterApply = makeReport(['after-apply']);
      const appended = appendRegradeHistoryRun({
        artifact,
        completedReport: afterApply,
        report: beforeApply,
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }

      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const written = readRegradeHistoryArtifact(historyPath);
      if (written.isErr()) {
        throw written.error;
      }
      expect(written.value.runs[0]?.report).toEqual(beforeApply);
      expect(written.value.runs[0]?.completionReport).toEqual(afterApply);

      const replay = appendRegradeHistoryRun({
        artifact,
        report: afterApply,
        rootDir: dir,
      });
      if (replay.isErr()) {
        throw replay.error;
      }
      expect(replay.value.status).toBe('replay');
      const afterReplay = readRegradeHistoryArtifact(historyPath);
      if (afterReplay.isErr()) {
        throw afterReplay.error;
      }
      expect(afterReplay.value.runs).toHaveLength(1);
    });
  });

  test('rejects tampered completion stamps before replaying or appending', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const appended = appendRegradeHistoryRun({
        artifact,
        completedReport: makeReport(['after-apply']),
        report: makeReport(['before-apply']),
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }

      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const persisted = JSON.parse(readFileSync(historyPath, 'utf8')) as {
        runs: { completionReportHash: string }[];
      };
      const futureReport = makeReport(['future-occurrence']);
      if (persisted.runs[0] === undefined) {
        throw new Error('Expected a recorded history run to tamper.');
      }
      persisted.runs[0].completionReportHash = regradeSourceHash(futureReport);
      writeFileSync(historyPath, `${JSON.stringify(persisted, null, 2)}\n`);
      const bytesBeforeAppend = readFileSync(historyPath, 'utf8');

      const rejected = appendRegradeHistoryRun({
        artifact,
        report: futureReport,
        rootDir: dir,
      });
      expect(rejected.isErr()).toBe(true);
      if (rejected.isOk()) {
        throw new Error('Expected a completion report stamp mismatch error.');
      }
      expect(rejected.error.message).toContain('stamp mismatch');
      expect(rejected.error.context?.['field']).toBe('completionReportHash');
      expect(readFileSync(historyPath, 'utf8')).toBe(bytesBeforeAppend);
    });
  });

  test('reads early v2 runs without explicit completion evidence', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const report = makeReport(['legacy-v2']);
      const appended = appendRegradeHistoryRun({
        artifact,
        report,
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }
      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const persisted = JSON.parse(readFileSync(historyPath, 'utf8')) as {
        runs: Record<string, unknown>[];
      };
      for (const run of persisted.runs) {
        delete run['completionReport'];
        delete run['completionReportHash'];
      }
      writeFileSync(historyPath, `${JSON.stringify(persisted, null, 2)}\n`);

      const legacy = readRegradeHistoryArtifact(historyPath);
      if (legacy.isErr()) {
        throw legacy.error;
      }
      expect(legacy.value.runs[0]?.completionReport).toEqual(report);
      expect(legacy.value.runs[0]?.completionReportHash).toBe(
        legacy.value.runs[0]?.lockHashAtRun
      );
      expect(verifyRegradeHistoryRuns(legacy.value).isOk()).toBe(true);
    });
  });

  test('verifies legacy stamps from raw report insertion order', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const report = makeReportWithReviewDetail();
      const appended = appendRegradeHistoryRun({
        artifact,
        report,
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }

      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const persisted = JSON.parse(readFileSync(historyPath, 'utf8')) as {
        runs: {
          completionReport?: RegradeReport;
          completionReportHash?: string;
          lockHashAtRun: string;
          report: RegradeReport;
        }[];
      };
      const [run] = persisted.runs;
      if (run === undefined) {
        throw new Error('Expected a recorded history run.');
      }
      const detail = run.report.entries[0]?.reviewDetails?.[0];
      if (detail === undefined) {
        throw new Error('Expected a recorded review detail.');
      }
      run.report.entries[0] = {
        ...run.report.entries[0],
        reviewDetails: [
          {
            classId: detail.classId,
            matchedForm: detail.matchedForm,
            preserveCautions: detail.preserveCautions,
            reason: detail.reason,
            signals: detail.signals,
            span: detail.span,
            symbol: detail.symbol,
          },
        ],
      };
      run.lockHashAtRun = legacyRegradeSourceHash(run.report);
      delete run.completionReport;
      delete run.completionReportHash;
      writeFileSync(historyPath, `${JSON.stringify(persisted, null, 2)}\n`);

      const legacy = readRegradeHistoryArtifact(historyPath);
      if (legacy.isErr()) {
        throw legacy.error;
      }
      expect(verifyRegradeHistoryRuns(legacy.value).isOk()).toBe(true);

      const next = appendRegradeHistoryRun({
        artifact,
        report: makeReport(['next-run']),
        rootDir: dir,
      });
      expect(next.isOk()).toBe(true);
      const afterAppend = readRegradeHistoryArtifact(historyPath);
      if (afterAppend.isErr()) {
        throw afterAppend.error;
      }
      expect(afterAppend.value.runs).toHaveLength(2);
      expect(verifyRegradeHistoryRuns(afterAppend.value).isOk()).toBe(true);
    });
  });

  test('verifies governed provenance stamped with legacy report hashes', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact({
        ...makePlanBody(),
        id: 'v1-facet-trailhead',
      });
      const report = makeReportWithReviewDetail();
      const appended = appendRegradeHistoryRun({
        artifact,
        completedReport: report,
        report,
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }

      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const persisted = JSON.parse(readFileSync(historyPath, 'utf8')) as {
        runs: {
          completionReport: RegradeReport;
          completionReportHash: string;
          lockHashAtRun: string;
          provenance: {
            sourceHashAfter: string;
            sourceHashBefore: string;
          };
          report: RegradeReport;
        }[];
      };
      const [run] = persisted.runs;
      if (run === undefined) {
        throw new Error('Expected a recorded history run.');
      }
      for (const source of [run.report, run.completionReport]) {
        const detail = source.entries[0]?.reviewDetails?.[0];
        if (detail === undefined) {
          throw new Error('Expected a recorded review detail.');
        }
        source.entries[0] = {
          ...source.entries[0],
          reviewDetails: [
            {
              classId: detail.classId,
              matchedForm: detail.matchedForm,
              preserveCautions: detail.preserveCautions,
              reason: detail.reason,
              signals: detail.signals,
              span: detail.span,
              symbol: detail.symbol,
            },
          ],
        };
      }
      run.lockHashAtRun = legacyRegradeSourceHash(run.report);
      run.completionReportHash = legacyRegradeSourceHash(run.completionReport);
      run.provenance.sourceHashBefore = run.lockHashAtRun;
      run.provenance.sourceHashAfter = run.completionReportHash;
      writeFileSync(historyPath, `${JSON.stringify(persisted, null, 2)}\n`);

      const legacy = readRegradeHistoryArtifact(historyPath);
      if (legacy.isErr()) {
        throw legacy.error;
      }
      expect(verifyRegradeHistoryRuns(legacy.value).isOk()).toBe(true);

      run.provenance.sourceHashBefore = '0'.repeat(64);
      writeFileSync(historyPath, `${JSON.stringify(persisted, null, 2)}\n`);
      const tampered = readRegradeHistoryArtifact(historyPath);
      if (tampered.isErr()) {
        throw tampered.error;
      }
      const failed = verifyRegradeHistoryRuns(tampered.value);
      expect(failed.isErr()).toBe(true);
      if (failed.isErr()) {
        expect(failed.error.message).toBe(
          'Regrade history run provenance mismatch.'
        );
      }
    });
  });

  test('verifies governed provenance stamped with legacy file evidence hashes', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact({
        ...makePlanBody(),
        id: 'v1-facet-trailhead',
      });
      const report = makeReportWithFileRenameEvidence();
      const appended = appendRegradeHistoryRun({
        artifact,
        completedReport: report,
        report,
        rootDir: dir,
      });
      if (appended.isErr()) {
        throw appended.error;
      }

      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const persisted = JSON.parse(readFileSync(historyPath, 'utf8')) as {
        runs: {
          completionReport: RegradeReport;
          completionReportHash: string;
          lockHashAtRun: string;
          provenance: {
            sourceHashAfter: string;
            sourceHashBefore: string;
          };
          report: RegradeReport;
        }[];
      };
      const [run] = persisted.runs;
      if (run === undefined) {
        throw new Error('Expected a recorded history run.');
      }
      expect(regradeSourceHashes(run.report).length).toBeGreaterThan(2);
      const sourceHash = regradeSourceHashes(run.report).find(
        (hash) =>
          hash !== regradeSourceHash(run.report) &&
          hash !== legacyRegradeSourceHash(run.report)
      );
      const completionHash = regradeSourceHashes(run.completionReport).find(
        (hash) =>
          hash !== regradeSourceHash(run.completionReport) &&
          hash !== legacyRegradeSourceHash(run.completionReport)
      );
      if (sourceHash === undefined || completionHash === undefined) {
        throw new Error('Expected legacy file-evidence source hashes.');
      }
      run.lockHashAtRun = sourceHash;
      run.completionReportHash = completionHash;
      run.provenance.sourceHashBefore = sourceHash;
      run.provenance.sourceHashAfter = completionHash;
      writeFileSync(historyPath, `${JSON.stringify(persisted, null, 2)}\n`);

      const legacy = readRegradeHistoryArtifact(historyPath);
      if (legacy.isErr()) {
        throw legacy.error;
      }
      expect(verifyRegradeHistoryRuns(legacy.value).isOk()).toBe(true);
    });
  });

  test('refuses to fork a consolidated history when the plan pins a different transition id', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const first = appendRegradeHistoryRun({
        artifact,
        report: makeReport(['first-class']),
        rootDir: dir,
      });
      expect(first.isOk()).toBe(true);

      const pinned = appendRegradeHistoryRun({
        artifact: { ...artifact, transitionId: 'ffffffffffff' },
        report: makeReport(['second-class']),
        rootDir: dir,
      });
      expect(pinned.isErr()).toBe(true);
      if (pinned.isOk()) {
        throw new Error('Expected transition id mismatch error.');
      }
      expect(pinned.error.message).toContain('transition id mismatch');
    });
  });

  test('refuses a different plan identity under the same transition name unless the plan carries the transition id', () => {
    withFixtureDir((dir) => {
      const firstBody: RegradePlanBody = {
        classIds: ['export-restructure:cli-aliases'],
        id: 'class:export-restructure:cli-aliases',
        kind: 'class',
        name: 'shared',
      };
      const first = appendRegradeHistoryRun({
        artifact: makePlanArtifact(firstBody),
        report: makeReport(['first-class']),
        rootDir: dir,
      });
      expect(first.isOk()).toBe(true);
      const historyPath = regradeHistoryPathForPlan(dir, firstBody);
      const written = readRegradeHistoryArtifact(historyPath);
      if (written.isErr()) {
        throw written.error;
      }

      const otherBody: RegradePlanBody = {
        classIds: ['export-restructure:mcp-trailheads'],
        id: 'class:export-restructure:mcp-trailheads',
        kind: 'class',
        name: 'shared',
      };
      const collision = appendRegradeHistoryRun({
        artifact: makePlanArtifact(otherBody),
        report: makeReport(['second-class']),
        rootDir: dir,
      });
      expect(collision.isErr()).toBe(true);
      if (collision.isOk()) {
        throw new Error('Expected plan identity mismatch error.');
      }
      expect(collision.error.message).toContain('different plan identity');

      // Carrying the transition id sanctions plan evolution on the spine.
      const evolved = appendRegradeHistoryRun({
        artifact: {
          ...makePlanArtifact(otherBody),
          transitionId: written.value.id,
        },
        report: makeReport(['second-class']),
        rootDir: dir,
      });
      expect(evolved.isOk()).toBe(true);
      const afterEvolution = readRegradeHistoryArtifact(historyPath);
      if (afterEvolution.isErr()) {
        throw afterEvolution.error;
      }
      expect(afterEvolution.value.runs).toHaveLength(2);
      expect(afterEvolution.value.id).toBe(written.value.id);
    });
  });
});

describe('verifyRegradeHistoryRuns', () => {
  test('requires provenance for id-less governed plans', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact({
        ...makePlanBody(),
        from: 'projection',
        to: 'derive',
      });
      const appended = appendRegradeHistoryRun({
        artifact,
        report: makeReport(['first-class']),
        rootDir: dir,
      });
      expect(appended.isOk()).toBe(true);

      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const written = readRegradeHistoryArtifact(historyPath);
      if (written.isErr()) {
        throw written.error;
      }
      const withoutProvenance = {
        ...written.value,
        runs: written.value.runs.map(
          ({ provenance: _provenance, ...run }) => run
        ),
      };
      const verified = verifyRegradeHistoryRuns(withoutProvenance);

      expect(verified.isErr()).toBe(true);
      if (verified.isErr()) {
        expect(verified.error.message).toContain('lacks governed provenance');
      }
    });
  });

  test('accepts a freshly written artifact after report serialization normalizes nested keys', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const appended = appendRegradeHistoryRun({
        artifact,
        report: makeReportWithReviewDetail(),
        rootDir: dir,
      });
      expect(appended.isOk()).toBe(true);

      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const written = readRegradeHistoryArtifact(historyPath);
      if (written.isErr()) {
        throw written.error;
      }
      const verified = verifyRegradeHistoryRuns(written.value);
      if (verified.isErr()) {
        throw verified.error;
      }
      expect(verified.value.runs).toBe(1);
    });
  });

  test('passes on a freshly written artifact and fails after tampering a stamp', () => {
    withFixtureDir((dir) => {
      const artifact = makePlanArtifact(makePlanBody());
      const appended = appendRegradeHistoryRun({
        artifact,
        report: makeReport(['first-class']),
        rootDir: dir,
      });
      expect(appended.isOk()).toBe(true);

      const historyPath = regradeHistoryPathForPlan(dir, artifact.plan);
      const written = readRegradeHistoryArtifact(historyPath);
      if (written.isErr()) {
        throw written.error;
      }
      const verified = verifyRegradeHistoryRuns(written.value);
      if (verified.isErr()) {
        throw verified.error;
      }
      expect(verified.value.runs).toBe(1);

      const completionTampered = {
        ...written.value,
        runs: written.value.runs.map((run) => ({
          ...run,
          completionReport: {
            ...run.completionReport,
            selectedClassIds: ['tampered-completion'],
          },
        })),
      };
      const completionFailed = verifyRegradeHistoryRuns(completionTampered);
      expect(completionFailed.isErr()).toBe(true);
      if (completionFailed.isOk()) {
        throw new Error('Expected completion report stamp mismatch error.');
      }
      expect(completionFailed.error.context?.['field']).toBe(
        'completionReportHash'
      );

      const tampered = {
        ...written.value,
        runs: written.value.runs.map((run) => ({
          ...run,
          lockHashAtRun: 'deadbeef'.repeat(8),
        })),
      };
      const failed = verifyRegradeHistoryRuns(tampered);
      expect(failed.isErr()).toBe(true);
      if (failed.isOk()) {
        throw new Error('Expected stamp mismatch error.');
      }
      expect(failed.error.message).toContain('stamp mismatch');
    });
  });
});
