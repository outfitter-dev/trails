import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type AdapterSourceExportExpectation = 'type' | 'value';

export type AdapterSourceExportKind =
  | 'interface-value'
  | 'interface-value-erased'
  | 'type'
  | 'type-alias-value'
  | 'type-alias-value-erased'
  | 'type-value'
  | 'type-value-erased'
  | 'value';

interface StarExportSpecifier {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

interface NamedExportSpecifier {
  readonly identifier: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

interface NamedImportSpecifier {
  readonly identifier: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

interface ExportListSpecifier {
  readonly exported: string;
  readonly local: string;
  readonly typeOnly: boolean;
}

type ImportKindResolver = (
  importSpecifier: NamedImportSpecifier
) => AdapterSourceExportKind | undefined;

export const adapterSourceExportKindHasType = (
  kind: AdapterSourceExportKind | undefined
): boolean =>
  kind === 'interface-value' ||
  kind === 'interface-value-erased' ||
  kind === 'type' ||
  kind === 'type-alias-value' ||
  kind === 'type-alias-value-erased' ||
  kind === 'type-value' ||
  kind === 'type-value-erased';

export const adapterSourceExportKindHasValue = (
  kind: AdapterSourceExportKind | undefined
): boolean =>
  kind === 'interface-value' ||
  kind === 'type-alias-value' ||
  kind === 'value' ||
  kind === 'type-value';

const eraseExportValue = (
  kind: AdapterSourceExportKind | undefined
): AdapterSourceExportKind | undefined => {
  if (kind === 'interface-value' || kind === 'interface-value-erased') {
    return 'interface-value-erased';
  }
  if (kind === 'type-alias-value' || kind === 'type-alias-value-erased') {
    return 'type-alias-value-erased';
  }
  if (kind === 'type-value' || kind === 'type-value-erased') {
    return 'type-value-erased';
  }
  return kind === 'type' ? 'type' : undefined;
};

const preferErasedExportKind = (
  current: AdapterSourceExportKind | undefined,
  candidate: AdapterSourceExportKind | undefined
): AdapterSourceExportKind | undefined => {
  const erasedCandidate = eraseExportValue(candidate);
  if (current === 'interface-value-erased' || !erasedCandidate) {
    return current;
  }
  if (erasedCandidate === 'interface-value-erased') {
    return erasedCandidate;
  }
  if (current === 'type-alias-value-erased') {
    return current;
  }
  if (erasedCandidate === 'type-alias-value-erased') {
    return erasedCandidate;
  }
  if (current === 'type-value-erased' || !erasedCandidate) {
    return current;
  }
  return erasedCandidate === 'type-value-erased'
    ? erasedCandidate
    : (current ?? erasedCandidate);
};

const combineExportKinds = (
  left: AdapterSourceExportKind | undefined,
  right: AdapterSourceExportKind | undefined
): AdapterSourceExportKind | undefined => {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const hasType =
    adapterSourceExportKindHasType(left) ||
    adapterSourceExportKindHasType(right);
  const hasValue =
    adapterSourceExportKindHasValue(left) ||
    adapterSourceExportKindHasValue(right);
  if (!hasValue) {
    return preferErasedExportKind(left, right);
  }
  if (!hasType) {
    return 'value';
  }
  if (left.startsWith('interface') || right.startsWith('interface')) {
    return 'interface-value';
  }
  if (left.startsWith('type-alias') || right.startsWith('type-alias')) {
    return 'type-alias-value';
  }
  return 'type-value';
};

const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const localDeclarationKind = (
  code: string,
  identifier: string,
  exportedOnly = false
): AdapterSourceExportKind | undefined => {
  const escapedIdentifier = escapeRegExp(identifier);
  const statementPrefix = '(?:^|[;\\n\\r])\\s*';
  const exportPrefix = exportedOnly
    ? `${statementPrefix}export\\s+`
    : `${statementPrefix}(?:export\\s+)?`;
  const valueDeclarationPattern = new RegExp(
    `${exportPrefix}(?!declare\\s+)(?:(?:async\\s+)?function|const|let|var)\\s+${escapedIdentifier}\\b`,
    'u'
  );
  const hasValueDeclaration = valueDeclarationPattern.test(code);

  const typeValueDeclarationPattern = new RegExp(
    `${exportPrefix}(?!declare\\s+)(?:abstract\\s+)?(?:class|enum)\\s+${escapedIdentifier}\\b`,
    'u'
  );
  if (typeValueDeclarationPattern.test(code)) {
    return 'type-value';
  }

  const interfaceDeclarationPattern = new RegExp(
    `${exportPrefix}(?:declare\\s+)?interface\\s+${escapedIdentifier}\\b`,
    'u'
  );
  const hasInterfaceDeclaration = interfaceDeclarationPattern.test(code);
  const typeAliasDeclarationPattern = new RegExp(
    `${exportPrefix}(?:declare\\s+)?type\\s+${escapedIdentifier}\\b`,
    'u'
  );
  const hasTypeAliasDeclaration = typeAliasDeclarationPattern.test(code);
  const hasTypeDeclaration = hasInterfaceDeclaration || hasTypeAliasDeclaration;
  if (hasValueDeclaration && hasInterfaceDeclaration) {
    return 'interface-value';
  }
  if (hasValueDeclaration && hasTypeAliasDeclaration) {
    return 'type-alias-value';
  }
  if (hasValueDeclaration && hasTypeDeclaration) {
    return 'type-value';
  }
  if (hasValueDeclaration) {
    return 'value';
  }
  return hasTypeDeclaration ? 'type' : undefined;
};

const maskDeadSourceText = (
  source: string,
  options: { strings: boolean }
): string => {
  const output = [...source];
  let index = 0;

  const maskRange = (start: number, end: number): void => {
    for (let cursor = start; cursor < end; cursor += 1) {
      if (output[cursor] !== '\n') {
        output[cursor] = ' ';
      }
    }
  };

  const skipQuoted = (quote: '"' | "'" | '`'): void => {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === quote) {
        index += 1;
        break;
      }
      index += 1;
    }
    if (options.strings) {
      maskRange(start, index);
    }
  };

  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2);
      const stop = end === -1 ? source.length : end;
      maskRange(index, stop);
      index = stop;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      maskRange(index, stop);
      index = stop;
      continue;
    }
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      skipQuoted(char);
      continue;
    }
    index += 1;
  }

  return output.join('');
};

const defaultExportKind = (
  source: string
): AdapterSourceExportKind | undefined => {
  const code = maskDeadSourceText(source, { strings: true });
  if (/\bexport\s+default\s+(?:async\s+)?function\*?\b/u.test(code)) {
    return 'value';
  }
  if (/\bexport\s+default\s+(?:abstract\s+)?(?:class|enum)\b/u.test(code)) {
    return 'type-value';
  }
  if (/\bexport\s+default\s+(?:interface|type)\b/u.test(code)) {
    return 'type';
  }

  const expressionIdentifier =
    /\bexport\s+default\s+(?<identifier>[A-Za-z_$][\w$]*)\b/u.exec(code)
      ?.groups?.['identifier'];
  if (expressionIdentifier) {
    return localDeclarationKind(code, expressionIdentifier) ?? 'value';
  }

  return /\bexport\s+default\b/u.test(code) ? 'value' : undefined;
};

const localDefaultImportSpecifier = (
  code: string,
  stringsMaskedCode: string,
  identifier: string
): NamedImportSpecifier | undefined => {
  const pattern =
    /\bimport\s+(?<importTypeOnly>type\s+)?(?<local>[A-Za-z_$][\w$]*)(?:\s*,\s*(?:\{[\s\S]*?\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s+from\s+['"](?<specifier>[^'"]+)['"]/gu;

  for (const match of code.matchAll(pattern)) {
    if (!stringsMaskedCode.startsWith('import', match.index ?? 0)) {
      continue;
    }
    if (match.groups?.['local'] !== identifier) {
      continue;
    }

    return {
      identifier: 'default',
      specifier: match.groups?.['specifier'] ?? '',
      typeOnly: Boolean(match.groups?.['importTypeOnly']),
    };
  }

  return undefined;
};

const parseNamedImportSpecifier = (
  item: string,
  declarationTypeOnly: boolean,
  specifier: string,
  identifier: string
): NamedImportSpecifier | undefined => {
  const trimmedItem = item.trim();
  if (!trimmedItem) {
    return undefined;
  }

  const itemTypeOnly = declarationTypeOnly || trimmedItem.startsWith('type ');
  const specifierText = trimmedItem.replace(/^type\s+/u, '');
  const imported =
    /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/u.exec(
      specifierText
    )?.groups;
  const local = imported?.['local'] ?? imported?.['imported'];
  const importedName = imported?.['imported'];
  if (local !== identifier || !importedName) {
    return undefined;
  }

  return {
    identifier: importedName,
    specifier,
    typeOnly: itemTypeOnly,
  };
};

const localNamedImportSpecifier = (
  source: string,
  identifier: string
): NamedImportSpecifier | undefined => {
  const code = maskDeadSourceText(source, { strings: false });
  const stringsMaskedCode = maskDeadSourceText(source, { strings: true });
  const defaultSpecifier = localDefaultImportSpecifier(
    code,
    stringsMaskedCode,
    identifier
  );
  if (defaultSpecifier) {
    return defaultSpecifier;
  }

  const pattern =
    /\bimport\s+(?<importTypeOnly>type\s+)?\{(?<imports>[\s\S]*?)\}\s+from\s+['"](?<specifier>[^'"]+)['"]/gu;

  for (const match of code.matchAll(pattern)) {
    if (!stringsMaskedCode.startsWith('import', match.index ?? 0)) {
      continue;
    }

    const declarationTypeOnly = Boolean(match.groups?.['importTypeOnly']);
    const namedImports = match.groups?.['imports'] ?? '';
    const specifier = match.groups?.['specifier'] ?? '';
    for (const item of namedImports.split(',')) {
      const namedSpecifier = parseNamedImportSpecifier(
        item,
        declarationTypeOnly,
        specifier,
        identifier
      );
      if (namedSpecifier) {
        return namedSpecifier;
      }
    }
  }

  return undefined;
};

const parseExportListSpecifier = (
  item: string,
  declarationTypeOnly: boolean
): ExportListSpecifier | undefined => {
  const trimmedItem = item.trim();
  if (!trimmedItem) {
    return undefined;
  }

  const typeOnly = declarationTypeOnly || trimmedItem.startsWith('type ');
  const specifierText = trimmedItem.replace(/^type\s+/u, '');
  const exported =
    /^(?<local>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<name>[A-Za-z_$][\w$]*))?$/u.exec(
      specifierText
    )?.groups;
  const local = exported?.['local'];
  if (!local) {
    return undefined;
  }

  return {
    exported: exported?.['name'] ?? local,
    local,
    typeOnly,
  };
};

const exportedLocalBindingKind = (
  source: string,
  code: string,
  local: string,
  resolveImportKind: ImportKindResolver
): AdapterSourceExportKind | undefined => {
  const localKind = localDeclarationKind(code, local);
  if (localKind) {
    return localKind;
  }

  const importSpecifier = localNamedImportSpecifier(source, local);
  if (!importSpecifier) {
    return undefined;
  }
  const importedKind = resolveImportKind(importSpecifier);
  return importSpecifier.typeOnly
    ? eraseExportValue(importedKind)
    : importedKind;
};

const namedExportKind = (
  source: string,
  identifier: string,
  resolveImportKind: ImportKindResolver
): AdapterSourceExportKind | undefined => {
  if (identifier === 'default') {
    const defaultKind = defaultExportKind(source);
    if (defaultKind) {
      return defaultKind;
    }
  }

  const stringsMaskedCode = maskDeadSourceText(source, { strings: true });
  const directKind = localDeclarationKind(stringsMaskedCode, identifier, true);
  if (directKind) {
    return directKind;
  }

  const exportCode = maskDeadSourceText(source, { strings: false });
  const exportListPattern =
    /\bexport\s+(?<typeOnly>type\s+)?\{(?<exports>[\s\S]*?)\}(?<from>\s+from\s+['"][^'"]+['"])?/gu;

  for (const match of exportCode.matchAll(exportListPattern)) {
    if (!stringsMaskedCode.startsWith('export', match.index ?? 0)) {
      continue;
    }
    if (match.groups?.['from']) {
      continue;
    }

    const declarationTypeOnly = Boolean(match.groups?.['typeOnly']);
    const namedExports = match.groups?.['exports'] ?? '';
    for (const item of namedExports.split(',')) {
      const exported = parseExportListSpecifier(item, declarationTypeOnly);
      if (exported?.exported !== identifier) {
        continue;
      }

      const localKind = exportedLocalBindingKind(
        source,
        stringsMaskedCode,
        exported.local,
        resolveImportKind
      );
      if (!localKind) {
        return undefined;
      }
      return exported.typeOnly ? eraseExportValue(localKind) : localKind;
    }
  }

  return undefined;
};

const starExportSpecifiers = (
  source: string
): readonly StarExportSpecifier[] => {
  const code = maskDeadSourceText(source, { strings: false });
  const stringsMaskedCode = maskDeadSourceText(source, { strings: true });
  return [
    ...code.matchAll(
      /\bexport\s+(?<typeOnly>type\s+)?\*\s+from\s+['"](?<specifier>[^'"]+)['"]/gu
    ),
  ]
    .filter((match) => stringsMaskedCode.startsWith('export', match.index ?? 0))
    .map((match) => ({
      specifier: match.groups?.['specifier'] ?? '',
      typeOnly: Boolean(match.groups?.['typeOnly']),
    }));
};

const namedExportSpecifiers = (
  source: string,
  identifier: string
): readonly NamedExportSpecifier[] => {
  const code = maskDeadSourceText(source, { strings: false });
  const stringsMaskedCode = maskDeadSourceText(source, { strings: true });
  const exports: NamedExportSpecifier[] = [];
  const pattern =
    /\bexport\s+(?<typeOnly>type\s+)?\{(?<exports>[\s\S]*?)\}\s+from\s+['"](?<specifier>[^'"]+)['"]/gu;

  for (const match of code.matchAll(pattern)) {
    if (!stringsMaskedCode.startsWith('export', match.index ?? 0)) {
      continue;
    }

    const specifier = match.groups?.['specifier'];
    if (!specifier?.startsWith('.')) {
      continue;
    }

    const declarationTypeOnly = Boolean(match.groups?.['typeOnly']);
    const namedExports = match.groups?.['exports'] ?? '';
    for (const item of namedExports.split(',')) {
      const trimmedItem = item.trim();
      if (!trimmedItem) {
        continue;
      }

      const itemTypeOnly =
        declarationTypeOnly || trimmedItem.startsWith('type ');
      const specifierText = trimmedItem.replace(/^type\s+/u, '');
      const exported =
        /^(?<local>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<name>[A-Za-z_$][\w$]*))?$/u.exec(
          specifierText
        )?.groups;
      const local = exported?.['local'];
      if (!local || (exported?.['name'] ?? local) !== identifier) {
        continue;
      }

      exports.push({
        identifier: local,
        specifier,
        typeOnly: itemTypeOnly,
      });
    }
  }

  return exports;
};

const resolveLocalModuleSpecifier = (
  sourcePath: string,
  specifier: string
): string | undefined => {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const basePath = resolve(dirname(sourcePath), specifier);
  const candidates = [
    basePath,
    basePath.endsWith('.js') ? `${basePath.slice(0, -3)}.ts` : undefined,
    basePath.endsWith('.js') ? `${basePath.slice(0, -3)}.tsx` : undefined,
    basePath.endsWith('.mjs') ? `${basePath.slice(0, -4)}.mts` : undefined,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ].filter((candidate): candidate is string => candidate !== undefined);

  return candidates.find((candidate) => existsSync(candidate));
};

const resolveAdapterSourceExportKind = (
  sourcePath: string,
  identifier: string,
  visited = new Set<string>()
): AdapterSourceExportKind | undefined => {
  const normalizedSourcePath = normalizeRealPath(sourcePath);
  const visitKey = `${normalizedSourcePath}:${identifier}`;
  if (visited.has(visitKey)) {
    return undefined;
  }
  visited.add(visitKey);

  let source: string;
  try {
    source = readFileSync(normalizedSourcePath, 'utf8');
  } catch {
    return undefined;
  }

  const directKind = namedExportKind(source, identifier, (importSpecifier) => {
    const importTarget = resolveLocalModuleSpecifier(
      normalizedSourcePath,
      importSpecifier.specifier
    );
    if (!importTarget) {
      return;
    }
    return resolveAdapterSourceExportKind(
      importTarget,
      importSpecifier.identifier,
      new Set(visited)
    );
  });
  let resolvedKind = directKind;
  for (const exportSpecifier of namedExportSpecifiers(source, identifier)) {
    const exportTarget = resolveLocalModuleSpecifier(
      normalizedSourcePath,
      exportSpecifier.specifier
    );
    if (!exportTarget) {
      continue;
    }

    const reexportedKind = resolveAdapterSourceExportKind(
      exportTarget,
      exportSpecifier.identifier,
      new Set(visited)
    );
    resolvedKind = combineExportKinds(
      resolvedKind,
      exportSpecifier.typeOnly
        ? eraseExportValue(reexportedKind)
        : reexportedKind
    );
  }

  if (resolvedKind !== undefined) {
    return resolvedKind;
  }

  for (const exportSpecifier of starExportSpecifiers(source)) {
    const exportTarget = resolveLocalModuleSpecifier(
      normalizedSourcePath,
      exportSpecifier.specifier
    );
    if (!exportTarget) {
      continue;
    }

    const reexportedKind = resolveAdapterSourceExportKind(
      exportTarget,
      identifier,
      new Set(visited)
    );
    resolvedKind = combineExportKinds(
      resolvedKind,
      exportSpecifier.typeOnly
        ? eraseExportValue(reexportedKind)
        : reexportedKind
    );
  }

  return resolvedKind;
};

/**
 * Inspect a local TypeScript source path for the kind of named export it
 * provides, following relative imports, named re-exports, and star re-exports.
 */
export const adapterSourceExportKind = (
  sourcePath: string,
  identifier: string
): AdapterSourceExportKind | undefined =>
  resolveAdapterSourceExportKind(sourcePath, identifier);

/**
 * Check whether a local TypeScript source path exports a named binding in the
 * expected type or runtime value position.
 */
export const adapterSourceExports = (
  sourcePath: string,
  identifier: string,
  expected: AdapterSourceExportExpectation
): boolean => {
  const exportKind = adapterSourceExportKind(sourcePath, identifier);
  return expected === 'type'
    ? adapterSourceExportKindHasType(exportKind)
    : adapterSourceExportKindHasValue(exportKind);
};
