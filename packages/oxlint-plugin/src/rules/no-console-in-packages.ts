import {
  invokesMemberCall,
  isAllowedPackageOrAdapter,
  isPackageOrAdapterSourceFile,
  reportNode,
} from './shared.js';
import type { RuleModule } from './shared.js';

export const noConsoleInPackagesRule: RuleModule = {
  create(context) {
    if (
      !isPackageOrAdapterSourceFile(context.filename) ||
      isAllowedPackageOrAdapter(context)
    ) {
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
        'Disallow console.* calls in packages/*/src and adapters/*/src source files except configured boundaries.',
      recommended: true,
    },
    messages: {
      noConsoleInPackages:
        'Avoid console.* in packages source. Send diagnostics through the Trails logging surface or an explicit sink boundary.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          allowedPackages: {
            description:
              'Directory names under packages/ or adapters/ that are allowed to write to console.*.',
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
