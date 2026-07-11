import type { RegradeReport } from '@ontrails/regrade';
import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendRegradeHistoryRun,
  mintTransitionId,
  readRegradeHistoryArtifact,
  regradeHistoryPathForPlan,
  verifyRegradeHistoryRuns,
} from '../regrade/history.js';
import {
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
  });
});

describe('appendRegradeHistoryRun', () => {
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
