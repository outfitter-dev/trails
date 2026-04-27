import {
  isAllowedPackage,
  isPackageSourceFile,
  matchesMemberExpression,
  reportNode,
} from './shared.js';
import type { RuleModule } from './shared.js';

export const noProcessEnvInPackagesRule: RuleModule = {
  create(context) {
    if (!isPackageSourceFile(context.filename) || isAllowedPackage(context)) {
      return {};
    }

    return {
      MemberExpression(node) {
        if (
          !matchesMemberExpression({
            node,
            objectName: 'process',
            propertyName: 'env',
          })
        ) {
          return;
        }

        reportNode({
          context,
          messageId: 'noProcessEnvInPackages',
          node,
        });
      },
    };
  },
  meta: {
    docs: {
      description:
        'Warn on process.env usage in packages/*/src except configured environment seams.',
      recommended: true,
    },
    messages: {
      noProcessEnvInPackages:
        'Avoid direct process.env access in package source. Use @ontrails/config, TrailContext env, or explicit dependency injection.',
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          allowedPackages: {
            description:
              'Directory names under packages/ that are allowed to read process.env at boundary seams.',
            items: { type: 'string' },
            type: 'array',
            uniqueItems: true,
          },
        },
        type: 'object',
      },
    ],
    type: 'suggestion',
  },
};
