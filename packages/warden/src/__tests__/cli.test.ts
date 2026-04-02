import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatWardenReport, runWarden } from '../cli.js';

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
    expect(output).toContain('trailhead.lock is stale');
    expect(output).toContain('Result: FAIL');
  });
});
