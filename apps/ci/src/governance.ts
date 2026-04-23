import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { findAppModule } from '@ontrails/cli';
import type { Topo } from '@ontrails/core';
import { AmbiguousError, NotFoundError } from '@ontrails/core';
import { runWarden } from '@ontrails/warden';
import type {
  DriftResult,
  WardenDiagnostic,
  WardenReport,
} from '@ontrails/warden';

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

const resolveAppModulePath = (rootDir: string): string => {
  const modulePath = resolve(rootDir, findAppModule(rootDir));
  if (!modulePath.endsWith('.js') || existsSync(modulePath)) {
    return modulePath;
  }

  const tsPath = modulePath.replace(/\.js$/, '.ts');
  return existsSync(tsPath) ? tsPath : modulePath;
};

const TOPO_EXPORT_KEYS = ['default', 'graph', 'app'] as const;

const isTopo = (value: unknown): value is Topo => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  // Require the shape runWarden actually uses: readonly Maps for trails,
  // signals, resources, contours, plus core accessor methods. A bare object
  // with a `trails` field (PR metadata, docs snippet, etc.) would fail at
  // runtime inside the topo-aware rules; gate it here.
  return (
    candidate['trails'] instanceof Map &&
    candidate['signals'] instanceof Map &&
    candidate['resources'] instanceof Map &&
    candidate['contours'] instanceof Map &&
    typeof candidate['get'] === 'function' &&
    typeof candidate['list'] === 'function' &&
    typeof candidate['name'] === 'string'
  );
};

const extractTopo = (
  modulePath: string,
  loaded: Record<string, unknown>
): Topo => {
  // Prefer the first export that is actually a Topo rather than the first
  // key present. A module can legally expose a non-Topo `default` alongside
  // a named `graph`/`app` topo (for example when default is the Topo's
  // metadata object), and nullish-coalescing would silently pick the wrong
  // one and fall back to no-topo governance.
  for (const key of TOPO_EXPORT_KEYS) {
    const candidate = loaded[key];
    if (isTopo(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find a Topo export in "${modulePath}". Expected a default, "graph", or "app" export created with topo().`
  );
};

interface TopoLoadResult {
  readonly topo?: Topo;
  readonly loadError?: {
    readonly message: string;
    readonly filePath: string;
  };
  readonly ambiguous?: {
    readonly message: string;
  };
}

const loadErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type TopoLoadError = NonNullable<TopoLoadResult['loadError']>;

type ResolvedPath =
  | { readonly kind: 'path'; readonly modulePath: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous'; readonly message: string }
  | { readonly kind: 'error'; readonly loadError: TopoLoadError };

const resolveModulePathForGovernance = (rootDir: string): ResolvedPath => {
  try {
    return { kind: 'path', modulePath: resolveAppModulePath(rootDir) };
  } catch (error) {
    // Discovery failures are configuration concerns, not real load failures:
    // - NotFoundError: repo has no Trails app; topo-aware rules have nothing
    //   to inspect. Silently skip.
    // - AmbiguousError: repo has multiple Trails apps (e.g. the Trails
    //   monorepo itself). Governance can't pick one without help, but
    //   staying completely silent hides the fact that topo-aware rules
    //   (permits etc.) are being skipped. Emit a warn diagnostic so the
    //   gap is visible in the report; callers can pass `--module <path>`
    //   to govern a specific app.
    if (error instanceof NotFoundError) {
      return { kind: 'missing' };
    }
    if (error instanceof AmbiguousError) {
      return { kind: 'ambiguous', message: loadErrorMessage(error) };
    }
    return {
      kind: 'error',
      loadError: { filePath: rootDir, message: loadErrorMessage(error) },
    };
  }
};

const importTopoFromModulePath = async (
  modulePath: string
): Promise<TopoLoadResult> => {
  try {
    const loaded = (await import(pathToFileURL(modulePath).href)) as Record<
      string,
      unknown
    >;
    const topo = extractTopo(modulePath, loaded);
    return topo ? { topo } : {};
  } catch (error) {
    // App module is present but failed to load (import-time throw, missing
    // dependency, bad topo export). Surface this so CI doesn't silently skip
    // topo-aware rules including permit governance.
    return {
      loadError: { filePath: modulePath, message: loadErrorMessage(error) },
    };
  }
};

const loadTopoForGovernance = (rootDir: string): Promise<TopoLoadResult> => {
  const resolved = resolveModulePathForGovernance(rootDir);
  if (resolved.kind === 'missing') {
    return Promise.resolve({});
  }
  if (resolved.kind === 'ambiguous') {
    return Promise.resolve({ ambiguous: { message: resolved.message } });
  }
  if (resolved.kind === 'error') {
    return Promise.resolve({ loadError: resolved.loadError });
  }
  return importTopoFromModulePath(resolved.modulePath);
};

const topoLoadFailureDiagnostic = (
  loadError: NonNullable<TopoLoadResult['loadError']>
): WardenDiagnostic => ({
  filePath: loadError.filePath,
  line: 1,
  message: `Failed to load Trails app for governance: ${loadError.message}`,
  rule: 'topo-load',
  severity: 'error',
});

const ambiguousTopoDiagnostic = (
  rootDir: string,
  message: string
): WardenDiagnostic => ({
  filePath: rootDir,
  line: 1,
  message: `Multiple Trails apps discovered; skipping topo-aware rules. Pass \`--module <path>\` to govern a specific app. ${message}`,
  rule: 'topo-load',
  severity: 'warn',
});

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
  const topoResult = await loadTopoForGovernance(resolvedRootDir);
  const wardenReport = await runWarden({
    rootDir: resolvedRootDir,
    topo: topoResult.topo,
  });

  let finalReport: WardenReport = wardenReport;
  if (topoResult.loadError) {
    finalReport = {
      ...finalReport,
      diagnostics: [
        topoLoadFailureDiagnostic(topoResult.loadError),
        ...finalReport.diagnostics,
      ],
      errorCount: finalReport.errorCount + 1,
      passed: false,
    };
  } else if (topoResult.ambiguous) {
    finalReport = {
      ...finalReport,
      diagnostics: [
        ambiguousTopoDiagnostic(resolvedRootDir, topoResult.ambiguous.message),
        ...finalReport.diagnostics,
      ],
      warnCount: finalReport.warnCount + 1,
    };
  }

  return evaluateCiGovernance({
    driftResult: finalReport.drift ?? fallbackDriftResult,
    failOn,
    format,
    wardenReport: finalReport,
  });
};
