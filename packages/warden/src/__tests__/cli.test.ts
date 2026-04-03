import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatWardenReport, runWarden } from '../cli.js';

const isDraftFileMarking = (rule: string): boolean =>
  rule === 'draft-file-marking';

const isDraftFileMarkingError = (diagnostic: {
  rule: string;
  severity?: string;
}): boolean =>
  isDraftFileMarking(diagnostic.rule) && diagnostic.severity === 'error';

const isDraftFileMarkingWarn = (diagnostic: {
  rule: string;
  severity?: string;
}): boolean =>
  isDraftFileMarking(diagnostic.rule) && diagnostic.severity === 'warn';

const isDraftVisibleDebt = (rule: string): boolean =>
  rule === 'draft-visible-debt';

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `warden-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('runWarden', () => {
  test('produces a report with diagnostics for bad code', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("entity.show", {
  blaze: async (input, ctx) => {
    throw new Error("boom");
  }
})`
      );

      const report = await runWarden({ rootDir: dir });
      expect(report.errorCount).toBeGreaterThan(0);
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('passes for clean code', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'good.ts'),
        `trail("entity.show", {
  blaze: async (input, ctx) => {
    return Result.ok(data);
  }
})`
      );

      const report = await runWarden({ rootDir: dir });
      expect(report.errorCount).toBe(0);
      expect(report.passed).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lintOnly skips drift check', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'empty.ts'), 'export {}');
      const report = await runWarden({ lintOnly: true, rootDir: dir });
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('driftOnly skips lint', async () => {
    const dir = makeTempDir();
    try {
      // Even with bad code, driftOnly should produce 0 diagnostics
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("x", { blaze: async () => { throw new Error("x"); } })`
      );
      const report = await runWarden({ driftOnly: true, rootDir: dir });
      expect(report.diagnostics.length).toBe(0);
      expect(report.drift).not.toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('uses project context for detour references across files', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'show.ts'),
        `trail("entity.show", {
  detours: { NotFoundError: ["entity.search"] },
  blaze: async (input, ctx) => {
    return Result.ok(data);
  }
})`
      );
      writeFileSync(
        join(dir, 'search.ts'),
        `trail("entity.search", {
  blaze: async (input, ctx) => {
    return Result.ok(data);
  }
})`
      );

      const report = await runWarden({ rootDir: dir });
      const detourRefErrors = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'valid-detour-refs'
      );

      expect(detourRefErrors).toHaveLength(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('flags throws in detour targets declared in another file', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'show.ts'),
        `trail("entity.show", {
  detours: { NotFoundError: ["entity.search"] },
  blaze: async (input, ctx) => {
    return Result.ok(data);
  }
})`
      );
      writeFileSync(
        join(dir, 'search.ts'),
        `trail("entity.search", {
  blaze: async (input, ctx) => {
    throw new Error("boom");
  }
})`
      );

      const report = await runWarden({ rootDir: dir });
      const detourThrowRules = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'no-throw-in-detour-target'
      );

      expect(detourThrowRules).toHaveLength(1);
      expect(detourThrowRules[0]?.message).toContain('entity.search');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('requires draft-bearing files to be visibly marked', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'draft-id.ts'),
        `trail("_draft.entity.prepare", {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({})
})`
      );

      const report = await runWarden({ rootDir: dir });

      const hasDraftFileMarking = report.diagnostics.some((diagnostic) =>
        isDraftFileMarking(diagnostic.rule)
      );
      const hasDraftVisibleDebt = report.diagnostics.some((diagnostic) =>
        isDraftVisibleDebt(diagnostic.rule)
      );

      expect(hasDraftFileMarking).toBe(true);
      expect(hasDraftVisibleDebt).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('allows correctly marked draft files while keeping the debt visible', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, '_draft.entity.ts'),
        `trail("_draft.entity.prepare", {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({})
})`
      );

      const report = await runWarden({ rootDir: dir });

      const hasDraftFileMarkingError = report.diagnostics.some((diagnostic) =>
        isDraftFileMarkingError(diagnostic)
      );
      const hasDraftVisibleDebt = report.diagnostics.some((diagnostic) =>
        isDraftVisibleDebt(diagnostic.rule)
      );

      expect(hasDraftFileMarkingError).toBe(false);
      expect(hasDraftVisibleDebt).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('warns when a draft-marked file no longer contains draft ids', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'entity.draft.ts'),
        `trail("entity.prepare", {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({})
})`
      );

      const report = await runWarden({ rootDir: dir });

      const hasDraftFileMarkingWarn = report.diagnostics.some((diagnostic) =>
        isDraftFileMarkingWarn(diagnostic)
      );

      expect(hasDraftFileMarkingWarn).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('formatWardenReport', () => {
  test('formats a clean report', () => {
    const output = formatWardenReport({
      diagnostics: [],
      drift: { committedHash: null, currentHash: 'stub', stale: false },
      errorCount: 0,
      passed: true,
      warnCount: 0,
    });
    expect(output).toContain('Warden Report');
    expect(output).toContain('Lint: clean');
    expect(output).toContain('Drift: clean');
    expect(output).toContain('Result: PASS');
  });

  test('formats a report with errors', () => {
    const output = formatWardenReport({
      diagnostics: [
        {
          filePath: 'src/trails/entity.ts',
          line: 3,
          message: 'Do not throw inside implementation.',
          rule: 'no-throw-in-implementation',
          severity: 'error',
        },
      ],
      drift: { committedHash: null, currentHash: 'stub', stale: false },
      errorCount: 1,
      passed: false,
      warnCount: 0,
    });
    expect(output).toContain('1 errors');
    expect(output).toContain('Result: FAIL');
    expect(output).toContain('entity.ts:3');
  });

  test('formats a report with stale drift', () => {
    const output = formatWardenReport({
      diagnostics: [],
      drift: { committedHash: 'abc', currentHash: 'def', stale: true },
      errorCount: 0,
      passed: false,
      warnCount: 0,
    });
    expect(output).toContain('trails.lock is stale');
    expect(output).toContain('Result: FAIL');
  });

  test('formats a report with blocked established exports', () => {
    const output = formatWardenReport({
      diagnostics: [],
      drift: {
        blockedReason:
          'Established topo validation failed with 1 draft issue(s)',
        committedHash: null,
        currentHash: 'blocked',
        stale: true,
      },
      errorCount: 0,
      passed: false,
      warnCount: 0,
    });
    expect(output).toContain('Drift: blocked');
    expect(output).toContain('established exports blocked');
  });
});
