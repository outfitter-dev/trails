/* oxlint-disable eslint-plugin-jest/require-hook, max-statements -- script entrypoint and snippet extraction live at module scope */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

interface ReadmeSnippetConfig {
  readonly allowNoSnippets?: boolean | undefined;
  readonly localFiles?: Readonly<Record<string, string>> | undefined;
  readonly prelude?: string | undefined;
  readonly readmePath: string;
}

interface ReadmeSnippetCheckResult {
  readonly readmePath: string;
  readonly snippetCount: number;
}

interface ExtractedSnippet {
  readonly code: string;
  readonly line: number;
  readonly extension: 'ts' | 'tsx';
}

interface ImportedBinding {
  readonly moduleSpecifier: string;
  readonly name: string;
}

const repoRoot = resolve(import.meta.dir, '..');
const tempParentDir = join(repoRoot, '.trails-tmp');

const COMMON_README_PRELUDE = `
declare const afterEach: (fn: () => unknown) => void;
declare const AlreadyExistsError: unknown;
declare const app: { list(): readonly unknown[] };
declare const config: any;
declare const ctx: any;
declare const db: any;
declare const definition: any;
declare const deriveFlags: any;
declare const deriveHttpRoutes: any;
declare const enrich: (value: unknown) => Promise<unknown>;
declare const entitySchema: any;
declare const err: any;
declare const error: unknown;
declare const env: any;
declare const expect: any;
declare const executeTrail: any;
declare const fallback: any;
declare const filePath: string;
declare const fileSchema: any;
declare const fn: any;
declare const graph: any;
declare const greet: any;
declare const gistModule: any;
declare const gistSchema: any;
declare const items: readonly unknown[];
declare const json: string;
declare const myApp: {
  ids(): readonly string[];
  resourceIds(): readonly string[];
};
declare const myTrail: any;
declare const myOtelCollector: { send(spans: unknown): Promise<void> };
declare const newGist: unknown;
declare const NotFoundError: unknown;
declare const ok: any;
declare const onboardTrail: any;
declare const processItem: (item: unknown) => Promise<void>;
declare const response: Response;
declare const result: any;
declare const results: unknown;
declare const Result: any;
declare const run: any;
declare const searchImpl: any;
declare const server: {
  registerTool(
    name: string,
    handler: unknown,
    options: Readonly<Record<string, unknown>>
  ): void;
};
declare const show: any;
declare const showTrail: any;
declare const sourceCode: string;
declare const store: any;
declare const surface: any;
declare const test: (name: string, fn: () => unknown) => void;
declare const topo: any;
declare const trail: any;
declare const ValidationError: unknown;
declare const value: unknown;
declare const z: any;
`.trim();

const README_MODULE_STUB = `
export type ActionResultContext = any;
export type AuthAdapter = any;
export type CliArg = any;
export type CliCommand = any;
export type CliFlag = any;
export type CliFlagValueAlias = any;
export type CliFlagValueAliasDeclaration = any;
export type CreateProgramOptions = any;
export type DeriveCliCommandsOptions = any;
export type Field = any;
export type InputResolver = any;
export type MemorySink = any;
export type MemorySinkOptions = any;
export type MemoryTraceSink = any;
export type OutputMode = any;
export type Permit = any;
export type PermitDiagnostic = any;
export type PermitExtractionInput = any;
export type ResolveCliPermitFromToken = any;
export type ResolveCliPermitFromTokenInput = any;
export type SamplingConfig = any;
export type SurfaceCliResult = any;
export type ToCommanderOptions = any;
export type Topo = any;
export type TraceRecord = any;

export const applyCliFlagValueAliases: any;
export const authVerify: any;
export const bindStoreDefinition: any;
export const checkDrift: any;
export const clearConfigState: any;
export const clearTraceSink: any;
export const combine: any;
export const connectDrizzle: any;
export const connectReadOnlyDrizzle: any;
export const configResource: any;
export const countPinnedSnapshots: any;
export const countPrunableSnapshots: any;
export const countTopoSnapshots: any;
export const createApp: any;
export const createBoundedMemorySink: any;
export const createCliHarness: any;
export const createConsoleSink: any;
export const createCrossContext: any;
export const createDevStore: any;
export const createFileSink: any;
export const createHttpHarness: any;
export const createJwtAdapter: any;
export const createLogtapeSink: any;
export const createMcpHarness: any;
export const createMemorySink: any;
export const createOtelAdapter: any;
export const createPermitForTrail: any;
export const createProgram: any;
export const createStoredTopoSnapshot: any;
export const createStoreAccessorContractCases: any;
export const createTestContext: any;
export const createTestPermit: any;
export const DEFAULT_SAMPLING: any;
export const defaultOnResult: any;
export const defineConfig: any;
export const deprecated: any;
export const deriveCliCommands: any;
export const deriveFlags: any;
export const deriveHttpRoutes: any;
export const deriveMcpTools: any;
export const deriveOpenApiSpec: any;
export const deriveOutputMode: any;
export const deriveTopoGraph: any;
export const deriveTopoGraphDiff: any;
export const deriveTopoGraphHash: any;
export const devPermitPreset: any;
export const dryRunPreset: any;
export const env: any;
export const executeTrail: any;
export const findStringLiterals: any;
export const formatGitHubAnnotations: any;
export const formatJson: any;
export const formatSummary: any;
export const formatWardenReport: any;
export const getLogger: any;
export const getPermit: any;
export const getStoredTopoExport: any;
export const jsonFile: any;
export const NotFoundError: any;
export const output: any;
export const outputModePreset: any;
export const parse: any;
export const passthroughResolver: any;
export const permitPreset: any;
export const pruneUnpinnedSnapshots: any;
export const readLockManifest: any;
export const registerConfigState: any;
export const registerTraceSink: any;
export const registerTraceStore: any;
export const Result: any;
export const run: any;
export const runTopoAwareWardenTrails: any;
export const runWarden: any;
export const runWardenTrails: any;
export const secret: any;
export const shouldSample: any;
export const store: any;
export const surface: any;
export const testAll: any;
export const testContracts: any;
export const testDetours: any;
export const testExamples: any;
export const testSurfaceParity: any;
export const testTrail: any;
export const toCommander: any;
export const tokenPreset: any;
export const topo: any;
export const tracePreset: any;
export const tracingResource: any;
export const trail: any;
export const validatePermits: any;
export const ValidationError: any;
export const vite: any;
export const walk: any;
export const wardenTopo: any;
export const wrapRule: any;
export const writeLockManifest: any;
export const writeTopoGraph: any;
export default {} as any;
`.trim();

export const PACKAGE_APP_ADAPTER_READMES = [
  'packages/tracing/README.md',
  'packages/logtape/README.md',
  'packages/wayfinder/README.md',
  'packages/core/README.md',
  'packages/config/README.md',
  'packages/permits/README.md',
  'packages/oxlint-plugin/README.md',
  'packages/mcp/README.md',
  'packages/cli/README.md',
  'packages/observe/README.md',
  'packages/testing/README.md',
  'packages/http/README.md',
  'packages/warden/README.md',
  'packages/topographer/README.md',
  'packages/store/README.md',
  'adapters/commander/README.md',
  'adapters/hono/README.md',
  'adapters/vite/README.md',
  'adapters/drizzle/README.md',
  'apps/trails/README.md',
  'apps/trails-demo/README.md',
] as const;

export const README_SNIPPET_CONFIGS: readonly ReadmeSnippetConfig[] = [
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/tracing/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/logtape/README.md',
  },
  {
    allowNoSnippets: true,
    readmePath: 'packages/wayfinder/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/core/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/config/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/permits/README.md',
  },
  {
    allowNoSnippets: true,
    readmePath: 'packages/oxlint-plugin/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/mcp/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/cli/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/observe/README.md',
  },
  {
    localFiles: {
      '../app.d.ts': 'export const graph: any;\n',
    },
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/testing/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/http/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/warden/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/topographer/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'packages/store/README.md',
  },
  {
    localFiles: {
      'app.d.ts': 'export const graph: any;\n',
    },
    prelude: COMMON_README_PRELUDE,
    readmePath: 'adapters/commander/README.md',
  },
  {
    localFiles: {
      'app.d.ts': 'export const graph: any;\n',
    },
    prelude: COMMON_README_PRELUDE,
    readmePath: 'adapters/hono/README.md',
  },
  {
    localFiles: {
      'src/app.d.ts': 'export const graph: any;\n',
    },
    prelude: COMMON_README_PRELUDE,
    readmePath: 'adapters/vite/README.md',
  },
  {
    prelude: COMMON_README_PRELUDE,
    readmePath: 'adapters/drizzle/README.md',
  },
  {
    allowNoSnippets: true,
    readmePath: 'apps/trails/README.md',
  },
  {
    localFiles: {
      'src/app.d.ts': 'export const graph: any;\n',
      'src/resources/entity-store.d.ts': `
export const entityStoreResource: any;
export function createMockEntityStore(): unknown;
`.trimStart(),
      'src/store.d.ts': `
export function createStore(seed?: readonly unknown[]): unknown;
`.trimStart(),
    },
    prelude: `
${COMMON_README_PRELUDE}
declare const signal: any;
`.trim(),
    readmePath: 'apps/trails-demo/README.md',
  },
] as const;

const TYPESCRIPT_FENCE_PATTERN = /^(?:ts|tsx|typescript)$/;
export const extractSnippets = (
  markdown: string,
  sourcePath?: string
): readonly ExtractedSnippet[] => {
  const lines = markdown.split('\n');
  const snippets: ExtractedSnippet[] = [];
  let active = false;
  let activeLine = 0;
  let fenceOpenLine = 0;
  let buffer: string[] = [];

  let activeExtension: 'ts' | 'tsx' = 'ts';

  for (const [index, line] of lines.entries()) {
    const fence = /^```([^\s`]*)\s*$/.exec(line.trim());

    if (!active) {
      const info = fence?.[1];
      if (info && TYPESCRIPT_FENCE_PATTERN.test(info)) {
        active = true;
        activeLine = index + 2;
        fenceOpenLine = index + 1;
        activeExtension = info === 'tsx' ? 'tsx' : 'ts';
        buffer = [];
      }
      continue;
    }

    if (line.trim() === '```') {
      snippets.push({
        code: buffer.join('\n'),
        extension: activeExtension,
        line: activeLine,
      });
      active = false;
      activeLine = 0;
      fenceOpenLine = 0;
      buffer = [];
      continue;
    }

    buffer.push(line);
  }

  if (active) {
    const where = sourcePath ? ` in ${sourcePath}` : '';
    throw new Error(
      `Unclosed TypeScript code fence${where} (opened at line ${String(fenceOpenLine)}). Add a closing \`\`\` to the snippet so typecheck can run.`
    );
  }

  return snippets;
};

export const parseImportedBindings = (
  snippet: string
): readonly ImportedBinding[] => {
  const bindings: ImportedBinding[] = [];

  const sourceFile = ts.createSourceFile(
    'readme-snippet.ts',
    snippet,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }

    const { importClause, moduleSpecifier } = statement;

    // Whole statement is type-only (`import type { ... }`) — none of these
    // bindings exist at runtime, so skip the verify-exported-bindings step
    // entirely rather than false-positive on every specifier.
    if (importClause.isTypeOnly) {
      continue;
    }

    const { namedBindings } = importClause;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue;
    }

    for (const specifier of namedBindings.elements) {
      if (specifier.isTypeOnly) {
        continue;
      }

      bindings.push({
        moduleSpecifier: moduleSpecifier.text,
        name: specifier.propertyName?.text ?? specifier.name.text,
      });
    }
  }

  return bindings;
};

const createSnippetRelativePath = (
  readmePath: string,
  snippetIndex: number,
  line: number,
  extension: 'ts' | 'tsx'
): string =>
  join(
    dirname(readmePath),
    `README.snippet-${String(snippetIndex).padStart(2, '0')}.line-${String(line)}.${extension}`
  );

const renderSnippetFile = (snippet: ExtractedSnippet): string =>
  [`// Source line: ${String(snippet.line)}`, 'export {};', snippet.code, '']
    .filter((section) => section.length > 0)
    .join('\n\n');

const writeFileCreatingParents = (filePath: string, contents: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
};

const writeSnippetHarness = (
  tempDir: string,
  config: ReadmeSnippetConfig
): {
  readonly files: readonly string[];
  readonly result: ReadmeSnippetCheckResult;
} => {
  const markdown = readFileSync(join(repoRoot, config.readmePath), 'utf8');
  const snippets = extractSnippets(markdown, config.readmePath);

  if (snippets.length === 0 && !config.allowNoSnippets) {
    throw new Error(`No TypeScript snippets found in ${config.readmePath}`);
  }

  const files: string[] = [];

  for (const [relativePath, contents] of Object.entries(
    config.localFiles ?? {}
  )) {
    writeFileCreatingParents(
      join(tempDir, dirname(config.readmePath), relativePath),
      contents
    );
  }

  if (config.prelude) {
    const ambientPath = join(
      tempDir,
      dirname(config.readmePath),
      'README.ambient.d.ts'
    );
    writeFileCreatingParents(ambientPath, `${config.prelude}\n`);
    files.push(ambientPath);
  }

  for (const [index, snippet] of snippets.entries()) {
    const filePath = join(
      tempDir,
      createSnippetRelativePath(
        config.readmePath,
        index + 1,
        snippet.line,
        snippet.extension
      )
    );

    writeFileCreatingParents(filePath, renderSnippetFile(snippet));
    files.push(filePath);
  }

  return {
    files,
    result: {
      readmePath: config.readmePath,
      snippetCount: snippets.length,
    },
  };
};

export const listUnconfiguredReadmes = (
  configs: readonly ReadmeSnippetConfig[] = README_SNIPPET_CONFIGS
): readonly string[] => {
  const configured = new Set(configs.map((config) => config.readmePath));
  return PACKAGE_APP_ADAPTER_READMES.filter((path) => !configured.has(path));
};

export const listUnexpectedReadmeConfigs = (
  configs: readonly ReadmeSnippetConfig[] = README_SNIPPET_CONFIGS
): readonly string[] => {
  const expected = new Set<string>(PACKAGE_APP_ADAPTER_READMES);
  return configs
    .map((config) => config.readmePath)
    .filter((path) => !expected.has(path));
};

export const listDuplicateReadmeConfigs = (
  configs: readonly ReadmeSnippetConfig[] = README_SNIPPET_CONFIGS
): readonly string[] => {
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const config of configs) {
    if (seen.has(config.readmePath)) {
      duplicates.add(config.readmePath);
      continue;
    }
    seen.add(config.readmePath);
  }
  return [...duplicates].toSorted();
};

const assertReadmeConfigCoverage = (
  configs: readonly ReadmeSnippetConfig[]
): void => {
  const missing = listUnconfiguredReadmes(configs);
  const unexpected = listUnexpectedReadmeConfigs(configs);
  const duplicates = listDuplicateReadmeConfigs(configs);

  if (missing.length > 0 || unexpected.length > 0 || duplicates.length > 0) {
    throw new Error(
      [
        missing.length > 0
          ? `Missing README snippet configs: ${missing.join(', ')}`
          : undefined,
        unexpected.length > 0
          ? `Unexpected README snippet configs: ${unexpected.join(', ')}`
          : undefined,
        duplicates.length > 0
          ? `Duplicate README snippet configs: ${duplicates.join(', ')}`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
};

const writeModuleStubs = (tempDir: string): void => {
  writeFileCreatingParents(
    join(tempDir, 'module-stubs', 'readme-module.d.ts'),
    `${README_MODULE_STUB}\n`
  );
};

const collectReadmeBindings = (
  config: ReadmeSnippetConfig
): readonly ImportedBinding[] => {
  const markdown = readFileSync(join(repoRoot, config.readmePath), 'utf8');
  return extractSnippets(markdown, config.readmePath).flatMap((snippet) =>
    parseImportedBindings(snippet.code)
  );
};

// Workspace roots to search for @ontrails/* packages, in priority order.
// `adapters/` holds third-party integrations (hono, vite, drizzle) alongside
// the first-party `packages/`. `apps/` is included so an allowlisted README
// can reference an app-owned module if that ever becomes useful.
const WORKSPACE_ROOTS = ['packages', 'adapters', 'apps'] as const;

interface PackageJson {
  readonly exports?: Record<string, string | Record<string, string>>;
}

const resolveExportTarget = (
  target: string | Record<string, string>
): string | undefined => {
  if (typeof target === 'string') {
    return target;
  }
  // Conditional exports object: prefer import/default/require in that order.
  return target['import'] ?? target['default'] ?? target['require'];
};

const resolveWorkspaceModulePath = (moduleSpecifier: string): string => {
  const suffix = moduleSpecifier.replace('@ontrails/', '');
  const [packageName, ...subpathParts] = suffix.split('/');
  if (!packageName) {
    throw new Error(`Invalid @ontrails specifier: "${moduleSpecifier}"`);
  }
  const subpath =
    subpathParts.length === 0 ? '.' : `./${subpathParts.join('/')}`;

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const packageDir = join(repoRoot, workspaceRoot, packageName);
    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    // Prefer the package.json `exports` map so subpath exports like
    // `@ontrails/tracing/otel` resolve to their real source file.
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, 'utf8')
    ) as PackageJson;
    const exportEntry = packageJson.exports?.[subpath];
    if (exportEntry) {
      const target = resolveExportTarget(exportEntry);
      if (target) {
        return join(packageDir, target);
      }
    }

    // Fallback for packages without an exports map — only the root entry.
    if (subpath === '.') {
      const fallback = join(packageDir, 'src/index.ts');
      if (existsSync(fallback)) {
        return fallback;
      }
    }

    throw new Error(
      `@ontrails specifier "${moduleSpecifier}" has no matching export in ${packageJsonPath}`
    );
  }

  throw new Error(
    `Cannot resolve workspace module for "${moduleSpecifier}". Looked under: ${WORKSPACE_ROOTS.map((r) => `${r}/${packageName}`).join(', ')}`
  );
};

const verifyExportedBindings = async (
  configs: readonly ReadmeSnippetConfig[]
): Promise<void> => {
  const bindingsByModule = new Map<string, Set<string>>();

  for (const config of configs) {
    for (const binding of collectReadmeBindings(config)) {
      if (!binding.moduleSpecifier.startsWith('@ontrails/')) {
        continue;
      }

      const existing =
        bindingsByModule.get(binding.moduleSpecifier) ?? new Set<string>();
      existing.add(binding.name);
      bindingsByModule.set(binding.moduleSpecifier, existing);
    }
  }

  for (const [moduleSpecifier, bindings] of bindingsByModule.entries()) {
    const module = await import(resolveWorkspaceModulePath(moduleSpecifier));

    for (const binding of bindings) {
      if (!(binding in module)) {
        throw new Error(
          `README snippet import "${binding}" is not exported by ${moduleSpecifier}`
        );
      }
    }
  }
};

const runSnippetTypecheck = (
  sourceTempDir: string,
  files: readonly string[]
): void => {
  const tsconfigPath = join(sourceTempDir, 'tsconfig.json');
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          baseUrl: sourceTempDir,
          exactOptionalPropertyTypes: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          noEmit: true,
          noImplicitAny: false,
          noUncheckedIndexedAccess: true,
          paths: {
            '@logtape/logtape': ['module-stubs/readme-module.d.ts'],
            '@ontrails/*': ['module-stubs/readme-module.d.ts'],
            vite: ['module-stubs/readme-module.d.ts'],
          },
          skipLibCheck: true,
          strict: true,
          target: 'ESNext',
        },
        files,
      },
      null,
      2
    ),
    'utf8'
  );

  const result = Bun.spawnSync({
    cmd: ['bunx', 'tsc', '--pretty', 'false', '--project', tsconfigPath],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode !== 0) {
    const output =
      `${result.stdout.toString()}${result.stderr.toString()}`.trim();
    throw new Error(output);
  }
};

const removeIfEmpty = (dir: string): void => {
  try {
    const entries = readdirSync(dir);
    if (entries.length === 0) {
      // Use rmdirSync — rmSync with recursive:false throws EISDIR on
      // directories, so the previous call silently left the (empty) dir
      // behind in every contributor's git status.
      rmdirSync(dir);
    }
  } catch {
    // Directory already removed or never existed — nothing to clean up.
  }
};

const main = async (): Promise<void> => {
  assertReadmeConfigCoverage(README_SNIPPET_CONFIGS);
  mkdirSync(tempParentDir, { recursive: true });
  const tempDir = mkdtempSync(join(tempParentDir, 'readme-snippets-src-'));

  try {
    writeModuleStubs(tempDir);
    const harnesses = README_SNIPPET_CONFIGS.map((config) =>
      writeSnippetHarness(tempDir, config)
    );
    const files = harnesses.flatMap((harness) => harness.files);
    const results = harnesses.map((harness) => harness.result);

    await verifyExportedBindings(README_SNIPPET_CONFIGS);
    runSnippetTypecheck(tempDir, files);

    const checked = results
      .map((result) => {
        const count =
          result.snippetCount === 0
            ? 'no TypeScript snippets'
            : `${String(result.snippetCount)} TypeScript snippet${result.snippetCount === 1 ? '' : 's'}`;
        return `- ${result.readmePath}: ${count}`;
      })
      .join('\n');
    console.log(
      `README snippet typecheck passed for ${String(results.length)} README files:\n${checked}`
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
    removeIfEmpty(tempParentDir);
  }
};

if (import.meta.main) {
  await main();
}
