import { normalizeFilePath, reportNode } from './shared.js';
import type { RuleModule } from './shared.js';

const PACKAGE_SOURCE_PATTERN = /(?:^|\/)packages\/[^/]+\/src\/(.+)$/u;
const DEFAULT_MAX_DEPTH = 2;

interface RuleOption {
  readonly maxDepth?: number;
}

const resolveMaxDepth = (options: readonly unknown[]): number => {
  const candidate = (options[0] as RuleOption | undefined)?.maxDepth;

  if (
    typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 1
  ) {
    return candidate;
  }

  return DEFAULT_MAX_DEPTH;
};

const getBarrelDepth = (sourcePath: string): number =>
  sourcePath.split('/').length;

const isNestedPackageBarrel = (filePath: string, maxDepth: number): boolean => {
  const sourcePath = normalizeFilePath(filePath).match(
    PACKAGE_SOURCE_PATTERN
  )?.[1];

  if (!sourcePath) {
    return false;
  }

  if (!(sourcePath === 'index.ts' || sourcePath.endsWith('/index.ts'))) {
    return false;
  }

  return getBarrelDepth(sourcePath) > maxDepth;
};

export const noNestedBarrelRule: RuleModule = {
  create(context) {
    const maxDepth = resolveMaxDepth(context.options);

    return {
      Program(node) {
        if (!isNestedPackageBarrel(context.filename, maxDepth)) {
          return;
        }

        reportNode({
          context,
          messageId: 'noNestedBarrel',
          node,
        });
      },
    };
  },
  meta: {
    docs: {
      description:
        'Warn on package source barrel files deeper than the configured depth.',
      recommended: true,
    },
    messages: {
      noNestedBarrel:
        'Avoid deeply nested barrel files. Keep exports at packages/*/src/index.ts or a deliberate first-level subpath barrel.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          maxDepth: {
            description:
              'Maximum allowed barrel depth relative to src/. 1 = only src/index.ts, 2 = src/<dir>/index.ts, etc.',
            minimum: 1,
            type: 'integer',
          },
        },
        type: 'object',
      },
    ],
    type: 'suggestion',
  },
};
