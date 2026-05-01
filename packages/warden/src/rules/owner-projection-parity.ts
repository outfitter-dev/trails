import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { intentValues } from '@ontrails/core';

import {
  getPropertyName,
  identifierName,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'owner-projection-parity';

const HTTP_METHOD_PROJECTION_PATH = resolve(
  fileURLToPath(new URL('../../../http/src/method.ts', import.meta.url))
);

const isTargetFile = (filePath: string): boolean =>
  resolve(filePath) === HTTP_METHOD_PROJECTION_PATH;

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
    current = (current as unknown as { expression?: AstNode }).expression;
  }
  return current;
};

interface ProjectionMap {
  readonly keys: ReadonlySet<string>;
  readonly node: AstNode;
}

const findHttpMethodByIntentMap = (ast: AstNode): ProjectionMap | null => {
  let found: ProjectionMap | null = null;

  walk(ast, (node) => {
    if (found || node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      id?: AstNode;
      init?: AstNode;
    };
    if (identifierName(id) !== 'httpMethodByIntent') {
      return;
    }

    const objectExpression = unwrapExpression(init);
    if (objectExpression?.type !== 'ObjectExpression') {
      found = { keys: new Set(), node };
      return;
    }

    const keys = new Set<string>();
    for (const property of (
      objectExpression as unknown as {
        properties?: readonly AstNode[];
      }
    ).properties ?? []) {
      if (property.type !== 'Property') {
        continue;
      }
      const key = getPropertyName(
        (property as unknown as { key?: AstNode }).key
      );
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
    extra.length > 0 ? `unknown projection keys: ${extra.join(', ')}` : '',
  ].filter(Boolean);

  return [
    'owner-projection-parity: httpMethodByIntent must cover the core intentValues owner vocabulary.',
    ...details,
  ].join(' ');
};

export const ownerProjectionParity: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (!isTargetFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const projection = findHttpMethodByIntentMap(ast);
    const ownerKeys = new Set<string>(intentValues);
    const projectionKeys = projection?.keys ?? new Set<string>();
    const missing = [...ownerKeys]
      .filter((key) => !projectionKeys.has(key))
      .toSorted();
    const extra = [...projectionKeys]
      .filter((key) => !ownerKeys.has(key))
      .toSorted();

    if (projection && missing.length === 0 && extra.length === 0) {
      return [];
    }

    const node = projection?.node ?? ast;
    return [
      {
        filePath,
        line: offsetToLine(sourceCode, node.start),
        message: projection
          ? buildMessage(missing, extra)
          : 'owner-projection-parity: expected httpMethodByIntent to project core intentValues.',
        rule: RULE_NAME,
        severity: 'error',
      },
    ];
  },
  description:
    'Require owner-derived projection maps to cover their authoritative owner vocabulary.',
  name: RULE_NAME,
  severity: 'error',
};
