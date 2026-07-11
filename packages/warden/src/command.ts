import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  deriveCliFlagValueAliases,
  findAppModule,
  findAppModuleCandidates,
} from '@ontrails/cli';
import type {
  CliFlagValueAlias,
  CliFlagValueAliasDeclaration,
} from '@ontrails/cli';
import { resolveTrailsOverlays } from '@ontrails/adapter-kit';
import type { Topo } from '@ontrails/core';
import { AmbiguousError, NotFoundError } from '@ontrails/core';
import type { TopoGraphOverlayRegistration } from '@ontrails/topography';
import {
  loadTrailsConfigValue,
  resolveTrailsProjectRoot,
} from '@ontrails/config';

import type {
  WardenConfigInput,
  WardenConfigLayer,
  WardenDepth,
  WardenDraftsMode,
  WardenFailOn,
  WardenFormat,
  WardenScope,
  WardenLockMode,
} from './config.js';
import {
  resolveWardenConfig,
  wardenDepthValues,
  wardenDraftsValues,
  wardenFailOnValues,
  wardenFormatValues,
  wardenLockValues,
} from './config.js';
import type {
  WardenReport,
  WardenRunOptions,
  WardenTopoTarget,
} from './cli.js';
import { runWarden } from './cli.js';
import {
  formatGitHubAnnotations,
  formatJson,
  formatSummary,
} from './formatters.js';
import type { WardenDiagnostic, WardenSeverity } from './rules/types.js';

type EnvRecord = Record<string, string | undefined>;

interface MutableWardenConfigLayer {
  apps?: string[] | undefined;
  depth?: WardenDepth | undefined;
  drafts?: WardenDraftsMode | undefined;
  failOn?: WardenFailOn | undefined;
  format?: WardenFormat | undefined;
  scope?: WardenScope | undefined;
  lock?: WardenLockMode | undefined;
  noLockMutation?: boolean | undefined;
}

const diagnostic = ({
  filePath = '<warden-cli>',
  message,
  rule = 'warden-cli',
  severity = 'error',
}: {
  readonly filePath?: string | undefined;
  readonly message: string;
  readonly rule?: string | undefined;
  readonly severity?: WardenSeverity | undefined;
}): WardenDiagnostic => ({
  filePath,
  line: 1,
  message,
  rule,
  severity,
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const cleanUndefined = <T extends Record<string, unknown>>(
  value: T
): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;

const splitApps = (value: string): readonly string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const splitCommaDelimitedValues = (value: string): readonly string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const isAllowedValue = <T extends string>(
  value: string,
  allowed: readonly T[]
): value is T => allowed.includes(value as T);

interface EnumReadOptions<T extends string> {
  readonly allowed: readonly T[];
  readonly diagnostics: WardenDiagnostic[];
  readonly flag: string;
  readonly value: string | undefined;
}

const readEnumValue = <T extends string>({
  allowed,
  diagnostics,
  flag,
  value,
}: EnumReadOptions<T>): T | undefined => {
  if (value !== undefined && isAllowedValue(value, allowed)) {
    return value;
  }
  diagnostics.push(
    diagnostic({
      message: `Invalid ${flag} value "${value ?? ''}". Expected one of: ${allowed.join(', ')}.`,
    })
  );
  return undefined;
};

export interface ParsedWardenCommand {
  readonly adapterCheck: boolean;
  readonly ci: boolean;
  readonly cli: WardenConfigLayer;
  readonly configPath?: string | undefined;
  readonly diagnostics: readonly WardenDiagnostic[];
  readonly fix: boolean;
  readonly prePush: boolean;
  readonly rootDir?: string | undefined;
}

const createEmptyParsedCommand = (message: string): ParsedWardenCommand => ({
  adapterCheck: false,
  ci: false,
  cli: {},
  diagnostics: [diagnostic({ message })],
  fix: false,
  prePush: false,
});

const tokenValue = (token: {
  readonly value?: string | boolean | undefined;
}): string | undefined =>
  typeof token.value === 'string' ? token.value : undefined;

interface CommandParserState {
  adapterCheck?: boolean | undefined;
  readonly apps: string[];
  readonly diagnostics: WardenDiagnostic[];
  readonly cli: MutableWardenConfigLayer;
  configPath?: string | undefined;
  fix?: boolean | undefined;
  rootDir?: string | undefined;
}

type AliasConfigKey = 'drafts' | 'format' | 'lock';

interface WardenAliasSpec {
  readonly aliases: CliFlagValueAliasDeclaration;
  readonly choices: readonly string[];
  readonly configKey: AliasConfigKey;
  readonly flagName: string;
}

interface WardenValueAliasTarget {
  readonly alias: CliFlagValueAlias;
  readonly configKey: AliasConfigKey;
}

const wardenAliasSpecs: readonly WardenAliasSpec[] = [
  {
    aliases: true,
    choices: wardenFormatValues,
    configKey: 'format',
    flagName: 'format',
  },
  {
    aliases: {
      cached: 'cached',
      refresh: 'refresh',
      skip: 'skip-lock',
    },
    choices: wardenLockValues,
    configKey: 'lock',
    flagName: 'lock',
  },
  {
    aliases: {
      exclude: 'exclude-drafts',
      include: 'include-drafts',
      only: 'only-drafts',
    },
    choices: wardenDraftsValues,
    configKey: 'drafts',
    flagName: 'drafts',
  },
];

const wardenValueAliasTargets: readonly WardenValueAliasTarget[] =
  wardenAliasSpecs.flatMap((spec) =>
    (
      deriveCliFlagValueAliases({
        aliases: spec.aliases,
        choices: spec.choices,
        flagName: spec.flagName,
      }) ?? []
    ).map((alias) => ({
      alias,
      configKey: spec.configKey,
    }))
  );

const wardenValueAliasTargetByName = new Map(
  wardenValueAliasTargets.map((target) => [target.alias.name, target])
);

const valueAliasParseOptions = Object.fromEntries(
  wardenValueAliasTargets.map((target) => [
    target.alias.name,
    { type: 'boolean' as const },
  ])
);

const parseTokens = (
  args: readonly string[]
): ReturnType<typeof parseArgs> | { readonly error: string } => {
  try {
    return parseArgs({
      allowPositionals: false,
      args: [...args],
      options: {
        'adapter-check': { type: 'boolean' },
        apps: { multiple: true, short: 'a', type: 'string' },
        ci: { type: 'boolean' },
        'config-path': { type: 'string' },
        depth: { type: 'string' },
        drafts: { type: 'string' },
        'fail-on': { type: 'string' },
        fix: { type: 'boolean' },
        format: { type: 'string' },
        lock: { type: 'string' },
        'no-lock-mutation': { type: 'boolean' },
        'pre-push': { type: 'boolean' },
        'root-dir': { type: 'string' },
        'scope-exclude': { multiple: true, type: 'string' },
        strict: { type: 'boolean' },
        ...valueAliasParseOptions,
      },
      strict: true,
      tokens: true,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
};

const isParseError = (
  value: ReturnType<typeof parseArgs> | { readonly error: string }
): value is { readonly error: string } => 'error' in value;

const applyPresetToken = (
  token: NonNullable<ReturnType<typeof parseArgs>['tokens']>[number],
  cli: MutableWardenConfigLayer
): { readonly ci: boolean; readonly prePush: boolean } => {
  if (token.kind !== 'option') {
    return { ci: false, prePush: false };
  }
  if (token.name === 'pre-push') {
    Object.assign(cli, {
      depth: 'project',
      failOn: 'error',
      lock: 'cached',
    } satisfies WardenConfigLayer);
    return { ci: false, prePush: true };
  }
  if (token.name === 'ci') {
    Object.assign(cli, {
      depth: 'all',
      failOn: 'error',
      format: 'github',
      lock: 'auto',
      noLockMutation: true,
    } satisfies WardenConfigLayer);
    return { ci: true, prePush: false };
  }
  return { ci: false, prePush: false };
};

const applyAliasOption = (name: string, state: CommandParserState): boolean => {
  const target = wardenValueAliasTargetByName.get(name);
  if (target === undefined) {
    return false;
  }
  if (target.configKey === 'format') {
    state.cli.format = target.alias.value as WardenFormat;
  } else if (target.configKey === 'lock') {
    state.cli.lock = target.alias.value as WardenLockMode;
  } else {
    state.cli.drafts = target.alias.value as WardenDraftsMode;
  }
  return true;
};

const applyEnumOption = (
  name: string,
  value: string | undefined,
  state: CommandParserState
): boolean => {
  if (name === 'depth') {
    state.cli.depth = readEnumValue<WardenDepth>({
      allowed: wardenDepthValues,
      diagnostics: state.diagnostics,
      flag: '--depth',
      value,
    });
    return true;
  }
  if (name === 'drafts') {
    state.cli.drafts = readEnumValue<WardenDraftsMode>({
      allowed: wardenDraftsValues,
      diagnostics: state.diagnostics,
      flag: '--drafts',
      value,
    });
    return true;
  }
  if (name === 'fail-on') {
    state.cli.failOn = readEnumValue<WardenFailOn>({
      allowed: wardenFailOnValues,
      diagnostics: state.diagnostics,
      flag: '--fail-on',
      value,
    });
    return true;
  }
  if (name === 'format') {
    state.cli.format = readEnumValue<WardenFormat>({
      allowed: wardenFormatValues,
      diagnostics: state.diagnostics,
      flag: '--format',
      value,
    });
    return true;
  }
  if (name === 'lock') {
    state.cli.lock = readEnumValue<WardenLockMode>({
      allowed: wardenLockValues,
      diagnostics: state.diagnostics,
      flag: '--lock',
      value,
    });
    return true;
  }
  return false;
};

const applyCommandOption = (
  token: NonNullable<ReturnType<typeof parseArgs>['tokens']>[number],
  state: CommandParserState
): void => {
  if (
    token.kind !== 'option' ||
    token.name === 'ci' ||
    token.name === 'pre-push'
  ) {
    return;
  }

  const value = tokenValue(token);
  if (
    applyAliasOption(token.name, state) ||
    applyEnumOption(token.name, value, state)
  ) {
    return;
  }

  if (token.name === 'apps') {
    if (value === undefined) {
      state.diagnostics.push(
        diagnostic({ message: '--apps requires a comma-delimited value.' })
      );
      return;
    }
    state.apps.push(...splitApps(value));
    return;
  }
  if (token.name === 'adapter-check') {
    state.adapterCheck = true;
    return;
  }
  if (token.name === 'config-path') {
    state.configPath = value;
    return;
  }
  if (token.name === 'scope-exclude') {
    if (value === undefined) {
      state.diagnostics.push(
        diagnostic({ message: '--scope-exclude requires a path glob.' })
      );
      return;
    }
    const existing = state.cli.scope?.exclude ?? [];
    state.cli.scope = {
      exclude: [...existing, ...splitCommaDelimitedValues(value)],
    };
    return;
  }
  if (token.name === 'fix') {
    state.fix = true;
    return;
  }
  if (token.name === 'no-lock-mutation') {
    state.cli.noLockMutation = true;
    return;
  }
  if (token.name === 'root-dir') {
    state.rootDir = value;
    return;
  }
  if (token.name === 'strict') {
    state.cli.failOn = 'warning';
    return;
  }

  state.diagnostics.push(
    diagnostic({ message: `Unsupported Warden option: --${token.name}` })
  );
};

export const parseWardenCommandArgs = (
  args: readonly string[]
): ParsedWardenCommand => {
  const parsed = parseTokens(args);
  if (isParseError(parsed)) {
    return createEmptyParsedCommand(parsed.error);
  }

  const state: CommandParserState = {
    apps: [],
    cli: {},
    diagnostics: [],
  };
  let ci = false;
  let prePush = false;

  for (const token of parsed.tokens ?? []) {
    const preset = applyPresetToken(token, state.cli);
    ci = ci || preset.ci;
    prePush = prePush || preset.prePush;
  }

  for (const token of parsed.tokens ?? []) {
    applyCommandOption(token, state);
  }

  if (state.apps.length > 0) {
    state.cli.apps = state.apps;
  }

  return {
    adapterCheck: state.adapterCheck ?? false,
    ci,
    cli: cleanUndefined(
      state.cli as Record<string, unknown>
    ) as WardenConfigLayer,
    configPath: state.configPath,
    diagnostics: state.diagnostics,
    fix: state.fix ?? false,
    prePush,
    rootDir: state.rootDir,
  };
};

interface WardenConfigLoadResult {
  readonly config?: WardenConfigInput | undefined;
  readonly configPath?: string | undefined;
  readonly diagnostics: readonly WardenDiagnostic[];
}

const findConfigPath = (
  rootDir: string,
  configPath: string | undefined
): WardenConfigLoadResult => {
  if (configPath !== undefined) {
    const resolvedPath = resolve(rootDir, configPath);
    return existsSync(resolvedPath)
      ? { configPath: resolvedPath, diagnostics: [] }
      : {
          diagnostics: [
            diagnostic({
              filePath: resolvedPath,
              message: `Warden config file not found: ${resolvedPath}`,
              rule: 'warden-config',
            }),
          ],
        };
  }

  return { diagnostics: [] };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

interface ResultLike {
  readonly error?: unknown;
  readonly value?: unknown;
  isErr(): boolean;
  isOk(): boolean;
}

const isResultLike = (value: unknown): value is ResultLike =>
  isRecord(value) &&
  typeof value['isOk'] === 'function' &&
  typeof value['isErr'] === 'function';

interface ResolvableConfig {
  resolve(options: {
    readonly cwd: string;
    readonly env: EnvRecord;
  }): Promise<unknown>;
}

const isResolvableConfig = (value: unknown): value is ResolvableConfig =>
  isRecord(value) && typeof value['resolve'] === 'function';

const extractWardenConfig = (value: unknown): WardenConfigInput | undefined =>
  isRecord(value) && 'warden' in value
    ? (value['warden'] as WardenConfigInput)
    : undefined;

export const loadWardenConfig = async ({
  configPath,
  env = {},
  rootDir,
}: {
  readonly configPath?: string | undefined;
  readonly env?: EnvRecord | undefined;
  readonly rootDir: string;
}): Promise<WardenConfigLoadResult> => {
  const located = findConfigPath(rootDir, configPath);
  if (configPath !== undefined && located.configPath === undefined) {
    return located;
  }

  try {
    const loaded = await loadTrailsConfigValue({ configPath, rootDir });
    const exported = loaded.value;
    if (exported === undefined) {
      return located;
    }
    if (isResolvableConfig(exported)) {
      const resolved = await exported.resolve({ cwd: rootDir, env });
      if (isResultLike(resolved)) {
        if (resolved.isOk()) {
          return {
            config: extractWardenConfig(resolved.value),
            configPath: loaded.configPath,
            diagnostics: located.diagnostics,
          };
        }
        return {
          configPath: loaded.configPath,
          diagnostics: [
            ...located.diagnostics,
            diagnostic({
              filePath: loaded.configPath ?? rootDir,
              message: `Failed to resolve Warden config: ${errorMessage(resolved.error)}`,
              rule: 'warden-config',
            }),
          ],
        };
      }
      return {
        config: extractWardenConfig(resolved),
        configPath: loaded.configPath,
        diagnostics: located.diagnostics,
      };
    }
    return {
      config: extractWardenConfig(exported),
      configPath: loaded.configPath,
      diagnostics: located.diagnostics,
    };
  } catch (error) {
    return {
      configPath: located.configPath ?? configPath,
      diagnostics: [
        ...located.diagnostics,
        diagnostic({
          filePath: located.configPath ?? rootDir,
          message: `Failed to load Warden config: ${errorMessage(error)}`,
          rule: 'warden-config',
        }),
      ],
    };
  }
};

const isTopo = (value: unknown): value is Topo => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value['trails'] instanceof Map &&
    value['signals'] instanceof Map &&
    value['resources'] instanceof Map &&
    value['entities'] instanceof Map &&
    typeof value['get'] === 'function' &&
    typeof value['list'] === 'function' &&
    typeof value['name'] === 'string'
  );
};

const TOPO_EXPORT_KEYS = ['default', 'graph', 'app'] as const;

const extractTopo = (
  modulePath: string,
  loaded: Record<string, unknown>
): Topo => {
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

const resolveFilesystemModulePath = (
  rootDir: string,
  modulePath: string
): string => {
  const absolutePath = isAbsolute(modulePath)
    ? modulePath
    : resolve(rootDir, modulePath);
  if (!absolutePath.endsWith('.js') || existsSync(absolutePath)) {
    return absolutePath;
  }

  const tsPath = absolutePath.replace(/\.js$/, '.ts');
  return existsSync(tsPath) ? tsPath : absolutePath;
};

const resolveDiscoveredModulePath = (
  rootDir: string,
  explicit?: string | undefined
): string =>
  resolveFilesystemModulePath(rootDir, findAppModule(rootDir, explicit));

const appCandidateMatches = (candidate: string, appName: string): boolean =>
  candidate === appName ||
  candidate === `apps/${appName}/src/app.ts` ||
  candidate.startsWith(`apps/${appName}/`);

const resolveNamedAppModulePath = (
  rootDir: string,
  appName: string
): string => {
  const matched = findAppModuleCandidates(rootDir).find((candidate) =>
    appCandidateMatches(candidate, appName)
  );
  return matched === undefined
    ? resolveDiscoveredModulePath(rootDir, appName)
    : resolveFilesystemModulePath(rootDir, matched);
};

interface LoadedWardenTopoModule {
  /** App-module overlay registrations read through the shared channel. */
  readonly overlays?: readonly TopoGraphOverlayRegistration[] | undefined;
  readonly topo: Topo;
}

const importTopoFromModulePath = async (
  modulePath: string
): Promise<LoadedWardenTopoModule> => {
  const loaded = (await import(pathToFileURL(modulePath).href)) as Record<
    string,
    unknown
  >;
  const topo = extractTopo(modulePath, loaded);
  const overlays = resolveTrailsOverlays(loaded, modulePath);
  return overlays === undefined ? { topo } : { overlays, topo };
};

const topoLoadDiagnostic = ({
  filePath,
  message,
  severity,
}: {
  readonly filePath: string;
  readonly message: string;
  readonly severity: WardenSeverity;
}): WardenDiagnostic =>
  diagnostic({
    filePath,
    message,
    rule: 'topo-load',
    severity,
  });

const WARDEN_TOPO_SELECTION_HINT =
  'Set warden.apps in trails.config.ts or pass --apps NAME,NAME.';

const cleanDiscoveryMessage = (message: string): string =>
  message
    .replaceAll('\n\nUse --module to select one explicitly.', '')
    .replaceAll(' Use --module to specify the path.', '')
    .trim();

const ambiguousTopoDiagnostic = (
  rootDir: string,
  message: string,
  strict: boolean
): WardenDiagnostic =>
  topoLoadDiagnostic({
    filePath: rootDir,
    message: `Multiple Trails apps discovered; skipping topo-aware rules. ${WARDEN_TOPO_SELECTION_HINT} ${cleanDiscoveryMessage(message)}`,
    severity: strict ? 'error' : 'warn',
  });

const missingTopoDiagnostic = (
  rootDir: string,
  message: string
): WardenDiagnostic =>
  topoLoadDiagnostic({
    filePath: rootDir,
    message: `No Trails app could be loaded for topo-aware Warden checks. ${cleanDiscoveryMessage(message)} ${WARDEN_TOPO_SELECTION_HINT}`,
    severity: 'error',
  });

interface ResolveTopoTargetsOptions {
  readonly apps?: readonly string[] | undefined;
  readonly rootDir: string;
  readonly strict: boolean;
}

interface ResolvedTopoTargets {
  readonly diagnostics: readonly WardenDiagnostic[];
  readonly topos: readonly WardenTopoTarget[];
}

export const resolveWardenTopoTargets = async ({
  apps,
  rootDir,
  strict,
}: ResolveTopoTargetsOptions): Promise<ResolvedTopoTargets> => {
  const diagnostics: WardenDiagnostic[] = [];
  const topos: WardenTopoTarget[] = [];

  if (apps !== undefined && apps.length > 0) {
    for (const appName of apps) {
      try {
        const modulePath = resolveNamedAppModulePath(rootDir, appName);
        const loaded = await importTopoFromModulePath(modulePath);
        topos.push({
          name: appName,
          overlays: loaded.overlays,
          topo: loaded.topo,
        });
      } catch (error) {
        diagnostics.push(
          topoLoadDiagnostic({
            filePath: rootDir,
            message: `Failed to load Trails app "${appName}" for Warden checks: ${errorMessage(error)}`,
            severity: 'error',
          })
        );
      }
    }
    return { diagnostics, topos };
  }

  try {
    const modulePath = resolveDiscoveredModulePath(rootDir);
    const loaded = await importTopoFromModulePath(modulePath);
    return {
      diagnostics,
      topos: [
        {
          name: loaded.topo.name,
          overlays: loaded.overlays,
          topo: loaded.topo,
        },
      ],
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return {
        diagnostics: strict
          ? [missingTopoDiagnostic(rootDir, error.message)]
          : diagnostics,
        topos,
      };
    }
    if (error instanceof AmbiguousError) {
      return {
        diagnostics: [ambiguousTopoDiagnostic(rootDir, error.message, strict)],
        topos,
      };
    }
    return {
      diagnostics: [
        topoLoadDiagnostic({
          filePath: rootDir,
          message: `Failed to load Trails app for Warden checks: ${errorMessage(error)}`,
          severity: 'error',
        }),
      ],
      topos,
    };
  }
};

const effectiveConfigNeedsTopo = (depth: WardenDepth): boolean =>
  depth === 'topo' || depth === 'all';

const buildRunOptions = ({
  adapterCheck,
  cli,
  config,
  env,
  fix,
  rootDir,
  topos,
}: {
  readonly adapterCheck: boolean;
  readonly cli: WardenConfigLayer;
  readonly config?: WardenConfigInput | undefined;
  readonly env: EnvRecord;
  readonly fix: boolean;
  readonly rootDir: string;
  readonly topos: readonly WardenTopoTarget[];
}): WardenRunOptions => ({
  ...cleanUndefined({
    adapterCheck,
    apps: cli.apps,
    config,
    depth: cli.depth,
    drafts: cli.drafts,
    failOn: cli.failOn,
    fix,
    format: cli.format,
    lock: cli.lock,
    noLockMutation: cli.noLockMutation,
    rootDir,
    scope: cli.scope,
    topos,
  }),
  env,
});

const reportPassed = (report: WardenReport): boolean =>
  report.errorCount === 0 &&
  (report.effectiveConfig?.failOn !== 'warning' || report.warnCount === 0) &&
  !(report.drift?.stale ?? false) &&
  report.drift?.blockedReason === undefined;

const mergeDiagnosticsIntoReport = (
  report: WardenReport,
  diagnostics: readonly WardenDiagnostic[]
): WardenReport => {
  if (diagnostics.length === 0) {
    return report;
  }

  const mergedDiagnostics = [...diagnostics, ...report.diagnostics];
  const mergedReport = {
    ...report,
    diagnostics: mergedDiagnostics,
    errorCount: mergedDiagnostics.filter((entry) => entry.severity === 'error')
      .length,
    warnCount: mergedDiagnostics.filter((entry) => entry.severity === 'warn')
      .length,
  };

  return {
    ...mergedReport,
    passed: reportPassed(mergedReport),
  };
};

export const formatWardenCommandOutput = (report: WardenReport): string => {
  switch (report.effectiveConfig?.format ?? 'summary') {
    case 'github': {
      return formatGitHubAnnotations(report);
    }
    case 'json': {
      return formatJson(report);
    }
    case 'summary': {
      return formatSummary(report);
    }
    default: {
      return formatSummary(report);
    }
  }
};

export interface WardenCommandResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
  readonly report: WardenReport;
  readonly summary: string;
  readonly writeStepSummary: boolean;
}

export interface RunWardenCommandOptions {
  readonly args?: readonly string[] | undefined;
  readonly cwd: string;
  readonly env?: EnvRecord | undefined;
}

export const runWardenCommand = async ({
  args = [],
  cwd,
  env = {},
}: RunWardenCommandOptions): Promise<WardenCommandResult> => {
  const parsed = parseWardenCommandArgs(args);
  const { rootDir } = resolveTrailsProjectRoot({
    explicitRootDir: parsed.rootDir,
    startDir: cwd,
  });
  const loadedConfig = await loadWardenConfig({
    configPath: parsed.configPath,
    env,
    rootDir,
  });
  const preflight = resolveWardenConfig({
    cli: parsed.cli,
    config: loadedConfig.config,
    env,
  });
  const topoResolution = effectiveConfigNeedsTopo(
    preflight.effectiveConfig.depth
  )
    ? await resolveWardenTopoTargets({
        apps: preflight.effectiveConfig.apps,
        rootDir,
        strict: parsed.ci,
      })
    : { diagnostics: [], topos: [] };
  const report = await runWarden(
    buildRunOptions({
      adapterCheck: parsed.adapterCheck,
      cli: parsed.cli,
      config: loadedConfig.config,
      env,
      fix: parsed.fix,
      rootDir,
      topos: topoResolution.topos,
    })
  );
  const finalReport = mergeDiagnosticsIntoReport(report, [
    ...parsed.diagnostics,
    ...loadedConfig.diagnostics,
    ...topoResolution.diagnostics,
  ]);

  return {
    exitCode: finalReport.passed ? 0 : 1,
    output: formatWardenCommandOutput(finalReport),
    report: finalReport,
    summary: formatSummary(finalReport),
    writeStepSummary: parsed.ci,
  };
};
