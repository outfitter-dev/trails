/**
 * Warns when a `resource('id', { ... })` definition declares neither a `mock`
 * factory nor an explicit `unmockable` reason.
 *
 * Every resource should declare its test posture: a `mock` factory so
 * `testAll(app)` runs without production-like configuration (common pitfall
 * #10), or an explicit `unmockable: { reason }` escape hatch when it genuinely
 * cannot be mocked. The `mock?`/`unmockable?` fields are both optional in
 * `ResourceSpec`, so the compiler does not enforce the choice — this rule does.
 *
 * Conservative by design (zero false positives over completeness): only flags
 * a `resource()` call whose second argument is an inline object literal with no
 * spread. A referenced spec variable, a spread spec, or a non-object second
 * argument cannot be verified statically, so they are skipped.
 */

import {
  extractFirstStringArg,
  findConfigProperty,
  getNodeCallee,
  identifierName,
  offsetToLine,
  parse,
  walk,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import { isFrameworkInternalFile, isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const isResourceCall = (node: AstNode): boolean =>
  node.type === 'CallExpression' &&
  identifierName(getNodeCallee(node)) === 'resource';

/**
 * `.test-d.ts` type-fixture files are not matched by `isTestFile` (its pattern
 * keys on `.test.`/`.spec.`), yet they hold type-inference probe resources that
 * intentionally omit `mock`. Treat them as test fixtures here.
 */
const isTypeFixtureFile = (filePath: string): boolean =>
  filePath.endsWith('.test-d.ts') || filePath.endsWith('.test-d.tsx');

/**
 * Framework-internal packages (`@ontrails/warden`, `@ontrails/testing`) define
 * throwaway fixture resources to build example topos for other rules' tests
 * (e.g. signal-graph-coaching's `invoiceStore`). Those scaffolding resources
 * are not governed application resources, so skip them — consistent with how
 * the rest of the framework treats `isFrameworkInternalFile` source.
 */
const isExcludedFile = (filePath: string): boolean =>
  isTestFile(filePath) ||
  isTypeFixtureFile(filePath) ||
  isFrameworkInternalFile(filePath);

/** A spec object literal we can analyze: an ObjectExpression with no spread. */
const isStaticallyAnalyzableSpec = (spec: AstNode | undefined): boolean => {
  if (!spec || spec.type !== 'ObjectExpression') {
    return false;
  }
  const properties = spec['properties'] as readonly AstNode[] | undefined;
  if (!properties) {
    return false;
  }
  // A spread (`...base`) could contribute `mock`/`unmockable` from elsewhere;
  // we cannot prove its absence, so do not flag.
  return properties.every((prop) => prop.type === 'Property');
};

const declaresTestPosture = (spec: AstNode): boolean =>
  findConfigProperty(spec, 'mock') !== null ||
  findConfigProperty(spec, 'unmockable') !== null;

export const resourceMockCoverage: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isExcludedFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    walk(ast, (node) => {
      if (!isResourceCall(node)) {
        return;
      }

      const args = node['arguments'] as readonly AstNode[] | undefined;
      const spec = args?.[1];
      if (!isStaticallyAnalyzableSpec(spec) || !spec) {
        return;
      }
      if (declaresTestPosture(spec)) {
        return;
      }

      const resourceId = extractFirstStringArg(node);
      const subject = resourceId ? `Resource "${resourceId}"` : 'Resource';
      diagnostics.push({
        filePath,
        line: offsetToLine(sourceCode, node.start),
        message: `${subject} declares no mock factory. Add a mock() so testAll(app) runs without configuration, or declare unmockable: { reason } if it intentionally cannot be mocked.`,
        rule: 'resource-mock-coverage',
        severity: 'warn',
      });
    });

    return diagnostics;
  },
  description:
    'Resource definitions declare a mock factory or an explicit unmockable reason.',
  name: 'resource-mock-coverage',
  severity: 'warn',
};
