import { describe, expect, test } from 'bun:test';

import type { WardenReport } from '../cli.js';
import {
  formatGitHubAnnotations,
  formatJson,
  formatSummary,
} from '../formatters.js';

const cleanReport: WardenReport = {
  diagnostics: [],
  drift: { committedHash: 'abc', currentHash: 'abc', stale: false },
  errorCount: 0,
  passed: true,
  warnCount: 0,
};

const reportWithDiagnostics: WardenReport = {
  diagnostics: [
    {
      filePath: 'packages/core/src/result.ts',
      line: 42,
      message: 'Throw statement found in trail implementation',
      rule: 'no-throw-in-implementation',
      severity: 'error',
    },
    {
      filePath: 'packages/core/src/trails.ts',
      line: 15,
      message: 'Trail "entity.show" has no output schema',
      rule: 'require-output-schema',
      severity: 'warn',
    },
  ],
  drift: null,
  errorCount: 1,
  passed: false,
  warnCount: 1,
};

const reportWithDrift: WardenReport = {
  diagnostics: [],
  drift: { committedHash: 'abc', currentHash: 'def', stale: true },
  errorCount: 0,
  passed: false,
  warnCount: 0,
};

describe('formatGitHubAnnotations', () => {
  test('produces empty string for clean report', () => {
    expect(formatGitHubAnnotations(cleanReport)).toBe('');
  });

  test('maps error severity to ::error', () => {
    const output = formatGitHubAnnotations(reportWithDiagnostics);
    expect(output).toContain(
      '::error file=packages/core/src/result.ts,line=42::no-throw-in-implementation:'
    );
  });

  test('maps warn severity to ::warning', () => {
    const output = formatGitHubAnnotations(reportWithDiagnostics);
    expect(output).toContain(
      '::warning file=packages/core/src/trails.ts,line=15::require-output-schema:'
    );
  });

  test('emits drift as a single ::error annotation', () => {
    const output = formatGitHubAnnotations(reportWithDrift);
    expect(output).toContain('::error::drift: surface.lock is stale');
  });

  test('produces one line per diagnostic', () => {
    const lines = formatGitHubAnnotations(reportWithDiagnostics)
      .split('\n')
      .filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe('formatJson', () => {
  test('produces valid JSON', () => {
    const parsed = JSON.parse(formatJson(cleanReport));
    expect(parsed).toBeDefined();
  });

  test('includes passed status', () => {
    const parsed = JSON.parse(formatJson(cleanReport));
    expect(parsed.passed).toBe(true);
  });

  test('includes summary counts', () => {
    const parsed = JSON.parse(formatJson(reportWithDiagnostics));
    expect(parsed.summary).toEqual({
      errors: 1,
      suggestions: 0,
      warnings: 1,
    });
  });

  test('includes diagnostics array', () => {
    const parsed = JSON.parse(formatJson(reportWithDiagnostics));
    expect(parsed.diagnostics).toHaveLength(2);
    expect(parsed.diagnostics[0].rule).toBe('no-throw-in-implementation');
  });

  test('includes null drift when absent', () => {
    const parsed = JSON.parse(formatJson(reportWithDiagnostics));
    expect(parsed.drift).toBeNull();
  });

  test('includes drift result when present', () => {
    const parsed = JSON.parse(formatJson(reportWithDrift));
    expect(parsed.drift.stale).toBe(true);
  });
});

describe('formatSummary', () => {
  test('includes markdown heading', () => {
    expect(formatSummary(cleanReport)).toContain('## Warden Report');
  });

  test('shows PASS for clean report', () => {
    expect(formatSummary(cleanReport)).toContain('**Result: PASS**');
  });

  test('shows FAIL for failing report', () => {
    expect(formatSummary(reportWithDiagnostics)).toContain('**Result: FAIL**');
  });

  test('groups errors under ### Errors heading', () => {
    const output = formatSummary(reportWithDiagnostics);
    expect(output).toContain('### Errors');
    expect(output).toContain('no-throw-in-implementation');
  });

  test('groups warnings under ### Warnings heading', () => {
    const output = formatSummary(reportWithDiagnostics);
    expect(output).toContain('### Warnings');
    expect(output).toContain('require-output-schema');
  });

  test('includes file:line in backticks', () => {
    const output = formatSummary(reportWithDiagnostics);
    expect(output).toContain('`packages/core/src/result.ts:42`');
  });

  test('includes drift section when stale', () => {
    const output = formatSummary(reportWithDrift);
    expect(output).toContain('### Drift');
    expect(output).toContain('surface.lock is stale');
  });

  test('omits drift section when clean', () => {
    expect(formatSummary(cleanReport)).not.toContain('### Drift');
  });
});
