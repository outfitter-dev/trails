import { describe, expect, test } from 'bun:test';

import {
  regradeClassifiedStateHash,
  regradeHistoryReceiptSchema,
  regradeReceiptPlanContentHash,
  resolveRegradeHistoryReceipt,
  serializeRegradeHistoryReceipt,
} from '../history-receipt.js';
import {
  historyReceiptFixture,
  receiptPlanFixture,
} from './fixtures/history-receipt.js';

const cloneFixture = (): typeof historyReceiptFixture =>
  structuredClone(historyReceiptFixture);

const runAt = (
  fixture: typeof historyReceiptFixture,
  index: number
): (typeof historyReceiptFixture.runs)[number] => {
  const run = fixture.runs[index];
  if (run === undefined) {
    throw new Error(`Missing receipt fixture run ${index}.`);
  }
  return run;
};

describe('Regrade history receipt v3', () => {
  test('serializes byte-identically and resolves proof references without a cache', () => {
    const first = serializeRegradeHistoryReceipt(historyReceiptFixture);
    const second = serializeRegradeHistoryReceipt(
      structuredClone(historyReceiptFixture)
    );

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (first.isErr()) {
      throw first.error;
    }
    if (second.isErr()) {
      throw second.error;
    }
    expect(first.value).toBe(second.value);
    expect(first.value.endsWith('\n')).toBe(true);
    expect(first.value).not.toContain('/Users/');
    expect(first.value).not.toContain('completionReport');
    expect(first.value).not.toContain('"ledger"');

    const resolved = resolveRegradeHistoryReceipt(JSON.parse(first.value));
    expect(resolved.isOk()).toBe(true);
    if (resolved.isErr()) {
      throw resolved.error;
    }
    expect(resolved.value.runs[1]?.plan).toEqual(receiptPlanFixture);
    expect(
      resolved.value.runs[1]?.classifiedState.forms.map((form) => form.form)
    ).toEqual(['Oldish', 'old']);
  });

  test('fails closed on broken and stale hash references', () => {
    const broken = cloneFixture();
    runAt(broken, 1).classifiedState.stateHash = 'f'.repeat(64);
    const brokenResult = resolveRegradeHistoryReceipt(broken);
    expect(brokenResult.isErr()).toBe(true);
    if (brokenResult.isErr()) {
      expect(brokenResult.error.message).toContain(
        'Broken Regrade receipt classified state reference'
      );
    }

    const stale = cloneFixture();
    runAt(stale, 0).classifiedState.stateHash = 'e'.repeat(64);
    const staleResult = resolveRegradeHistoryReceipt(stale);
    expect(staleResult.isErr()).toBe(true);
    if (staleResult.isErr()) {
      expect(staleResult.error.message).toContain(
        'classified state hash mismatch'
      );
    }
  });

  test('fails closed on mismatched transitions and duplicate form identities', () => {
    const mismatched = cloneFixture();
    runAt(mismatched, 0).transitionId = 'another-transition';
    expect(regradeHistoryReceiptSchema.safeParse(mismatched).success).toBe(
      false
    );

    const duplicate = cloneFixture();
    const { classifiedState: embedded } = runAt(duplicate, 0);
    if (embedded.kind !== 'embedded') {
      throw new Error('Expected embedded fixture state.');
    }
    embedded.forms = [
      ...embedded.forms,
      { disposition: 'unresolved', form: 'OLDISH' },
    ];
    embedded.stateHash = regradeClassifiedStateHash({
      caseSensitive: embedded.caseSensitive,
      forms: embedded.forms,
    });
    const duplicateResult = resolveRegradeHistoryReceipt(duplicate);
    expect(duplicateResult.isErr()).toBe(true);
    if (duplicateResult.isErr()) {
      expect(duplicateResult.error.message).toContain('duplicate forms');
    }

    const opaqueTransitionId = cloneFixture();
    opaqueTransitionId.id = 'a1b2c3d4e5f6';
    for (const run of opaqueTransitionId.runs) {
      run.transitionId = opaqueTransitionId.id;
    }
    expect(resolveRegradeHistoryReceipt(opaqueTransitionId).isOk()).toBe(true);

    const invalidHistoryPath = cloneFixture();
    invalidHistoryPath.path = '.trails/regrade/other/fixture-old-new.json';
    expect(resolveRegradeHistoryReceipt(invalidHistoryPath).isErr()).toBe(true);
  });

  test('rejects absolute and non-normalized values only in path-bearing fields', () => {
    const absoluteFile = cloneFixture();
    const [changedFile] = runAt(absoluteFile, 0).evidence.changedFiles;
    if (changedFile === undefined) {
      throw new Error('Expected changed-file fixture.');
    }
    changedFile.afterPath = '/Users/example/project/src/example.ts';
    expect(regradeHistoryReceiptSchema.safeParse(absoluteFile).success).toBe(
      false
    );

    const windowsPlan = cloneFixture();
    const { intent } = runAt(windowsPlan, 0);
    if (intent.kind !== 'embedded' || intent.plan.kind !== 'vocabulary') {
      throw new Error('Expected embedded vocabulary fixture plan.');
    }
    const [fileRename] = intent.plan.fileRenames ?? [];
    if (fileRename === undefined) {
      throw new Error('Expected file-rename fixture.');
    }
    fileRename.from = 'C:\\repo\\docs\\old.md';
    expect(regradeHistoryReceiptSchema.safeParse(windowsPlan).success).toBe(
      false
    );

    const authoredRoute = cloneFixture();
    const { intent: routeIntent } = runAt(authoredRoute, 0);
    if (
      routeIntent.kind !== 'embedded' ||
      routeIntent.plan.kind !== 'vocabulary'
    ) {
      throw new Error('Expected embedded vocabulary fixture plan.');
    }
    routeIntent.plan.intent = 'Preserve the authored HTTP route /v1/example.';
    routeIntent.planContentHash = regradeReceiptPlanContentHash(
      routeIntent.plan
    );
    const proofIntent = runAt(authoredRoute, 1).intent;
    if (proofIntent.kind !== 'reference') {
      throw new Error('Expected referenced proof fixture plan.');
    }
    proofIntent.planContentHash = routeIntent.planContentHash;
    expect(routeIntent.plan.intent).toContain('/v1/example');
    expect(resolveRegradeHistoryReceipt(authoredRoute).isOk()).toBe(true);

    const escapingRepresentative = cloneFixture();
    const representativeState = runAt(
      escapingRepresentative,
      0
    ).classifiedState;
    if (representativeState.kind !== 'embedded') {
      throw new Error('Expected embedded fixture state.');
    }
    const unresolved = representativeState.forms.find(
      (form) => form.disposition === 'unresolved'
    );
    if (unresolved?.representative === undefined) {
      throw new Error('Expected representative fixture.');
    }
    unresolved.representative.path = '../outside.ts';
    expect(
      regradeHistoryReceiptSchema.safeParse(escapingRepresentative).success
    ).toBe(false);

    const nulPath = cloneFixture();
    const [nulFile] = runAt(nulPath, 0).evidence.changedFiles;
    if (nulFile === undefined) {
      throw new Error('Expected changed-file fixture.');
    }
    nulFile.beforePath = 'src/before\u0000after.ts';
    expect(regradeHistoryReceiptSchema.safeParse(nulPath).success).toBe(false);
  });

  test('requires proof receipts to reference prior state and claim no writes', () => {
    const invalidProof = cloneFixture();
    const original = runAt(invalidProof, 0);
    const proof = runAt(invalidProof, 1);
    proof.classifiedState = original.classifiedState;
    expect(regradeHistoryReceiptSchema.safeParse(invalidProof).success).toBe(
      false
    );

    const openProof = cloneFixture();
    runAt(openProof, 1).completion.gate.status = 'open';
    expect(regradeHistoryReceiptSchema.safeParse(openProof).success).toBe(
      false
    );
  });

  test('normalizes receipt-owned sets before canonical serialization', () => {
    const first = cloneFixture();
    const second = cloneFixture();
    const firstOriginal = runAt(first, 0);
    const secondOriginal = runAt(second, 0);
    const extraFile = {
      afterBlobHash: '2'.repeat(40),
      afterPath: 'docs/new.md',
      beforeBlobHash: '1'.repeat(40),
      beforePath: 'docs/new.md',
    };
    firstOriginal.evidence.changedFiles = [
      ...firstOriginal.evidence.changedFiles,
      extraFile,
    ];
    firstOriginal.completion.metrics.filesChanged = 2;
    secondOriginal.evidence.changedFiles = [
      extraFile,
      ...secondOriginal.evidence.changedFiles,
    ];
    secondOriginal.completion.metrics.filesChanged = 2;
    firstOriginal.completion.gate.reasons = [
      'deferred-forms-or-occurrences',
      'deferred-forms-or-occurrences',
    ];
    const firstState = firstOriginal.classifiedState;
    const secondState = secondOriginal.classifiedState;
    if (firstState.kind !== 'embedded' || secondState.kind !== 'embedded') {
      throw new Error('Expected embedded fixture states.');
    }
    secondState.forms = [...secondState.forms].toReversed();

    const firstSerialized = serializeRegradeHistoryReceipt(first);
    const secondSerialized = serializeRegradeHistoryReceipt(second);
    expect(firstSerialized.isOk()).toBe(true);
    expect(secondSerialized.isOk()).toBe(true);
    if (firstSerialized.isErr()) {
      throw firstSerialized.error;
    }
    if (secondSerialized.isErr()) {
      throw secondSerialized.error;
    }
    expect(firstSerialized.value).toBe(secondSerialized.value);
  });

  test('uses code-unit ordering for canonical receipt-owned sets', () => {
    const receipt = cloneFixture();
    const original = runAt(receipt, 0);
    original.evidence.changedFiles.push({
      afterBlobHash: '4'.repeat(40),
      afterPath: 'src/ä.ts',
      beforeBlobHash: '3'.repeat(40),
      beforePath: 'src/ä.ts',
    });
    original.evidence.changedFiles.push({
      afterBlobHash: '6'.repeat(40),
      afterPath: 'src/z.ts',
      beforeBlobHash: '5'.repeat(40),
      beforePath: 'src/z.ts',
    });
    original.completion.metrics.filesChanged = 3;
    const state = original.classifiedState;
    if (state.kind !== 'embedded') {
      throw new Error('Expected embedded fixture state.');
    }
    state.forms.push(
      { disposition: 'preserved', form: 'ä' },
      { disposition: 'preserved', form: 'z' }
    );
    state.stateHash = regradeClassifiedStateHash(state);
    const proofState = runAt(receipt, 1).classifiedState;
    if (proofState.kind !== 'reference') {
      throw new Error('Expected referenced proof fixture state.');
    }
    proofState.stateHash = state.stateHash;

    const serialized = serializeRegradeHistoryReceipt(receipt);
    if (serialized.isErr()) {
      throw serialized.error;
    }
    expect(serialized.value.indexOf('src/z.ts')).toBeLessThan(
      serialized.value.indexOf('src/ä.ts')
    );
    expect(serialized.value.indexOf('"form": "z"')).toBeLessThan(
      serialized.value.indexOf('"form": "ä"')
    );
  });

  test('rejects contradictory completion and changed-file evidence', () => {
    const invalidGate = cloneFixture();
    runAt(invalidGate, 0).completion.gate = {
      reasons: [],
      remaining: 7,
      status: 'green',
    };
    expect(regradeHistoryReceiptSchema.safeParse(invalidGate).success).toBe(
      false
    );

    const unresolvedGreenGate = cloneFixture();
    runAt(unresolvedGreenGate, 0).completion.gate = {
      reasons: [],
      remaining: 0,
      status: 'green',
    };
    expect(
      regradeHistoryReceiptSchema.safeParse(unresolvedGreenGate).success
    ).toBe(false);

    const invalidCount = cloneFixture();
    runAt(invalidCount, 0).completion.metrics.occurrencesRewritten = 2;
    expect(regradeHistoryReceiptSchema.safeParse(invalidCount).success).toBe(
      false
    );

    const reasonlessOpen = cloneFixture();
    runAt(reasonlessOpen, 0).completion.gate.reasons = [];
    expect(regradeHistoryReceiptSchema.safeParse(reasonlessOpen).success).toBe(
      false
    );

    const evidenceOnlyOpen = cloneFixture();
    runAt(evidenceOnlyOpen, 0).completion.gate = {
      reasons: ['missing-expected-policy-evidence'],
      remaining: 0,
      status: 'open',
    };
    expect(
      regradeHistoryReceiptSchema.safeParse(evidenceOnlyOpen).success
    ).toBe(true);

    const unchangedFile = cloneFixture();
    const [file] = runAt(unchangedFile, 0).evidence.changedFiles;
    if (file === undefined) {
      throw new Error('Expected changed-file fixture.');
    }
    file.afterBlobHash = file.beforeBlobHash;
    expect(regradeHistoryReceiptSchema.safeParse(unchangedFile).success).toBe(
      false
    );

    const contentPreservingRename = cloneFixture();
    const [renamed] = runAt(contentPreservingRename, 0).evidence.changedFiles;
    if (renamed === undefined) {
      throw new Error('Expected changed-file fixture.');
    }
    renamed.afterBlobHash = renamed.beforeBlobHash;
    renamed.afterPath = 'src/renamed.ts';
    expect(
      regradeHistoryReceiptSchema.safeParse(contentPreservingRename).success
    ).toBe(true);

    const duplicateSource = cloneFixture();
    const duplicateRun = runAt(duplicateSource, 0);
    const [sourceFile] = duplicateRun.evidence.changedFiles;
    if (sourceFile === undefined) {
      throw new Error('Expected changed-file fixture.');
    }
    duplicateRun.evidence.changedFiles.push({
      ...sourceFile,
      afterBlobHash: '7'.repeat(40),
      afterPath: 'src/other.ts',
    });
    duplicateRun.completion.metrics.filesChanged = 2;
    expect(regradeHistoryReceiptSchema.safeParse(duplicateSource).success).toBe(
      false
    );

    const duplicateDestination = cloneFixture();
    const destinationRun = runAt(duplicateDestination, 0);
    const [destinationFile] = destinationRun.evidence.changedFiles;
    if (destinationFile === undefined) {
      throw new Error('Expected changed-file fixture.');
    }
    destinationRun.evidence.changedFiles.push({
      ...destinationFile,
      beforeBlobHash: '8'.repeat(40),
      beforePath: 'src/other.ts',
    });
    destinationRun.completion.metrics.filesChanged = 2;
    expect(
      regradeHistoryReceiptSchema.safeParse(duplicateDestination).success
    ).toBe(false);
  });

  test('strictly rejects snapshot-era occurrence and duplicate report payloads', () => {
    const snapshot = {
      ...historyReceiptFixture,
      completionReport: {},
      ledger: { occurrences: [] },
      report: {},
    };
    expect(regradeHistoryReceiptSchema.safeParse(snapshot).success).toBe(false);

    const nestedSnapshot = cloneFixture();
    const { intent } = runAt(nestedSnapshot, 0);
    if (intent.kind !== 'embedded' || intent.plan.scope === undefined) {
      throw new Error('Expected embedded scoped fixture plan.');
    }
    const malformedScope = intent.plan.scope as typeof intent.plan.scope & {
      ledger: { occurrences: never[] };
    };
    malformedScope.ledger = { occurrences: [] };
    expect(regradeHistoryReceiptSchema.safeParse(nestedSnapshot).success).toBe(
      false
    );
  });
});
