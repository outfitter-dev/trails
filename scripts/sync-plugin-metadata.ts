import { resolve } from 'node:path';

export const MARKETPLACE_MANIFEST_PATH = '.claude-plugin/marketplace.json';
export const PLUGIN_MANIFEST_PATH = 'plugin/.claude-plugin/plugin.json';
export const TRAILS_SKILL_PATH = 'plugin/skills/trails/SKILL.md';
export const FRAMEWORK_PACKAGE_PATH = 'packages/core/package.json';

type JsonObject = Record<string, unknown>;

interface MarketplacePlugin {
  name?: unknown;
  source?: unknown;
  version?: unknown;
  description?: unknown;
}

interface MarketplaceManifest {
  metadata?: JsonObject;
  plugins?: MarketplacePlugin[];
}

interface PluginManifest {
  name?: unknown;
  version?: unknown;
}

interface FrameworkPackage {
  version?: unknown;
}

interface ParsedSkillVersion {
  frontmatter: string;
  frontmatterEnd: number;
  lineIndex: number;
  version: string;
}

export interface PluginMetadataState {
  frameworkVersion: string;
  marketplace: MarketplaceManifest;
  marketplaceMetadataVersion: string | undefined;
  marketplacePluginVersion: string | undefined;
  pluginManifest: PluginManifest;
  pluginName: string;
  pluginVersion: string;
  skillSource: string;
  skillTrailsVersion: string | undefined;
}

export interface PluginMetadataDiagnostic {
  actual: string | undefined;
  expected: string;
  message: string;
  path: string;
}

export interface PluginMetadataSyncResult {
  changedPaths: readonly string[];
  diagnostics: readonly PluginMetadataDiagnostic[];
}

const parseArgs = (
  args: readonly string[]
): { check: boolean; rootDir: string } => {
  let rootDir = process.cwd();
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--check') {
      check = true;
      continue;
    }

    if (arg === '--root') {
      const next = args[index + 1];
      if (!next) {
        throw new Error('sync-plugin-metadata: --root requires a path.');
      }
      rootDir = next;
      index += 1;
      continue;
    }

    throw new Error(`sync-plugin-metadata: unknown argument ${arg}.`);
  }

  return { check, rootDir };
};

const readJson = async <T extends JsonObject>(
  rootDir: string,
  path: string
): Promise<T> => {
  const source = await Bun.file(resolve(rootDir, path)).text();
  return JSON.parse(source) as T;
};

const requireString = (value: unknown, label: string, path: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`sync-plugin-metadata: expected ${label} in ${path}.`);
  }
  return value;
};

const unquoteYamlScalar = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseSkillTrailsVersion = (source: string): ParsedSkillVersion => {
  if (!source.startsWith('---\n')) {
    throw new Error(
      `sync-plugin-metadata: expected frontmatter in ${TRAILS_SKILL_PATH}.`
    );
  }

  const frontmatterEnd = source.indexOf('\n---', 4);
  if (frontmatterEnd === -1) {
    throw new Error(
      `sync-plugin-metadata: expected closing frontmatter marker in ${TRAILS_SKILL_PATH}.`
    );
  }

  const frontmatter = source.slice(4, frontmatterEnd);
  const lines = frontmatter.split('\n');
  let inMetadata = false;
  let inTrails = false;

  for (const [lineIndex, line] of lines.entries()) {
    const trimmed = line.trim();

    if (trimmed === 'metadata:') {
      inMetadata = true;
      inTrails = false;
      continue;
    }

    if (inMetadata && trimmed.length > 0 && !line.startsWith(' ')) {
      inMetadata = false;
      inTrails = false;
    }

    if (inMetadata && line === '  trails:') {
      inTrails = true;
      continue;
    }

    if (inTrails && trimmed.length > 0 && !line.startsWith('    ')) {
      inTrails = false;
    }

    if (!inTrails) {
      continue;
    }

    const versionMatch = line.match(/^ {4}version:\s*(.+)$/);
    if (versionMatch) {
      return {
        frontmatter,
        frontmatterEnd,
        lineIndex,
        version: unquoteYamlScalar(versionMatch[1] ?? ''),
      };
    }
  }

  throw new Error(
    `sync-plugin-metadata: expected metadata.trails.version in ${TRAILS_SKILL_PATH}.`
  );
};

const replaceSkillTrailsVersion = (source: string, version: string): string => {
  const parsed = parseSkillTrailsVersion(source);
  const lines = parsed.frontmatter.split('\n');
  lines[parsed.lineIndex] = `    version: ${version}`;

  return `${source.slice(0, 4)}${lines.join('\n')}${source.slice(
    parsed.frontmatterEnd
  )}`;
};

const findMarketplacePlugin = (
  marketplace: MarketplaceManifest,
  pluginName: string
): MarketplacePlugin | undefined =>
  marketplace.plugins?.find((plugin) => plugin.name === pluginName);

const renderJson = (value: JsonObject): string =>
  `${JSON.stringify(value, null, 2)}\n`;

export const readPluginMetadataState = async (
  rootDir = process.cwd()
): Promise<PluginMetadataState> => {
  const marketplace = await readJson<MarketplaceManifest>(
    rootDir,
    MARKETPLACE_MANIFEST_PATH
  );
  const pluginManifest = await readJson<PluginManifest>(
    rootDir,
    PLUGIN_MANIFEST_PATH
  );
  const frameworkPackage = await readJson<FrameworkPackage>(
    rootDir,
    FRAMEWORK_PACKAGE_PATH
  );
  const skillSource = await Bun.file(
    resolve(rootDir, TRAILS_SKILL_PATH)
  ).text();
  const pluginName = requireString(
    pluginManifest.name,
    'plugin name',
    PLUGIN_MANIFEST_PATH
  );
  const pluginVersion = requireString(
    pluginManifest.version,
    'plugin version',
    PLUGIN_MANIFEST_PATH
  );
  const frameworkVersion = requireString(
    frameworkPackage.version,
    'framework package version',
    FRAMEWORK_PACKAGE_PATH
  );
  const marketplacePlugin = findMarketplacePlugin(marketplace, pluginName);
  const skillTrailsVersion = parseSkillTrailsVersion(skillSource).version;

  return {
    frameworkVersion,
    marketplace,
    marketplaceMetadataVersion:
      typeof marketplace.metadata?.version === 'string'
        ? marketplace.metadata.version
        : undefined,
    marketplacePluginVersion:
      typeof marketplacePlugin?.version === 'string'
        ? marketplacePlugin.version
        : undefined,
    pluginManifest,
    pluginName,
    pluginVersion,
    skillSource,
    skillTrailsVersion,
  };
};

export const checkPluginMetadata = (
  state: PluginMetadataState
): readonly PluginMetadataDiagnostic[] => {
  const diagnostics: PluginMetadataDiagnostic[] = [];

  if (state.marketplaceMetadataVersion !== state.pluginVersion) {
    diagnostics.push({
      actual: state.marketplaceMetadataVersion,
      expected: state.pluginVersion,
      message:
        'marketplace metadata.version must match plugin/.claude-plugin/plugin.json version.',
      path: `${MARKETPLACE_MANIFEST_PATH}:metadata.version`,
    });
  }

  if (state.marketplacePluginVersion !== state.pluginVersion) {
    diagnostics.push({
      actual: state.marketplacePluginVersion,
      expected: state.pluginVersion,
      message:
        'marketplace plugins[].version must match plugin/.claude-plugin/plugin.json version.',
      path: `${MARKETPLACE_MANIFEST_PATH}:plugins[${state.pluginName}].version`,
    });
  }

  if (state.skillTrailsVersion !== state.frameworkVersion) {
    diagnostics.push({
      actual: state.skillTrailsVersion,
      expected: state.frameworkVersion,
      message:
        'trails skill metadata.trails.version must match packages/core/package.json version.',
      path: `${TRAILS_SKILL_PATH}:metadata.trails.version`,
    });
  }

  return diagnostics;
};

const formatDiagnostic = (diagnostic: PluginMetadataDiagnostic): string =>
  [
    `sync-plugin-metadata: ${diagnostic.path} is out of date.`,
    `Expected ${diagnostic.expected}, found ${diagnostic.actual ?? 'missing'}.`,
    diagnostic.message,
  ].join(' ');

export const syncPluginMetadata = async (
  rootDir = process.cwd()
): Promise<PluginMetadataSyncResult> => {
  const state = await readPluginMetadataState(rootDir);
  const marketplacePlugin = findMarketplacePlugin(
    state.marketplace,
    state.pluginName
  );

  if (!state.marketplace.metadata) {
    state.marketplace.metadata = {};
  }
  if (!marketplacePlugin) {
    throw new Error(
      `sync-plugin-metadata: expected plugin ${state.pluginName} in ${MARKETPLACE_MANIFEST_PATH}.`
    );
  }

  state.marketplace.metadata.version = state.pluginVersion;
  marketplacePlugin.version = state.pluginVersion;

  const nextMarketplace = renderJson(state.marketplace);
  const nextSkill = replaceSkillTrailsVersion(
    state.skillSource,
    state.frameworkVersion
  );
  const changedPaths: string[] = [];

  if (
    nextMarketplace !==
    (await Bun.file(resolve(rootDir, MARKETPLACE_MANIFEST_PATH)).text())
  ) {
    await Bun.write(
      resolve(rootDir, MARKETPLACE_MANIFEST_PATH),
      nextMarketplace
    );
    changedPaths.push(MARKETPLACE_MANIFEST_PATH);
  }

  if (nextSkill !== state.skillSource) {
    await Bun.write(resolve(rootDir, TRAILS_SKILL_PATH), nextSkill);
    changedPaths.push(TRAILS_SKILL_PATH);
  }

  const nextState = await readPluginMetadataState(rootDir);

  return {
    changedPaths,
    diagnostics: checkPluginMetadata(nextState),
  };
};

const run = async (): Promise<void> => {
  const { check, rootDir } = parseArgs(process.argv.slice(2));
  const state = await readPluginMetadataState(rootDir);
  const diagnostics = checkPluginMetadata(state);

  if (check) {
    for (const diagnostic of diagnostics) {
      console.error(formatDiagnostic(diagnostic));
    }

    if (diagnostics.length > 0) {
      console.error('Run `bun run plugin:metadata:sync` to refresh metadata.');
      process.exit(1);
    }

    return;
  }

  const result = await syncPluginMetadata(rootDir);
  for (const changedPath of result.changedPaths) {
    console.log(`Wrote ${resolve(rootDir, changedPath)}`);
  }

  for (const diagnostic of result.diagnostics) {
    console.error(formatDiagnostic(diagnostic));
  }

  if (result.diagnostics.length > 0) {
    console.error(
      'Metadata sync completed with remaining drift; inspect the diagnostics above.'
    );
    process.exit(1);
  }
};

if (import.meta.main) {
  await run();
}
