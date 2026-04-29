import type { Context, CreateRule } from '@oxlint/plugins';

export interface CapturedReport {
  readonly data?: Record<string, number | string>;
  readonly messageId: string;
  readonly node: unknown;
}

export const createCallExpressionNode = (
  objectName: string,
  propertyName: string
): unknown => ({
  callee: {
    object: {
      name: objectName,
      type: 'Identifier',
    },
    property: {
      name: propertyName,
      type: 'Identifier',
    },
    type: 'MemberExpression',
  },
  type: 'CallExpression',
});

export const createIdentifierCallNode = (callName: string): unknown => ({
  callee: {
    name: callName,
    type: 'Identifier',
  },
  type: 'CallExpression',
});

export const createMemberExpressionNode = (
  objectName: string,
  propertyName: string
): unknown => ({
  object: {
    name: objectName,
    type: 'Identifier',
  },
  property: {
    name: propertyName,
    type: 'Identifier',
  },
  type: 'MemberExpression',
});

export const createImportDeclarationNode = (
  importSource: string,
  specifiers: readonly unknown[] = []
): unknown => ({
  source: {
    type: 'Literal',
    value: importSource,
  },
  specifiers,
  type: 'ImportDeclaration',
});

export const createNamedImportDeclarationNode = (
  importSource: string,
  imports: readonly {
    readonly imported: string;
    readonly local?: string;
  }[]
): unknown =>
  createImportDeclarationNode(
    importSource,
    imports.map(({ imported, local }) => ({
      imported: {
        name: imported,
        type: 'Identifier',
      },
      local: {
        name: local ?? imported,
        type: 'Identifier',
      },
      type: 'ImportSpecifier',
    }))
  );

export const createNamespaceImportDeclarationNode = (
  importSource: string,
  localName: string
): unknown =>
  createImportDeclarationNode(importSource, [
    {
      local: {
        name: localName,
        type: 'Identifier',
      },
      type: 'ImportNamespaceSpecifier',
    },
  ]);

export const createExportDeclarationNode = (
  importSource: string,
  type:
    | 'ExportAllDeclaration'
    | 'ExportNamedDeclaration' = 'ExportNamedDeclaration'
): unknown => ({
  source: {
    type: 'Literal',
    value: importSource,
  },
  type,
});

export const createRequireCallNode = (importSource: string): unknown => ({
  arguments: [
    {
      type: 'Literal',
      value: importSource,
    },
  ],
  callee: {
    name: 'require',
    type: 'Identifier',
  },
  type: 'CallExpression',
});

export const createRequireBindingNode = (
  importSource: string,
  localName: string
): unknown => ({
  id: {
    name: localName,
    type: 'Identifier',
  },
  init: createRequireCallNode(importSource),
  type: 'VariableDeclarator',
});

export const createRequireObjectPatternBindingNode = (
  importSource: string,
  imports: readonly {
    readonly imported: string;
    readonly local?: string;
  }[]
): unknown => ({
  id: {
    properties: imports.map(({ imported, local }) => ({
      key: {
        name: imported,
        type: 'Identifier',
      },
      type: 'Property',
      value: {
        name: local ?? imported,
        type: 'Identifier',
      },
    })),
    type: 'ObjectPattern',
  },
  init: createRequireCallNode(importSource),
  type: 'VariableDeclarator',
});

export const runRuleForEvents = ({
  events,
  filename,
  options,
  rule,
}: {
  readonly events: readonly {
    readonly event: string;
    readonly nodes: readonly unknown[];
  }[];
  readonly filename: string;
  readonly options?: readonly unknown[];
  readonly rule: CreateRule;
}): readonly CapturedReport[] => {
  const reports: CapturedReport[] = [];

  const context = {
    filename,
    options: [...(options ?? [])],
    report(descriptor: {
      readonly data?: Record<string, number | string>;
      readonly messageId?: string;
      readonly node?: unknown;
    }) {
      reports.push({
        data: descriptor.data,
        messageId: descriptor.messageId ?? 'unknown',
        node: descriptor.node,
      });
    },
  } as unknown as Context;

  const listeners = rule.create(context) as Record<
    string,
    ((node: unknown) => void) | undefined
  >;
  for (const { event, nodes } of events) {
    const listener = listeners[event];

    if (!listener) {
      continue;
    }

    for (const node of nodes) {
      listener(node);
    }
  }

  return reports;
};

export const runRuleForEvent = ({
  event,
  filename,
  nodes,
  options,
  rule,
}: {
  readonly event: string;
  readonly filename: string;
  readonly nodes: readonly unknown[];
  readonly options?: readonly unknown[];
  readonly rule: CreateRule;
}): readonly CapturedReport[] =>
  runRuleForEvents({
    events: [{ event, nodes }],
    filename,
    options,
    rule,
  });
