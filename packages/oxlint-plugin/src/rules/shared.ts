import type {
  Context,
  CreateRule,
  DiagnosticData,
  Ranged,
} from '@oxlint/plugins';

export type RuleContext = Context;
export type RuleModule = CreateRule;

const PACKAGES_SRC_PATTERN = /(?:^|\/)packages\/[^/]+\/src\//u;
const PACKAGE_NAME_PATTERN = /(?:^|\/)packages\/([^/]+)\/src\//u;
const TEST_FILE_PATTERN = /(?:^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/u;
const TEMPLATE_FILE_PATTERN = /\.template\.[cm]?[jt]sx?$/u;

interface NodeWithType {
  readonly type: string;
}

interface MemberExpressionNode extends NodeWithType {
  readonly object: unknown;
  readonly property: unknown;
  readonly type: 'MemberExpression';
}

interface CallExpressionNode extends NodeWithType {
  readonly arguments?: readonly unknown[];
  readonly callee: unknown;
  readonly type: 'CallExpression';
}

interface ChainExpressionNode extends NodeWithType {
  readonly expression: unknown;
  readonly type: 'ChainExpression';
}

export const normalizeFilePath = (filePath: string): string =>
  filePath.replaceAll('\\', '/');

export const isPackageSourceFile = (filePath: string | undefined): boolean => {
  if (!filePath) {
    return false;
  }

  const normalized = normalizeFilePath(filePath);

  if (!PACKAGES_SRC_PATTERN.test(normalized)) {
    return false;
  }

  if (TEST_FILE_PATTERN.test(normalized)) {
    return false;
  }

  return !TEMPLATE_FILE_PATTERN.test(normalized);
};

export const extractPackageName = (
  filePath: string | undefined
): string | undefined => {
  if (!filePath) {
    return undefined;
  }

  return normalizeFilePath(filePath).match(PACKAGE_NAME_PATTERN)?.[1];
};

export const resolveAllowedPackages = (
  options: readonly unknown[]
): ReadonlySet<string> => {
  const allowedPackages = (
    options[0] as { allowedPackages?: unknown } | undefined
  )?.allowedPackages;

  if (!Array.isArray(allowedPackages)) {
    return new Set();
  }

  return new Set(
    allowedPackages.filter(
      (packageName): packageName is string => typeof packageName === 'string'
    )
  );
};

export const isAllowedPackage = (context: RuleContext): boolean => {
  const packageName = extractPackageName(context.filename);
  return (
    typeof packageName === 'string' &&
    resolveAllowedPackages(context.options).has(packageName)
  );
};

export const asIdentifierName = (value: unknown): string | undefined => {
  if (!(value && typeof value === 'object')) {
    return undefined;
  }

  if ((value as { type?: unknown }).type !== 'Identifier') {
    return undefined;
  }

  const { name } = value as { name?: unknown };
  return typeof name === 'string' ? name : undefined;
};

export const asLiteralString = (value: unknown): string | undefined => {
  if (!(value && typeof value === 'object')) {
    return undefined;
  }

  if ((value as { type?: unknown }).type !== 'Literal') {
    return undefined;
  }

  const literalValue = (value as { value?: unknown }).value;
  return typeof literalValue === 'string' ? literalValue : undefined;
};

const asNodeWithType = (value: unknown): NodeWithType | undefined => {
  if (!(value && typeof value === 'object')) {
    return undefined;
  }

  const { type } = value as { type?: unknown };
  return typeof type === 'string' ? (value as NodeWithType) : undefined;
};

const asCallExpression = (value: unknown): CallExpressionNode | undefined => {
  const node = asNodeWithType(value);
  return node?.type === 'CallExpression'
    ? (value as CallExpressionNode)
    : undefined;
};

const asMemberExpression = (
  value: unknown
): MemberExpressionNode | undefined => {
  const node = asNodeWithType(value);
  return node?.type === 'MemberExpression'
    ? (value as MemberExpressionNode)
    : undefined;
};

const unwrapChainExpression = (value: unknown): unknown => {
  const node = asNodeWithType(value);
  return node?.type === 'ChainExpression'
    ? (value as ChainExpressionNode).expression
    : value;
};

export const matchesMemberExpression = ({
  node,
  objectName,
  propertyName,
}: {
  readonly node: unknown;
  readonly objectName: string;
  readonly propertyName?: string;
}): boolean => {
  const memberExpression = asMemberExpression(unwrapChainExpression(node));

  if (!memberExpression) {
    return false;
  }

  if (asIdentifierName(memberExpression.object) !== objectName) {
    return false;
  }

  if (!propertyName) {
    return true;
  }

  return (
    asIdentifierName(memberExpression.property) === propertyName ||
    asLiteralString(memberExpression.property) === propertyName
  );
};

export const invokesMemberCall = ({
  node,
  objectName,
  propertyName,
}: {
  readonly node: unknown;
  readonly objectName: string;
  readonly propertyName?: string;
}): boolean => {
  const callExpression = asCallExpression(node);

  if (!callExpression) {
    return false;
  }

  if (typeof propertyName === 'string') {
    return matchesMemberExpression({
      node: callExpression.callee,
      objectName,
      propertyName,
    });
  }

  return matchesMemberExpression({
    node: callExpression.callee,
    objectName,
  });
};

export const getImportSourceFromImportDeclaration = (
  node: unknown
): string | undefined => {
  if (!(node && typeof node === 'object')) {
    return undefined;
  }

  if ((node as { type?: unknown }).type !== 'ImportDeclaration') {
    return undefined;
  }

  return asLiteralString((node as { source?: unknown }).source);
};

export const getImportSourceFromReExportDeclaration = (
  node: unknown
): string | undefined => {
  if (!(node && typeof node === 'object')) {
    return undefined;
  }

  const { type } = node as { type?: unknown };

  if (type !== 'ExportNamedDeclaration' && type !== 'ExportAllDeclaration') {
    return undefined;
  }

  return asLiteralString((node as { source?: unknown }).source);
};

export const getImportSourceFromRequire = (
  node: unknown
): string | undefined => {
  const callExpression = asCallExpression(node);

  if (!callExpression) {
    return undefined;
  }

  if (asIdentifierName(callExpression.callee) !== 'require') {
    return undefined;
  }

  return asLiteralString(callExpression.arguments?.[0]);
};

export const reportNode = ({
  context,
  data,
  messageId,
  node,
}: {
  readonly context: RuleContext;
  readonly data?: DiagnosticData;
  readonly messageId: string;
  readonly node: unknown;
}): void => {
  if (data) {
    context.report({
      data,
      messageId,
      node: node as Ranged,
    });
    return;
  }

  context.report({
    messageId,
    node: node as Ranged,
  });
};
