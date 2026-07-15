import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { intentValues } from '@ontrails/core';

import {
  getNodeExpression,
  getNodeId,
  getNodeInit,
  getNodeKey,
  getNodeProperties,
  getPropertyName,
  identifierName,
  offsetToLine,
  parse,
  walk,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'owner-render-parity';

const HTTP_METHOD_DERIVATION_PATH = resolve(
  fileURLToPath(new URL('../../../http/src/method.ts', import.meta.url))
);

const isTargetFile = (filePath: string): boolean =>
  resolve(filePath) === HTTP_METHOD_DERIVATION_PATH;

const unwrapExpression = (node: AstNode | undefined): AstNode | undefined => {
  let current = node;
  while (
    current &&
    [
      'ParenthesizedExpression',
      'TSAsExpression',
      'TSNonNullExpression',
      'TSSatisfiesExpression',
      'TSTypeAssertion',
    ].includes(current.type)
  ) {
    current = getNodeExpression(current);
  }
  return current;
};

interface IntentKeyMap {
  readonly keys: ReadonlySet<string>;
  readonly node: AstNode;
}

const findHttpMethodByIntentMap = (ast: AstNode): IntentKeyMap | null => {
  let found: IntentKeyMap | null = null;

  walk(ast, (node) => {
    if (found || node.type !== 'VariableDeclarator') {
      return;
    }

    const id = getNodeId(node);
    const init = getNodeInit(node);
    if (identifierName(id) !== 'httpMethodByIntent') {
      return;
    }

    const objectExpression = unwrapExpression(init);
    if (objectExpression?.type !== 'ObjectExpression') {
      found = { keys: new Set(), node };
      return;
    }

    const keys = new Set<string>();
    for (const property of getNodeProperties(objectExpression) ?? []) {
      if (property.type !== 'Property') {
        continue;
      }
      const key = getPropertyName(getNodeKey(property));
      if (key) {
        keys.add(key);
      }
    }

    found = { keys, node: objectExpression };
  });

  return found;
};

const buildMessage = (missing: string[], extra: string[]): string => {
  const details = [
    missing.length > 0 ? `missing owner intents: ${missing.join(', ')}` : '',
    extra.length > 0 ? `unknown intentKeyMap keys: ${extra.join(', ')}` : '',
  ].filter(Boolean);

  return [
    'owner-render-parity: httpMethodByIntent must cover the core intentValues owner vocabulary.',
    ...details,
  ].join(' ');
};

export const ownerRenderParity: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (!isTargetFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const intentKeyMap = findHttpMethodByIntentMap(ast);
    const ownerKeys = new Set<string>(intentValues);
    const derivedKeys = intentKeyMap?.keys ?? new Set<string>();
    const missing = [...ownerKeys]
      .filter((key) => !derivedKeys.has(key))
      .toSorted();
    const extra = [...derivedKeys]
      .filter((key) => !ownerKeys.has(key))
      .toSorted();

    if (intentKeyMap && missing.length === 0 && extra.length === 0) {
      return [];
    }

    const node = intentKeyMap?.node ?? ast;
    return [
      {
        filePath,
        line: offsetToLine(sourceCode, node.start),
        message: intentKeyMap
          ? buildMessage(missing, extra)
          : 'owner-render-parity: expected httpMethodByIntent to render core intentValues.',
        rule: RULE_NAME,
        severity: 'error',
      },
    ];
  },
  description:
    'Require owner-derived intentKeyMap maps to cover their authoritative owner vocabulary.',
  name: RULE_NAME,
  severity: 'error',
};
