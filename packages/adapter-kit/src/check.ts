/**
 * Shared adapter readiness checks for Warden and local author tooling.
 *
 * The engine reads package manifests and source files. It does not import
 * runtime adapter packages, and runtime adapters must not import it.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { deriveAdapterTargetCatalog } from './catalog.js';
import type {
  AdapterTargetCatalog,
  AdapterTargetCatalogDiagnosticCode,
  AdapterTargetCatalogEntry,
  AdapterTargetPlacement,
} from './catalog.js';

export type AdapterCheckDiagnosticCode =
  | AdapterTargetCatalogDiagnosticCode
  | 'dependency-direction'
  | 'invalid-adapter-metadata'
  | 'missing-conformance'
  | 'missing-owner-conformance'
  | 'missing-package-export'
  | 'tooling-boundary'
  | 'unknown-adapter-target'
  | 'unsupported-placement';

export type AdapterCheckDiagnosticSeverity = 'error' | 'warn';

export interface AdapterCheckDiagnostic {
  readonly code: AdapterCheckDiagnosticCode;
  readonly message: string;
  readonly packageJsonPath: string;
  readonly packageName?: string | undefined;
  readonly placement?: AdapterTargetPlacement | undefined;
  readonly severity: AdapterCheckDiagnosticSeverity;
  readonly target?: string | undefined;
}

export interface AdapterCheckSubject {
  readonly conformanceTestPaths: readonly string[];
  readonly key: string;
  readonly ownerPackage: string;
  readonly packageJsonPath: string;
  readonly packageName: string;
  readonly packageRoot: string;
  readonly placement: AdapterTargetPlacement;
  readonly target: string;
  readonly targetKey: string;
  readonly testingImport?: string | undefined;
}

export interface AdapterCheckReport {
  readonly diagnostics: readonly AdapterCheckDiagnostic[];
  readonly subjects: readonly AdapterCheckSubject[];
  readonly targets: readonly AdapterTargetCatalogEntry[];
}

interface RootManifest {
  readonly workspaces?: unknown;
}

interface AdapterCheckPackageManifest {
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly exports?: unknown;
  readonly name?: unknown;
  readonly optionalDependencies?: unknown;
  readonly peerDependencies?: unknown;
  readonly trails?: unknown;
}

interface WorkspacePackage {
  readonly manifest: AdapterCheckPackageManifest;
  readonly packageJsonPath: string;
  readonly packageRoot: string;
  readonly workspacePath: string;
}

interface AdapterMetadata {
  readonly target: string;
}

const adapterKitPackageName = '@ontrails/adapter-kit';

const targetIdPattern = /^[a-z][a-z0-9-]*$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

const workspacePatternsFromManifest = (
  manifest: RootManifest | undefined
): readonly string[] => {
  const { workspaces } = manifest ?? {};
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (pattern): pattern is string => typeof pattern === 'string'
    );
  }

  const packages = isRecord(workspaces) ? workspaces['packages'] : undefined;
  return Array.isArray(packages)
    ? packages.filter(
        (pattern): pattern is string => typeof pattern === 'string'
      )
    : [];
};

const workspaceDirsForPattern = (
  rootDir: string,
  pattern: string
): readonly string[] => {
  if (!pattern.endsWith('/*')) {
    const workspaceDir = join(rootDir, pattern);
    return existsSync(workspaceDir) ? [workspaceDir] : [];
  }

  const groupDir = join(rootDir, pattern.slice(0, -2));
  if (!existsSync(groupDir)) {
    return [];
  }

  return readdirSync(groupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(groupDir, entry.name))
    .toSorted();
};

const workspacePackages = (rootDir: string): readonly WorkspacePackage[] => {
  const normalizedRoot = normalizeRealPath(rootDir);
  const rootManifest = readJson<RootManifest>(
    join(normalizedRoot, 'package.json')
  );
  const packages: WorkspacePackage[] = [];

  for (const pattern of workspacePatternsFromManifest(rootManifest)) {
    for (const workspaceDir of workspaceDirsForPattern(
      normalizedRoot,
      pattern
    )) {
      const packageJsonPath = join(workspaceDir, 'package.json');
      const manifest = readJson<AdapterCheckPackageManifest>(packageJsonPath);
      if (!manifest || typeof manifest.name !== 'string') {
        continue;
      }

      const packageRoot = normalizeRealPath(dirname(packageJsonPath));
      packages.push({
        manifest,
        packageJsonPath: normalizeRealPath(packageJsonPath),
        packageRoot,
        workspacePath: normalizePath(relative(normalizedRoot, packageRoot)),
      });
    }
  }

  return packages.toSorted((left, right) =>
    left.workspacePath.localeCompare(right.workspacePath)
  );
};

const resolveExportTarget = (
  target: unknown,
  depth = 0
): string | undefined => {
  if (typeof target === 'string') {
    return target;
  }
  if (!isRecord(target) || depth > 8) {
    return undefined;
  }

  for (const condition of ['bun', 'import', 'default', 'require'] as const) {
    const resolvedTarget = resolveExportTarget(target[condition], depth + 1);
    if (resolvedTarget) {
      return resolvedTarget;
    }
  }
  return undefined;
};

const isPackageRelativePath = (path: string): boolean =>
  path.startsWith('./') && !normalizePath(path).includes('/../');

const exportTargetIsFile = (packageRoot: string, target: string): boolean => {
  if (!isPackageRelativePath(target)) {
    return false;
  }

  try {
    return statSync(resolve(packageRoot, target)).isFile();
  } catch {
    return false;
  }
};

const hasResolvableExport = (
  workspace: WorkspacePackage,
  key: string
): boolean => {
  const { exports: exportsValue } = workspace.manifest;
  if (typeof exportsValue === 'string') {
    return (
      key === '.' && exportTargetIsFile(workspace.packageRoot, exportsValue)
    );
  }

  if (!isRecord(exportsValue)) {
    return false;
  }

  if (!Object.hasOwn(exportsValue, key)) {
    if (key !== '.') {
      return false;
    }

    const rootTarget = resolveExportTarget(exportsValue);
    return (
      rootTarget !== undefined &&
      exportTargetIsFile(workspace.packageRoot, rootTarget)
    );
  }

  const target = resolveExportTarget(exportsValue[key]);
  return (
    target !== undefined && exportTargetIsFile(workspace.packageRoot, target)
  );
};

const dependencyMap = (value: unknown): Readonly<Record<string, unknown>> =>
  isRecord(value) ? value : {};

const runtimeDependencyNames = (
  manifest: AdapterCheckPackageManifest
): ReadonlySet<string> =>
  new Set([
    ...Object.keys(dependencyMap(manifest.dependencies)),
    ...Object.keys(dependencyMap(manifest.optionalDependencies)),
    ...Object.keys(dependencyMap(manifest.peerDependencies)),
  ]);

const trailAdapterMetadata = (
  manifest: AdapterCheckPackageManifest
): AdapterMetadata | undefined | null => {
  const trails = isRecord(manifest.trails) ? manifest.trails : undefined;
  const adapter = trails?.['adapter'];
  if (adapter === undefined) {
    return undefined;
  }
  if (!isRecord(adapter)) {
    return null;
  }

  const { target } = adapter;
  return typeof target === 'string' && targetIdPattern.test(target)
    ? { target }
    : null;
};

const placementForWorkspace = (
  workspacePath: string
): AdapterTargetPlacement | undefined =>
  workspacePath.startsWith('adapters/') ? 'extracted' : undefined;

const diagnostic = (
  packageJsonPath: string,
  packageName: string | undefined,
  code: AdapterCheckDiagnosticCode,
  message: string,
  target?: string,
  placement?: AdapterTargetPlacement
): AdapterCheckDiagnostic => ({
  code,
  message,
  packageJsonPath,
  ...(packageName === undefined ? {} : { packageName }),
  ...(placement === undefined ? {} : { placement }),
  severity: 'error',
  ...(target === undefined ? {} : { target }),
});

const catalogDiagnostics = (
  catalog: AdapterTargetCatalog
): readonly AdapterCheckDiagnostic[] =>
  catalog.diagnostics.map((entry) =>
    diagnostic(
      entry.packageJsonPath,
      entry.packageName,
      entry.code,
      entry.message,
      entry.target
    )
  );

const targetEntriesByTarget = (
  targets: readonly AdapterTargetCatalogEntry[]
): ReadonlyMap<string, AdapterTargetCatalogEntry> =>
  new Map(targets.map((target) => [target.target, target]));

const collectSourceFiles = (dir: string): readonly string[] => {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      if (entry.isFile() && child.endsWith('.ts')) {
        files.push(normalizeRealPath(child));
      }
    }
  };

  visit(dir);
  return files.toSorted();
};

const isIdentifierChar = (char: string | undefined): boolean =>
  char !== undefined && /[$\w]/u.test(char);

const skipWhitespace = (source: string, start: number): number => {
  let index = start;
  while (/\s/u.test(source[index] ?? '')) {
    index += 1;
  }
  return index;
};

const previousNonWhitespaceChar = (
  source: string,
  start: number
): string | undefined => {
  let index = start - 1;
  while (index >= 0) {
    const char = source[index];
    if (!/\s/u.test(char ?? '')) {
      return char;
    }
    index -= 1;
  }
  return undefined;
};

const regexLiteralCanStartAfter = (char: string | undefined): boolean =>
  char === undefined || /[([{:;,=!?&|+\-*%^~<>]/u.test(char);

const regexLiteralCanStartAfterKeyword = (
  source: string,
  start: number
): boolean =>
  /\b(?:await|case|delete|do|else|in|instanceof|of|return|throw|typeof|void|yield)\s*$/u.test(
    source.slice(0, start).trimEnd()
  );

const startsRegexLiteral = (source: string, start: number): boolean => {
  if (
    source[start] !== '/' ||
    source.startsWith('//', start) ||
    source.startsWith('/*', start)
  ) {
    return false;
  }

  const previousChar = previousNonWhitespaceChar(source, start);
  return (
    regexLiteralCanStartAfter(previousChar) ||
    regexLiteralCanStartAfterKeyword(source, start)
  );
};

const skipRegexLiteral = (source: string, start: number): number => {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '[') {
      inCharacterClass = true;
      index += 1;
      continue;
    }
    if (char === ']' && inCharacterClass) {
      inCharacterClass = false;
      index += 1;
      continue;
    }
    if (char === '/' && !inCharacterClass) {
      index += 1;
      while (/[a-z]/iu.test(source[index] ?? '')) {
        index += 1;
      }
      return index;
    }
    index += 1;
  }
  return source.length;
};

const readQuotedString = (
  source: string,
  start: number
): { readonly end: number; readonly value: string } | undefined => {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }

  let index = start + 1;
  let value = '';
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      value += source[index + 1] ?? '';
      index += 2;
      continue;
    }
    if (char === quote) {
      return { end: index + 1, value };
    }
    value += char;
    index += 1;
  }

  return undefined;
};

const skipBlockComment = (source: string, start: number): number => {
  const end = source.indexOf('*/', start + 2);
  return end === -1 ? source.length : end + 2;
};

const skipLineComment = (source: string, start: number): number => {
  const end = source.indexOf('\n', start + 2);
  return end === -1 ? source.length : end + 1;
};

const skipTrivia = (source: string, start: number): number => {
  let index = skipWhitespace(source, start);
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      index = skipWhitespace(source, skipLineComment(source, index));
      continue;
    }
    if (source.startsWith('/*', index)) {
      index = skipWhitespace(source, skipBlockComment(source, index));
      continue;
    }
    return index;
  }
  return index;
};

const skipQuoted = (source: string, start: number): number => {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
};

const skipImportScanIgnoredToken = (
  source: string,
  start: number
): number | undefined => {
  if (source.startsWith('//', start)) {
    return skipLineComment(source, start);
  }
  if (source.startsWith('/*', start)) {
    return skipBlockComment(source, start);
  }

  const char = source[start];
  if (char === '"' || char === "'" || char === '`') {
    return skipQuoted(source, start);
  }
  if (char === '/' && startsRegexLiteral(source, start)) {
    return skipRegexLiteral(source, start);
  }

  return undefined;
};

const importClauseHasRuntimeBinding = (
  clause: string,
  options: { readonly emptyNamedCounts?: boolean } = {}
): boolean => {
  const emptyNamedCounts = options.emptyNamedCounts ?? true;
  const uncommented = clause
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/\/\/[^\n\r]*/g, ' ');
  const trimmed = uncommented.trim();
  if (!trimmed) {
    return false;
  }

  const namedStart = trimmed.indexOf('{');
  if (namedStart === -1) {
    return true;
  }

  if (trimmed.slice(0, namedStart).replaceAll(',', '').trim()) {
    return true;
  }

  const namedEnd = trimmed.indexOf('}', namedStart + 1);
  if (namedEnd === -1) {
    return emptyNamedCounts;
  }

  const namedBindings = trimmed
    .slice(namedStart + 1, namedEnd)
    .split(',')
    .map((binding) => binding.trim())
    .filter(Boolean);
  if (namedBindings.length === 0) {
    return emptyNamedCounts;
  }

  return namedBindings.some((binding) => !/^type(?:\s|$)/u.test(binding));
};

const previousStatementStart = (source: string, start: number): number => {
  let index = start - 1;
  while (index >= 0) {
    if (source[index] === ';' || source[index] === '}') {
      return index + 1;
    }
    index -= 1;
  }
  return 0;
};

const importAppearsInTypePosition = (
  source: string,
  start: number
): boolean => {
  const prefix = source
    .slice(previousStatementStart(source, start), start)
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/\/\/[^\n\r]*/g, ' ')
    .trimStart();
  const lastLineStart =
    Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r')) + 1;
  const lastLine = prefix.slice(lastLineStart).trimStart();
  if (
    /^(?:export\s+)?(?:type|interface)\b/u.test(prefix) &&
    lastLineStart > 0 &&
    /^(?:const|let|var|using|await|return|throw|void|yield|new)\b/u.test(
      lastLine
    )
  ) {
    return false;
  }

  if (/^(?:export\s+)?(?:type|interface)\b/u.test(prefix)) {
    return true;
  }

  const trimmed = prefix.trimEnd();
  const lastAssignment = prefix.lastIndexOf('=');
  const colonLooksLikeTypeAnnotation = (colonIndex: number): boolean => {
    const objectLiteralStart = prefix.indexOf('{', lastAssignment + 1);
    if (objectLiteralStart !== -1 && objectLiteralStart < colonIndex) {
      return false;
    }

    const blockStart = prefix.lastIndexOf('{');
    if (blockStart > colonIndex) {
      const blockTail = prefix.slice(blockStart + 1).trimStart();
      if (
        /^(?:const|let|var|using|await|return|throw|void|yield|new)\b/u.test(
          blockTail
        )
      ) {
        return false;
      }
    }

    const questionIndex = prefix.indexOf('?', lastAssignment + 1);
    return questionIndex === -1 || questionIndex > colonIndex;
  };

  if (trimmed.endsWith('<') && isIdentifierChar(trimmed.at(-2))) {
    return true;
  }

  if (trimmed.endsWith(':')) {
    const trailingColon = prefix.lastIndexOf(':');
    return colonLooksLikeTypeAnnotation(trailingColon);
  }

  if (/\b(?:as|extends|implements|satisfies|typeof)\s*$/u.test(trimmed)) {
    return true;
  }

  const annotationColon = prefix.indexOf(':', lastAssignment + 1);
  if (annotationColon === -1) {
    return false;
  }

  return colonLooksLikeTypeAnnotation(annotationColon);
};

const importDeclarationSpecifier = (
  source: string,
  start: number
): string | undefined => {
  let index = skipTrivia(source, start + 'import'.length);
  if (source[index] === '.') {
    return undefined;
  }
  if (
    source.startsWith('type', index) &&
    !isIdentifierChar(source[index + 'type'.length])
  ) {
    return undefined;
  }
  const sideEffect = readQuotedString(source, index);
  if (sideEffect) {
    return sideEffect.value;
  }

  if (source[index] === '(') {
    if (importAppearsInTypePosition(source, start)) {
      return undefined;
    }
    index = skipTrivia(source, index + 1);
    return readQuotedString(source, index)?.value;
  }

  const clauseStart = index;
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      index = skipLineComment(source, index);
      continue;
    }
    if (source.startsWith('/*', index)) {
      index = skipBlockComment(source, index);
      continue;
    }
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index);
      continue;
    }
    if (
      source.startsWith('from', index) &&
      !isIdentifierChar(source[index - 1]) &&
      !isIdentifierChar(source[index + 'from'.length])
    ) {
      if (!importClauseHasRuntimeBinding(source.slice(clauseStart, index))) {
        return undefined;
      }
      index = skipTrivia(source, index + 'from'.length);
      return readQuotedString(source, index)?.value;
    }
    if (char === ';') {
      return undefined;
    }
    index += 1;
  }

  return undefined;
};

const boundImportDeclarationSpecifier = (
  source: string,
  start: number
): string | undefined => {
  let index = skipTrivia(source, start + 'import'.length);
  if (source[index] === '.') {
    return undefined;
  }
  if (
    source.startsWith('type', index) &&
    !isIdentifierChar(source[index + 'type'.length])
  ) {
    return undefined;
  }
  if (readQuotedString(source, index)) {
    return undefined;
  }

  if (source[index] === '(') {
    if (importAppearsInTypePosition(source, start)) {
      return undefined;
    }
    index = skipTrivia(source, index + 1);
    return readQuotedString(source, index)?.value;
  }

  const clauseStart = index;
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      index = skipLineComment(source, index);
      continue;
    }
    if (source.startsWith('/*', index)) {
      index = skipBlockComment(source, index);
      continue;
    }
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index);
      continue;
    }
    if (
      source.startsWith('from', index) &&
      !isIdentifierChar(source[index - 1]) &&
      !isIdentifierChar(source[index + 'from'.length])
    ) {
      if (
        !importClauseHasRuntimeBinding(source.slice(clauseStart, index), {
          emptyNamedCounts: false,
        })
      ) {
        return undefined;
      }
      index = skipTrivia(source, index + 'from'.length);
      return readQuotedString(source, index)?.value;
    }
    if (char === ';') {
      return undefined;
    }
    index += 1;
  }

  return undefined;
};

const reExportDeclarationSpecifier = (
  source: string,
  start: number
): string | undefined => {
  let index = skipTrivia(source, start + 'export'.length);
  if (
    source.startsWith('type', index) &&
    !isIdentifierChar(source[index + 'type'.length])
  ) {
    return undefined;
  }

  const clauseStart = index;
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      index = skipLineComment(source, index);
      continue;
    }
    if (source.startsWith('/*', index)) {
      index = skipBlockComment(source, index);
      continue;
    }
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipQuoted(source, index);
      continue;
    }
    if (char === '}') {
      const next = skipTrivia(source, index + 1);
      if (
        !source.startsWith('from', next) ||
        isIdentifierChar(source[next + 'from'.length])
      ) {
        return undefined;
      }
      index = next;
      continue;
    }
    if (
      source.startsWith('from', index) &&
      !isIdentifierChar(source[index - 1]) &&
      !isIdentifierChar(source[index + 'from'.length])
    ) {
      if (!importClauseHasRuntimeBinding(source.slice(clauseStart, index))) {
        return undefined;
      }
      index = skipTrivia(source, index + 'from'.length);
      return readQuotedString(source, index)?.value;
    }
    if (char === ';') {
      return undefined;
    }
    index += 1;
  }

  return undefined;
};

const importsSpecifier = (
  source: string,
  specifier: string,
  options: { includeReExports?: boolean; requireImportBinding?: boolean } = {}
): boolean => {
  const includeReExports = options.includeReExports ?? true;
  const importSpecifier = options.requireImportBinding
    ? boundImportDeclarationSpecifier
    : importDeclarationSpecifier;
  let index = 0;
  while (index < source.length) {
    const skippedIndex = skipImportScanIgnoredToken(source, index);
    if (skippedIndex !== undefined) {
      index = skippedIndex;
      continue;
    }

    if (
      source.startsWith('import', index) &&
      !isIdentifierChar(source[index - 1]) &&
      previousNonWhitespaceChar(source, index) !== '.' &&
      !isIdentifierChar(source[index + 'import'.length])
    ) {
      if (importSpecifier(source, index) === specifier) {
        return true;
      }
      index += 'import'.length;
      continue;
    }
    if (
      includeReExports &&
      source.startsWith('export', index) &&
      !isIdentifierChar(source[index - 1]) &&
      !isIdentifierChar(source[index + 'export'.length])
    ) {
      if (reExportDeclarationSpecifier(source, index) === specifier) {
        return true;
      }
      index += 'export'.length;
      continue;
    }
    index += 1;
  }

  return false;
};

const pathsImporting = (
  sourceFiles: readonly string[],
  specifier: string,
  options?: { includeReExports?: boolean; requireImportBinding?: boolean }
): readonly string[] =>
  sourceFiles.filter((filePath) =>
    importsSpecifier(readFileSync(filePath, 'utf8'), specifier, options)
  );

const isTestFile = (filePath: string): boolean => {
  const normalizedPath = normalizePath(filePath);
  return (
    normalizedPath.includes('/__tests__/') ||
    normalizedPath.endsWith('.test.ts') ||
    normalizedPath.endsWith('.test-d.ts')
  );
};

const assertPackageExports = (
  workspace: WorkspacePackage,
  diagnostics: AdapterCheckDiagnostic[]
): void => {
  const packageName = workspace.manifest.name as string;
  for (const key of ['.', './package.json'] as const) {
    if (hasResolvableExport(workspace, key)) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        workspace.packageJsonPath,
        packageName,
        'missing-package-export',
        `${packageName} must export "${key}" so adapter kit and consumers can resolve it.`
      )
    );
  }
};

const assertDependencyDirection = (
  workspace: WorkspacePackage,
  targetEntry: AdapterTargetCatalogEntry,
  diagnostics: AdapterCheckDiagnostic[]
): void => {
  const packageName = workspace.manifest.name as string;
  const dependencies = dependencyMap(workspace.manifest.dependencies);
  const devDependencies = dependencyMap(workspace.manifest.devDependencies);
  const optionalDependencies = dependencyMap(
    workspace.manifest.optionalDependencies
  );
  const peerDependencies = dependencyMap(workspace.manifest.peerDependencies);

  if (
    Object.hasOwn(dependencies, targetEntry.ownerPackage) ||
    Object.hasOwn(optionalDependencies, targetEntry.ownerPackage)
  ) {
    diagnostics.push(
      diagnostic(
        workspace.packageJsonPath,
        packageName,
        'dependency-direction',
        `${packageName} must peer-depend on ${targetEntry.ownerPackage}; runtime dependencies invert the adapter boundary.`,
        targetEntry.target,
        'extracted'
      )
    );
  }

  if (Object.hasOwn(devDependencies, targetEntry.ownerPackage)) {
    diagnostics.push(
      diagnostic(
        workspace.packageJsonPath,
        packageName,
        'dependency-direction',
        `${packageName} must not hide ${targetEntry.ownerPackage} in devDependencies; declare the owner as a peer dependency.`,
        targetEntry.target,
        'extracted'
      )
    );
  }

  if (!Object.hasOwn(peerDependencies, targetEntry.ownerPackage)) {
    diagnostics.push(
      diagnostic(
        workspace.packageJsonPath,
        packageName,
        'dependency-direction',
        `${packageName} must declare ${targetEntry.ownerPackage} in peerDependencies for extracted adapter placement.`,
        targetEntry.target,
        'extracted'
      )
    );
  }
};

const assertToolingBoundary = (
  workspace: WorkspacePackage,
  sourceFiles: readonly string[],
  diagnostics: AdapterCheckDiagnostic[]
): void => {
  const packageName = workspace.manifest.name as string;
  if (runtimeDependencyNames(workspace.manifest).has(adapterKitPackageName)) {
    diagnostics.push(
      diagnostic(
        workspace.packageJsonPath,
        packageName,
        'tooling-boundary',
        `${packageName} must not depend on ${adapterKitPackageName}; adapter kit stays out of runtime adapter packages.`
      )
    );
  }

  const runtimeSourceFiles = sourceFiles.filter(
    (sourceFile) => !isTestFile(sourceFile)
  );
  const toolingImportPaths = pathsImporting(
    runtimeSourceFiles,
    adapterKitPackageName
  );
  for (const sourcePath of toolingImportPaths) {
    diagnostics.push(
      diagnostic(
        workspace.packageJsonPath,
        packageName,
        'tooling-boundary',
        `${packageName} imports ${adapterKitPackageName} from ${normalizePath(relative(workspace.packageRoot, sourcePath))}; adapters must not import the adapter kit engine.`
      )
    );
  }
};

const checkAdapterPackage = (
  workspace: WorkspacePackage,
  targetById: ReadonlyMap<string, AdapterTargetCatalogEntry>
): {
  readonly diagnostics: readonly AdapterCheckDiagnostic[];
  readonly subject?: AdapterCheckSubject | undefined;
} => {
  const packageName = workspace.manifest.name as string;
  const diagnostics: AdapterCheckDiagnostic[] = [];
  const placement = placementForWorkspace(workspace.workspacePath);
  const metadata = trailAdapterMetadata(workspace.manifest);

  if (!placement || metadata === undefined) {
    return { diagnostics: [] };
  }

  assertPackageExports(workspace, diagnostics);
  const sourceFiles = collectSourceFiles(join(workspace.packageRoot, 'src'));
  assertToolingBoundary(workspace, sourceFiles, diagnostics);

  if (metadata === null) {
    return {
      diagnostics: [
        ...diagnostics,
        diagnostic(
          workspace.packageJsonPath,
          packageName,
          'invalid-adapter-metadata',
          `${packageName} must declare trails.adapter as an object with a kebab-case target string.`,
          undefined,
          placement
        ),
      ],
    };
  }

  const targetEntry = targetById.get(metadata.target);
  if (!targetEntry) {
    return {
      diagnostics: [
        ...diagnostics,
        diagnostic(
          workspace.packageJsonPath,
          packageName,
          'unknown-adapter-target',
          `${packageName} declares unknown adapter target "${metadata.target}".`,
          metadata.target,
          placement
        ),
      ],
    };
  }

  if (!targetEntry.placements.includes(placement)) {
    diagnostics.push(
      diagnostic(
        workspace.packageJsonPath,
        packageName,
        'unsupported-placement',
        `${targetEntry.ownerPackage}:${targetEntry.target} does not support ${placement} adapter placement.`,
        targetEntry.target,
        placement
      )
    );
  }

  if (placement === 'extracted') {
    assertDependencyDirection(workspace, targetEntry, diagnostics);
  }

  const { testingImport } = targetEntry;
  const conformanceTestPaths = testingImport
    ? pathsImporting(sourceFiles.filter(isTestFile), testingImport, {
        includeReExports: false,
        requireImportBinding: true,
      })
    : [];

  if (!testingImport) {
    diagnostics.push(
      diagnostic(
        workspace.packageJsonPath,
        packageName,
        'missing-owner-conformance',
        `${targetEntry.ownerPackage}:${targetEntry.target} must declare testingImport before adapters can prove conformance.`,
        targetEntry.target,
        placement
      )
    );
  } else if (conformanceTestPaths.length === 0) {
    diagnostics.push(
      diagnostic(
        workspace.packageJsonPath,
        packageName,
        'missing-conformance',
        `${packageName} must import ${testingImport} from a conformance test.`,
        targetEntry.target,
        placement
      )
    );
  }

  return {
    diagnostics,
    subject: {
      conformanceTestPaths,
      key: packageName,
      ownerPackage: targetEntry.ownerPackage,
      packageJsonPath: workspace.packageJsonPath,
      packageName,
      packageRoot: workspace.packageRoot,
      placement,
      target: targetEntry.target,
      targetKey: targetEntry.key,
      ...(testingImport ? { testingImport } : {}),
    },
  };
};

export const checkAdapters = (rootDir: string): AdapterCheckReport => {
  const catalog = deriveAdapterTargetCatalog(rootDir);
  const targetById = targetEntriesByTarget(catalog.targets);
  const diagnostics: AdapterCheckDiagnostic[] = [
    ...catalogDiagnostics(catalog),
  ];
  const subjects: AdapterCheckSubject[] = [];

  for (const workspace of workspacePackages(rootDir)) {
    const result = checkAdapterPackage(workspace, targetById);
    diagnostics.push(...result.diagnostics);
    if (result.subject) {
      subjects.push(result.subject);
    }
  }

  return {
    diagnostics,
    subjects: subjects.toSorted((left, right) =>
      left.key.localeCompare(right.key)
    ),
    targets: catalog.targets,
  };
};
