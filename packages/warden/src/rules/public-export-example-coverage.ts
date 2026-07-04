/**
 * Repo-local rule (TRL-943): public API exports re-exported from the v1
 * surface package index barrels must carry a leading `@example` TSDoc block
 * on their exported declaration. Graduated from
 * `scripts/check-public-api-examples.ts` so the contract is governed by
 * Warden instead of a standalone script.
 *
 * The inventory mirrors the script's semantics:
 *
 *  1. Only non-type-only named re-exports with relative module specifiers
 *     are inventoried. Type-only export declarations and type-only
 *     specifiers are skipped.
 *  2. Star re-exports, non-relative specifiers, and local export lists on a
 *     target barrel are reported as errors — the inventory cannot resolve
 *     them to a declaration.
 *  3. Each re-export resolves to its source module (`.js` → `.ts`, relative
 *     to the barrel), and the exported declaration is located by the
 *     IMPORTED name (the `propertyName` when aliased). The declaration is
 *     covered when a leading comment in the trivia gap before it matches
 *     `@example`.
 *  4. A `minimumExports` entry that never appears in the barrel inventory is
 *     an error — the minimum policy list must stay inventoried.
 *
 * Severity model: missing `@example` on a `minimumExports` entry is an
 * `error`; missing `@example` on any other inventoried export is a `warn`
 * so the rest of the inventory stays visible without failing
 * `failOn: 'error'` runs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getNodeBodyStatements,
  getNodeDeclaration,
  getNodeDeclarations,
  getNodeExportKind,
  getNodeExported,
  getNodeId,
  getNodeLocal,
  getNodeName,
  getNodeSource,
  getNodeSpecifiers,
  getNodeValue,
  offsetToLine,
  parse,
} from './ast.js';
import type { AstNode } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'public-export-example-coverage';

export interface PublicApiPackageTarget {
  /** Repo-root-relative path to the package's public index barrel. */
  readonly indexPath: string;
  /** Exports that MUST be inventoried and carry `@example` coverage. */
  readonly minimumExports: readonly string[];
  /** Published package name, used in diagnostics. */
  readonly packageName: string;
}

/**
 * Repo-local public API `@example` coverage policy.
 *
 * Ported verbatim from `scripts/check-public-api-examples.ts`
 * (`PUBLIC_API_EXAMPLE_TARGETS`). This table lives in the rule module as
 * repo-local policy: `wardenConfigSchema` is a strict runner-options schema
 * and source-static rules receive only `(sourceCode, filePath)`, so there is
 * no per-rule config channel today. Move the table into Warden config if a
 * per-rule config channel lands.
 */
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
  {
    indexPath: 'adapters/cloudflare/src/index.ts',
    minimumExports: ['createWorkersHandler', 'cloudflareKv'],
    packageName: '@ontrails/cloudflare',
  },
] as const;

export interface ResolvedPublicApiTarget extends PublicApiPackageTarget {
  /** Absolute path of the target barrel — the rule's path anchor. */
  readonly absoluteIndexPath: string;
  /** Absolute repo (or fixture) root used to relativize diagnostic paths. */
  readonly rootDir: string;
}

/**
 * Resolve repo-relative policy targets against a root directory. Exported
 * for unit testing — tests build fixture trees under a temp root instead of
 * depending on the real repo barrels. Not part of the public rule API.
 */
export const resolvePublicApiExampleTargets = (
  rootDir: string,
  targets: readonly PublicApiPackageTarget[]
): readonly ResolvedPublicApiTarget[] => {
  const resolvedRoot = resolve(rootDir);
  return targets.map((target) => ({
    ...target,
    absoluteIndexPath: resolve(resolvedRoot, target.indexPath),
    rootDir: resolvedRoot,
  }));
};

/**
 * Repo root resolved from this rule's own module URL
 * (`packages/warden/src/rules/` → four levels up). Anchoring to the real
 * on-disk location gives the same consumer-repo safety property as
 * `warden-export-symmetry`'s SELF_BARREL_PATH: in a consumer repository the
 * warden package resolves inside `node_modules`, so the computed absolute
 * target paths never match consumer files and the rule stays silent.
 */
const REPO_ROOT = resolve(
  fileURLToPath(new URL('../../../..', import.meta.url))
);

const RESOLVED_TARGETS = resolvePublicApiExampleTargets(
  REPO_ROOT,
  PUBLIC_API_EXAMPLE_TARGETS
);

interface PublicExportSpecifier {
  /** Public export name as seen on the barrel. */
  readonly exportName: string;
  /** Local source binding name (`propertyName` when aliased). */
  readonly importedName: string;
  readonly moduleSpecifier: string;
  /** Start offset of the export specifier on the barrel. */
  readonly start: number;
}

interface BarrelInventory {
  readonly diagnostics: readonly WardenDiagnostic[];
  readonly specifiers: readonly PublicExportSpecifier[];
}

const isTypeKind = (node: AstNode): boolean =>
  getNodeExportKind(node) === 'type';

const readNameNode = (node: AstNode | undefined): string | null => {
  if (!node) {
    return null;
  }
  if (node.type === 'Identifier') {
    return getNodeName(node) ?? null;
  }
  if (node.type === 'Literal' || node.type === 'StringLiteral') {
    const value = getNodeValue(node);
    return typeof value === 'string' ? value : null;
  }
  return null;
};

const moduleSpecifierValue = (node: AstNode): string | null => {
  const source = getNodeSource(node);
  if (!source) {
    return null;
  }
  const value = getNodeValue(source);
  return typeof value === 'string' ? value : null;
};

const programBody = (ast: AstNode): readonly AstNode[] =>
  getNodeBodyStatements(ast);

const diagnostic = (
  sourceCode: string,
  filePath: string,
  start: number,
  severity: WardenDiagnostic['severity'],
  message: string
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, start),
  message: `${RULE_NAME}: ${message}`,
  rule: RULE_NAME,
  severity,
});

const specifiersFromExportDeclaration = (
  node: AstNode,
  moduleSpecifier: string
): readonly PublicExportSpecifier[] => {
  const specifiers = getNodeSpecifiers(node) ?? [];
  return specifiers.flatMap((specifier) => {
    if (specifier.type !== 'ExportSpecifier' || isTypeKind(specifier)) {
      return [];
    }
    const exported = getNodeExported(specifier);
    const local = getNodeLocal(specifier);
    const exportName = readNameNode(exported);
    if (!exportName) {
      return [];
    }
    return [
      {
        exportName,
        importedName: readNameNode(local) ?? exportName,
        moduleSpecifier,
        start: specifier.start,
      },
    ];
  });
};

interface InventoryContext {
  readonly diagnostics: WardenDiagnostic[];
  readonly filePath: string;
  readonly sourceCode: string;
  readonly specifiers: PublicExportSpecifier[];
  readonly target: ResolvedPublicApiTarget;
}

const inventoryNamedExport = (node: AstNode, ctx: InventoryContext): void => {
  if (isTypeKind(node)) {
    return;
  }
  const declaration = getNodeDeclaration(node);
  if (declaration) {
    // Declaration-form exports (`export const foo = ...`) are not module
    // re-exports; the script's inventory skipped them the same way.
    return;
  }
  const moduleSpecifier = moduleSpecifierValue(node);
  if (moduleSpecifier === null) {
    ctx.diagnostics.push(
      diagnostic(
        ctx.sourceCode,
        ctx.filePath,
        node.start,
        'error',
        `${ctx.target.packageName} barrel has a local export list without a module specifier. The public API inventory only supports module re-exports — re-export each name from its source module.`
      )
    );
    return;
  }
  if (!moduleSpecifier.startsWith('.')) {
    ctx.diagnostics.push(
      diagnostic(
        ctx.sourceCode,
        ctx.filePath,
        node.start,
        'error',
        `${ctx.target.packageName} barrel re-exports from non-relative module specifier '${moduleSpecifier}'. The public API inventory can only resolve relative re-exports to their declarations.`
      )
    );
    return;
  }
  ctx.specifiers.push(
    ...specifiersFromExportDeclaration(node, moduleSpecifier)
  );
};

const inventoryStarExport = (node: AstNode, ctx: InventoryContext): void => {
  if (isTypeKind(node)) {
    return;
  }
  const moduleSpecifier = moduleSpecifierValue(node) ?? '<unknown>';
  ctx.diagnostics.push(
    diagnostic(
      ctx.sourceCode,
      ctx.filePath,
      node.start,
      'error',
      `${ctx.target.packageName} barrel uses a star re-export from '${moduleSpecifier}'. The public API inventory does not support star re-exports — list each export by name so @example coverage stays checkable.`
    )
  );
};

/**
 * Inventory the non-type-only named re-exports on a target barrel, emitting
 * error diagnostics for shapes the inventory cannot resolve (star
 * re-exports, non-relative specifiers, local export lists).
 */
const collectBarrelInventory = (
  sourceCode: string,
  filePath: string,
  ast: AstNode,
  target: ResolvedPublicApiTarget
): BarrelInventory => {
  const ctx: InventoryContext = {
    diagnostics: [],
    filePath,
    sourceCode,
    specifiers: [],
    target,
  };
  for (const statement of programBody(ast)) {
    if (statement.type === 'ExportNamedDeclaration') {
      inventoryNamedExport(statement, ctx);
    } else if (statement.type === 'ExportAllDeclaration') {
      inventoryStarExport(statement, ctx);
    }
  }
  return { diagnostics: ctx.diagnostics, specifiers: ctx.specifiers };
};

const TS_RE_EXPORT_EXTENSION = /\.js$/;

const resolveReexportSourcePath = (
  absoluteIndexPath: string,
  moduleSpecifier: string
): string => {
  const withTsExtension = moduleSpecifier.replace(
    TS_RE_EXPORT_EXTENSION,
    '.ts'
  );
  return normalize(join(dirname(absoluteIndexPath), withTsExtension));
};

const declarationNameMatches = (
  declaration: AstNode,
  exportName: string
): boolean => {
  if (
    declaration.type === 'FunctionDeclaration' ||
    declaration.type === 'ClassDeclaration' ||
    declaration.type === 'TSInterfaceDeclaration' ||
    declaration.type === 'TSTypeAliasDeclaration'
  ) {
    const id = getNodeId(declaration);
    return readNameNode(id) === exportName;
  }
  if (declaration.type === 'VariableDeclaration') {
    const declarations = getNodeDeclarations(declaration);
    return declarations.some((declarator) => {
      const id = getNodeId(declarator);
      return readNameNode(id) === exportName;
    });
  }
  return false;
};

/**
 * Comment texts found in an inter-statement trivia gap. The gap between two
 * top-level statements contains only whitespace and comments, so a small
 * line/block comment scan recovers the same comment set TypeScript's
 * `getLeadingCommentRanges` returns for the statement's full start.
 */
const collectCommentTexts = (gapText: string): readonly string[] => {
  const comments: string[] = [];
  let index = 0;
  while (index < gapText.length - 1) {
    if (gapText[index] === '/' && gapText[index + 1] === '/') {
      const lineEnd = gapText.indexOf('\n', index);
      const stop = lineEnd === -1 ? gapText.length : lineEnd;
      comments.push(gapText.slice(index, stop));
      index = stop + 1;
    } else if (gapText[index] === '/' && gapText[index + 1] === '*') {
      const blockEnd = gapText.indexOf('*/', index + 2);
      const stop = blockEnd === -1 ? gapText.length : blockEnd + 2;
      comments.push(gapText.slice(index, stop));
      index = stop;
    } else {
      index += 1;
    }
  }
  return comments;
};

const EXAMPLE_TAG_PATTERN = /@example\b/;

/**
 * True when the exported declaration named `importedName` in `sourceText`
 * carries a leading comment containing `@example`. Leading comments are
 * recovered from the trivia gap between the preceding top-level statement's
 * end (or file start) and the matching export statement's start.
 */
const hasLeadingExampleForExport = (
  sourceText: string,
  ast: AstNode,
  importedName: string
): boolean => {
  const body = programBody(ast);
  for (const [statementIndex, statement] of body.entries()) {
    if (statement.type !== 'ExportNamedDeclaration') {
      continue;
    }
    const declaration = getNodeDeclaration(statement);
    if (!declaration || !declarationNameMatches(declaration, importedName)) {
      continue;
    }
    const previous = body[statementIndex - 1];
    const gapText = sourceText.slice(previous?.end ?? 0, statement.start);
    return collectCommentTexts(gapText).some((comment) =>
      EXAMPLE_TAG_PATTERN.test(comment)
    );
  }
  return false;
};

const readSourceFile = (sourcePath: string): string | null => {
  try {
    return readFileSync(sourcePath, 'utf8');
  } catch {
    return null;
  }
};

const coverageDiagnosticsForSpecifier = (
  sourceCode: string,
  filePath: string,
  specifier: PublicExportSpecifier,
  target: ResolvedPublicApiTarget
): readonly WardenDiagnostic[] => {
  const sourcePath = resolveReexportSourcePath(
    target.absoluteIndexPath,
    specifier.moduleSpecifier
  );
  const relativeSourcePath = relative(target.rootDir, sourcePath);
  const sourceText = readSourceFile(sourcePath);
  if (sourceText === null) {
    return [
      diagnostic(
        sourceCode,
        filePath,
        specifier.start,
        'error',
        `${target.packageName} export "${specifier.exportName}" re-exports from unreadable source ${relativeSourcePath}. The public API inventory could not read the resolved module.`
      ),
    ];
  }
  const sourceAst = parse(sourcePath, sourceText);
  if (!sourceAst) {
    return [
      diagnostic(
        sourceCode,
        filePath,
        specifier.start,
        'error',
        `${target.packageName} export "${specifier.exportName}" re-exports from unparseable source ${relativeSourcePath}. The public API inventory could not parse the resolved module.`
      ),
    ];
  }
  if (
    hasLeadingExampleForExport(sourceText, sourceAst, specifier.importedName)
  ) {
    return [];
  }
  const isMinimum = target.minimumExports.includes(specifier.exportName);
  const tier = isMinimum ? 'minimum' : 'inventory';
  return [
    diagnostic(
      sourceCode,
      filePath,
      specifier.start,
      isMinimum ? 'error' : 'warn',
      `${target.packageName} export "${specifier.exportName}" (${tier}) is missing a leading @example TSDoc block on its exported declaration "${specifier.importedName}" in ${relativeSourcePath}. Add an @example to the declaration's TSDoc.`
    ),
  ];
};

const missingMinimumDiagnostics = (
  sourceCode: string,
  filePath: string,
  specifiers: readonly PublicExportSpecifier[],
  target: ResolvedPublicApiTarget
): readonly WardenDiagnostic[] => {
  const present = new Set(specifiers.map((specifier) => specifier.exportName));
  return target.minimumExports
    .filter((exportName) => !present.has(exportName))
    .map((exportName) =>
      diagnostic(
        sourceCode,
        filePath,
        0,
        'error',
        `${target.packageName} minimum export "${exportName}" is missing from the barrel inventory at ${target.indexPath}. Every minimumExports policy entry must stay re-exported by name on the package barrel.`
      )
    );
};

/**
 * Run the coverage analysis against an explicit resolved-target table.
 * Exported for unit testing so fixtures can anchor to a temp root instead of
 * the real repo barrels. Not part of the public rule API.
 */
export const checkPublicExportExampleCoverage = (
  sourceCode: string,
  filePath: string,
  targets: readonly ResolvedPublicApiTarget[]
): readonly WardenDiagnostic[] => {
  const resolvedPath = resolve(filePath);
  const target = targets.find(
    (candidate) => candidate.absoluteIndexPath === resolvedPath
  );
  if (!target) {
    return [];
  }
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }
  const inventory = collectBarrelInventory(sourceCode, filePath, ast, target);
  return [
    ...inventory.diagnostics,
    ...missingMinimumDiagnostics(
      sourceCode,
      filePath,
      inventory.specifiers,
      target
    ),
    ...inventory.specifiers.flatMap((specifier) =>
      coverageDiagnosticsForSpecifier(sourceCode, filePath, specifier, target)
    ),
  ];
};

/**
 * Warden rule enforcing leading `@example` TSDoc coverage on the public API
 * exports of the v1 surface package barrels (TRL-943).
 */
export const publicExportExampleCoverage: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkPublicExportExampleCoverage(
      sourceCode,
      filePath,
      RESOLVED_TARGETS
    );
  },
  description:
    'Enforces that public API exports re-exported from the v1 surface package index barrels carry a leading @example TSDoc block, with a mandatory per-package minimumExports coverage list.',
  name: RULE_NAME,
  severity: 'error',
};
