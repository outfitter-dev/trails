/* oxlint-disable max-statements -- inventory traversal is clearer as a small script */

import { dirname, join, normalize } from 'node:path';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

interface PublicApiPackageTarget {
  readonly indexPath: string;
  readonly minimumExports: readonly string[];
  readonly packageName: string;
}

export interface PublicApiExportRecord {
  readonly exportName: string;
  readonly hasExample: boolean;
  readonly isMinimum: boolean;
  readonly packageName: string;
  readonly sourcePath: string;
}

interface PublicExportSpecifier {
  readonly exportName: string;
  readonly importedName: string;
  readonly moduleSpecifier: string;
}

const repoRoot = join(import.meta.dir, '..');

export const PUBLIC_API_EXAMPLE_TARGETS: readonly PublicApiPackageTarget[] = [
  {
    indexPath: 'packages/cli/src/index.ts',
    minimumExports: [
      'deriveCliCommands',
      'deriveFlags',
      'output',
      'deriveOutputMode',
      'findAppModuleCandidates',
      'findAppModule',
    ],
    packageName: '@ontrails/cli',
  },
  {
    indexPath: 'packages/http/src/index.ts',
    minimumExports: [
      'deriveHttpRoutes',
      'deriveHttpInputSource',
      'deriveHttpMethod',
      'deriveHttpOperationMethod',
      'deriveOpenApiSpec',
    ],
    packageName: '@ontrails/http',
  },
  {
    indexPath: 'packages/mcp/src/index.ts',
    minimumExports: [
      'deriveMcpTools',
      'createServer',
      'surface',
      'connectStdio',
    ],
    packageName: '@ontrails/mcp',
  },
  {
    indexPath: 'adapters/commander/src/index.ts',
    minimumExports: ['createProgram', 'surface', 'toCommander'],
    packageName: '@ontrails/commander',
  },
  {
    indexPath: 'adapters/hono/src/index.ts',
    minimumExports: ['createApp', 'surface'],
    packageName: '@ontrails/hono',
  },
] as const;

const hasExportModifier = (node: ts.Node): boolean =>
  ts
    .getModifiers(node)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
  false;

const isNamedDeclarationForExport = (
  statement: ts.Statement,
  exportName: string
): boolean => {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)) &&
    statement.name?.text === exportName
  ) {
    return hasExportModifier(statement);
  }

  if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
    return false;
  }

  return statement.declarationList.declarations.some(
    (declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === exportName
  );
};

export const hasLeadingExampleForExport = (
  sourceText: string,
  exportName: string
): boolean => {
  const sourceFile = ts.createSourceFile(
    'public-api.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const statement = sourceFile.statements.find((candidate) =>
    isNamedDeclarationForExport(candidate, exportName)
  );
  if (!statement) {
    return false;
  }

  const comments =
    ts.getLeadingCommentRanges(sourceText, statement.getFullStart()) ?? [];
  return comments.some((comment) =>
    /@example\b/.test(sourceText.slice(comment.pos, comment.end))
  );
};

export const collectPublicExportsFromSource = (
  indexSource: string
): readonly PublicExportSpecifier[] => {
  const sourceFile = ts.createSourceFile(
    'index.ts',
    indexSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const exports: PublicExportSpecifier[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) {
      continue;
    }

    if (
      !statement.moduleSpecifier ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      throw new Error('Public API inventory only supports module re-exports');
    }

    if (!statement.exportClause) {
      throw new Error(
        `Public API inventory does not support star re-exports from ${statement.moduleSpecifier.text}`
      );
    }

    if (!ts.isNamedExports(statement.exportClause)) {
      continue;
    }

    for (const specifier of statement.exportClause.elements) {
      if (specifier.isTypeOnly) {
        continue;
      }

      exports.push({
        exportName: specifier.name.text,
        importedName: specifier.propertyName?.text ?? specifier.name.text,
        moduleSpecifier: statement.moduleSpecifier.text,
      });
    }
  }

  return exports;
};

const resolveSourcePath = (
  indexPath: string,
  moduleSpecifier: string
): string => {
  if (!moduleSpecifier.startsWith('.')) {
    throw new Error(
      `Only relative public export specifiers are supported: ${moduleSpecifier}`
    );
  }
  const withTsExtension = moduleSpecifier.replace(/\.js$/, '.ts');
  return normalize(join(dirname(indexPath), withTsExtension));
};

const buildMinimumKey = (packageName: string, exportName: string): string =>
  `${packageName}#${exportName}`;

export const collectPublicApiInventory = (
  targets: readonly PublicApiPackageTarget[] = PUBLIC_API_EXAMPLE_TARGETS
): readonly PublicApiExportRecord[] => {
  const records: PublicApiExportRecord[] = [];

  for (const target of targets) {
    const indexSource = readFileSync(join(repoRoot, target.indexPath), 'utf8');
    const minimumExports = new Set(target.minimumExports);

    for (const specifier of collectPublicExportsFromSource(indexSource)) {
      const sourcePath = resolveSourcePath(
        target.indexPath,
        specifier.moduleSpecifier
      );
      const sourceText = readFileSync(join(repoRoot, sourcePath), 'utf8');
      records.push({
        exportName: specifier.exportName,
        hasExample: hasLeadingExampleForExport(
          sourceText,
          specifier.importedName
        ),
        isMinimum: minimumExports.has(specifier.exportName),
        packageName: target.packageName,
        sourcePath,
      });
    }
  }

  return records;
};

const assertMinimumTargetsPresent = (
  records: readonly PublicApiExportRecord[],
  targets: readonly PublicApiPackageTarget[]
): void => {
  const present = new Set(
    records.map((record) =>
      buildMinimumKey(record.packageName, record.exportName)
    )
  );
  const missing = targets.flatMap((target) =>
    target.minimumExports
      .filter(
        (exportName) =>
          !present.has(buildMinimumKey(target.packageName, exportName))
      )
      .map((exportName) => `${target.packageName}.${exportName}`)
  );

  if (missing.length > 0) {
    throw new Error(
      `Minimum public API exports missing from inventory: ${missing.join(', ')}`
    );
  }
};

const formatInventory = (records: readonly PublicApiExportRecord[]): string =>
  records
    .toSorted((a, b) =>
      a.packageName === b.packageName
        ? a.exportName.localeCompare(b.exportName)
        : a.packageName.localeCompare(b.packageName)
    )
    .map((record) => {
      const status = record.hasExample ? 'covered' : 'missing';
      const tier = record.isMinimum ? 'minimum' : 'inventory';
      return `- ${record.packageName}.${record.exportName}: ${status} (${tier}; ${record.sourcePath})`;
    })
    .join('\n');

const main = (): void => {
  const records = collectPublicApiInventory();
  assertMinimumTargetsPresent(records, PUBLIC_API_EXAMPLE_TARGETS);

  const missingMinimum = records.filter(
    (record) => record.isMinimum && !record.hasExample
  );
  if (missingMinimum.length > 0) {
    throw new Error(
      `Missing @example coverage for v1 public API minimum exports:\n${formatInventory(missingMinimum)}`
    );
  }

  const minimumCount = records.filter((record) => record.isMinimum).length;
  console.log(
    `Public API @example coverage passed for ${String(minimumCount)} minimum exports.\n${formatInventory(records)}`
  );
};

if (import.meta.main) {
  main();
}
