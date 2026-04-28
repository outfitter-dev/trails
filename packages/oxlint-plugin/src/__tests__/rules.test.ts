import { describe, expect, test } from 'bun:test';

import { noConsoleInPackagesRule } from '../rules/no-console-in-packages.js';
import { noDeepRelativeImportRule } from '../rules/no-deep-relative-import.js';
import { noNestedBarrelRule } from '../rules/no-nested-barrel.js';
import { noProcessEnvInPackagesRule } from '../rules/no-process-env-in-packages.js';
import { noProcessExitInPackagesRule } from '../rules/no-process-exit-in-packages.js';
import { preferBunApiRule } from '../rules/prefer-bun-api.js';
import { snapshotLocationRule } from '../rules/snapshot-location.js';
import { tempAuditDirectFrameworkWritesRule } from '../rules/temp-audit-direct-framework-writes.js';
import { testFileNamingRule } from '../rules/test-file-naming.js';
import {
  createCallExpressionNode,
  createExportDeclarationNode,
  createIdentifierCallNode,
  createImportDeclarationNode,
  createMemberExpressionNode,
  createRequireCallNode,
  runRuleForEvent,
} from './rule-test-helpers.js';

describe('repo-local rules', () => {
  test('reports console calls in package source but respects allowed packages', () => {
    const reports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'packages/core/src/run.ts',
      nodes: [createCallExpressionNode('console', 'log')],
      rule: noConsoleInPackagesRule,
    });
    const allowedReports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'packages/logging/src/sinks.ts',
      nodes: [createCallExpressionNode('console', 'error')],
      options: [{ allowedPackages: ['logging'] }],
      rule: noConsoleInPackagesRule,
    });

    expect(reports.map((report) => report.messageId)).toEqual([
      'noConsoleInPackages',
    ]);
    expect(allowedReports).toHaveLength(0);
  });

  test('reports process.exit calls in package source but respects allowed packages', () => {
    const reports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'packages/core/src/run.ts',
      nodes: [createCallExpressionNode('process', 'exit')],
      rule: noProcessExitInPackagesRule,
    });
    const allowedReports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'packages/cli/src/commander/to-commander.ts',
      nodes: [createCallExpressionNode('process', 'exit')],
      options: [{ allowedPackages: ['cli'] }],
      rule: noProcessExitInPackagesRule,
    });

    expect(reports.map((report) => report.messageId)).toEqual([
      'noProcessExitInPackages',
    ]);
    expect(allowedReports).toHaveLength(0);
  });

  test('reports process.env usage in package source but respects allowed packages', () => {
    const reports = runRuleForEvent({
      event: 'MemberExpression',
      filename: 'packages/http/src/server.ts',
      nodes: [createMemberExpressionNode('process', 'env')],
      rule: noProcessEnvInPackagesRule,
    });
    const allowedReports = runRuleForEvent({
      event: 'MemberExpression',
      filename: 'packages/config/src/define-config.ts',
      nodes: [createMemberExpressionNode('process', 'env')],
      options: [{ allowedPackages: ['config'] }],
      rule: noProcessEnvInPackagesRule,
    });

    expect(reports.map((report) => report.messageId)).toEqual([
      'noProcessEnvInPackages',
    ]);
    expect(allowedReports).toHaveLength(0);
  });

  test('reports deep relative imports beyond the configured depth', () => {
    const importReports = runRuleForEvent({
      event: 'ImportDeclaration',
      filename: 'packages/core/src/result.ts',
      nodes: [createImportDeclarationNode('../../../shared/value.js')],
      rule: noDeepRelativeImportRule,
    });
    const requireReports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'packages/core/src/result.ts',
      nodes: [createRequireCallNode('../../../../shared/value.js')],
      rule: noDeepRelativeImportRule,
    });
    const allowedReports = runRuleForEvent({
      event: 'ImportDeclaration',
      filename: 'packages/core/src/result.ts',
      nodes: [createImportDeclarationNode('../../shared/value.js')],
      rule: noDeepRelativeImportRule,
    });
    const reExportReports = runRuleForEvent({
      event: 'ExportNamedDeclaration',
      filename: 'packages/core/src/index.ts',
      nodes: [createExportDeclarationNode('../../../shared/value.js')],
      rule: noDeepRelativeImportRule,
    });

    expect(importReports[0]?.data).toEqual({
      importSource: '../../../shared/value.js',
      maxParentSegments: 2,
    });
    expect(requireReports.map((report) => report.messageId)).toEqual([
      'noDeepRelativeImport',
    ]);
    expect(reExportReports.map((report) => report.messageId)).toEqual([
      'noDeepRelativeImport',
    ]);
    expect(allowedReports).toHaveLength(0);
  });

  test('allows first-level package barrels and reports deeper barrels', () => {
    const firstLevelReports = runRuleForEvent({
      event: 'Program',
      filename: 'packages/core/src/trails/index.ts',
      nodes: [{ type: 'Program' }],
      rule: noNestedBarrelRule,
    });
    const deepReports = runRuleForEvent({
      event: 'Program',
      filename: 'packages/core/src/trails/internal/index.ts',
      nodes: [{ type: 'Program' }],
      rule: noNestedBarrelRule,
    });

    expect(firstLevelReports).toHaveLength(0);
    expect(deepReports.map((report) => report.messageId)).toEqual([
      'noNestedBarrel',
    ]);
  });

  test('reports mapped value imports but ignores type-only imports', () => {
    const reports = runRuleForEvent({
      event: 'ImportDeclaration',
      filename: 'packages/core/src/result.ts',
      nodes: [createImportDeclarationNode('uuid')],
      rule: preferBunApiRule,
    });
    const typeOnlyReports = runRuleForEvent({
      event: 'ImportDeclaration',
      filename: 'packages/core/src/result.ts',
      nodes: [
        {
          importKind: 'type',
          source: { type: 'Literal', value: 'semver' },
          type: 'ImportDeclaration',
        },
      ],
      rule: preferBunApiRule,
    });
    const nodeCryptoReports = runRuleForEvent({
      event: 'ImportDeclaration',
      filename: 'packages/core/src/result.ts',
      nodes: [createImportDeclarationNode('node:crypto')],
      rule: preferBunApiRule,
    });
    const disabledDefaultReports = runRuleForEvent({
      event: 'ImportDeclaration',
      filename: 'packages/core/src/result.ts',
      nodes: [createImportDeclarationNode('uuid')],
      options: [{ mappings: { uuid: false } }],
      rule: preferBunApiRule,
    });

    expect(reports[0]?.data).toEqual({
      bunAlternative: 'Bun.randomUUIDv7()',
      importName: 'uuid',
    });
    expect(typeOnlyReports).toHaveLength(0);
    expect(nodeCryptoReports).toHaveLength(0);
    expect(disabledDefaultReports).toHaveLength(0);
  });

  test('reports .spec.* test names and misplaced snapshots', () => {
    const namingReports = runRuleForEvent({
      event: 'Program',
      filename: 'packages/core/src/__tests__/result.spec.ts',
      nodes: [{ type: 'Program' }],
      rule: testFileNamingRule,
    });
    const snapshotReports = runRuleForEvent({
      event: 'Program',
      filename: 'packages/core/src/__tests__/result.snap',
      nodes: [{ type: 'Program' }],
      rule: snapshotLocationRule,
    });
    const nestedSnapshotReports = runRuleForEvent({
      event: 'Program',
      filename: 'packages/core/src/__tests__/__snapshots__/result.snap',
      nodes: [{ type: 'Program' }],
      rule: snapshotLocationRule,
    });

    expect(namingReports.map((report) => report.messageId)).toEqual([
      'testFileNaming',
    ]);
    expect(snapshotReports.map((report) => report.messageId)).toEqual([
      'snapshotLocation',
    ]);
    expect(nestedSnapshotReports).toHaveLength(0);
  });

  test('reports direct framework writes in scoped audit paths', () => {
    const bunWriteReports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'apps/trails/src/trails/create-scaffold.ts',
      nodes: [createCallExpressionNode('Bun', 'write')],
      rule: tempAuditDirectFrameworkWritesRule,
    });
    const directWriteReports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'apps/trails/src/trails/draft-promote.ts',
      nodes: [createIdentifierCallNode('mkdirSync')],
      rule: tempAuditDirectFrameworkWritesRule,
    });
    const directRenameReports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'apps/trails/src/trails/draft-promote.ts',
      nodes: [createIdentifierCallNode('renameSync')],
      rule: tempAuditDirectFrameworkWritesRule,
    });
    const directWriteReportsFromImport = runRuleForEvent({
      event: 'CallExpression',
      filename: 'apps/trails/src/trails/add-verify.ts',
      nodes: [createIdentifierCallNode('writeFile')],
      rule: tempAuditDirectFrameworkWritesRule,
    });
    const packageReports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'packages/core/src/internal/topo-store.ts',
      nodes: [createCallExpressionNode('Bun', 'write')],
      rule: tempAuditDirectFrameworkWritesRule,
    });
    const testReports = runRuleForEvent({
      event: 'CallExpression',
      filename: 'apps/trails/src/trails/__tests__/create-scaffold.test.ts',
      nodes: [createCallExpressionNode('Bun', 'write')],
      rule: tempAuditDirectFrameworkWritesRule,
    });

    expect(bunWriteReports[0]?.data).toEqual({ callName: 'Bun.write' });
    expect(directWriteReports[0]?.data).toEqual({ callName: 'mkdirSync' });
    expect(directRenameReports[0]?.data).toEqual({ callName: 'renameSync' });
    expect(directWriteReportsFromImport[0]?.data).toEqual({
      callName: 'writeFile',
    });
    expect(packageReports).toHaveLength(0);
    expect(testReports).toHaveLength(0);
  });
});
