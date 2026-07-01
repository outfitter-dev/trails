/**
 * Project-context helpers shared by the Warden runner and resolver-backed
 * rules.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  collectImportResolutionsForFile,
  createWardenResolver,
  normalizePath,
} from './resolve.js';
import type {
  WardenImportResolution,
  WardenResolverOptions,
} from './resolve.js';
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
  isDeclarationWithId,
  isExportNamedDeclaration,
  isVariableDeclaration,
  offsetToLine,
  parse,
} from './rules/ast.js';
import type { AstNode } from './rules/ast.js';
import type { WardenExportedSymbolDefinition } from './rules/types.js';
import { collectPublicWorkspaces } from './workspaces.js';
import type { WardenPublicWorkspace } from './workspaces.js';

const ONTRAILS_DOCUMENTATION_SPECIFIER_PATTERN =
  /@ontrails\/[a-z0-9-]+(?:\/[A-Za-z0-9._~-]+)+/g;

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const setResolutionsForFile = (
  resolutionsByFile: Map<string, readonly WardenImportResolution[]>,
  sourceFilePath: string,
  resolutions: readonly WardenImportResolution[]
): void => {
  const normalizedFilePath =
    resolutions[0]?.importerPath ?? normalizeRealPath(sourceFilePath);
  resolutionsByFile.set(normalizedFilePath, resolutions);
  if (normalizedFilePath !== sourceFilePath) {
    resolutionsByFile.set(sourceFilePath, resolutions);
  }
};

export interface WardenProjectContextSourceFile {
  readonly filePath: string;
  readonly kind: 'documentation' | 'text' | 'typescript';
  readonly sourceCode: string;
}

const collectDocumentationImportSpecifiers = (
  sourceCode: string
): readonly { readonly importSource: string; readonly line: number }[] => {
  const specifiers: { importSource: string; line: number }[] = [];
  for (const match of sourceCode.matchAll(
    ONTRAILS_DOCUMENTATION_SPECIFIER_PATTERN
  )) {
    if (match.index === undefined) {
      continue;
    }
    specifiers.push({
      importSource: match[0],
      line: offsetToLine(sourceCode, match.index),
    });
  }
  return specifiers;
};

const exportAliasesForWorkspaces = (
  workspaces: ReadonlyMap<string, WardenPublicWorkspace>
): Record<string, string[]> => {
  const aliases: Record<string, string[]> = {};
  for (const workspace of workspaces.values()) {
    for (const [specifier, target] of Object.entries(
      workspace.exportTargets ?? {}
    )) {
      aliases[`${specifier}$`] = [target];
    }
  }
  return aliases;
};

const resolveOptionsWithWorkspaceAliases = (
  publicWorkspaces: ReadonlyMap<string, WardenPublicWorkspace> | undefined,
  resolveOptions: WardenResolverOptions['resolveOptions'] | undefined
): WardenResolverOptions['resolveOptions'] => {
  if (!publicWorkspaces) {
    return resolveOptions;
  }

  const workspaceAliases = exportAliasesForWorkspaces(publicWorkspaces);
  return {
    ...resolveOptions,
    alias: {
      ...workspaceAliases,
      ...resolveOptions?.alias,
    },
  };
};

export const collectProjectImportResolutions = ({
  publicWorkspaces,
  resolveOptions,
  rootDir,
  sourceFiles,
}: {
  readonly publicWorkspaces?: ReadonlyMap<string, WardenPublicWorkspace>;
  readonly resolveOptions?: WardenResolverOptions['resolveOptions'];
  readonly rootDir: string;
  readonly sourceFiles: readonly WardenProjectContextSourceFile[];
}): ReadonlyMap<string, readonly WardenImportResolution[]> => {
  const resolver = createWardenResolver({
    resolveOptions: resolveOptionsWithWorkspaceAliases(
      publicWorkspaces,
      resolveOptions
    ),
    rootDir,
  });
  const resolutionsByFile = new Map<
    string,
    readonly WardenImportResolution[]
  >();

  for (const sourceFile of sourceFiles) {
    if (sourceFile.kind !== 'typescript') {
      continue;
    }
    const resolutions = collectImportResolutionsForFile({
      filePath: sourceFile.filePath,
      resolver,
      sourceCode: sourceFile.sourceCode,
    });
    if (resolutions.length > 0) {
      setResolutionsForFile(
        resolutionsByFile,
        sourceFile.filePath,
        resolutions
      );
    }
  }

  return resolutionsByFile;
};

export const collectProjectDocumentationImportResolutions = ({
  publicWorkspaces: providedPublicWorkspaces,
  rootDir,
  sourceFiles,
}: {
  readonly publicWorkspaces?: ReadonlyMap<string, WardenPublicWorkspace>;
  readonly rootDir: string;
  readonly sourceFiles: readonly WardenProjectContextSourceFile[];
}): ReadonlyMap<string, readonly WardenImportResolution[]> => {
  const publicWorkspaces =
    providedPublicWorkspaces ?? collectPublicWorkspaces(rootDir);
  const resolver = createWardenResolver({
    resolveOptions: { alias: exportAliasesForWorkspaces(publicWorkspaces) },
    rootDir,
  });
  const resolutionsByFile = new Map<
    string,
    readonly WardenImportResolution[]
  >();

  for (const sourceFile of sourceFiles) {
    if (sourceFile.kind !== 'documentation') {
      continue;
    }
    const resolutions = collectDocumentationImportSpecifiers(
      sourceFile.sourceCode
    ).map((specifier) =>
      resolver.resolveImport(
        sourceFile.filePath,
        specifier.importSource,
        specifier.line
      )
    );
    if (resolutions.length > 0) {
      setResolutionsForFile(
        resolutionsByFile,
        sourceFile.filePath,
        resolutions
      );
    }
  }

  return resolutionsByFile;
};

const exportedKindForDeclaration = (
  declaration: AstNode
): WardenExportedSymbolDefinition['kind'] | null => {
  if (declaration.type === 'ClassDeclaration') {
    return 'class';
  }
  if (declaration.type === 'FunctionDeclaration') {
    return 'function';
  }
  if (
    declaration.type === 'EnumDeclaration' ||
    declaration.type === 'TSEnumDeclaration'
  ) {
    return 'enum';
  }
  if (
    declaration.type === 'InterfaceDeclaration' ||
    declaration.type === 'TSInterfaceDeclaration'
  ) {
    return 'interface';
  }
  if (declaration.type === 'TSTypeAliasDeclaration') {
    return 'type';
  }
  if (isVariableDeclaration(declaration)) {
    return 'const';
  }
  return null;
};

const publicExportTargetWorkspacesByPath = (
  publicWorkspaces: ReadonlyMap<string, WardenPublicWorkspace>
): ReadonlyMap<string, WardenPublicWorkspace> => {
  const workspacesByTargetPath = new Map<string, WardenPublicWorkspace>();
  for (const workspace of publicWorkspaces.values()) {
    for (const target of Object.values(workspace.exportTargets ?? {})) {
      workspacesByTargetPath.set(normalizeRealPath(target), workspace);
    }
  }
  return workspacesByTargetPath;
};

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

const exportedSpecifierKind = (
  statement: AstNode,
  specifier: AstNode
): WardenExportedSymbolDefinition['kind'] =>
  getNodeExportKind(statement) === 'type' ||
  getNodeExportKind(specifier) === 'type'
    ? 'type'
    : 'export';

const reexportedDefinitions = ({
  filePath,
  sourceCode,
  statement,
  workspace,
}: {
  readonly filePath: string;
  readonly sourceCode: string;
  readonly statement: AstNode;
  readonly workspace: WardenPublicWorkspace;
}): readonly WardenExportedSymbolDefinition[] => {
  const specifiers = getNodeSpecifiers(statement) ?? [];
  return specifiers.flatMap((specifier) => {
    if (specifier.type !== 'ExportSpecifier') {
      return [];
    }
    const exported = getNodeExported(specifier);
    const local = getNodeLocal(specifier);
    const name = readNameNode(exported) ?? readNameNode(local);
    return name
      ? [
          {
            filePath,
            kind: exportedSpecifierKind(statement, specifier),
            line: offsetToLine(sourceCode, specifier.start),
            name,
            workspaceName: workspace.name,
            workspaceRoot: workspace.rootDir,
          } satisfies WardenExportedSymbolDefinition,
        ]
      : [];
  });
};

const namedDeclarationDefinitions = ({
  declaration,
  filePath,
  sourceCode,
  workspace,
}: {
  readonly declaration: AstNode;
  readonly filePath: string;
  readonly sourceCode: string;
  readonly workspace: WardenPublicWorkspace;
}): readonly WardenExportedSymbolDefinition[] => {
  const kind = exportedKindForDeclaration(declaration);
  if (!kind) {
    return [];
  }

  if (isVariableDeclaration(declaration)) {
    return getNodeDeclarations(declaration).flatMap((declarator) => {
      const name = getNodeName(getNodeId(declarator));
      return name
        ? [
            {
              filePath,
              kind,
              line: offsetToLine(sourceCode, declarator.start),
              name,
              workspaceName: workspace.name,
              workspaceRoot: workspace.rootDir,
            } satisfies WardenExportedSymbolDefinition,
          ]
        : [];
    });
  }

  if (!isDeclarationWithId(declaration)) {
    return [];
  }

  const name = getNodeName(getNodeId(declaration));
  return name
    ? [
        {
          filePath,
          kind,
          line: offsetToLine(sourceCode, declaration.start),
          name,
          workspaceName: workspace.name,
          workspaceRoot: workspace.rootDir,
        } satisfies WardenExportedSymbolDefinition,
      ]
    : [];
};

const collectExportedSymbolDefinitionsForFile = (
  sourceFile: WardenProjectContextSourceFile,
  publicExportTargetWorkspaces: ReadonlyMap<string, WardenPublicWorkspace>
): readonly WardenExportedSymbolDefinition[] => {
  if (sourceFile.kind !== 'typescript') {
    return [];
  }

  const workspace = publicExportTargetWorkspaces.get(
    normalizeRealPath(sourceFile.filePath)
  );
  if (!workspace) {
    return [];
  }

  const ast = parse(sourceFile.filePath, sourceFile.sourceCode);
  if (!ast) {
    return [];
  }

  return getNodeBodyStatements(ast).flatMap((statement) => {
    if (!isExportNamedDeclaration(statement)) {
      return [];
    }
    if (getNodeSource(statement) || getNodeSpecifiers(statement)?.length) {
      return reexportedDefinitions({
        filePath: sourceFile.filePath,
        sourceCode: sourceFile.sourceCode,
        statement,
        workspace,
      });
    }
    const declaration = getNodeDeclaration(statement);
    return declaration
      ? namedDeclarationDefinitions({
          declaration,
          filePath: sourceFile.filePath,
          sourceCode: sourceFile.sourceCode,
          workspace,
        })
      : [];
  });
};

export const collectProjectExportedSymbolDefinitions = ({
  publicWorkspaces: providedPublicWorkspaces,
  rootDir,
  sourceFiles,
}: {
  readonly publicWorkspaces?: ReadonlyMap<string, WardenPublicWorkspace>;
  readonly rootDir: string;
  readonly sourceFiles: readonly WardenProjectContextSourceFile[];
}): ReadonlyMap<string, readonly WardenExportedSymbolDefinition[]> => {
  const publicWorkspaces =
    providedPublicWorkspaces ?? collectPublicWorkspaces(rootDir);
  const publicExportTargetWorkspaces =
    publicExportTargetWorkspacesByPath(publicWorkspaces);
  const definitionsByName = new Map<string, WardenExportedSymbolDefinition[]>();

  for (const sourceFile of sourceFiles) {
    for (const definition of collectExportedSymbolDefinitionsForFile(
      sourceFile,
      publicExportTargetWorkspaces
    )) {
      const existing = definitionsByName.get(definition.name) ?? [];
      existing.push(definition);
      definitionsByName.set(definition.name, existing);
    }
  }

  return new Map(
    [...definitionsByName.entries()].map(([name, definitions]) => [
      name,
      definitions.toSorted(
        (left, right) =>
          left.workspaceName.localeCompare(right.workspaceName) ||
          left.filePath.localeCompare(right.filePath) ||
          left.line - right.line
      ),
    ])
  );
};

export { collectPublicWorkspaces };
export type { WardenPublicWorkspace } from './workspaces.js';
