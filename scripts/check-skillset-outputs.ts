import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

interface SkillsetDiagnostic {
  code?: unknown;
  message?: unknown;
  path?: unknown;
  severity?: unknown;
}

interface SkillsetResult {
  data?: {
    checkedFiles?: unknown;
    failures?: unknown;
  };
  diagnostics?: unknown;
  ok?: unknown;
}

interface CommandResult {
  exitCode: number;
  parsed?: SkillsetResult;
  stderr: string;
  stdout: string;
}

type JsonRecord = Record<string, unknown>;

const ISOLATED_PREFIX = '.skillset/cache/latest/';
const MARKETPLACE_MANIFEST_PATH = '.claude-plugin/marketplace.json';

const isDiagnostic = (value: unknown): value is SkillsetDiagnostic =>
  typeof value === 'object' && value !== null;

const diagnosticsOf = (result: SkillsetResult): readonly SkillsetDiagnostic[] =>
  Array.isArray(result.diagnostics)
    ? result.diagnostics.filter(isDiagnostic)
    : [];

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeIsolatedPaths = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.startsWith(ISOLATED_PREFIX)
      ? value.slice(ISOLATED_PREFIX.length)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeIsolatedPaths);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeIsolatedPaths(child),
    ])
  );
};

export const normalizeMarketplaceLock = (value: unknown): unknown => {
  const normalized = normalizeIsolatedPaths(structuredClone(value));
  if (!isRecord(normalized)) {
    return normalized;
  }

  delete normalized.provenanceHash;
  const { marketplaces } = normalized;
  if (!isRecord(marketplaces) || !Array.isArray(marketplaces.entries)) {
    return normalized;
  }

  for (const entry of marketplaces.entries) {
    if (!isRecord(entry)) {
      continue;
    }
    if (Array.isArray(entry.generatedPaths)) {
      entry.generatedPaths = entry.generatedPaths.filter(
        (path) => path !== MARKETPLACE_MANIFEST_PATH
      );
    }

    const { resolved } = entry;
    if (!isRecord(resolved)) {
      continue;
    }
    delete resolved.ref;
    delete resolved.sha;
    if (Array.isArray(resolved.generatedPaths)) {
      resolved.generatedPaths = resolved.generatedPaths.filter(
        (path) => path !== MARKETPLACE_MANIFEST_PATH
      );
    }
  }

  return normalized;
};

export const isMarketplaceLockOnlyDrift = (
  result: SkillsetResult,
  liveLock: unknown,
  isolatedLock: unknown
): boolean => {
  const errors = diagnosticsOf(result).filter(
    (diagnostic) => diagnostic.severity === 'error'
  );
  const failures = result.data?.failures;

  const diagnosticMatches =
    errors.length === 1 &&
    errors[0]?.code === 'generated-output-changed' &&
    errors[0]?.path === 'skillset.lock' &&
    Array.isArray(failures) &&
    failures.length === 1 &&
    failures[0] === 'stale generated file: skillset.lock';

  return (
    diagnosticMatches &&
    JSON.stringify(normalizeMarketplaceLock(liveLock)) ===
      JSON.stringify(normalizeMarketplaceLock(isolatedLock))
  );
};

const runSkillset = async (args: readonly string[]): Promise<CommandResult> => {
  const process = Bun.spawn(['skillset', ...args], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);

  let parsed: SkillsetResult | undefined;
  try {
    parsed = JSON.parse(stdout) as SkillsetResult;
  } catch {
    // Preserve the command's original output below when its JSON contract fails.
  }

  return { exitCode, parsed, stderr, stdout };
};

const reportCommandFailure = (label: string, result: CommandResult): void => {
  console.error(`${label} failed.`);
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  if (result.stdout.length > 0) {
    process.stderr.write(result.stdout);
  }
};

const reportWarnings = (result: SkillsetResult): void => {
  for (const diagnostic of diagnosticsOf(result)) {
    if (
      diagnostic.severity === 'warning' &&
      typeof diagnostic.message === 'string'
    ) {
      console.warn(`skillset: warning: ${diagnostic.message}`);
    }
  }
};

const readIsolatedLock = async (): Promise<unknown> => {
  const config = Bun.YAML.parse(await Bun.file('skillset.yaml').text()) as {
    workspace?: { cacheKey?: unknown };
  };
  const cacheKey = config.workspace?.cacheKey;
  if (typeof cacheKey !== 'string' || cacheKey.length === 0) {
    throw new Error(
      'skillset: workspace.cacheKey is required to verify marketplace lock provenance'
    );
  }

  const configuredCache = process.env.XDG_CACHE_HOME;
  const cacheBase =
    configuredCache !== undefined && isAbsolute(configuredCache)
      ? configuredCache
      : join(homedir(), '.cache');
  const lockPath = join(
    cacheBase,
    'skillset',
    cacheKey,
    'latest',
    'skillset.lock'
  );
  return Bun.file(lockPath).json();
};

const verifyMarketplaceLockDelta = async (
  outputs: SkillsetResult
): Promise<boolean> => {
  const isolated = await runSkillset([
    'build',
    '--isolated',
    '--all',
    '--yes',
    '--root',
    '.',
    '--json',
  ]);
  if (isolated.exitCode !== 0 || isolated.parsed?.ok !== true) {
    reportCommandFailure('Skillset isolated build', isolated);
    return false;
  }

  try {
    const [liveLock, isolatedLock] = await Promise.all([
      Bun.file('skillset.lock').json(),
      readIsolatedLock(),
    ]);
    return isMarketplaceLockOnlyDrift(outputs, liveLock, isolatedLock);
  } catch (error) {
    console.error(
      `Skillset marketplace lock comparison failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
};

export const checkSkillsetOutputs = async (): Promise<void> => {
  const releaseState = await runSkillset([
    'change',
    'check',
    '--root',
    '.',
    '--json',
  ]);
  const outputs = await runSkillset([
    'check',
    '--only',
    'outputs',
    '--root',
    '.',
    '--json',
  ]);
  const marketplace = await runSkillset([
    'marketplace',
    'check',
    'trails',
    '--root',
    '.',
    '--json',
  ]);
  const marketplaceReady =
    marketplace.exitCode === 0 && marketplace.parsed?.ok === true;
  const releaseStateReady =
    releaseState.exitCode === 0 && releaseState.parsed?.ok === true;
  const outputStateAccepted =
    outputs.exitCode === 0 && outputs.parsed?.ok === true
      ? true
      : outputs.parsed !== undefined &&
        marketplaceReady &&
        (await verifyMarketplaceLockDelta(outputs.parsed));

  if (!outputStateAccepted) {
    reportCommandFailure('Skillset output check', outputs);
  } else if (outputs.parsed !== undefined) {
    reportWarnings(outputs.parsed);
  }

  if (!marketplaceReady) {
    reportCommandFailure('Skillset marketplace check', marketplace);
  }

  if (!releaseStateReady) {
    reportCommandFailure('Skillset release-state check', releaseState);
  }

  if (!outputStateAccepted || !marketplaceReady || !releaseStateReady) {
    process.exitCode = 1;
    return;
  }

  const checkedFiles = outputs.parsed?.data?.checkedFiles;
  const count = typeof checkedFiles === 'number' ? checkedFiles : 'all';
  console.log(
    `skillset: checked ${count} generated files; release state and marketplace provenance are ready`
  );
};

if (import.meta.main) {
  await checkSkillsetOutputs();
}
