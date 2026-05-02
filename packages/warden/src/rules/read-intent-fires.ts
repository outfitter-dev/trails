import {
  buildSignalIdentifierResolver,
  deriveConstString,
  extractStringLiteral,
  findConfigProperty,
  findTrailDefinitions,
  getStringValue,
  identifierName,
  isStringLiteral,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode, SignalIdentifierResolver } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

interface DeclaredFireSummary {
  readonly count: number;
  readonly ids: readonly string[];
  readonly line: number;
}

const isReadIntent = (config: AstNode): boolean => {
  const intentProp = findConfigProperty(config, 'intent');
  const intentValue = intentProp?.value as AstNode | undefined;
  return isStringLiteral(intentValue) && getStringValue(intentValue) === 'read';
};

const collectArrayBindings = (ast: AstNode): ReadonlyMap<string, AstNode> => {
  const bindings = new Map<string, AstNode>();
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    const name = identifierName(id);
    if (name && init?.type === 'ArrayExpression') {
      bindings.set(name, init);
    }
  });
  return bindings;
};

const getFiresArray = (
  config: AstNode,
  arrayBindings: ReadonlyMap<string, AstNode>
): AstNode | null => {
  const firesProp = findConfigProperty(config, 'fires');
  const value = firesProp?.value as AstNode | undefined;
  if (value?.type === 'ArrayExpression') {
    return value;
  }

  const name = identifierName(value);
  return name ? (arrayBindings.get(name) ?? null) : null;
};

const getFiresElements = (
  config: AstNode,
  arrayBindings: ReadonlyMap<string, AstNode>
): readonly AstNode[] => {
  const array = getFiresArray(config, arrayBindings);
  if (!array) {
    return [];
  }

  return (
    (array as unknown as { readonly elements?: readonly (AstNode | null)[] })
      .elements ?? []
  ).filter((element): element is AstNode => element !== null);
};

const resolveFireElementId = (
  element: AstNode,
  sourceCode: string,
  signalIds: SignalIdentifierResolver
): string | null => {
  const literalValue = extractStringLiteral(element);
  if (literalValue !== null) {
    return literalValue;
  }

  if (element.type !== 'Identifier') {
    return null;
  }

  const resolved = signalIds.resolve(element);
  if (resolved.kind === 'signal' || resolved.kind === 'string') {
    return resolved.id;
  }

  const name = identifierName(element);
  return name ? deriveConstString(name, sourceCode) : null;
};

const summarizeDeclaredFires = (
  config: AstNode,
  arrayBindings: ReadonlyMap<string, AstNode>,
  sourceCode: string,
  signalIds: SignalIdentifierResolver
): DeclaredFireSummary | null => {
  const firesProp = findConfigProperty(config, 'fires');
  const elements = getFiresElements(config, arrayBindings);
  if (elements.length === 0) {
    return null;
  }

  const ids: string[] = [];
  for (const element of elements) {
    const resolved = resolveFireElementId(element, sourceCode, signalIds);
    if (resolved) {
      ids.push(resolved);
    }
  }

  const [firstElement] = elements;
  const lineNode = firesProp ?? firstElement;
  return {
    count: elements.length,
    ids,
    line: lineNode ? offsetToLine(sourceCode, lineNode.start) : 1,
  };
};

const formatSignalList = (summary: DeclaredFireSummary): string => {
  const named = summary.ids.map((id) => `"${id}"`);
  const unresolvedCount = summary.count - summary.ids.length;
  const unresolved =
    unresolvedCount > 0
      ? [
          unresolvedCount === 1
            ? '1 unresolved signal reference'
            : `${unresolvedCount} unresolved signal references`,
        ]
      : [];
  return [...named, ...unresolved].join(', ');
};

const buildDiagnostic = (
  trailId: string,
  summary: DeclaredFireSummary,
  filePath: string
): WardenDiagnostic => ({
  filePath,
  line: summary.line,
  message: `Trail "${trailId}" declares intent: 'read' but also declares fires: [${formatSignalList(summary)}]. Read trails should remain side-effect-free; change the trail intent or move ctx.fire behavior to an appropriate write trail.`,
  rule: 'read-intent-fires',
  severity: 'warn',
});

export const readIntentFires: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const signalIds = buildSignalIdentifierResolver(ast);
    const arrayBindings = collectArrayBindings(ast);
    return findTrailDefinitions(ast).flatMap((def) => {
      if (def.kind !== 'trail' || !isReadIntent(def.config)) {
        return [];
      }

      const summary = summarizeDeclaredFires(
        def.config,
        arrayBindings,
        sourceCode,
        signalIds
      );
      return summary ? [buildDiagnostic(def.id, summary, filePath)] : [];
    });
  },
  description:
    'Warn when read-intent trails declare signal fires side effects.',
  name: 'read-intent-fires',
  severity: 'warn',
};
