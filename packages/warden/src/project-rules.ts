import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  ProjectAwareWardenRule,
  TopoAwareWardenRule,
  WardenDiagnostic,
  WardenRuleMetadata,
  WardenRule,
} from './rules/types.js';

const PROJECT_WARDEN_RULES_FILE = '.trails/rules.ts';
const PROJECT_WARDEN_RULES_DIR = '.trails/rules';
const LEGACY_PROJECT_WARDEN_RULES_DIR = 'trails/warden/rules';

export interface ProjectWardenRules {
  readonly diagnostics: readonly WardenDiagnostic[];
  readonly sourceRules: readonly WardenRule[];
  readonly topoRules: readonly TopoAwareWardenRule[];
}

interface RuleModule {
  readonly default?: unknown;
  readonly rule?: unknown;
  readonly rules?: unknown;
  readonly sourceRule?: unknown;
  readonly sourceRules?: unknown;
  readonly topoRule?: unknown;
  readonly topoRules?: unknown;
}

interface ProjectRuleModulePaths {
  readonly diagnostics: readonly WardenDiagnostic[];
  readonly files: readonly string[];
}

interface LoadedRuleFile extends ProjectWardenRules {
  readonly filePath: string;
}

const diagnostic = (message: string, filePath: string): WardenDiagnostic => ({
  filePath,
  line: 1,
  message,
  rule: 'project-warden-rules',
  severity: 'error',
});

const asArray = (value: unknown): readonly unknown[] => {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const isSourceRule = (value: unknown): value is WardenRule => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const maybe = value as Partial<WardenRule>;
  return (
    typeof maybe.name === 'string' &&
    typeof maybe.description === 'string' &&
    (maybe.severity === 'error' || maybe.severity === 'warn') &&
    typeof maybe.check === 'function'
  );
};

const isTopoRule = (value: unknown): value is TopoAwareWardenRule => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const maybe = value as Partial<TopoAwareWardenRule>;
  return (
    typeof maybe.name === 'string' &&
    typeof maybe.description === 'string' &&
    (maybe.severity === 'error' || maybe.severity === 'warn') &&
    typeof maybe.checkTopo === 'function'
  );
};

const defaultProjectRuleDepth = (
  tier: WardenRuleMetadata['tier']
): WardenRuleMetadata['depth'] => {
  if (tier === 'topo-aware') {
    return 'topo';
  }
  if (tier === 'project-static') {
    return 'project';
  }
  return 'source';
};

const defaultProjectRuleMetadata = (
  rule: { readonly description: string },
  tier: WardenRuleMetadata['tier']
): WardenRuleMetadata => ({
  concern: 'general',
  depth: defaultProjectRuleDepth(tier),
  invariant: rule.description,
  lifecycle: { state: 'durable' },
  scope: 'repo-local',
  tier,
});

const isProjectAwareSourceRule = (
  rule: WardenRule
): rule is ProjectAwareWardenRule =>
  'checkWithContext' in rule && typeof rule.checkWithContext === 'function';

const withSourceRuleMetadata = (rule: WardenRule): WardenRule => ({
  ...rule,
  metadata:
    rule.metadata ??
    defaultProjectRuleMetadata(
      rule,
      isProjectAwareSourceRule(rule) ? 'project-static' : 'source-static'
    ),
});

const withTopoRuleMetadata = (
  rule: TopoAwareWardenRule
): TopoAwareWardenRule => ({
  ...rule,
  metadata: rule.metadata ?? defaultProjectRuleMetadata(rule, 'topo-aware'),
});

const ruleCandidatesFromModule = (module: RuleModule): readonly unknown[] => [
  ...asArray(module.default),
  ...asArray(module.rule),
  ...asArray(module.rules),
  ...asArray(module.sourceRule),
  ...asArray(module.sourceRules),
];

const topoRuleCandidatesFromModule = (
  module: RuleModule
): readonly unknown[] => [
  ...asArray(module.topoRule),
  ...asArray(module.topoRules),
];

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const collectProjectRuleFiles = (rootDir: string): readonly string[] => {
  const files: string[] = [];
  const rulesFile = join(rootDir, PROJECT_WARDEN_RULES_FILE);
  const rulesDir = join(rootDir, PROJECT_WARDEN_RULES_DIR);

  if (isFile(rulesFile)) {
    files.push(rulesFile);
  }

  if (!isDirectory(rulesDir)) {
    return files;
  }

  const glob = new Bun.Glob('*.ts');
  files.push(
    ...[...glob.scanSync({ cwd: rulesDir, onlyFiles: true })]
      .filter(
        (entry) =>
          !entry.endsWith('.test.ts') && !basename(entry).startsWith('_')
      )
      .map((entry) => join(rulesDir, entry))
  );
  return files.toSorted((left, right) => left.localeCompare(right));
};

const collectProjectRuleModulePaths = (
  rootDir: string
): ProjectRuleModulePaths => {
  const diagnostics: WardenDiagnostic[] = [];
  const legacyRulesDir = join(rootDir, LEGACY_PROJECT_WARDEN_RULES_DIR);

  if (isDirectory(legacyRulesDir)) {
    diagnostics.push(
      diagnostic(
        'Project Warden rules moved from trails/warden/rules to .trails/rules.ts or direct .trails/rules/*.ts files.',
        legacyRulesDir
      )
    );
  }

  return {
    diagnostics,
    files: collectProjectRuleFiles(rootDir),
  };
};

const loadRuleFile = async (filePath: string): Promise<LoadedRuleFile> => {
  let module: RuleModule;
  try {
    module = (await import(pathToFileURL(filePath).href)) as RuleModule;
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          error instanceof Error
            ? `Failed to load project Warden rule module: ${error.message}`
            : 'Failed to load project Warden rule module.',
          filePath
        ),
      ],
      filePath,
      sourceRules: [],
      topoRules: [],
    };
  }

  const sourceRules = ruleCandidatesFromModule(module)
    .filter(isSourceRule)
    .map(withSourceRuleMetadata);
  const topoRules = topoRuleCandidatesFromModule(module)
    .filter(isTopoRule)
    .map(withTopoRuleMetadata);
  if (sourceRules.length === 0 && topoRules.length === 0) {
    return {
      diagnostics: [
        diagnostic(
          'Project Warden rule module must export a WardenRule or TopoAwareWardenRule.',
          filePath
        ),
      ],
      filePath,
      sourceRules: [],
      topoRules: [],
    };
  }

  return { diagnostics: [], filePath, sourceRules, topoRules };
};

const duplicateRuleDiagnostics = (
  loaded: readonly LoadedRuleFile[]
): readonly WardenDiagnostic[] => {
  const seen = new Map<string, string>();
  const diagnostics: WardenDiagnostic[] = [];

  for (const result of loaded) {
    for (const rule of [...result.sourceRules, ...result.topoRules]) {
      const previousFilePath = seen.get(rule.name);
      if (previousFilePath === undefined) {
        seen.set(rule.name, result.filePath);
        continue;
      }
      diagnostics.push(
        diagnostic(
          `Duplicate project Warden rule id "${rule.name}" also exported from "${previousFilePath}". Project-local rule ids must be unique.`,
          result.filePath
        )
      );
    }
  }

  return diagnostics;
};

export const loadProjectWardenRules = async (
  rootDir: string
): Promise<ProjectWardenRules> => {
  const collected = collectProjectRuleModulePaths(rootDir);
  const { files } = collected;
  const loaded = await Promise.all(files.map(loadRuleFile));

  return {
    diagnostics: [
      ...collected.diagnostics,
      ...loaded.flatMap((result) => result.diagnostics),
      ...duplicateRuleDiagnostics(loaded),
    ],
    sourceRules: loaded.flatMap((result) => result.sourceRules),
    topoRules: loaded.flatMap((result) => result.topoRules),
  };
};
