import {
  asIdentifierName,
  asLiteralString,
  getImportSourceFromImportDeclaration,
  getImportSourceFromRequire,
  invokesMemberCall,
  normalizeFilePath,
  reportNode,
} from './shared.js';
import type { RuleModule } from './shared.js';

const DEFAULT_SCOPED_PATHS = ['apps/trails/src/trails/'] as const;
const TEST_FILE_PATTERN = /(?:^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/u;
const FS_IMPORT_SOURCES = new Set([
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
]);
const FS_BASE_IMPORT_SOURCES = new Set(['fs', 'node:fs']);
const FS_PROMISES_EXPORT = 'promises';

const MEMBER_WRITE_CALLS = [
  ['Bun', 'write'],
  ['fs', 'cp'],
  ['fs', 'cpSync'],
  ['fs', 'copyFile'],
  ['fs', 'copyFileSync'],
  ['fs', 'mkdir'],
  ['fs', 'mkdirSync'],
  ['fs', 'rename'],
  ['fs', 'renameSync'],
  ['fs', 'rm'],
  ['fs', 'rmSync'],
  ['fs', 'writeFile'],
  ['fs', 'writeFileSync'],
] as const;

const DIRECT_WRITE_CALLS = new Set([
  'cp',
  'cpSync',
  'copyFile',
  'copyFileSync',
  'mkdir',
  'mkdirSync',
  'rename',
  'renameSync',
  'rm',
  'rmSync',
  'writeFile',
  'writeFileSync',
]);

const isFsImportSource = (source: string | undefined): boolean =>
  typeof source === 'string' && FS_IMPORT_SOURCES.has(source);

const getImportedBindingName = (specifier: unknown): string | undefined => {
  if (!(specifier && typeof specifier === 'object')) {
    return undefined;
  }

  const { local, imported, type } = specifier as {
    imported?: unknown;
    local?: unknown;
    type?: unknown;
  };

  if (type !== 'ImportSpecifier') {
    return undefined;
  }

  const importedName =
    asIdentifierName(imported) ?? asLiteralString(imported) ?? undefined;

  if (!(importedName && DIRECT_WRITE_CALLS.has(importedName))) {
    return undefined;
  }

  return asIdentifierName(local) ?? importedName;
};

const getFsNamespaceBindingName = (specifier: unknown): string | undefined => {
  if (!(specifier && typeof specifier === 'object')) {
    return undefined;
  }

  const { local, type } = specifier as { local?: unknown; type?: unknown };

  return type === 'ImportNamespaceSpecifier' ||
    type === 'ImportDefaultSpecifier'
    ? asIdentifierName(local)
    : undefined;
};

const getImportedFsPromisesNamespaceName = (
  specifier: unknown,
  importSource: string | undefined
): string | undefined => {
  if (
    !(importSource && FS_BASE_IMPORT_SOURCES.has(importSource)) ||
    !(specifier && typeof specifier === 'object')
  ) {
    return undefined;
  }

  const { local, imported, type } = specifier as {
    imported?: unknown;
    local?: unknown;
    type?: unknown;
  };

  if (type !== 'ImportSpecifier') {
    return undefined;
  }

  const importedName =
    asIdentifierName(imported) ?? asLiteralString(imported) ?? undefined;

  return importedName === FS_PROMISES_EXPORT
    ? (asIdentifierName(local) ?? importedName)
    : undefined;
};

const collectFsImportBindings = ({
  directWriteBindings,
  fsNamespaceBindings,
  node,
}: {
  readonly directWriteBindings: Set<string>;
  readonly fsNamespaceBindings: Set<string>;
  readonly node: unknown;
}): void => {
  const importSource = getImportSourceFromImportDeclaration(node);
  if (!isFsImportSource(importSource)) {
    return;
  }

  const { specifiers } = node as { specifiers?: unknown };

  if (!Array.isArray(specifiers)) {
    return;
  }

  for (const specifier of specifiers) {
    const directBinding = getImportedBindingName(specifier);
    if (directBinding) {
      directWriteBindings.add(directBinding);
      continue;
    }

    const importedPromisesNamespace = getImportedFsPromisesNamespaceName(
      specifier,
      importSource
    );
    if (importedPromisesNamespace) {
      fsNamespaceBindings.add(importedPromisesNamespace);
      continue;
    }

    const namespaceBinding = getFsNamespaceBindingName(specifier);
    if (namespaceBinding) {
      fsNamespaceBindings.add(namespaceBinding);
    }
  }
};

const asObjectPatternProperties = (
  value: unknown
): readonly unknown[] | undefined => {
  if (!(value && typeof value === 'object')) {
    return undefined;
  }

  const { properties, type } = value as {
    properties?: unknown;
    type?: unknown;
  };

  return type === 'ObjectPattern' && Array.isArray(properties)
    ? properties
    : undefined;
};

const collectFsObjectPatternBinding = ({
  directWriteBindings,
  fsNamespaceBindings,
  importSource,
  property,
}: {
  readonly directWriteBindings: Set<string>;
  readonly fsNamespaceBindings: Set<string>;
  readonly importSource: string;
  readonly property: unknown;
}): void => {
  if (!(property && typeof property === 'object')) {
    return;
  }

  const { key, type, value } = property as {
    key?: unknown;
    type?: unknown;
    value?: unknown;
  };

  if (type !== 'Property') {
    return;
  }

  const importedName = asIdentifierName(key) ?? asLiteralString(key);
  const localName = asIdentifierName(value) ?? importedName;

  if (!(importedName && localName)) {
    return;
  }

  if (
    FS_BASE_IMPORT_SOURCES.has(importSource) &&
    importedName === FS_PROMISES_EXPORT
  ) {
    fsNamespaceBindings.add(localName);
    return;
  }

  if (DIRECT_WRITE_CALLS.has(importedName)) {
    directWriteBindings.add(localName);
  }
};

const collectFsRequireBindings = ({
  directWriteBindings,
  fsNamespaceBindings,
  node,
}: {
  readonly directWriteBindings: Set<string>;
  readonly fsNamespaceBindings: Set<string>;
  readonly node: unknown;
}): void => {
  if (!(node && typeof node === 'object')) {
    return;
  }

  const { id, init, type } = node as {
    id?: unknown;
    init?: unknown;
    type?: unknown;
  };

  if (type !== 'VariableDeclarator') {
    return;
  }

  const importSource = getImportSourceFromRequire(init);
  if (importSource === undefined || !isFsImportSource(importSource)) {
    return;
  }

  const namespaceBinding = asIdentifierName(id);
  if (namespaceBinding) {
    fsNamespaceBindings.add(namespaceBinding);
    return;
  }

  const properties = asObjectPatternProperties(id);
  if (!properties) {
    return;
  }

  for (const property of properties) {
    collectFsObjectPatternBinding({
      directWriteBindings,
      fsNamespaceBindings,
      importSource,
      property,
    });
  }
};

const resolveScopedPaths = (options: readonly unknown[]): readonly string[] => {
  const scopedPaths = (options[0] as { scopedPaths?: unknown } | undefined)
    ?.scopedPaths;

  if (!Array.isArray(scopedPaths)) {
    return DEFAULT_SCOPED_PATHS;
  }

  const normalizedPaths = scopedPaths.filter(
    (path): path is string => typeof path === 'string' && path.length > 0
  );

  return normalizedPaths.length > 0 ? normalizedPaths : DEFAULT_SCOPED_PATHS;
};

const isScopedFile = ({
  filePath,
  scopedPaths,
}: {
  readonly filePath: string | undefined;
  readonly scopedPaths: readonly string[];
}): boolean => {
  if (!filePath) {
    return false;
  }

  const normalized = normalizeFilePath(filePath);

  if (TEST_FILE_PATTERN.test(normalized)) {
    return false;
  }

  return scopedPaths.some((scopedPath) =>
    normalized.includes(normalizeFilePath(scopedPath))
  );
};

const getDirectCallName = (
  node: unknown,
  directWriteBindings: ReadonlySet<string>
): string | undefined => {
  if (!(node && typeof node === 'object')) {
    return undefined;
  }

  if ((node as { type?: unknown }).type !== 'CallExpression') {
    return undefined;
  }

  const callName = asIdentifierName((node as { callee?: unknown }).callee);
  return callName && directWriteBindings.has(callName) ? callName : undefined;
};

const getMemberWriteCallName = (
  node: unknown,
  fsNamespaceBindings: ReadonlySet<string>
): string | undefined => {
  for (const [defaultObjectName, propertyName] of MEMBER_WRITE_CALLS) {
    const objectNames =
      defaultObjectName === 'fs'
        ? fsNamespaceBindings
        : new Set([defaultObjectName]);

    for (const objectName of objectNames) {
      if (invokesMemberCall({ node, objectName, propertyName })) {
        return `${objectName}.${propertyName}`;
      }
    }
  }

  return undefined;
};

const getWriteCallName = (
  node: unknown,
  directWriteBindings: ReadonlySet<string>,
  fsNamespaceBindings: ReadonlySet<string>
): string | undefined =>
  getMemberWriteCallName(node, fsNamespaceBindings) ??
  getDirectCallName(node, directWriteBindings);

/**
 * Temporary TRL-575 audit rule.
 *
 * Delete after the framework write-path audit either routes these calls through
 * containment/plan/apply helpers or classifies the remaining call sites as
 * intentional framework boundaries.
 */
export const tempAuditDirectFrameworkWritesRule: RuleModule = {
  create(context) {
    const scopedPaths = resolveScopedPaths(context.options);

    if (!isScopedFile({ filePath: context.filename, scopedPaths })) {
      return {};
    }

    const directWriteBindings = new Set<string>();
    const fsNamespaceBindings = new Set<string>();

    return {
      CallExpression(node) {
        const callName = getWriteCallName(
          node,
          directWriteBindings,
          fsNamespaceBindings
        );

        if (!callName) {
          return;
        }

        reportNode({
          context,
          data: { callName },
          messageId: 'tempAuditDirectFrameworkWrites',
          node,
        });
      },
      ImportDeclaration(node) {
        collectFsImportBindings({
          directWriteBindings,
          fsNamespaceBindings,
          node,
        });
      },
      VariableDeclarator(node) {
        collectFsRequireBindings({
          directWriteBindings,
          fsNamespaceBindings,
          node,
        });
      },
    };
  },
  meta: {
    docs: {
      description:
        'Temporarily report direct filesystem writes in Trails framework trail code during TRL-575 audit discovery.',
      recommended: false,
    },
    messages: {
      tempAuditDirectFrameworkWrites:
        "Temporary TRL-575 audit: '{{callName}}' writes directly from framework trail code. Route writes through containment/plan/apply helpers or document this as an intentional boundary.",
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          scopedPaths: {
            description:
              'Path fragments where direct filesystem writes should be reported.',
            items: { type: 'string' },
            type: 'array',
            uniqueItems: true,
          },
        },
        type: 'object',
      },
    ],
    type: 'problem',
  },
};
