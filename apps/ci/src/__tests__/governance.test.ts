import { describe, expect, test } from 'bun:test';

import type { DriftResult, WardenReport } from '@ontrails/warden';

import { createDriftOnlyReport, evaluateCiGovernance } from '../governance.js';

const staleDrift: DriftResult = {
  committedHash: 'committed-123',
  currentHash: 'current-456',
  stale: true,
};

const cleanDrift: DriftResult = {
  committedHash: 'same-hash',
  currentHash: 'same-hash',
  stale: false,
};

const warningOnlyReport: WardenReport = {
  diagnostics: [
    {
      filePath: 'apps/example/src/foo.ts',
      line: 12,
      message: 'Document this trail',
      rule: 'missing-docs',
      severity: 'warn',
    },
  ],
  drift: cleanDrift,
  errorCount: 0,
  passed: true,
  warnCount: 1,
};

const failingReport: WardenReport = {
  diagnostics: [
    {
      filePath: 'apps/example/src/foo.ts',
      line: 12,
      message: 'Document this trail',
      rule: 'missing-docs',
      severity: 'warn',
    },
    {
      filePath: 'apps/example/src/bar.ts',
      line: 24,
      message: 'Return Result.ok/err instead of throwing',
      rule: 'implementation-returns-result',
      severity: 'error',
    },
  ],
  drift: staleDrift,
  errorCount: 1,
  passed: false,
  warnCount: 1,
};

describe('evaluateCiGovernance', () => {
  test('formats GitHub output as a stable golden string', () => {
    const result = evaluateCiGovernance({
      driftResult: staleDrift,
      failOn: 'error',
      format: 'github',
      wardenReport: failingReport,
    });

    expect(result.output).toBe(
      [
        '::warning file=apps/example/src/foo.ts,line=12,title=missing-docs::Document this trail',
        '::error file=apps/example/src/bar.ts,line=24,title=implementation-returns-result::Return Result.ok/err instead of throwing',
        '::error title=drift-detected::trails.lock is stale — regenerate with `trails topo compile`',
      ].join('\n')
    );
  });

  test('formats JSON output as a stable golden string', () => {
    const result = evaluateCiGovernance({
      driftResult: staleDrift,
      failOn: 'error',
      format: 'json',
      wardenReport: failingReport,
    });

    expect(result.output).toBe(`{
  "drift": {
    "hasDrift": true,
    "committedHash": "committed-123",
    "currentHash": "current-456",
    "stale": true
  },
  "passed": false,
  "warden": {
    "diagnostics": [
      {
        "filePath": "apps/example/src/foo.ts",
        "line": 12,
        "message": "Document this trail",
        "rule": "missing-docs",
        "severity": "warn"
      },
      {
        "filePath": "apps/example/src/bar.ts",
        "line": 24,
        "message": "Return Result.ok/err instead of throwing",
        "rule": "implementation-returns-result",
        "severity": "error"
      }
    ],
    "errorCount": 1,
    "passed": false,
    "warnCount": 1
  }
}`);
  });

  test('formats summary output as a stable golden string', () => {
    const result = evaluateCiGovernance({
      driftResult: staleDrift,
      failOn: 'error',
      format: 'summary',
      wardenReport: failingReport,
    });

    expect(result.output).toBe(`## Trails Governance Report

### Warden: 1 errors, 1 warnings

| Severity | Rule | File | Line | Message |
|----------|------|------|------|---------|
| warn | missing-docs | apps/example/src/foo.ts | 12 | Document this trail |
| error | implementation-returns-result | apps/example/src/bar.ts | 24 | Return Result.ok/err instead of throwing |

### Drift: stale
The trails.lock file is out of date. Regenerate with \`trails topo compile\`.

**Result: FAIL**`);
  });

  test('treats warning-only runs as passing when failOn is error', () => {
    const result = evaluateCiGovernance({
      driftResult: cleanDrift,
      failOn: 'error',
      format: 'json',
      wardenReport: warningOnlyReport,
    });

    expect(result.passed).toBe(true);
  });

  test('fails warning-only runs when failOn is warning', () => {
    const result = evaluateCiGovernance({
      driftResult: cleanDrift,
      failOn: 'warning',
      format: 'json',
      wardenReport: warningOnlyReport,
    });

    expect(result.passed).toBe(false);
  });

  test('fails when error diagnostics are present', () => {
    const result = evaluateCiGovernance({
      driftResult: cleanDrift,
      failOn: 'error',
      format: 'json',
      wardenReport: failingReport,
    });

    expect(result.passed).toBe(false);
  });

  test('fails when drift is stale even without diagnostics', () => {
    const result = evaluateCiGovernance({
      driftResult: staleDrift,
      failOn: 'error',
      format: 'json',
      wardenReport: createDriftOnlyReport(staleDrift),
    });

    expect(result.passed).toBe(false);
  });
});
