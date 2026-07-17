import { describe, expect, test } from 'bun:test';
import { ValidationError } from '@ontrails/core';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyPreparedRegradeRun,
  prepareRegradeRun,
  runRegrade,
  validatePreparedRegradeRun,
} from '../report.js';
import type {
  PreparedRegradeRun,
  PreparedRegradeRunIdentity,
  RegradeClass,
} from '../report.js';
import {
  applyPreparedVocabularyRegradeRun,
  prepareVocabularyRegradeRun,
  runVocabularyRegrade,
} from '../vocabulary.js';

const identity: PreparedRegradeRunIdentity = {
  lockStateHash: 'lock',
  planContentHash: 'plan',
  policyHash: 'policy',
  scopeHash: 'scope',
  toolVersion: '1.0.0',
};

const withTempRoot = (execute: (root: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'regrade-prepared-'));
  try {
    execute(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
};

const rewriteClass = (onApply?: () => void): RegradeClass => ({
  apply: (source) => {
    onApply?.();
    return source.includes('oldName')
      ? {
          kind: 'rewrite',
          nextSource: source.replaceAll('oldName', 'newName'),
          notes: [],
        }
      : { kind: 'no-op', notes: [] };
  },
  describe: 'Rename oldName to newName.',
  id: 'test:old-name',
  scanTargets: { extensions: ['.ts'] },
});

const prepareClassRun = (
  root: string,
  cls: RegradeClass = rewriteClass()
): PreparedRegradeRun => {
  const result = prepareRegradeRun({ classes: [cls], identity, root });
  expect(result.isOk()).toBe(true);
  if (result.isErr() || result.value === null) {
    throw result.isErr() ? result.error : new Error('Expected prepared run.');
  }
  return result.value;
};

describe('prepared class/symbol Regrade runs', () => {
  test('matches the existing dry report and applies without reclassification', () => {
    withTempRoot((root) => {
      const path = join(root, 'source.ts');
      writeFileSync(path, 'export const oldName = 1;\n');
      let classifications = 0;
      const prepared = prepareClassRun(
        root,
        rewriteClass(() => {
          classifications += 1;
        })
      );
      expect(classifications).toBe(1);

      const existing = runRegrade({ classes: [rewriteClass()], root });
      expect(existing.isOk()).toBe(true);
      if (existing.isErr()) {
        throw existing.error;
      }
      expect(prepared.report).toEqual(existing.value);

      const cloned = applyPreparedRegradeRun({ ...prepared }, identity);
      expect(cloned.isErr()).toBe(true);
      expect(cloned.isErr() && cloned.error.message).toContain(
        'original in-memory evaluation'
      );

      const applied = applyPreparedRegradeRun(prepared, identity);
      expect(applied.isOk()).toBe(true);
      expect(classifications).toBe(1);
      expect(readFileSync(path, 'utf8')).toBe('export const newName = 1;\n');
    });
  });

  test('keeps the private apply report isolated from handle mutation', () => {
    withTempRoot((root) => {
      const path = join(root, 'source.ts');
      writeFileSync(path, 'export const oldName = 1;\n');
      const prepared = prepareClassRun(root);
      const expectedMatched = prepared.report.matched;
      const expectedEntries = structuredClone(prepared.report.entries);
      const expectedUnknownClassIds = [...prepared.report.unknownClassIds];
      expect(prepared.report.scannedPaths).toEqual(['source.ts']);
      expect(
        Object.getOwnPropertyDescriptor(prepared.report, 'scannedPaths')
          ?.enumerable
      ).toBe(false);

      Reflect.set(prepared.report, 'matched', 999);
      Reflect.set(prepared.report, 'entries', []);
      Reflect.set(prepared.report, 'unknownClassIds', ['tampered']);

      const applied = applyPreparedRegradeRun(prepared, identity);
      expect(applied.isOk()).toBe(true);
      if (applied.isErr()) {
        throw applied.error;
      }
      expect(applied.value.matched).toBe(expectedMatched);
      expect(applied.value.entries).toEqual(expectedEntries);
      expect(applied.value.unknownClassIds).toEqual(expectedUnknownClassIds);
      expect(applied.value.scannedPaths).toEqual(['source.ts']);
      expect(applied.value.apply?.applied).toBe(1);
      expect(readFileSync(path, 'utf8')).toBe('export const newName = 1;\n');
    });
  });

  test('rejects every stale receipt-aligned identity field', () => {
    withTempRoot((root) => {
      writeFileSync(join(root, 'source.ts'), 'const oldName = 1;\n');
      const prepared = prepareClassRun(root);
      for (const field of [
        'planContentHash',
        'policyHash',
        'scopeHash',
        'lockStateHash',
        'toolVersion',
      ] as const) {
        const result = applyPreparedRegradeRun(prepared, {
          ...identity,
          [field]: 'stale',
        });
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(ValidationError);
          expect(result.error.message).toContain(field);
        }
      }
    });
  });

  test('rejects changed, added, and removed relevant sources', () => {
    for (const mutation of ['changed', 'added', 'removed'] as const) {
      withTempRoot((root) => {
        const path = join(root, 'source.ts');
        writeFileSync(path, 'const oldName = 1;\n');
        const prepared = prepareClassRun(root);
        if (mutation === 'changed') {
          writeFileSync(path, 'const oldName = 2;\n');
        } else if (mutation === 'added') {
          writeFileSync(join(root, 'added.ts'), 'const value = 1;\n');
        } else {
          unlinkSync(path);
        }
        const result = applyPreparedRegradeRun(prepared, identity);
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(ValidationError);
          expect(result.error.message).toContain('source state is stale');
        }
      });
    }
  });

  test('rejects package manifest bytes that changed class context', () => {
    withTempRoot((root) => {
      const manifestPath = join(root, 'package.json');
      writeFileSync(manifestPath, '{"name":"before"}\n');
      writeFileSync(join(root, 'source.ts'), 'const oldName = 1;\n');
      const prepared = prepareClassRun(root);
      writeFileSync(manifestPath, '{"name":"after"}\n');

      const result = applyPreparedRegradeRun(prepared, identity);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(result.error.message).toContain('source state is stale');
      }
    });
  });

  test('does not trust mutable public handle identity or source hashes', () => {
    withTempRoot((root) => {
      const path = join(root, 'source.ts');
      writeFileSync(path, 'const oldName = 1;\n');
      const prepared = prepareClassRun(root);
      const mutable = prepared as {
        identity: PreparedRegradeRunIdentity;
        sourceStateHash: string;
      };
      mutable.identity = { ...identity, toolVersion: 'stale' };
      const staleIdentity = applyPreparedRegradeRun(prepared, mutable.identity);
      expect(staleIdentity.isErr()).toBe(true);

      writeFileSync(path, 'const oldName = 999;\n');
      mutable.sourceStateHash = prepareClassRun(root).sourceStateHash;
      const staleSource = applyPreparedRegradeRun(prepared, identity);
      expect(staleSource.isErr()).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('const oldName = 999;\n');
    });
  });

  test('snapshots caller parameters before freshness validation', () => {
    withTempRoot((root) => {
      const alternateRoot = mkdtempSync(join(tmpdir(), 'regrade-alternate-'));
      const path = join(root, 'source.ts');
      try {
        writeFileSync(path, 'const oldName = 1;\n');
        writeFileSync(join(alternateRoot, 'source.ts'), 'const oldName = 1;\n');
        const params = {
          classes: [rewriteClass()],
          identity,
          root,
        };
        const prepared = prepareRegradeRun(params);
        if (prepared.isErr() || prepared.value === null) {
          throw new Error('Expected prepared Regrade evaluation.');
        }

        writeFileSync(path, 'const oldName = 2;\n');
        params.root = alternateRoot;
        const applied = applyPreparedRegradeRun(prepared.value, identity);

        expect(applied.isErr()).toBe(true);
        expect(readFileSync(path, 'utf8')).toBe('const oldName = 2;\n');
      } finally {
        rmSync(alternateRoot, { force: true, recursive: true });
      }
    });
  });

  test('validates source freshness without applying prepared rewrites', () => {
    withTempRoot((root) => {
      const path = join(root, 'source.ts');
      writeFileSync(path, 'const oldName = 1;\n');
      const prepared = prepareClassRun(root);

      expect(validatePreparedRegradeRun(prepared, identity).isOk()).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('const oldName = 1;\n');

      writeFileSync(path, 'const oldName = 2;\n');
      const stale = validatePreparedRegradeRun(prepared, identity);
      expect(stale.isErr()).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('const oldName = 2;\n');
    });
  });

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails closed when selected files or directories become unreadable',
    () => {
      withTempRoot((root) => {
        const path = join(root, 'source.ts');
        writeFileSync(path, 'const oldName = 1;\n');
        chmodSync(path, 0o000);
        try {
          const unreadablePrepare = prepareRegradeRun({
            classes: [rewriteClass()],
            identity,
            root,
          });
          expect(unreadablePrepare.isErr()).toBe(true);
        } finally {
          chmodSync(path, 0o600);
        }

        const prepared = prepareClassRun(root);
        chmodSync(root, 0o000);
        try {
          const unreadableApply = applyPreparedRegradeRun(prepared, identity);
          expect(unreadableApply.isErr()).toBe(true);
        } finally {
          chmodSync(root, 0o700);
        }
      });
    }
  );
});

describe('prepared vocabulary Regrade runs', () => {
  test('matches the existing dry report, applies, and rejects stale sources', () => {
    withTempRoot((root) => {
      const path = join(root, 'source.ts');
      writeFileSync(path, 'export const oldTerm = "oldTerm";\n');
      const plan = {
        from: 'oldTerm',
        kind: 'vocabulary' as const,
        scope: { include: ['**/*.ts'] },
        to: 'newTerm',
      };
      const existing = runVocabularyRegrade({ plan, root });
      const preparedResult = prepareVocabularyRegradeRun({
        identity,
        plan,
        root,
      });
      expect(existing.isOk()).toBe(true);
      expect(preparedResult.isOk()).toBe(true);
      if (
        existing.isErr() ||
        preparedResult.isErr() ||
        preparedResult.value === null
      ) {
        throw new Error('Expected dry vocabulary evaluations.');
      }
      expect(preparedResult.value.report).toEqual(existing.value);

      writeFileSync(path, 'export const oldTerm = "changed";\n');
      const stale = applyPreparedVocabularyRegradeRun(
        preparedResult.value,
        identity
      );
      expect(stale.isErr()).toBe(true);
      expect(stale.isErr() && stale.error).toBeInstanceOf(ValidationError);
    });

    withTempRoot((root) => {
      const path = join(root, 'source.ts');
      writeFileSync(path, 'export const oldTerm = "oldTerm";\n');
      const plan = {
        from: 'oldTerm',
        kind: 'vocabulary' as const,
        scope: { include: ['**/*.ts'] },
        to: 'newTerm',
      };
      const prepared = prepareVocabularyRegradeRun({ identity, plan, root });
      if (prepared.isErr() || prepared.value === null) {
        throw new Error('Expected prepared vocabulary evaluation.');
      }
      const cloned = applyPreparedVocabularyRegradeRun(
        { ...prepared.value },
        identity
      );
      expect(cloned.isErr()).toBe(true);
      expect(cloned.isErr() && cloned.error.message).toContain(
        'original in-memory evaluation'
      );
      const applied = applyPreparedVocabularyRegradeRun(
        prepared.value,
        identity
      );
      expect(applied.isOk()).toBe(true);
      expect(readFileSync(path, 'utf8')).toContain('newTerm');
    });
  });

  test('rejects every stale identity field and changed source inventory', () => {
    withTempRoot((root) => {
      const path = join(root, 'source.ts');
      const plan = {
        from: 'oldTerm',
        kind: 'vocabulary' as const,
        scope: { include: ['**/*.ts'] },
        to: 'newTerm',
      };
      writeFileSync(path, 'const oldTerm = 1;\n');
      const prepared = prepareVocabularyRegradeRun({ identity, plan, root });
      if (prepared.isErr() || prepared.value === null) {
        throw new Error('Expected prepared vocabulary evaluation.');
      }
      for (const field of [
        'planContentHash',
        'policyHash',
        'scopeHash',
        'lockStateHash',
        'toolVersion',
      ] as const) {
        const result = applyPreparedVocabularyRegradeRun(prepared.value, {
          ...identity,
          [field]: 'stale',
        });
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(ValidationError);
          expect(result.error.message).toContain(field);
        }
      }

      writeFileSync(join(root, 'added.ts'), 'const value = 1;\n');
      const added = applyPreparedVocabularyRegradeRun(prepared.value, identity);
      expect(added.isErr()).toBe(true);
      unlinkSync(join(root, 'added.ts'));
      unlinkSync(path);
      const removed = applyPreparedVocabularyRegradeRun(
        prepared.value,
        identity
      );
      expect(removed.isErr()).toBe(true);
    });
  });

  test('does not trust mutable public vocabulary handle state', () => {
    withTempRoot((root) => {
      const path = join(root, 'source.ts');
      const plan = {
        from: 'oldTerm',
        kind: 'vocabulary' as const,
        to: 'newTerm',
      };
      writeFileSync(path, 'const oldTerm = 1;\n');
      const prepared = prepareVocabularyRegradeRun({ identity, plan, root });
      if (prepared.isErr() || prepared.value === null) {
        throw new Error('Expected prepared vocabulary evaluation.');
      }
      const mutable = prepared.value as {
        identity: PreparedRegradeRunIdentity;
        sourceStateHash: string;
      };
      mutable.identity = { ...identity, toolVersion: 'stale' };
      expect(
        applyPreparedVocabularyRegradeRun(
          prepared.value,
          mutable.identity
        ).isErr()
      ).toBe(true);

      writeFileSync(path, 'const oldTerm = 999;\n');
      const fresh = prepareVocabularyRegradeRun({ identity, plan, root });
      if (fresh.isErr() || fresh.value === null) {
        throw new Error('Expected fresh vocabulary evaluation.');
      }
      mutable.sourceStateHash = fresh.value.sourceStateHash;
      expect(
        applyPreparedVocabularyRegradeRun(prepared.value, identity).isErr()
      ).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('const oldTerm = 999;\n');
    });
  });

  test('keeps private vocabulary evidence isolated from public report mutation', () => {
    withTempRoot((root) => {
      const path = join(root, 'source.ts');
      writeFileSync(path, 'const oldTerm = 1;\n');
      const prepared = prepareVocabularyRegradeRun({
        identity,
        plan: {
          from: 'oldTerm',
          kind: 'vocabulary',
          to: 'newTerm',
        },
        root,
      });
      if (prepared.isErr() || prepared.value === null) {
        throw new Error('Expected prepared vocabulary evaluation.');
      }
      const { scannedPaths } = prepared.value.report;
      const { run } = prepared.value.report;
      if (run === undefined) {
        throw new Error('Expected vocabulary run evidence.');
      }
      (run.ledger as { occurrences: unknown[] }).occurrences = [];

      const applied = applyPreparedVocabularyRegradeRun(
        prepared.value,
        identity
      ).unwrap();
      expect(readFileSync(path, 'utf8')).toBe('const newTerm = 1;\n');
      expect(applied.run?.ledger.occurrences).toHaveLength(1);
      expect(applied.run?.ledger.occurrences[0]).toMatchObject({
        verdict: 'applied',
      });
      expect(prepared.value.report.scannedPaths).toEqual(scannedPaths);
      expect(
        Object.getOwnPropertyDescriptor(prepared.value.report, 'scannedPaths')
          ?.enumerable
      ).toBe(false);
    });
  });

  test('snapshots vocabulary parameters before freshness validation', () => {
    withTempRoot((root) => {
      const alternateRoot = mkdtempSync(join(tmpdir(), 'regrade-alternate-'));
      const path = join(root, 'source.ts');
      try {
        writeFileSync(path, 'const oldTerm = 1;\n');
        writeFileSync(join(alternateRoot, 'source.ts'), 'const oldTerm = 1;\n');
        const params = {
          identity,
          plan: {
            from: 'oldTerm',
            kind: 'vocabulary' as const,
            to: 'newTerm',
          },
          root,
        };
        const prepared = prepareVocabularyRegradeRun(params);
        if (prepared.isErr() || prepared.value === null) {
          throw new Error('Expected prepared vocabulary evaluation.');
        }

        writeFileSync(path, 'const oldTerm = 2;\n');
        params.root = alternateRoot;
        const applied = applyPreparedVocabularyRegradeRun(
          prepared.value,
          identity
        );

        expect(applied.isErr()).toBe(true);
        expect(readFileSync(path, 'utf8')).toBe('const oldTerm = 2;\n');
      } finally {
        rmSync(alternateRoot, { force: true, recursive: true });
      }
    });
  });
});
