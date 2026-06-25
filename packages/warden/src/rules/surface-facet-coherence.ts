import { matchesTrailPattern } from '@ontrails/core';

import {
  extractStringOrTemplateLiteral,
  findConfigProperty,
  getNodeArgument,
  getNodeElements,
  getNodeExpression,
  getNodeId,
  getNodeInit,
  getNodeKey,
  getNodeName,
  getNodeProperties,
  getNodeTypeAnnotation,
  getNodeValue,
  getNodeValueNode,
  getPropertyName,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'surface-facet-coherence';

interface FacetSelector {
  readonly facetId: string;
  readonly node: AstNode;
  readonly value: string;
}

const unwrapExpression = (node: AstNode | undefined): AstNode | undefined => {
  let current = node;
  while (
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSSatisfiesExpression'
  ) {
    current = getNodeExpression(current) ?? getNodeArgument(current);
  }
  return current;
};

const objectProperties = (node: AstNode): readonly AstNode[] =>
  node.type === 'ObjectExpression' ? (getNodeProperties(node) ?? []) : [];

const propertyValue = (property: AstNode): AstNode | undefined =>
  property.type === 'Property' ? getNodeValueNode(property) : undefined;

const literalBooleanValue = (node: AstNode | undefined): boolean | null => {
  if (node?.type !== 'Literal') {
    return null;
  }
  const value = getNodeValue(node);
  return typeof value === 'boolean' ? value : null;
};

const diagnostic = (
  sourceCode: string,
  filePath: string,
  node: AstNode,
  message: string
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, node.start),
  message,
  rule: RULE_NAME,
  severity: 'warn',
});

const isFacetDefinition = (node: AstNode): boolean =>
  node.type === 'ObjectExpression' &&
  findConfigProperty(node, 'trails') !== null;

const isFacetMapCandidate = (node: AstNode): boolean =>
  objectProperties(node).some((property) => {
    const value = unwrapExpression(propertyValue(property));
    return value !== undefined && isFacetDefinition(value);
  });

const isFacetMapBindingName = (name: string | null): boolean =>
  name !== null &&
  (name === 'facets' || name.endsWith('Facets') || name.endsWith('FacetMap'));

const hasFacetMapTypeAnnotation = (
  sourceCode: string,
  node: AstNode
): boolean => {
  const typeAnnotation = getNodeTypeAnnotation(node);
  return (
    typeAnnotation !== undefined &&
    /\b(?:McpSurfaceFacetMap|TopoGraphFacetDeclaration|FacetMap)\b/.test(
      sourceCode.slice(typeAnnotation.start, typeAnnotation.end)
    )
  );
};

const selectorNodes = (trailsNode: AstNode): readonly AstNode[] | null => {
  const value = unwrapExpression(trailsNode);
  if (!value) {
    return null;
  }
  if (value.type === 'ArrayExpression') {
    return getNodeElements(value).filter((element) => element !== null);
  }
  return [value];
};

const collectLiteralSelectors = (
  sourceCode: string,
  filePath: string,
  facetId: string,
  trailsProp: AstNode,
  diagnostics: WardenDiagnostic[]
): readonly FacetSelector[] => {
  const trailsValue = propertyValue(trailsProp);
  const nodes = trailsValue ? selectorNodes(trailsValue) : null;
  if (nodes === null || nodes.length === 0) {
    diagnostics.push(
      diagnostic(
        sourceCode,
        filePath,
        trailsProp,
        `Surface facet "${facetId}" uses a dynamic trails selector. Keep facet selectors as string literals so Warden can check overlap and drift.`
      )
    );
    return [];
  }

  const selectors: FacetSelector[] = [];
  for (const node of nodes) {
    const selectorValue = extractStringOrTemplateLiteral(node);
    if (selectorValue === null) {
      diagnostics.push(
        diagnostic(
          sourceCode,
          filePath,
          node,
          `Surface facet "${facetId}" uses a dynamic trails selector. Keep facet selectors as string literals so Warden can check overlap and drift.`
        )
      );
      continue;
    }
    selectors.push({ facetId, node, value: selectorValue });
  }
  return selectors;
};

const hasNonEmptyDescription = (definition: AstNode): boolean => {
  const descriptionProp = findConfigProperty(definition, 'description');
  const value = unwrapExpression(propertyValue(descriptionProp ?? definition));
  const description = extractStringOrTemplateLiteral(value);
  return typeof description === 'string' && description.trim().length > 0;
};

const literalStringProperty = (
  definition: AstNode,
  propertyName: string
): string | null => {
  const prop = findConfigProperty(definition, propertyName);
  if (!prop) {
    return null;
  }
  return extractStringOrTemplateLiteral(unwrapExpression(propertyValue(prop)));
};

const literalBooleanProperty = (
  definition: AstNode,
  propertyName: string
): boolean | null => {
  const prop = findConfigProperty(definition, propertyName);
  if (!prop) {
    return null;
  }
  return literalBooleanValue(unwrapExpression(propertyValue(prop)));
};

const selectorsMayOverlap = (
  first: FacetSelector,
  second: FacetSelector
): boolean =>
  first.value === second.value ||
  matchesTrailPattern(first.value, second.value) ||
  matchesTrailPattern(second.value, first.value);

const diagnoseFacetDefinition = (
  sourceCode: string,
  filePath: string,
  facetId: string,
  definition: AstNode
): {
  readonly diagnostics: readonly WardenDiagnostic[];
  readonly selectors: readonly FacetSelector[];
} => {
  const diagnostics: WardenDiagnostic[] = [];
  const trailsProp = findConfigProperty(definition, 'trails');
  const selectors =
    trailsProp === null
      ? []
      : collectLiteralSelectors(
          sourceCode,
          filePath,
          facetId,
          trailsProp,
          diagnostics
        );

  if (!hasNonEmptyDescription(definition)) {
    diagnostics.push(
      diagnostic(
        sourceCode,
        filePath,
        definition,
        `Surface facet "${facetId}" needs a non-empty description so MCP clients and agents can choose it without guessing.`
      )
    );
  }

  const visibility = literalStringProperty(definition, 'visibility');
  const wideningAccepted = literalBooleanProperty(
    definition,
    'visibilityWideningAccepted'
  );
  if (visibility === 'public' && wideningAccepted !== true) {
    diagnostics.push(
      diagnostic(
        sourceCode,
        filePath,
        definition,
        `Surface facet "${facetId}" explicitly sets public visibility without visibilityWideningAccepted: true. Facets must not accidentally widen hidden trails.`
      )
    );
  }

  if (
    wideningAccepted === true &&
    !literalStringProperty(definition, 'descriptionStableThrough')
  ) {
    diagnostics.push(
      diagnostic(
        sourceCode,
        filePath,
        definition,
        `Surface facet "${facetId}" accepts visibility widening but does not record descriptionStableThrough review metadata.`
      )
    );
  }

  return { diagnostics, selectors };
};

const diagnoseFacetMap = (
  sourceCode: string,
  filePath: string,
  facetMap: AstNode
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const selectors: FacetSelector[] = [];

  for (const property of objectProperties(facetMap)) {
    const facetId = getPropertyName(getNodeKey(property));
    const value = unwrapExpression(propertyValue(property));
    if (!facetId || value === undefined || !isFacetDefinition(value)) {
      continue;
    }
    const result = diagnoseFacetDefinition(
      sourceCode,
      filePath,
      facetId,
      value
    );
    diagnostics.push(...result.diagnostics);
    selectors.push(...result.selectors);
  }

  for (let i = 0; i < selectors.length; i += 1) {
    const first = selectors[i];
    if (!first) {
      continue;
    }
    for (let j = i + 1; j < selectors.length; j += 1) {
      const second = selectors[j];
      if (
        !second ||
        first.facetId === second.facetId ||
        !selectorsMayOverlap(first, second)
      ) {
        continue;
      }
      diagnostics.push(
        diagnostic(
          sourceCode,
          filePath,
          second.node,
          `Surface facet selector "${second.value}" in "${second.facetId}" overlaps selector "${first.value}" in "${first.facetId}". Narrow one facet so each public trail has one MCP owner.`
        )
      );
    }
  }

  return diagnostics;
};

export const surfaceFacetCoherence: WardenRule = {
  check(sourceCode, filePath) {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const seen = new Set<number>();
    const diagnostics: WardenDiagnostic[] = [];
    const diagnoseCandidate = (node: AstNode | undefined): void => {
      const unwrapped = unwrapExpression(node);
      if (
        unwrapped === undefined ||
        unwrapped.type !== 'ObjectExpression' ||
        seen.has(unwrapped.start) ||
        !isFacetMapCandidate(unwrapped)
      ) {
        return;
      }
      seen.add(unwrapped.start);
      diagnostics.push(...diagnoseFacetMap(sourceCode, filePath, unwrapped));
    };

    walk(ast, (node) => {
      if (node.type === 'Property') {
        const propertyName = getPropertyName(getNodeKey(node));
        if (propertyName === 'facets') {
          diagnoseCandidate(propertyValue(node));
        }
        return;
      }

      if (node.type === 'VariableDeclarator') {
        const bindingName = getNodeName(getNodeId(node));
        if (
          typeof bindingName === 'string' &&
          isFacetMapBindingName(bindingName)
        ) {
          diagnoseCandidate(getNodeInit(node) ?? undefined);
        }
        return;
      }

      if (
        (node.type === 'TSAsExpression' ||
          node.type === 'TSSatisfiesExpression') &&
        hasFacetMapTypeAnnotation(sourceCode, node)
      ) {
        diagnoseCandidate(node);
      }
    });

    return diagnostics;
  },
  description:
    'Coach trailhead maps away from selector overlap, hidden visibility widening, and drift-prone dynamic selectors.',
  name: RULE_NAME,
  severity: 'warn',
};
