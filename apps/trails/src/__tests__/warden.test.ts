import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatWardenReport, runWarden } from '@ontrails/warden';

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `trails-warden-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('trails warden', () => {
  test('runs lint + drift checks and produces a report', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'good.ts'),
        `trail("hello", {
  implementation: async (input, ctx) => {
    return Result.ok({ message: "hi" });
  }
})`
      );

      const report = await runWarden({ rootDir: dir });
      expect(report.diagnostics).toBeDefined();
      expect(typeof report.errorCount).toBe('number');
      expect(typeof report.warnCount).toBe('number');
      expect(typeof report.passed).toBe('boolean');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lintOnly skips drift detection', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'empty.ts'), 'export {}');
      const report = await runWarden({ lintOnly: true, rootDir: dir });
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('driftOnly skips lint rules', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("x", {
  implementation: async () => { throw new Error("boom"); }
})`
      );
      const report = await runWarden({ driftOnly: true, rootDir: dir });
      expect(report.diagnostics.length).toBe(0);
      expect(report.drift).not.toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('formatWardenReport produces human-readable output', async () => {
    const report = await runWarden({ rootDir: '/dev/null' });
    const output = formatWardenReport(report);
    expect(output).toContain('Warden Report');
    expect(typeof output).toBe('string');
  });
});
