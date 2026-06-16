import { describe, expect, test } from 'bun:test';

import * as warden from '@ontrails/warden';
import {
  applySourceEdits,
  createSourceEdit,
  findBlazeBodies,
  findContourDefinitions,
  findTrailDefinitions,
  isBlazeCall,
  offsetToLineColumn,
  parse,
  parseWithDiagnostics,
  walk,
  walkWithParents,
  walkWithScopeContext,
  walkScope,
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
import { contour, trail } from '@ontrails/core';

const user = contour('user', { id: z.string() });

export const showUser = trail('user.show', {
  blaze: async (input, ctx) => {
    return userShow.blaze(input, ctx);
  },
});
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
    walk(blazeBody, (node) => {
      sawBlazeCall ||= isBlazeCall(node);
    });
    expect(sawBlazeCall).toBe(true);

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
import { trail } from '@ontrails/core';

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
      const { callee } = node as unknown as {
        readonly callee?: { readonly name?: string };
      };
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
      line: 6,
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
