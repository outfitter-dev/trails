import {
  asIdentifierName,
  invokesMemberCall,
  normalizeFilePath,
  reportNode,
} from './shared.js';
import type { RuleModule } from './shared.js';

const DEFAULT_SCOPED_PATHS = ['apps/trails/src/trails/'] as const;
const TEST_FILE_PATTERN = /(?:^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/u;

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

const getDirectCallName = (node: unknown): string | undefined => {
  if (!(node && typeof node === 'object')) {
    return undefined;
  }

  if ((node as { type?: unknown }).type !== 'CallExpression') {
    return undefined;
  }

  const callName = asIdentifierName((node as { callee?: unknown }).callee);
  return callName && DIRECT_WRITE_CALLS.has(callName) ? callName : undefined;
};

const getMemberWriteCallName = (node: unknown): string | undefined => {
  for (const [objectName, propertyName] of MEMBER_WRITE_CALLS) {
    if (invokesMemberCall({ node, objectName, propertyName })) {
      return `${objectName}.${propertyName}`;
    }
  }

  return undefined;
};

const getWriteCallName = (node: unknown): string | undefined =>
  getMemberWriteCallName(node) ?? getDirectCallName(node);

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

    return {
      CallExpression(node) {
        const callName = getWriteCallName(node);

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
