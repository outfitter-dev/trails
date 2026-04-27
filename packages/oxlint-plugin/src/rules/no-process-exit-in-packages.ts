import {
  invokesMemberCall,
  isAllowedPackage,
  isPackageSourceFile,
  reportNode,
} from './shared.js';
import type { RuleModule } from './shared.js';

export const noProcessExitInPackagesRule: RuleModule = {
  create(context) {
    if (!isPackageSourceFile(context.filename) || isAllowedPackage(context)) {
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
        'Disallow process.exit() in packages/*/src except configured surface boundaries.',
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
              'Directory names under packages/ that own process-exit surface boundaries.',
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
