import { describe, expect, test } from 'bun:test';

import * as warden from '@ontrails/warden';
import {
  findBlazeBodies,
  findContourDefinitions,
  findTrailDefinitions,
  isBlazeCall,
  parse,
  walk,
  walkScope,
} from '@ontrails/warden/ast';
import type { FrameworkNamespaceContext } from '@ontrails/warden/ast';

describe('@ontrails/warden public API', () => {
  test('exports built-in rule metadata from the root entrypoint', () => {
    expect(warden.getWardenRuleMetadata('permit-governance')?.tier).toBe(
      'topo-aware'
    );
    expect(warden.wardenRuleTiers).toContain('source-static');
    expect(warden.listWardenRuleMetadata().length).toBeGreaterThan(0);
  });

  test('keeps parser helpers on the ast entrypoint', () => {
    expect('parse' in warden).toBe(false);
    expect('walk' in warden).toBe(false);

    const ast = parse('example.ts', 'export const value = 1;');
    expect(ast).not.toBeNull();

    let visited = 0;
    if (ast) {
      walk(ast, () => {
        visited += 1;
      });
    }
    expect(visited).toBeGreaterThan(0);
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
});
