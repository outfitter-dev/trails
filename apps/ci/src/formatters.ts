/**
 * CI output formatters for warden and drift results.
 *
 * Supports three output modes:
 * - `json` — machine-readable JSON (default for non-CI environments)
 * - `github` — GitHub Actions annotation format
 * - `summary` — human-readable markdown summary
 */

import type { DriftResult, WardenReport } from '@ontrails/warden';

/** Supported CI output formats */
export type CiFormat = 'github' | 'json' | 'summary';

interface CiOutput {
  readonly wardenReport: WardenReport;
  readonly driftResult: DriftResult;
}

/** Format warden diagnostics as GitHub Actions annotations */
const formatGitHub = (output: CiOutput): string => {
  const lines: string[] = [];

  for (const d of output.wardenReport.diagnostics) {
    const level = d.severity === 'error' ? 'error' : 'warning';
    lines.push(
      `::${level} file=${d.filePath},line=${String(d.line)},title=${d.rule}::${d.message}`
    );
  }

  if (output.driftResult.stale) {
    lines.push(
      '::error title=drift-detected::trailhead.lock is stale — regenerate with `trails survey generate`'
    );
  }

  return lines.join('\n');
};

/** Format as machine-readable JSON */
const formatJson = (output: CiOutput): string =>
  JSON.stringify(
    {
      drift: {
        hasDrift: output.driftResult.stale,
        ...output.driftResult,
      },
      passed: output.wardenReport.passed && !output.driftResult.stale,
      warden: {
        diagnostics: output.wardenReport.diagnostics,
        errorCount: output.wardenReport.errorCount,
        passed: output.wardenReport.passed,
        warnCount: output.wardenReport.warnCount,
      },
    },
    null,
    2
  );

/** Build the warden section of the markdown summary */
const summaryWardenSection = (report: WardenReport): string[] => {
  if (report.diagnostics.length === 0) {
    return ['### Warden: clean'];
  }

  const header = `### Warden: ${String(report.errorCount)} errors, ${String(report.warnCount)} warnings`;
  const tableHeader = [
    '',
    '| Severity | Rule | File | Line | Message |',
    '|----------|------|------|------|---------|',
  ];
  const rows = report.diagnostics.map(
    (d) =>
      `| ${d.severity} | ${d.rule} | ${d.filePath} | ${String(d.line)} | ${d.message} |`
  );

  return [header, ...tableHeader, ...rows];
};

/** Build the drift section of the markdown summary */
const summaryDriftSection = (drift: DriftResult): string[] => {
  if (drift.stale) {
    return [
      '### Drift: stale',
      'The trailhead.lock is out of date. Regenerate with `trails survey generate`.',
    ];
  }
  return ['### Drift: clean'];
};

/** Format as markdown summary */
const formatSummary = (output: CiOutput): string => {
  const passed = output.wardenReport.passed && !output.driftResult.stale;
  const result = passed ? '**Result: PASS**' : '**Result: FAIL**';

  return [
    '## Trails Governance Report',
    '',
    ...summaryWardenSection(output.wardenReport),
    '',
    ...summaryDriftSection(output.driftResult),
    '',
    result,
  ].join('\n');
};

const formatters: Record<CiFormat, (output: CiOutput) => string> = {
  github: formatGitHub,
  json: formatJson,
  summary: formatSummary,
};

/** Format CI output using the specified format */
export const formatCiOutput = (format: CiFormat, output: CiOutput): string =>
  formatters[format](output);
