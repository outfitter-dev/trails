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

export const createImportDeclarationNode = (importSource: string): unknown => ({
  source: {
    type: 'Literal',
    value: importSource,
  },
  type: 'ImportDeclaration',
});

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
  const listener = listeners[event];

  if (!listener) {
    return reports;
  }

  for (const node of nodes) {
    listener(node);
  }

  return reports;
};
