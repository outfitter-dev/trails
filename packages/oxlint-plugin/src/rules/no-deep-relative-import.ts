import {
  getImportSourceFromImportDeclaration,
  getImportSourceFromReExportDeclaration,
  getImportSourceFromRequire,
  isPackageSourceFile,
  reportNode,
} from './shared.js';
import type { RuleModule } from './shared.js';

interface RuleOption {
  readonly maxParentSegments?: number;
}

const DEFAULT_MAX_PARENT_SEGMENTS = 2;

const resolveMaxParentSegments = (options: readonly unknown[]): number => {
  const candidate = (options[0] as RuleOption | undefined)?.maxParentSegments;

  if (
    typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 0
  ) {
    return candidate;
  }

  return DEFAULT_MAX_PARENT_SEGMENTS;
};

const countLeadingParentSegments = (importSource: string): number => {
  let count = 0;

  for (const segment of importSource.split('/')) {
    if (segment !== '..') {
      break;
    }

    count += 1;
  }

  return count;
};

export const noDeepRelativeImportRule: RuleModule = {
  create(context) {
    if (!isPackageSourceFile(context.filename)) {
      return {};
    }

    const maxParentSegments = resolveMaxParentSegments(context.options);

    const reportIfDeepRelativeImport = (
      node: unknown,
      importSource: string | undefined
    ): void => {
      if (!importSource?.startsWith('..')) {
        return;
      }

      if (countLeadingParentSegments(importSource) <= maxParentSegments) {
        return;
      }

      reportNode({
        context,
        data: {
          importSource,
          maxParentSegments,
        },
        messageId: 'noDeepRelativeImport',
        node,
      });
    };

    return {
      CallExpression(node) {
        reportIfDeepRelativeImport(node, getImportSourceFromRequire(node));
      },
      ExportAllDeclaration(node) {
        reportIfDeepRelativeImport(
          node,
          getImportSourceFromReExportDeclaration(node)
        );
      },
      ExportNamedDeclaration(node) {
        reportIfDeepRelativeImport(
          node,
          getImportSourceFromReExportDeclaration(node)
        );
      },
      ImportDeclaration(node) {
        reportIfDeepRelativeImport(
          node,
          getImportSourceFromImportDeclaration(node)
        );
      },
    };
  },
  meta: {
    docs: {
      description:
        'Warn on deep relative imports in package source; prefer public package or local module boundaries.',
      recommended: true,
    },
    messages: {
      noDeepRelativeImport:
        "Deep relative import '{{importSource}}' exceeds max parent depth ({{maxParentSegments}}). Prefer @ontrails/* package imports or a nearer module boundary.",
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          maxParentSegments: {
            minimum: 0,
            type: 'integer',
          },
        },
        type: 'object',
      },
    ],
    type: 'suggestion',
  },
};
