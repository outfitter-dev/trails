import { asLiteralString, reportNode } from './shared.js';
import type { RuleModule } from './shared.js';

const DEFAULT_IMPORT_MAPPING: Record<string, string> = {
  'better-sqlite3': 'bun:sqlite',
  glob: 'Bun.Glob',
  semver: 'Bun.semver',
  uuid: 'Bun.randomUUIDv7()',
};

const resolveImportMapping = (
  options: readonly unknown[]
): Record<string, string> => {
  const customMappings = (options[0] as { mappings?: unknown } | undefined)
    ?.mappings;

  if (!(customMappings && typeof customMappings === 'object')) {
    return DEFAULT_IMPORT_MAPPING;
  }

  const customOverrides: Record<string, string> = {};
  const removedMappings = new Set<string>();

  for (const [importName, alternative] of Object.entries(customMappings)) {
    if (typeof alternative === 'string') {
      if (alternative === '') {
        removedMappings.add(importName);
        continue;
      }

      customOverrides[importName] = alternative;
      continue;
    }

    if (alternative === false || alternative === null) {
      removedMappings.add(importName);
    }
  }

  return Object.fromEntries(
    Object.entries({
      ...DEFAULT_IMPORT_MAPPING,
      ...customOverrides,
    }).filter(([importName]) => !removedMappings.has(importName))
  );
};

const getImportSource = (node: unknown): string | undefined => {
  if (!(node && typeof node === 'object')) {
    return undefined;
  }

  if ((node as { type?: unknown }).type !== 'ImportDeclaration') {
    return undefined;
  }

  return asLiteralString((node as { source?: unknown }).source);
};

const isTypeOnlyImport = (node: unknown): boolean => {
  if (!(node && typeof node === 'object')) {
    return false;
  }

  if ((node as { type?: unknown }).type !== 'ImportDeclaration') {
    return false;
  }

  if ((node as { importKind?: unknown }).importKind === 'type') {
    return true;
  }

  const { specifiers } = node as { specifiers?: readonly unknown[] };

  if (!(Array.isArray(specifiers) && specifiers.length > 0)) {
    return false;
  }

  return specifiers.every((specifier) => {
    if (!(specifier && typeof specifier === 'object')) {
      return false;
    }

    if ((specifier as { type?: unknown }).type !== 'ImportSpecifier') {
      return false;
    }

    return (specifier as { importKind?: unknown }).importKind === 'type';
  });
};

export const preferBunApiRule: RuleModule = {
  create(context) {
    const importMapping = resolveImportMapping(context.options);

    return {
      ImportDeclaration(node) {
        if (isTypeOnlyImport(node)) {
          return;
        }

        const importSource = getImportSource(node);

        if (!importSource) {
          return;
        }

        const bunAlternative = importMapping[importSource];

        if (!bunAlternative) {
          return;
        }

        reportNode({
          context,
          data: {
            bunAlternative,
            importName: importSource,
          },
          messageId: 'preferBunApi',
          node,
        });
      },
    };
  },
  meta: {
    docs: {
      description:
        'Suggest Bun-native APIs when mapped npm packages are imported.',
      recommended: true,
    },
    messages: {
      preferBunApi:
        "Prefer Bun-native API over '{{importName}}': {{bunAlternative}}.",
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          mappings: {
            additionalProperties: {
              anyOf: [{ type: 'string' }, { const: false }, { type: 'null' }],
            },
            type: 'object',
          },
        },
        type: 'object',
      },
    ],
    type: 'suggestion',
  },
};
