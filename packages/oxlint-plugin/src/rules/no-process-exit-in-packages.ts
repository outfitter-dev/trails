import {
  invokesMemberCall,
  isAllowedPackageOrAdapter,
  isPackageOrAdapterSourceFile,
  reportNode,
} from './shared.js';
import type { RuleModule } from './shared.js';

export const noProcessExitInPackagesRule: RuleModule = {
  create(context) {
    if (
      !isPackageOrAdapterSourceFile(context.filename) ||
      isAllowedPackageOrAdapter(context)
    ) {
      return {};
    }

    return {
      CallExpression(node) {
        if (
          !invokesMemberCall({
            node,
            objectName: 'process',
            propertyName: 'exit',
          })
        ) {
          return;
        }

        reportNode({
          context,
          messageId: 'noProcessExitInPackages',
          node,
        });
      },
    };
  },
  meta: {
    docs: {
      description:
        'Disallow process.exit() in package source except configured surface boundaries.',
      recommended: true,
    },
    messages: {
      noProcessExitInPackages:
        'Do not call process.exit() in package source. Return a Result or error value and let the surface boundary choose the exit code.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          allowedPackages: {
            description:
              'Directory names under packages/ or adapters/ that own process-exit surface boundaries.',
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
