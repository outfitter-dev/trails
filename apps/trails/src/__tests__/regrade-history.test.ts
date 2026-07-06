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
  regradePlanContentHash,
  regradePlanSlugForBody,
  regradeSourceHash,
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
});

describe('verifyRegradeHistoryRuns', () => {
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
