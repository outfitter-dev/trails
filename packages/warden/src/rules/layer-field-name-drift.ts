import { sep } from 'node:path';

import {
  getNodeCallee,
  getNodeId,
  getNodeInit,
  identifierName,
  offsetToLine,
  parse,
  walk,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'layer-field-name-drift';

const LEGACY_RESERVED_SET_NAMES = new Set(['META_FLAG_CANDIDATES']);

const normalizePath = (filePath: string): string =>
  filePath.split(sep).join('/');

const isSurfaceSourceFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return /(^|\/)packages\/(cli|http|mcp)\/src\//.test(normalized);
};

const isTestFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return (
    normalized.includes('/__tests__/') || /\.test\.[cm]?tsx?$/.test(normalized)
  );
};

const looksLikeLayerReservedNameSet = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    LEGACY_RESERVED_SET_NAMES.has(name) ||
    (lower.includes('layer') &&
      lower.includes('reserved') &&
      (lower.includes('name') || lower.includes('flag')))
  );
};

const isSetConstruction = (node: AstNode | undefined): boolean => {
  if (node?.type !== 'NewExpression') {
    return false;
  }
  const callee = getNodeCallee(node);
  return identifierName(callee) === 'Set';
};

const isLocalReservedSetInitializer = (node: AstNode | undefined): boolean =>
  node?.type === 'ArrayExpression' || isSetConstruction(node);

const buildDiagnostic = (
  sourceCode: string,
  filePath: string,
  node: AstNode,
  name: string
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, node.start),
  message: `layer-field-name-drift: surface-local reserved name set "${name}" can make layer input fields render differently across surfaces. Import LAYER_FIELD_RESERVED_NAMES from @ontrails/core instead.`,
  rule: RULE_NAME,
  severity: 'error',
});

export const layerFieldNameDrift: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (!isSurfaceSourceFile(filePath) || isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    walk(ast, (node) => {
      if (node.type !== 'VariableDeclarator') {
        return;
      }
      const id = getNodeId(node);
      const init = getNodeInit(node);
      const name = identifierName(id);
      if (
        name &&
        looksLikeLayerReservedNameSet(name) &&
        isLocalReservedSetInitializer(init)
      ) {
        diagnostics.push(buildDiagnostic(sourceCode, filePath, node, name));
      }
    });

    return diagnostics;
  },
  description:
    'Prevent surface-local reserved-name sets from drifting layer input field rendering across surfaces.',
  name: RULE_NAME,
  severity: 'error',
};
