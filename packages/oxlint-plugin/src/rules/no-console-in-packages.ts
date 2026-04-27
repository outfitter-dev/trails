import {
  invokesMemberCall,
  isAllowedPackage,
  isPackageSourceFile,
  reportNode,
} from './shared.js';
import type { RuleModule } from './shared.js';

export const noConsoleInPackagesRule: RuleModule = {
  create(context) {
    if (!isPackageSourceFile(context.filename) || isAllowedPackage(context)) {
      return {};
    }

    return {
      CallExpression(node) {
        if (!invokesMemberCall({ node, objectName: 'console' })) {
          return;
        }

        reportNode({
          context,
          messageId: 'noConsoleInPackages',
          node,
        });
      },
    };
  },
  meta: {
    docs: {
      description:
        'Disallow console.* calls in packages/*/src source files except configured package boundaries.',
      recommended: true,
    },
    messages: {
      noConsoleInPackages:
        'Avoid console.* in packages source. Route diagnostics through the Trails logging surface or an explicit sink boundary.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          allowedPackages: {
            description:
              'Directory names under packages/ that are allowed to write to console.*.',
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
