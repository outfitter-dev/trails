import { identifierName, offsetToLine, parse, walk } from './ast.js';
import { isFrameworkInternalFile } from './scan.js';
import type { AstNode } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'no-native-error-result';

const NATIVE_ERROR_CONSTRUCTORS = new Set([
  'AggregateError',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
]);

const getMemberPropertyName = (node: AstNode): string | null => {
  if (
    node.type !== 'MemberExpression' &&
    node.type !== 'StaticMemberExpression'
  ) {
    return null;
  }

  return identifierName((node as unknown as { property?: AstNode }).property);
};

const isResultObject = (node: AstNode | undefined): boolean => {
  if (!node) {
    return false;
  }

  if (identifierName(node) === 'Result') {
    return true;
  }

  return getMemberPropertyName(node) === 'Result';
};

const isResultErrCall = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }

  const { callee } = node as unknown as { callee?: AstNode };
  if (!callee || getMemberPropertyName(callee) !== 'err') {
    return false;
  }

  return isResultObject((callee as unknown as { object?: AstNode }).object);
};

const isNativeErrorConstruction = (node: AstNode | undefined): boolean => {
  if (!node || node.type !== 'NewExpression') {
    return false;
  }

  const constructorName = identifierName(
    (node as unknown as { callee?: AstNode }).callee
  );
  return constructorName
    ? NATIVE_ERROR_CONSTRUCTORS.has(constructorName)
    : false;
};

const getFirstArgument = (node: AstNode): AstNode | undefined =>
  (node as unknown as { arguments?: readonly AstNode[] }).arguments?.[0];

const createDiagnostic = (
  filePath: string,
  sourceCode: string,
  node: AstNode
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, node.start),
  message:
    'Use a specific TrailsError subclass with Result.err(...) instead of native Error.',
  rule: RULE_NAME,
  severity: 'error',
});

export const noNativeErrorResult: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isFrameworkInternalFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    walk(ast, (node) => {
      if (
        isResultErrCall(node) &&
        isNativeErrorConstruction(getFirstArgument(node))
      ) {
        diagnostics.push(createDiagnostic(filePath, sourceCode, node));
      }
    });

    return diagnostics;
  },
  description:
    'Require Result.err(...) calls to carry specific TrailsError subclasses instead of native Error.',
  name: RULE_NAME,
  severity: 'error',
};
