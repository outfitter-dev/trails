import { describe, expect, test } from 'bun:test';

import * as warden from '@ontrails/warden';
import {
  applySourceEdits,
  createSourceEdit,
  findBlazeBodies,
  findContourDefinitions,
  findTrailDefinitions,
  getNodeAlternate,
  getNodeArguments,
  getNodeCallee,
  getNodeDeclarations,
  getNodeId,
  getNodeInit,
  identifierName,
  isBlazeCall,
  isCallExpression,
  isIdentifier,
  isImportDeclaration,
  isProgram,
  isVariableDeclaration,
  isVariableDeclarator,
  offsetToLineColumn,
  parse,
  parseWithDiagnostics,
  walk,
  walkScope,
  walkWithParents,
  walkWithScopeContext,
} from '@ontrails/warden/ast';
import type { FrameworkNamespaceContext } from '@ontrails/warden/ast';
import {
  collectImportSpecifiers,
  defaultWardenResolveOptions,
} from '@ontrails/warden/resolve';

describe('@ontrails/warden public API', () => {
  test('exports built-in rule metadata from the root entrypoint', () => {
    expect(warden.getWardenRuleMetadata('permit-governance')?.tier).toBe(
      'topo-aware'
    );
    expect(warden.wardenRuleTiers).toContain('source-static');
    expect(warden.listWardenRuleMetadata().length).toBeGreaterThan(0);
    expect(warden.adapterCheckRuleName).toBe('adapter-check');
    expect(typeof warden.runWardenAdapterChecks).toBe('function');
    expect(typeof warden.loadProjectWardenRules).toBe('function');
  });

  test('exports governed vocabulary transition schemas from the root entrypoint', () => {
    expect(
      warden.governedVocabularyScopeSchema.parse({
        exclude: ['.agents/memory/**'],
      }).exclude
    ).toEqual(['.agents/memory/**']);
    expect(
      warden.governedVocabularyLiteralRenameSchema.parse({
        from: 'wayfind.facets',
        to: 'wayfind.trailheads',
      }).to
    ).toBe('wayfind.trailheads');
  });

  test('exports the composable Warden config schema from the root entrypoint', () => {
    const omittedSection: unknown = undefined;
    const result = warden.wardenConfigSchema.safeParse(omittedSection);

    expect(result.success).toBe(true);
    expect(result.data?.depth).toBe('all');
    expect(result.data?.failOn).toBe('error');
  });

  test('keeps parser helpers on the ast entrypoint', () => {
    expect('parse' in warden).toBe(false);
    expect('walk' in warden).toBe(false);

    const ast = parse('example.ts', 'export const value = 1;');
    expect(ast).not.toBeNull();
    expect(
      parseWithDiagnostics('broken.ts', 'export const = ;').diagnostics.length
    ).toBeGreaterThan(0);

    let visited = 0;
    if (ast) {
      walk(ast, () => {
        visited += 1;
      });
    }
    expect(visited).toBeGreaterThan(0);
  });

  test('exports curated AST node guards on the ast entrypoint', () => {
    const ast = parse(
      'example.ts',
      `
        import {
  trail
} from '@ontrails/core';
        const showUser = trail('user.show', {});
      `
    );
    expect(ast).not.toBeNull();
    expect(isProgram(ast)).toBe(true);
    if (!isProgram(ast)) {
      return;
    }

    expect(ast.body?.some(isImportDeclaration)).toBe(true);
    const declaration = ast.body?.find(isVariableDeclaration);
    const [declarator] = declaration?.declarations ?? [];

    expect(isVariableDeclarator(declarator)).toBe(true);
    if (isVariableDeclarator(declarator)) {
      expect(isIdentifier(declarator.id)).toBe(true);
      expect(isCallExpression(declarator.init)).toBe(true);
      expect(identifierName(getNodeId(declarator))).toBe('showUser');
      expect(identifierName(getNodeCallee(getNodeInit(declarator)))).toBe(
        'trail'
      );
      expect(getNodeArguments(getNodeInit(declarator))).toHaveLength(2);
    }
    expect(getNodeDeclarations(declaration)).toHaveLength(1);
  });

  test('keeps resolver helpers on the resolve entrypoint', () => {
    expect('collectImportSpecifiers' in warden).toBe(true);
    expect('defaultWardenResolveOptions' in warden).toBe(true);
    expect(defaultWardenResolveOptions.conditionNames).toEqual([
      'bun',
      'node',
      'import',
      'default',
    ]);
    expect(
      collectImportSpecifiers(
        'example.ts',
        "import { value } from '@ontrails/core';\n"
      )
    ).toEqual([{ importSource: '@ontrails/core', line: 1 }]);
  });

  test('exposes stable rule-authoring helpers on the ast entrypoint', () => {
    const source = `
import {
  contour,
  trail
} from '@ontrails/core';

const user = contour('user', { id: z.string() });

export const showUser = trail('user.show', {
  blaze: async (input, ctx) => {
    return userShow.blaze(input, ctx);
  },
});

const selectedTrail = enabled ? loadPrimary() : loadFallback();
`;
    const ast = parse('example.ts', source);
    expect(ast).not.toBeNull();

    if (!ast) {
      return;
    }

    expect(
      findTrailDefinitions(ast).map((definition) => definition.id)
    ).toEqual(['user.show']);
    expect(
      findContourDefinitions(ast).map((definition) => definition.name)
    ).toEqual(['user']);

    const [blazeBody] = findBlazeBodies(ast);
    expect(blazeBody).toBeDefined();

    let sawBlazeCall = false;
    let alternateNodeType: string | undefined;
    walk(blazeBody, (node) => {
      sawBlazeCall ||= isBlazeCall(node);
    });
    walk(ast, (node) => {
      if (node.type === 'ConditionalExpression') {
        alternateNodeType = getNodeAlternate(node)?.type;
      }
    });
    expect(sawBlazeCall).toBe(true);
    expect(alternateNodeType).toBe('CallExpression');

    const namespaceContext = {
      namespaces: new Set(['core']),
      safeCallStarts: new Set([0]),
    } satisfies FrameworkNamespaceContext;
    expect(namespaceContext.namespaces.has('core')).toBe(true);

    const scopedNodeTypes: string[] = [];
    let hasScopedBlazeCall = false;
    walkScope(ast, (node) => {
      scopedNodeTypes.push(node.type);
      hasScopedBlazeCall ||= isBlazeCall(node);
    });
    expect(scopedNodeTypes.length).toBeGreaterThan(0);
    expect(scopedNodeTypes).toContain('ArrowFunctionExpression');
    expect(hasScopedBlazeCall).toBe(false);
  });

  test('exposes parent-aware, scope-aware, and edit helpers on the ast entrypoint', () => {
    const source = `
import {
  trail
} from '@ontrails/core';

export const showUser = trail('user.show', {});

function wrapper(trail: (id: string) => void) {
  trail('shadowed.show');
}
`;
    const ast = parse('example.ts', source);
    expect(ast).not.toBeNull();
    if (!ast) {
      return;
    }

    const parentContexts: string[] = [];
    walkWithParents(ast, (node, context) => {
      if (node.type === 'CallExpression') {
        parentContexts.push(
          `${context.parent?.type ?? 'root'}:${String(context.key)}`
        );
      }
    });
    expect(parentContexts).toContain('VariableDeclarator:init');

    const declarationTypes: string[] = [];
    walkWithScopeContext(ast, (node, context) => {
      if (node.type !== 'CallExpression') {
        return;
      }
      const callee = getNodeCallee(node);
      if (callee?.name === 'trail') {
        const declaration = context.getDeclaration('trail');
        if (declaration) {
          declarationTypes.push(declaration.type);
        }
      }
    });
    expect(declarationTypes).toEqual(['Import', 'FunctionParam']);

    expect(offsetToLineColumn(source, source.indexOf('wrapper'))).toEqual({
      column: 10,
      line: 8,
    });
    expect(
      applySourceEdits(source, [
        createSourceEdit(
          source.indexOf('showUser'),
          source.indexOf('showUser') + 8,
          'showAccount'
        ),
      ])
    ).toContain('showAccount');
  });
});
