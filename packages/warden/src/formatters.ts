/**
 * CI-oriented formatters for warden reports.
 *
 * Each formatter takes a `WardenReport` and produces output suited to a
 * specific CI environment: GitHub Actions annotations, structured JSON,
 * or a concise markdown summary.
 */

import type { WardenReport } from './cli.js';
import type { WardenGuidanceLink, WardenSeverity } from './rules/types.js';

/** Map warden severity to GitHub Actions annotation level. */
const ghLevel: Record<WardenSeverity, string> = {
  error: 'error',
  warn: 'warning',
};

/**
 * Produce GitHub Actions workflow command annotations, one per diagnostic.
 *
 * Severity mapping: `error` to `::error`, `warn` to `::warning`.
 * Drift staleness or established-export blocking is emitted as a single
 * `::error` annotation when detected.
 */
export const formatGitHubAnnotations = (report: WardenReport): string => {
  const lines: string[] = [];

  for (const d of report.diagnostics) {
    const level = ghLevel[d.severity];
    lines.push(
      `::${level} file=${d.filePath},line=${String(d.line)}::${d.rule}: ${d.message}`
    );
  }

  if (report.drift?.blockedReason !== undefined) {
    lines.push(`::error::drift: ${report.drift.blockedReason}`);
  } else if (report.drift?.stale) {
    lines.push(
      '::error::drift: trails.lock is stale (regenerate with `trails compile`)'
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
      fixes: report.fixes,
      passed: report.passed,
      summary,
    },
    null,
    2
  );
};

const formatGuidanceLink = (link: WardenGuidanceLink): string => {
  if (link.path !== undefined) {
    return `[${link.label}](${link.path})`;
  }
  if (link.url !== undefined) {
    return `[${link.label}](${link.url})`;
  }
  return link.label;
};

/** Format diagnostic guidance as indented markdown lines. */
const diagnosticGuidanceLines = (
  d: WardenReport['diagnostics'][number]
): readonly string[] => {
  const { guidance } = d;
  if (guidance === undefined) {
    return [];
  }

  const lines = [`  - Next: ${guidance.summary}`];
  if (guidance.steps !== undefined && guidance.steps.length > 0) {
    lines.push(
      `  - Steps: ${guidance.steps
        .map((step, index) => `${String(index + 1)}. ${step}`)
        .join(' ')}`
    );
  }
  if (guidance.docs !== undefined && guidance.docs.length > 0) {
    lines.push(`  - Docs: ${guidance.docs.map(formatGuidanceLink).join(', ')}`);
  }
  if (guidance.commands !== undefined && guidance.commands.length > 0) {
    lines.push(
      `  - Commands: ${guidance.commands.map((cmd) => `\`${cmd}\``).join(', ')}`
    );
  }
  if (guidance.relatedRules !== undefined && guidance.relatedRules.length > 0) {
    lines.push(
      `  - Related: ${guidance.relatedRules.map((rule) => `\`${rule}\``).join(', ')}`
    );
  }
  return lines;
};

/** Format a diagnostic as markdown lines. */
const diagnosticLines = (
  d: WardenReport['diagnostics'][number]
): readonly string[] => [
  `- \`${d.filePath}:${String(d.line)}\` — ${d.rule}: ${d.message}`,
  ...diagnosticGuidanceLines(d),
];

/** Render a severity group as a headed markdown section, or empty array. */
const severitySection = (
  heading: string,
  diagnostics: WardenReport['diagnostics']
): readonly string[] => {
  if (diagnostics.length === 0) {
    return [];
  }
  return ['', `### ${heading}`, ...diagnostics.flatMap(diagnosticLines)];
};

/** Render a drift section if stale, otherwise empty array. */
const driftSection = (drift: WardenReport['drift']): readonly string[] => {
  if (drift?.blockedReason !== undefined) {
    return [
      '',
      '### Drift',
      `- established exports are blocked: ${drift.blockedReason}`,
    ];
  }

  if (!drift?.stale) {
    return [];
  }
  return [
    '',
    '### Drift',
    '- trails.lock is stale (regenerate with `trails compile`)',
  ];
};

/** Render safe-fix counts when a fix pass was requested. */
const fixSummaryLine = (fixes: WardenReport['fixes']): readonly string[] => {
  if (fixes === undefined) {
    return [];
  }
  return [
    `**Fixes:** ${String(fixes.applied)} applied, ${String(fixes.filesChanged)} files changed, ${String(fixes.skipped)} skipped`,
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
    ...fixSummaryLine(report.fixes),
    ...severitySection('Errors', errors),
    ...severitySection('Warnings', warnings),
    ...driftSection(report.drift),
  ].join('\n');
};
