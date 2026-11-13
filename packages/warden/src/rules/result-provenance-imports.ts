/** Shared bounded import/declaration seam for Result provenance rules. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  getNodeBodyStatements,
  getNodeDeclaration,
  getNodeDeclarations,
  getNodeId,
  getNodeExported,
  getNodeImported,
  getNodeLocal,
  getNodeSource,
  getNodeSpecifiers,
  getNodeValue,
  parse,
  getNodeInit,
  identifierName,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';

/**
 * Resolve a relative import source specifier to an absolute on-disk file path,
 * or null when the source is not a relative path we can resolve locally.
 *
 * Handles `.js` -> `.ts` rewriting (the convention in this repo), plain `.ts`
 * imports, and extensionless paths.
 */
const buildResolutionCandidates = (resolved: string): readonly string[] => {
  if (resolved.endsWith('.ts') || resolved.endsWith('.tsx')) {
    return [resolved];
  }
  if (resolved.endsWith('.js')) {
    return [
      resolved.replace(/\.js$/, '.ts'),
      resolved.replace(/\.js$/, '.tsx'),
      resolved,
    ];
  }
  if (resolved.endsWith('.jsx')) {
    return [resolved.replace(/\.jsx$/, '.tsx'), resolved];
  }
  return [`${resolved}.ts`, `${resolved}.tsx`];
};

export const resolveRelativeImportPath = (
  source: string,
  fromFile: string
): string | null => {
  if (!(source.startsWith('./') || source.startsWith('../'))) {
    return null;
  }
  const baseDir = isAbsolute(fromFile)
    ? dirname(fromFile)
    : dirname(resolve(fromFile));
  const resolved = resolve(baseDir, source);
  return (
    buildResolutionCandidates(resolved).find((candidate) =>
      existsSync(candidate)
    ) ?? null
  );
};

/** Index only a module's own declarations; no transitive or inferred bindings. */
export const collectModuleDeclarations = (
  ast: AstNode
): ReadonlyMap<string, AstNode> => {
  const declarations = new Map<string, AstNode>();
  for (const statement of getNodeBodyStatements(ast)) {
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? getNodeDeclaration(statement)
        : statement;
    if (!declaration) {
      continue;
    }
    if (declaration.type === 'VariableDeclaration') {
      for (const variable of getNodeDeclarations(declaration)) {
        const name = identifierName(getNodeId(variable));
        const init = getNodeInit(variable);
        if (name && init) {
          declarations.set(name, init);
        }
      }
    } else {
      const name = identifierName(getNodeId(declaration));
      if (name) {
        declarations.set(name, declaration);
      }
    }
  }
  return declarations;
};

export interface ModuleSource {
  ast: AstNode;
  path: string;
}
interface Binding {
  module: ModuleSource;
  node: AstNode;
}
export const imports = (module: ModuleSource) =>
  getNodeBodyStatements(module.ast).filter(
    (node) => node.type === 'ImportDeclaration'
  );

const exportedDeclaration = (
  module: ModuleSource,
  name: string
): AstNode | undefined => {
  const locals = collectModuleDeclarations(module.ast);
  for (const statement of getNodeBodyStatements(module.ast)) {
    if (
      statement.type !== 'ExportNamedDeclaration' ||
      getNodeSource(statement)
    ) {
      continue;
    }
    const declaration = getNodeDeclaration(statement);
    if (declaration) {
      if (identifierName(getNodeId(declaration)) === name) {
        return declaration;
      }
      for (const variable of getNodeDeclarations(declaration)) {
        if (identifierName(getNodeId(variable)) === name) {
          return getNodeInit(variable);
        }
      }
    }
    for (const specifier of getNodeSpecifiers(statement)) {
      // Export specifiers expose their local and exported names through the same curated fields.
      const exported = identifierName(getNodeExported(specifier));
      if (exported === name) {
        return locals.get(identifierName(getNodeLocal(specifier)) ?? '');
      }
    }
  }
  return undefined;
};

/** Resolve a direct local or named relative import without following re-export chains. */
export const createDirectBindingResolver = () => {
  const files = new Map<string, ModuleSource | null>();
  const load = (
    sourcePath: string,
    owner: ModuleSource
  ): ModuleSource | null => {
    const target = resolveRelativeImportPath(sourcePath, owner.path);
    if (!target) {
      return null;
    }
    if (files.has(target)) {
      return files.get(target) ?? null;
    }
    try {
      const tree = parse(target, readFileSync(target, 'utf8'));
      const module = tree ? { ast: tree, path: target } : null;
      files.set(target, module);
      return module;
    } catch {
      files.set(target, null);
      return null;
    }
  };
  const binding = (module: ModuleSource, name: string): Binding | null => {
    const local = collectModuleDeclarations(module.ast).get(name);
    if (local) {
      return { module, node: local };
    }
    for (const declaration of imports(module)) {
      for (const specifier of getNodeSpecifiers(declaration)) {
        if (
          specifier.type !== 'ImportSpecifier' ||
          identifierName(getNodeLocal(specifier)) !== name
        ) {
          continue;
        }
        const origin = getNodeValue(getNodeSource(declaration));
        const imported = identifierName(getNodeImported(specifier));
        const target = typeof origin === 'string' ? load(origin, module) : null;
        const node =
          target && imported
            ? exportedDeclaration(target, imported)
            : undefined;
        if (target && node) {
          return { module: target, node };
        }
      }
    }
    return null;
  };
  return binding;
};
