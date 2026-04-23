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
import { join, resolve } from 'node:path';
import ts from 'typescript';

interface ReadmeSnippetConfig {
  readonly prelude?: string | undefined;
  readonly readmePath: string;
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

const README_ALLOWLIST: readonly ReadmeSnippetConfig[] = [
  {
    prelude: `
declare module '@ontrails/core' {
  export type Topo = unknown;
}

declare module '@ontrails/testing' {
  export function testAll(app: import('@ontrails/core').Topo): Promise<unknown>;
}

declare module '@ontrails/tracing' {
  export interface TraceRecord {
    readonly status?: string;
  }

  export interface MemorySink {
    readonly records: readonly TraceRecord[];
  }

  export interface SamplingConfig {
    readonly destroy?: number;
    readonly read?: number;
    readonly write?: number;
  }

  export const DEFAULT_SAMPLING: Required<SamplingConfig>;
  export function clearTraceSink(): void;
  export function createDevStore(options?: {
    readonly maxAge?: number;
    readonly maxRecords?: number;
    readonly path?: string;
  }): unknown;
  export function createMemorySink(): MemorySink;
  export function createOtelConnector(options: {
    readonly batchSize?: number;
    readonly exporter: (spans: unknown) => Promise<void>;
  }): unknown;
  export function registerTraceSink(sink: unknown): void;
  export function shouldSample(
    intent: 'destroy' | 'read' | 'write',
    config?: SamplingConfig
  ): boolean;
  export const tracingResource: {
    from(ctx: unknown): { active: boolean; store?: { count(): number } };
  };
}

declare const app: import('@ontrails/core').Topo;
declare const db: { users: { get(id: unknown): Promise<unknown> } };
declare const enrich: (value: unknown) => Promise<unknown>;
declare const expect: any;
declare const graph: import('@ontrails/core').Topo;
declare const myOtelCollector: { send(spans: unknown): Promise<void> };
declare const Result: { ok(value: unknown): unknown };
declare function run(...args: readonly unknown[]): Promise<unknown>;
declare function trail(
  id: string,
  spec: {
    readonly blaze: (...args: readonly any[]) => unknown;
    readonly resources?: readonly unknown[];
  }
): unknown;
`.trim(),
    readmePath: 'packages/tracing/README.md',
  },
] as const;

const TYPESCRIPT_FENCE_PATTERN = /^(?:ts|tsx|typescript)$/;
const extractSnippets = (
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

const createSnippetFileName = (
  readmePath: string,
  snippetIndex: number,
  line: number,
  extension: 'ts' | 'tsx'
): string =>
  `${readmePath.split('/').join('__')}.snippet-${String(snippetIndex).padStart(2, '0')}.line-${String(line)}.${extension}`;

const renderSnippetFile = (snippet: ExtractedSnippet): string =>
  [`// Source line: ${String(snippet.line)}`, 'export {};', snippet.code, '']
    .filter((section) => section.length > 0)
    .join('\n\n');

const writeSnippetHarness = (
  tempDir: string,
  config: ReadmeSnippetConfig
): readonly string[] => {
  const markdown = readFileSync(join(repoRoot, config.readmePath), 'utf8');
  const snippets = extractSnippets(markdown, config.readmePath);

  if (snippets.length === 0) {
    throw new Error(`No TypeScript snippets found in ${config.readmePath}`);
  }

  const files: string[] = [];

  if (config.prelude) {
    const ambientPath = join(
      tempDir,
      `${config.readmePath.split('/').join('__')}.ambient.d.ts`
    );
    writeFileSync(ambientPath, `${config.prelude}\n`, 'utf8');
    files.push(ambientPath);
  }

  for (const [index, snippet] of snippets.entries()) {
    const filePath = join(
      tempDir,
      createSnippetFileName(
        config.readmePath,
        index + 1,
        snippet.line,
        snippet.extension
      )
    );

    writeFileSync(filePath, renderSnippetFile(snippet), 'utf8');
    files.push(filePath);
  }

  return files;
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
// `connectors/` holds third-party integrations (hono, vite, drizzle) alongside
// the first-party `packages/`. `apps/` is included so an allowlisted README
// can reference an app-owned module if that ever becomes useful.
const WORKSPACE_ROOTS = ['packages', 'connectors', 'apps'] as const;

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

const runSnippetTypecheck = (files: readonly string[]): void => {
  const tempDir = mkdtempSync(join(tempParentDir, 'readme-snippets-tsc-'));

  try {
    const tsconfigPath = join(tempDir, 'tsconfig.json');
    writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            exactOptionalPropertyTypes: true,
            module: 'ESNext',
            moduleResolution: 'bundler',
            noEmit: true,
            noImplicitAny: false,
            noUncheckedIndexedAccess: true,
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
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
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
  mkdirSync(tempParentDir, { recursive: true });
  const tempDir = mkdtempSync(join(tempParentDir, 'readme-snippets-src-'));

  try {
    const files = README_ALLOWLIST.flatMap((config) =>
      writeSnippetHarness(tempDir, config)
    );
    await verifyExportedBindings(README_ALLOWLIST);
    runSnippetTypecheck(files);

    const checked = README_ALLOWLIST.map((config) => config.readmePath).join(
      ', '
    );
    console.log(`README snippet typecheck passed for: ${checked}`);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
    removeIfEmpty(tempParentDir);
  }
};

if (import.meta.main) {
  await main();
}
