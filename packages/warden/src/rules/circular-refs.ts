import {
  collectContourReferenceTargetsByName,
  findContourDefinitions,
  offsetToLine,
  parse,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const mergeReferenceGraphs = (
  localGraph: ReadonlyMap<string, readonly string[]>,
  contextGraph?: ReadonlyMap<string, readonly string[]>
): ReadonlyMap<string, readonly string[]> => {
  const merged = new Map<string, Set<string>>();

  const addTargets = (source: string, targets: readonly string[]): void => {
    const existing = merged.get(source);
    if (existing) {
      for (const target of targets) {
        existing.add(target);
      }
      return;
    }

    merged.set(source, new Set(targets));
  };

  for (const [source, targets] of contextGraph ?? []) {
    addTargets(source, targets);
  }

  for (const [source, targets] of localGraph) {
    addTargets(source, targets);
  }

  return new Map(
    [...merged.entries()].map(([source, targets]) => [source, [...targets]])
  );
};

const findCyclePath = (
  start: string,
  graph: ReadonlyMap<string, readonly string[]>,
  current = start,
  path: readonly string[] = [start],
  active: ReadonlySet<string> = new Set([start])
): readonly string[] | null => {
  for (const target of graph.get(current) ?? []) {
    if (target === start) {
      return [...path, target];
    }

    if (active.has(target)) {
      continue;
    }

    const cycle = findCyclePath(
      start,
      graph,
      target,
      [...path, target],
      new Set([...active, target])
    );
    if (cycle) {
      return cycle;
    }
  }

  return null;
};

const buildCircularReferenceDiagnostic = (
  contourName: string,
  cyclePath: readonly string[],
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Contour "${contourName}" participates in circular contour references: ${cyclePath.join(' -> ')}.`,
  rule: 'circular-refs',
  severity: 'warn',
});

const checkCircularReferences = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  graph: ReadonlyMap<string, readonly string[]>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  return findContourDefinitions(ast).flatMap((definition) => {
    const cyclePath = findCyclePath(definition.name, graph);
    if (!cyclePath) {
      return [];
    }

    return [
      buildCircularReferenceDiagnostic(
        definition.name,
        cyclePath,
        filePath,
        offsetToLine(sourceCode, definition.start)
      ),
    ];
  });
};

/**
 * Warns when contour references form a direct or transitive cycle.
 */
export const circularRefs: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const graph = collectContourReferenceTargetsByName(ast);
    return checkCircularReferences(ast, sourceCode, filePath, graph);
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const localGraph = collectContourReferenceTargetsByName(
      ast,
      context.knownContourIds
    );
    return checkCircularReferences(
      ast,
      sourceCode,
      filePath,
      mergeReferenceGraphs(localGraph, context.contourReferencesByName)
    );
  },
  description: 'Warn when contour references form direct or transitive cycles.',
  name: 'circular-refs',
  severity: 'warn',
};
