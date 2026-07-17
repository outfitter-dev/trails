import { afterEach, describe, expect, test } from 'bun:test';
import { runFileRenameRegrade } from '@ontrails/regrade';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REGRADE_PLAN_SCHEMA_VERSION } from '../plan-artifact.js';
import type { RegradePlanArtifact } from '../plan-artifact.js';
import {
  preparedRegradeRunIdentity,
  validatePreparedRegradePlanArtifact,
} from '../prepared-run.js';
import {
  reloadPreparedRegradePlan,
  validatePreparedFileRenameSourceState,
} from '../../trails/regrade.js';

const roots: string[] = [];

const fixtureArtifact = (scope?: {
  readonly include?: readonly string[];
}): RegradePlanArtifact => ({
  kind: 'regrade-plan',
  path: '.trails/regrade/plans/fixture.json',
  plan: {
    classIds: ['fixture-class'],
    id: 'fixture-plan',
    kind: 'class',
    ...(scope === undefined ? {} : { scope }),
  },
  provenance: { fields: {} },
  schemaVersion: REGRADE_PLAN_SCHEMA_VERSION,
  sourceHash: 'fixture-source',
});

const vocabularyArtifact = (): RegradePlanArtifact => ({
  kind: 'regrade-plan',
  path: '.trails/regrade/plans/vocabulary.json',
  plan: {
    from: 'oldTerm',
    id: 'vocabulary-plan',
    kind: 'vocabulary',
    to: 'newTerm',
  },
  provenance: { fields: {} },
  schemaVersion: REGRADE_PLAN_SCHEMA_VERSION,
  sourceHash: 'vocabulary-source',
});

const identity = (
  rootDir: string,
  artifact = fixtureArtifact(),
  classIds: readonly string[] = ['fixture-class'],
  includeEntries: 'actionable' | 'all' = 'actionable'
) =>
  preparedRegradeRunIdentity({
    artifact,
    classIds,
    includeEntries,
    rootDir,
  }).unwrap();

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('preparedRegradeRunIdentity', () => {
  test('keeps vocabulary identity independent from project Warden rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-regrade-identity-'));
    roots.push(root);
    mkdirSync(join(root, '.trails'));
    writeFileSync(
      join(root, '.trails/rules.ts'),
      'import "./missing-rule.ts"; export const sourceRules = [];\n'
    );

    const vocabulary = preparedRegradeRunIdentity({
      artifact: vocabularyArtifact(),
      includeEntries: 'actionable',
      rootDir: root,
    });
    expect(vocabulary.isOk()).toBe(true);

    const classPlan = preparedRegradeRunIdentity({
      artifact: fixtureArtifact(),
      classIds: ['fixture-class'],
      includeEntries: 'actionable',
      rootDir: root,
    });
    expect(classPlan.isErr()).toBe(true);
  });

  test('invalidates each app-owned receipt-aligned identity boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-regrade-identity-'));
    roots.push(root);
    const baseline = identity(root);

    expect(
      identity(root, fixtureArtifact({ include: ['src/**'] })).scopeHash
    ).not.toBe(baseline.scopeHash);
    expect(
      identity(root, fixtureArtifact(), ['another-class']).policyHash
    ).not.toBe(baseline.policyHash);
    expect(
      identity(root, fixtureArtifact(), ['fixture-class'], 'all').scopeHash
    ).not.toBe(baseline.scopeHash);

    writeFileSync(join(root, 'trails.lock'), '{"version":1}\n');
    const withLock = identity(root);
    expect(withLock.lockStateHash).not.toBe(baseline.lockStateHash);
    writeFileSync(join(root, 'trails.lock'), '{"version":2}\n');
    expect(identity(root).lockStateHash).not.toBe(withLock.lockStateHash);

    mkdirSync(join(root, '.trails'));
    writeFileSync(
      join(root, '.trails/rules.ts'),
      'export const sourceRules = ["before"];\n'
    );
    const withProjectRule = identity(root);
    writeFileSync(
      join(root, '.trails/rules.ts'),
      'export const sourceRules = ["after"];\n'
    );
    expect(identity(root).policyHash).not.toBe(withProjectRule.policyHash);

    mkdirSync(join(root, '.trails/rules'));
    writeFileSync(
      join(root, '.trails/rules/_helper.ts'),
      'export const value = 1;\n'
    );
    writeFileSync(
      join(root, '.trails/rules.ts'),
      'import { value } from "./rules/_helper.ts"; export const sourceRules = [value];\n'
    );
    const withRuleHelper = identity(root);
    writeFileSync(
      join(root, '.trails/rules/_helper.ts'),
      'export const value = 2;\n'
    );
    expect(identity(root).policyHash).not.toBe(withRuleHelper.policyHash);

    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src/warden-rule-helper.ts'),
      'export const value = 1;\n'
    );
    writeFileSync(
      join(root, '.trails/rules.ts'),
      'import { value } from "../src/warden-rule-helper.ts"; export const sourceRules = [value];\n'
    );
    const withExternalHelper = identity(root);
    writeFileSync(
      join(root, 'src/warden-rule-helper.ts'),
      'export const value = 2;\n'
    );
    expect(identity(root).policyHash).not.toBe(withExternalHelper.policyHash);

    writeFileSync(
      join(root, 'src/warden-rule-helper.mts'),
      'export { value } from "./warden-rule-deep.ts";\n'
    );
    writeFileSync(
      join(root, 'src/warden-rule-deep.ts'),
      'export const value = 1;\n'
    );
    writeFileSync(
      join(root, '.trails/rules.ts'),
      'import { value } from "../src/warden-rule-helper.mts"; export const sourceRules = [value];\n'
    );
    const withTwoHopHelper = identity(root);
    writeFileSync(
      join(root, 'src/warden-rule-deep.ts'),
      'export const value = 2;\n'
    );
    expect(identity(root).policyHash).not.toBe(withTwoHopHelper.policyHash);

    const changedPlan = fixtureArtifact();
    const changedPlanIdentity = identity(root, {
      ...changedPlan,
      plan: { ...changedPlan.plan, intent: 'changed intent' },
    });
    expect(changedPlanIdentity.planContentHash).not.toBe(
      withLock.planContentHash
    );
    const changedProvenance = fixtureArtifact();
    const changedProvenanceIdentity = identity(root, {
      ...changedProvenance,
      provenance: { fields: { intent: 'authored' } },
    });
    expect(changedProvenanceIdentity.planContentHash).not.toBe(
      baseline.planContentHash
    );
    expect(baseline.toolVersion).toBe(withLock.toolVersion);
  });

  test('rejects an active plan artifact edited after preflight', () => {
    const expected = fixtureArtifact();
    const changed = {
      ...expected,
      plan: { ...expected.plan, intent: 'edited during preflight' },
    };
    const result = validatePreparedRegradePlanArtifact({
      current: changed,
      currentPath: '/fixture/current.json',
      expected,
      expectedPath: '/fixture/current.json',
    });
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.message).toContain(
      'changed during apply preflight'
    );
  });

  test('rereads a changed on-disk plan before any source or history mutation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-regrade-plan-reread-'));
    roots.push(root);
    const expected = fixtureArtifact();
    const relativePlanPath = '.trails/regrade/plans/fixture.json';
    const absolutePlanPath = join(root, relativePlanPath);
    const sourcePath = join(root, 'source.ts');
    const historyPath = join(root, '.trails/regrade/history/fixture.json');
    mkdirSync(join(root, '.trails/regrade/plans'), { recursive: true });
    writeFileSync(sourcePath, 'export const oldName = 1;\n');
    writeFileSync(
      absolutePlanPath,
      `${JSON.stringify({
        ...expected,
        plan: { ...expected.plan, intent: 'edited during preflight' },
      })}\n`
    );

    const result = await reloadPreparedRegradePlan({
      input: { includeEntries: 'actionable', plan: relativePlanPath },
      loaded: { artifact: expected, path: absolutePlanPath },
      rootDir: root,
    });
    expect(result.isErr()).toBe(true);
    expect(readFileSync(sourcePath, 'utf8')).toBe(
      'export const oldName = 1;\n'
    );
    expect(existsSync(historyPath)).toBe(false);
  });

  test('rejects changed file-rename bytes before any move', () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-regrade-file-rename-'));
    roots.push(root);
    mkdirSync(join(root, 'docs'));
    const sourcePath = join(root, 'docs/old.md');
    const targetPath = join(root, 'docs/new.md');
    writeFileSync(sourcePath, '# Before\n');
    const plan = {
      fileRenames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
      from: 'old',
      kind: 'vocabulary' as const,
      scope: { extensions: ['.ts'], include: ['src/**'] },
      to: 'new',
    };
    const prepared = runFileRenameRegrade({
      renames: plan.fileRenames,
      root,
      vocabularyPlan: plan,
    }).unwrap();

    writeFileSync(sourcePath, '# Changed after preflight\n');
    const validated = validatePreparedFileRenameSourceState({
      includeEntries: 'actionable',
      plan,
      prepared,
      rootDir: root,
    });

    expect(validated.isErr()).toBe(true);
    expect(validated.isErr() && validated.error.message).toContain('stale');
    expect(readFileSync(sourcePath, 'utf8')).toBe(
      '# Changed after preflight\n'
    );
    expect(existsSync(targetPath)).toBe(false);
  });
});
