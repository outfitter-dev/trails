/**
 * CI-oriented formatters for warden reports.
 *
 * Each formatter takes a `WardenReport` and produces output suited to a
 * specific CI environment: GitHub Actions annotations, structured JSON,
 * or a concise markdown summary.
 */

import type { WardenReport } from './cli.js';
import type { WardenSeverity } from './rules/types.js';

/** Map warden severity to GitHub Actions annotation level. */
const ghLevel: Record<WardenSeverity, string> = {
  error: 'error',
  warn: 'warning',
};

/**
 * Produce GitHub Actions workflow command annotations, one per diagnostic.
 *
 * Severity mapping: `error` to `::error`, `warn` to `::warning`.
 * Drift staleness is emitted as a single `::error` annotation when detected.
 */
export const formatGitHubAnnotations = (report: WardenReport): string => {
  const lines: string[] = [];

  for (const d of report.diagnostics) {
    const level = ghLevel[d.severity];
    lines.push(
      `::${level} file=${d.filePath},line=${String(d.line)}::${d.rule}: ${d.message}`
    );
  }

  if (report.drift?.stale) {
    lines.push(
      '::error::drift: surface.lock is stale (regenerate with `trails survey generate`)'
    );
  }

  return lines.join('\n');
};

/**
 * Produce a structured JSON string from the report.
 *
 * Includes a `summary` object with error, warning, and suggestion counts
 * for easy consumption by downstream tooling.
 */
export const formatJson = (report: WardenReport): string => {
  const summary = {
    errors: report.errorCount,
    suggestions: 0,
    warnings: report.warnCount,
  };

  return JSON.stringify(
    {
      diagnostics: report.diagnostics,
      drift: report.drift,
      passed: report.passed,
      summary,
    },
    null,
    2
  );
};

/** Format a diagnostic as a markdown list item. */
const diagnosticLine = (d: WardenReport['diagnostics'][number]): string =>
  `- \`${d.filePath}:${String(d.line)}\` — ${d.rule}: ${d.message}`;

/** Render a severity group as a headed markdown section, or empty array. */
const severitySection = (
  heading: string,
  diagnostics: WardenReport['diagnostics']
): readonly string[] => {
  if (diagnostics.length === 0) {
    return [];
  }
  return ['', `### ${heading}`, ...diagnostics.map(diagnosticLine)];
};

/** Render a drift section if stale, otherwise empty array. */
const driftSection = (drift: WardenReport['drift']): readonly string[] => {
  if (!drift?.stale) {
    return [];
  }
  return [
    '',
    '### Drift',
    '- surface.lock is stale (regenerate with `trails survey generate`)',
  ];
};

/**
 * Produce a concise markdown summary suitable for a GitHub job summary or PR comment.
 *
 * Groups diagnostics by severity and includes drift status when relevant.
 */
export const formatSummary = (report: WardenReport): string => {
  const result = report.passed ? 'PASS' : 'FAIL';
  const errors = report.diagnostics.filter((d) => d.severity === 'error');
  const warnings = report.diagnostics.filter((d) => d.severity === 'warn');

  return [
    '## Warden Report',
    '',
    `**Result: ${result}** | ${String(report.errorCount)} errors, ${String(report.warnCount)} warnings`,
    ...severitySection('Errors', errors),
    ...severitySection('Warnings', warnings),
    ...driftSection(report.drift),
  ].join('\n');
};
