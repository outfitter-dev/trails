/**
 * Flags throws in implementations that are used as detour targets.
 *
 * Uses AST parsing for accurate detection of detour target IDs and
 * throw statements within those trail implementations.
 */

import {
  findImplementationBodies,
  findTrailDefinitions,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/** Collect all trail IDs referenced as detour targets in the AST. */
const collectDetourTargets = (ast: AstNode): ReadonlySet<string> => {
  const targets = new Set<string>();

  walk(ast, (node) => {
    if (
      node.type !== 'Property' ||
      node.key?.name !== 'detours' ||
      !node.value
    ) {
      return;
    }

    walk(node.value as AstNode, (inner) => {
      if (inner.type === 'Literal' || inner.type === 'StringLiteral') {
        const { value } = inner as unknown as { value?: unknown };
        if (typeof value === 'string' && value.includes('.')) {
          targets.add(value);
        }
      }
    });
  });

  return targets;
};

/** Find throws in implementation bodies of targeted trails. */
const findThrowsInTargetedTrails = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  detourTargets: ReadonlySet<string>
): WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];

  for (const def of findTrailDefinitions(ast)) {
    if (!detourTargets.has(def.id)) {
      continue;
    }

    for (const body of findImplementationBodies(def.config as AstNode)) {
      walk(body, (node) => {
        if (node.type === 'ThrowStatement') {
          diagnostics.push({
            filePath,
            line: offsetToLine(sourceCode, node.start),
            message: `Trail "${def.id}" is a detour target and must not throw. Use Result.err() instead.`,
            rule: 'no-throw-in-detour-target',
            severity: 'error',
          });
        }
      });
    }
  }

  return diagnostics;
};

const checkThrowInDetourTargets = (
  sourceCode: string,
  filePath: string,
  detourTargets: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  return findThrowsInTargetedTrails(
    ast as AstNode,
    sourceCode,
    filePath,
    detourTargets
  );
};

/**
 * Flags throws in implementations that are used as detour targets.
 */
export const noThrowInDetourTarget: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return checkThrowInDetourTargets(
      sourceCode,
      filePath,
      collectDetourTargets(ast as AstNode)
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    if (context.detourTargetTrailIds) {
      return checkThrowInDetourTargets(
        sourceCode,
        filePath,
        context.detourTargetTrailIds
      );
    }
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return checkThrowInDetourTargets(
      sourceCode,
      filePath,
      collectDetourTargets(ast as AstNode)
    );
  },
  description:
    'Disallow throw statements inside implementations that are referenced as detour targets.',
  name: 'no-throw-in-detour-target',
  severity: 'error',
};
