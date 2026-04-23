import { resolve } from 'node:path';

import { runWarden } from '@ontrails/warden';
import type { DriftResult, WardenReport } from '@ontrails/warden';

import type { CiFormat } from './formatters.js';
import { formatCiOutput } from './formatters.js';

export type CiFailOn = 'error' | 'warning';

export interface CiGovernanceResult {
  readonly driftResult: DriftResult;
  readonly errorCount: number;
  readonly output: string;
  readonly passed: boolean;
  readonly summary: string;
  readonly wardenReport: WardenReport;
  readonly warningCount: number;
}

interface EvaluateCiGovernanceOptions {
  readonly driftResult: DriftResult;
  readonly failOn: CiFailOn;
  readonly format: CiFormat;
  readonly wardenReport: WardenReport;
}

const fallbackDriftResult: DriftResult = {
  committedHash: null,
  currentHash: 'unknown',
  stale: false,
};

export const createDriftOnlyReport = (
  driftResult: DriftResult
): WardenReport => ({
  diagnostics: [],
  drift: driftResult,
  errorCount: 0,
  passed: !driftResult.stale && driftResult.blockedReason === undefined,
  warnCount: 0,
});

export const evaluateCiGovernance = ({
  driftResult,
  failOn,
  format,
  wardenReport,
}: EvaluateCiGovernanceOptions): CiGovernanceResult => {
  const output = formatCiOutput(format, {
    driftResult,
    wardenReport,
  });
  const summary = formatCiOutput('summary', {
    driftResult,
    wardenReport,
  });
  const failedByErrors = wardenReport.errorCount > 0;
  const failedByWarnings = failOn === 'warning' && wardenReport.warnCount > 0;
  const hasDrift = driftResult.stale;
  const hasBlockedDrift = driftResult.blockedReason !== undefined;

  return {
    driftResult,
    errorCount: wardenReport.errorCount,
    output,
    passed:
      !failedByErrors && !failedByWarnings && !hasDrift && !hasBlockedDrift,
    summary,
    wardenReport,
    warningCount: wardenReport.warnCount,
  };
};

interface RunCiGovernanceOptions {
  readonly failOn?: CiFailOn | undefined;
  readonly format?: CiFormat | undefined;
  readonly rootDir?: string | undefined;
}

export const runCiGovernance = async ({
  failOn = 'error',
  format = 'json',
  rootDir = process.cwd(),
}: RunCiGovernanceOptions = {}): Promise<CiGovernanceResult> => {
  const resolvedRootDir = resolve(rootDir);
  const wardenReport = await runWarden({ rootDir: resolvedRootDir });

  return evaluateCiGovernance({
    driftResult: wardenReport.drift ?? fallbackDriftResult,
    failOn,
    format,
    wardenReport,
  });
};
