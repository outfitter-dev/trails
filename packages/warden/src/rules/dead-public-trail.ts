import {
  collectComposeTargetTrailIds,
  findConfigProperty,
  findTrailDefinitions,
  getStringValue,
  isStringLiteral,
  offsetToLine,
  parse,
  walkWithParents,
} from './ast.js';
import type { AstNode, AstParentContext } from './ast.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const RULE_NAME = 'dead-public-trail';

const isNonEmptyActivationValue = (onValue: AstNode): boolean => {
  if (onValue.type === 'Identifier') {
    return true;
  }
  if (onValue.type !== 'ArrayExpression') {
    return false;
  }
  const elements = onValue['elements'] as readonly AstNode[] | undefined;
  return (elements?.length ?? 0) > 0;
};

const hasOnActivation = (config: AstNode): boolean => {
  const onProp = findConfigProperty(config, 'on');
  const onValue = onProp?.value as AstNode | undefined;
  return onValue ? isNonEmptyActivationValue(onValue) : false;
};

const hasExplicitInternalVisibility = (config: AstNode): boolean => {
  const visibilityProp = findConfigProperty(config, 'visibility');
  const visibilityValue = visibilityProp?.value as AstNode | undefined;
  return (
    !!visibilityValue &&
    isStringLiteral(visibilityValue) &&
    getStringValue(visibilityValue) === 'internal'
  );
};

const hasLegacyMetaInternal = (config: AstNode): boolean => {
  const metaProp = findConfigProperty(config, 'meta');
  const metaValue = metaProp?.value as AstNode | undefined;
  if (!metaValue || metaValue.type !== 'ObjectExpression') {
    return false;
  }
  const internalProp = findConfigProperty(metaValue, 'internal');
  const internalValue = internalProp?.value as AstNode | undefined;
  return (
    internalValue?.type === 'BooleanLiteral' &&
    (internalValue as unknown as { value: boolean }).value === true
  );
};

const isInternalTrail = (config: AstNode): boolean =>
  hasExplicitInternalVisibility(config) || hasLegacyMetaInternal(config);

const isExportDeclaration = (node: AstNode | null | undefined): boolean =>
  node?.type === 'ExportNamedDeclaration' ||
  node?.type === 'ExportDefaultDeclaration';

const identifierName = (node: AstNode | undefined): string | null =>
  node?.type === 'Identifier'
    ? ((node as unknown as { name?: string }).name ?? null)
    : null;

const trailBindingStarts = (ast: AstNode): ReadonlyMap<string, number> => {
  const trailStarts = new Set(
    findTrailDefinitions(ast)
      .filter((definition) => definition.kind === 'trail')
      .map((definition) => definition.start)
  );
  const bindings = new Map<string, number>();

  walkWithParents(ast, (node: AstNode) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }
    const { id, init } = node as unknown as {
      id?: AstNode;
      init?: AstNode;
    };
    const name = identifierName(id);
    if (name && init && trailStarts.has(init.start)) {
      bindings.set(name, init.start);
    }
  });

  return bindings;
};

const addExportedSpecifierStarts = (
  node: AstNode,
  bindings: ReadonlyMap<string, number>,
  exported: Set<number>
): void => {
  const specifiers =
    (node as unknown as { specifiers?: readonly AstNode[] }).specifiers ?? [];
  for (const specifier of specifiers) {
    const { local } = specifier as unknown as { local?: AstNode };
    const name = identifierName(local);
    const start = name ? bindings.get(name) : undefined;
    if (start !== undefined) {
      exported.add(start);
    }
  }
};

const exportedTrailStarts = (ast: AstNode): ReadonlySet<number> => {
  const exported = new Set<number>();
  const bindings = trailBindingStarts(ast);

  walkWithParents(ast, (node: AstNode, context: AstParentContext) => {
    if (node.type !== 'CallExpression') {
      return;
    }

    // Catch `export default trail(...)`. Exported variable declarations are
    // handled by the VariableDeclaration walk below.
    if (isExportDeclaration(context.parent)) {
      exported.add(node.start);
    }
  });

  walkWithParents(ast, (node: AstNode, context: AstParentContext) => {
    if (node.type !== 'VariableDeclaration') {
      return;
    }
    if (!isExportDeclaration(context.parent)) {
      return;
    }
    const declarations =
      (node as unknown as { declarations?: readonly AstNode[] }).declarations ??
      [];
    for (const declaration of declarations) {
      const { init } = declaration as unknown as { init?: AstNode };
      if (init?.type === 'CallExpression') {
        exported.add(init.start);
      }
    }
  });

  walkWithParents(ast, (node: AstNode) => {
    if (node.type === 'ExportNamedDeclaration') {
      addExportedSpecifierStarts(node, bindings, exported);
      return;
    }

    if (node.type !== 'ExportDefaultDeclaration') {
      return;
    }
    const { declaration } = node as unknown as { declaration?: AstNode };
    const name = identifierName(declaration);
    const start = name ? bindings.get(name) : undefined;
    if (start !== undefined) {
      exported.add(start);
    }
  });

  return exported;
};

const buildDiagnostic = (
  trailId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Exported public trail "${trailId}" is not registered in a configured app topo, composed by another trail, or activated by on:. Anchor the contract in a topo, compose it, mark it internal, or remove the public export.`,
  rule: RULE_NAME,
  severity: 'warn',
});

const unionComposeTargetIds = (
  ast: AstNode | null,
  sourceCode: string,
  context: ProjectContext
): ReadonlySet<string> => {
  const local = ast
    ? collectComposeTargetTrailIds(ast, sourceCode)
    : new Set<string>();
  return context.composeTargetTrailIds
    ? new Set([...context.composeTargetTrailIds, ...local])
    : local;
};

const checkDeadPublicTrails = (
  ast: AstNode | null,
  sourceCode: string,
  filePath: string,
  context: ProjectContext
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath) || !ast || !context.topoTrailIds) {
    return [];
  }

  const exportedStarts = exportedTrailStarts(ast);
  const composeTargetTrailIds = unionComposeTargetIds(ast, sourceCode, context);
  const diagnostics: WardenDiagnostic[] = [];

  for (const def of findTrailDefinitions(ast)) {
    if (
      def.kind !== 'trail' ||
      isInternalTrail(def.config) ||
      !exportedStarts.has(def.start)
    ) {
      continue;
    }

    if (
      hasOnActivation(def.config) ||
      composeTargetTrailIds.has(def.id) ||
      context.topoTrailIds.has(def.id)
    ) {
      continue;
    }

    diagnostics.push(
      buildDiagnostic(def.id, filePath, offsetToLine(sourceCode, def.start))
    );
  }

  return diagnostics;
};

export const deadPublicTrail: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    return checkDeadPublicTrails(ast, sourceCode, filePath, {
      knownTrailIds: new Set<string>(),
    });
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    return checkDeadPublicTrails(
      parse(filePath, sourceCode),
      sourceCode,
      filePath,
      context
    );
  },
  description:
    'Warn when an exported public trail is neither registered in configured app topos nor reachable through composition or activation.',
  name: RULE_NAME,
  severity: 'warn',
};
