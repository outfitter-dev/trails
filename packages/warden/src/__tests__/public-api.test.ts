import { describe, expect, test } from 'bun:test';

import * as warden from '@ontrails/warden';
import {
  applySourceEdits,
  createSourceEdit,
  findImplementationBodies,
  findEntityDefinitions,
  findTrailDefinitions,
  getNodeAlternate,
  getNodeArguments,
  getNodeCallee,
  getNodeDeclarations,
  getNodeId,
  getNodeInit,
  identifierName,
  isImplementationCall,
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
} from '@ontrails/source';
import type { FrameworkNamespaceContext } from '@ontrails/source';
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

  test('does not export parser helpers from the Warden root entrypoint', () => {
    expect('parse' in warden).toBe(false);
    expect('walk' in warden).toBe(false);
  });

  test('uses parser helpers from the source package', () => {
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

  test('uses curated AST node guards from the source package', () => {
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

  test('uses stable rule-authoring helpers from the source package', () => {
    const source = `
import {
  entity,
  trail
} from '@ontrails/core';

const user = entity('user', { id: z.string() });

export const showUser = trail('user.show', {
  implementation: async (input, ctx) => {
    return userShow.implementation(input, ctx);
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
      findEntityDefinitions(ast).map((definition) => definition.name)
    ).toEqual(['user']);

    const [implementationBody] = findImplementationBodies(ast);
    expect(implementationBody).toBeDefined();

    let sawImplementationCall = false;
    let alternateNodeType: string | undefined;
    walk(implementationBody, (node) => {
      sawImplementationCall ||= isImplementationCall(node);
    });
    walk(ast, (node) => {
      if (node.type === 'ConditionalExpression') {
        alternateNodeType = getNodeAlternate(node)?.type;
      }
    });
    expect(sawImplementationCall).toBe(true);
    expect(alternateNodeType).toBe('CallExpression');

    const namespaceContext = {
      namespaces: new Set(['core']),
      safeCallStarts: new Set([0]),
    } satisfies FrameworkNamespaceContext;
    expect(namespaceContext.namespaces.has('core')).toBe(true);

    const scopedNodeTypes: string[] = [];
    let hasScopedImplementationCall = false;
    walkScope(ast, (node) => {
      scopedNodeTypes.push(node.type);
      hasScopedImplementationCall ||= isImplementationCall(node);
    });
    expect(scopedNodeTypes.length).toBeGreaterThan(0);
    expect(scopedNodeTypes).toContain('ArrowFunctionExpression');
    expect(hasScopedImplementationCall).toBe(false);
  });

  test('uses parent-aware, scope-aware, and edit helpers from the source package', () => {
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

  test('does not publish the removed ast subpath in package metadata', async () => {
    const packageJson = (await Bun.file(
      new URL('../../package.json', import.meta.url)
    ).json()) as {
      readonly dependencies?: Record<string, string>;
      readonly exports?: Record<string, string>;
    };

    expect(packageJson.dependencies?.['@ontrails/source']).toBe('workspace:^');
    expect(packageJson.exports?.['./ast']).toBeUndefined();
  });
});
