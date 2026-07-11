import { describe, expect, test } from 'bun:test';

import {
  collectEntityDefinitionIds,
  collectEntityReferenceSites,
  collectNamedEntityIds,
  deriveEntityIdentifierName,
} from '../rules/source/entities.js';
import {
  hasIgnoreCommentOnLine,
  splitSourceLines,
} from '../rules/source/pragmas.js';
import {
  applySourceEdits,
  createSourceEdit,
  extractStringLiteral,
  findEntityDefinitions,
  findTrailDefinitions,
  getNodeArguments,
  getNodeBody,
  getNodeBodyStatements,
  getNodeCallee,
  getNodeDeclaration,
  getNodeDeclarations,
  getNodeElements,
  getNodeId,
  getNodeInit,
  getNodeKey,
  getNodeLocal,
  getNodeProperties,
  getNodeSource,
  getNodeSpecifiers,
  getNodeValue,
  getNodeValueNode,
  identifierName,
  isCallExpression,
  isDeclarationWithId,
  isExportDeclaration,
  isExportSpecifier,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isMemberExpression,
  isProgram,
  isVariableDeclaration,
  isVariableDeclarator,
  offsetToLineColumn,
  parse,
  parseWithDiagnostics,
  validateSourceEdits,
  walkWithParents,
  walkWithScopeContext,
} from '@ontrails/source';
import type { VariableDeclarationNode } from '@ontrails/source';
import {
  __getTrailCalleeNameForTest,
  collectFrameworkNamespaceBindings,
} from '../../../source/src/trails.js';

describe('deriveEntityIdentifierName', () => {
  test('supports the common *Entity binding suffix when resolving known entities', () => {
    expect(
      deriveEntityIdentifierName(
        'userEntity',
        new Map<string, string>(),
        new Set(['user'])
      )
    ).toBe('user');
  });

  test('prefers exact entity ids over the *Entity fallback', () => {
    expect(
      deriveEntityIdentifierName(
        'userEntity',
        new Map<string, string>(),
        new Set(['user', 'userEntity'])
      )
    ).toBe('userEntity');
  });
});

describe('hasIgnoreCommentOnLine', () => {
  test('matches the pragma when the preceding line is exact', () => {
    const lines = splitSourceLines(
      "// warden-ignore-next-line\nconst x = '_draft.foo';\n"
    );
    expect(hasIgnoreCommentOnLine(lines, 2)).toBe(true);
  });

  test('matches the pragma with leading whitespace', () => {
    const lines = splitSourceLines(
      "  // warden-ignore-next-line\n  const x = '_draft.foo';\n"
    );
    expect(hasIgnoreCommentOnLine(lines, 2)).toBe(true);
  });

  test('matches the pragma with trailing whitespace (editor did not auto-trim)', () => {
    const lines = splitSourceLines(
      "// warden-ignore-next-line   \nconst x = '_draft.foo';\n"
    );
    expect(hasIgnoreCommentOnLine(lines, 2)).toBe(true);
  });

  test('returns false when there is no preceding line', () => {
    const lines = splitSourceLines("const x = '_draft.foo';\n");
    expect(hasIgnoreCommentOnLine(lines, 1)).toBe(false);
  });

  test('returns false when the preceding line is blank', () => {
    const lines = splitSourceLines(
      "// warden-ignore-next-line\n\nconst x = '_draft.foo';\n"
    );
    expect(hasIgnoreCommentOnLine(lines, 3)).toBe(false);
  });

  test('accepts pre-split lines so callers memoize across many matches', () => {
    // Regression guard for the O(N × source length) re-split fix. The caller
    // splits once and threads the same lines array through to every lookup.
    const source = Array.from(
      { length: 100 },
      (_, i) => `const v${i} = '_draft.id${i}';`
    ).join('\n');
    const lines = splitSourceLines(source);
    for (let line = 1; line <= 100; line += 1) {
      expect(hasIgnoreCommentOnLine(lines, line)).toBe(false);
    }
  });
});

const parseOrThrow = (source: string) =>
  parse('test.ts', source) ??
  (() => {
    throw new Error('failed to parse');
  })();

describe('OXC-backed AST facade helpers', () => {
  test('parseWithDiagnostics surfaces recoverable parser errors', () => {
    const result = parseWithDiagnostics('broken.ts', 'export const = ;');

    expect(result.ast).not.toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('Unexpected token');
    expect(result.diagnostics[0]?.labels[0]).toMatchObject({
      end: 14,
      start: 13,
    });
  });

  test('walkWithParents exposes parent key and index context', () => {
    const source = 'const value = trail("demo.show", {});\n';
    const ast = parseOrThrow(source);

    const contexts: string[] = [];
    walkWithParents(ast, (node, context) => {
      if (node.type === 'CallExpression') {
        contexts.push(
          `${context.parent?.type ?? 'root'}:${String(context.key)}:${context.index ?? 'none'}`
        );
      }
    });

    expect(contexts).toEqual(['VariableDeclarator:init:none']);
  });

  test('walkWithScopeContext distinguishes imports from shadowed parameters', () => {
    const source = `
      import {
  trail
} from '@ontrails/core';

      export const root = trail('root.show', {});

      function wrapped(trail: (id: string) => void) {
        trail('shadowed.show');
      }
    `;
    const ast = parseOrThrow(source);
    const trailCalls: {
      readonly declarationType: string | null;
      readonly line: number;
    }[] = [];

    walkWithScopeContext(ast, (node, context) => {
      if (node.type !== 'CallExpression') {
        return;
      }
      const callee = getNodeCallee(node);
      if (callee?.name !== 'trail') {
        return;
      }

      trailCalls.push({
        declarationType: context.getDeclaration('trail')?.type ?? null,
        line: offsetToLineColumn(source, node.start).line,
      });
    });

    expect(trailCalls).toEqual([
      { declarationType: 'Import', line: 6 },
      { declarationType: 'FunctionParam', line: 9 },
    ]);
  });

  test('curated node guards narrow common source shapes', () => {
    const source = `
      import {
  trail as makeTrail
} from '@ontrails/core';

      const usesMember = api.value;
      export const showUser = makeTrail('user.show', {});
      export { showUser as publicShowUser };
      export default class UserController {
        show() {
          return this;
        }
      }
    `;
    const ast = parseOrThrow(source);

    expect(isProgram(ast)).toBe(true);
    const imports = ast.body?.filter(isImportDeclaration) ?? [];
    expect(imports).toHaveLength(1);
    const [specifier] = imports[0]?.specifiers ?? [];
    expect(isImportSpecifier(specifier)).toBe(true);
    expect(identifierName(specifier?.local)).toBe('makeTrail');
    expect(specifier && isIdentifier(specifier.imported)).toBe(true);

    let variableDeclaration: VariableDeclarationNode | undefined;
    walkWithParents(ast, (node) => {
      if (
        !variableDeclaration &&
        isVariableDeclaration(node) &&
        node.declarations?.some(
          (declarator) =>
            isVariableDeclarator(declarator) &&
            identifierName(declarator.id) === 'showUser'
        )
      ) {
        variableDeclaration = node;
      }
    });
    expect(variableDeclaration?.kind).toBe('const');
    const declarator = variableDeclaration?.declarations?.find(
      (candidate) =>
        isVariableDeclarator(candidate) &&
        identifierName(candidate.id) === 'showUser'
    );
    expect(isVariableDeclarator(declarator)).toBe(true);
    expect(identifierName(declarator?.id)).toBe('showUser');
    expect(isCallExpression(declarator?.init)).toBe(true);

    const namedExport = ast.body?.find(
      (node) => isExportDeclaration(node) && node.specifiers?.length
    );
    const [exportSpecifier] = namedExport?.specifiers ?? [];
    expect(isExportSpecifier(exportSpecifier)).toBe(true);
    expect(identifierName(exportSpecifier?.exported)).toBe('publicShowUser');

    const defaultExport = ast.body?.find(
      (node) =>
        isExportDeclaration(node) && node.type === 'ExportDefaultDeclaration'
    );
    expect(isDeclarationWithId(defaultExport?.declaration)).toBe(true);
    if (isDeclarationWithId(defaultExport?.declaration)) {
      expect(identifierName(defaultExport.declaration.id)).toBe(
        'UserController'
      );
    }

    let sawMemberExpression = false;
    walkWithParents(ast, (node) => {
      sawMemberExpression ||= isMemberExpression(node);
    });
    expect(sawMemberExpression).toBe(true);
  });

  test('node field accessors expose recurring OXC shapes without rule-local casts', () => {
    const source = `
      import {
  trail as makeTrail
} from '@ontrails/core';

      export const showUser = makeTrail('user.show', {
        meta: { owner: 'docs' },
      });

      const [firstUser] = users;
    `;
    const ast = parseOrThrow(source);

    expect(getNodeBodyStatements(ast).length).toBeGreaterThan(0);
    const importDecl = getNodeBodyStatements(ast).find(isImportDeclaration);
    expect(extractStringLiteral(getNodeSource(importDecl))).toBe(
      '@ontrails/core'
    );
    const [specifier] = getNodeSpecifiers(importDecl);
    expect(identifierName(getNodeLocal(specifier))).toBe('makeTrail');

    const exportDecl = getNodeBodyStatements(ast).find(isExportDeclaration);
    const declaration = getNodeDeclaration(exportDecl);
    const [declarator] = getNodeDeclarations(declaration);
    expect(identifierName(getNodeId(declarator))).toBe('showUser');

    const init = getNodeInit(declarator);
    expect(identifierName(getNodeCallee(init))).toBe('makeTrail');
    const [idArg, configArg] = getNodeArguments(init);
    expect(extractStringLiteral(idArg)).toBe('user.show');

    const [metaProp] = getNodeProperties(configArg);
    expect(identifierName(getNodeKey(metaProp))).toBe('meta');
    const [ownerProp] = getNodeProperties(getNodeValueNode(metaProp));
    expect(identifierName(getNodeKey(ownerProp))).toBe('owner');
    expect(getNodeValue(getNodeValueNode(ownerProp))).toBe('docs');

    const destructuringDeclarator = getNodeBodyStatements(ast)
      .flatMap((node) => getNodeDeclarations(node))
      .find((node) => getNodeId(node)?.type === 'ArrayPattern');
    const [firstPattern] = getNodeElements(getNodeId(destructuringDeclarator));
    expect(identifierName(firstPattern ?? undefined)).toBe('firstUser');
  });

  test('source edit helpers apply validated non-overlapping edits', () => {
    const source = 'const sourceTerm = "oldTerm";\n';
    const edits = [
      createSourceEdit(6, 16, 'targetTerm'),
      createSourceEdit(20, 27, 'newTerm'),
    ];

    expect(validateSourceEdits(edits)).toEqual(edits);
    expect(applySourceEdits(source, edits)).toBe(
      'const targetTerm = "newTerm";\n'
    );
  });

  test('source edit helpers reject overlapping edits', () => {
    expect(() =>
      validateSourceEdits([
        createSourceEdit(0, 6, 'targetTerm'),
        createSourceEdit(4, 11, 'newTerm'),
      ])
    ).toThrow('Overlapping source edits');
  });

  test('source edit helpers reject invalid offsets before applying', () => {
    for (const edit of [
      createSourceEdit(10, 10, 'targetTerm'),
      createSourceEdit(0, 4, 'targetTerm'),
      createSourceEdit(0.5, 1, 'targetTerm'),
      createSourceEdit(Number.NaN, 1, 'targetTerm'),
    ]) {
      expect(() => applySourceEdits('abc', [edit])).toThrow(
        'Invalid source edit range'
      );
    }
  });
});

const parseCallee = (source: string) => {
  const ast = parseOrThrow(source);
  // The first statement is an ExpressionStatement wrapping the CallExpression.
  const [stmt] = getNodeBody(ast);
  const { expression } = stmt as { expression: unknown };
  return expression as Parameters<typeof __getTrailCalleeNameForTest>[0];
};

const coreNamespaces: ReadonlySet<string> = new Set(['core']);

describe('getTrailCalleeName', () => {
  test('matches bare trail(...) identifier callees', () => {
    expect(__getTrailCalleeNameForTest(parseCallee('trail("foo", {});'))).toBe(
      'trail'
    );
  });

  test('matches namespaced ns.trail(...) callees when the namespace is from @ontrails/*', () => {
    expect(
      __getTrailCalleeNameForTest(
        parseCallee('core.trail("foo", {});'),
        coreNamespaces
      )
    ).toBe('trail');
  });

  test('matches bare signal(...) identifier callees', () => {
    expect(__getTrailCalleeNameForTest(parseCallee('signal("evt", {});'))).toBe(
      'signal'
    );
  });

  test('matches namespaced ns.signal(...) callees when the namespace is from @ontrails/*', () => {
    expect(
      __getTrailCalleeNameForTest(
        parseCallee('core.signal("evt", {});'),
        coreNamespaces
      )
    ).toBe('signal');
  });

  test('rejects computed member access like ns[trail](...)', () => {
    expect(
      __getTrailCalleeNameForTest(
        parseCallee('ns[trail]("foo", {});'),
        new Set(['ns'])
      )
    ).toBeNull();
  });

  test('rejects unrelated bare callees', () => {
    expect(
      __getTrailCalleeNameForTest(parseCallee('other("foo", {});'))
    ).toBeNull();
  });

  test('rejects unrelated namespaced callees', () => {
    expect(
      __getTrailCalleeNameForTest(
        parseCallee('ns.other("foo", {});'),
        new Set(['ns'])
      )
    ).toBeNull();
  });

  test('rejects namespaced callees when the receiver is not a framework namespace', () => {
    // `analytics.trail(...)` must not be mistaken for `core.trail(...)` when
    // the `analytics` binding is not an `@ontrails/*` namespace import.
    expect(
      __getTrailCalleeNameForTest(
        parseCallee('analytics.trail("foo", {});'),
        coreNamespaces
      )
    ).toBeNull();
  });
});

describe('collectFrameworkNamespaceBindings', () => {
  test('collects the local name of an @ontrails/core namespace import', () => {
    const ast = parseOrThrow(`
      import * as core from '@ontrails/core';
    `);
    expect([...collectFrameworkNamespaceBindings(ast)].toSorted()).toEqual([
      'core',
    ]);
  });

  test('collects bindings for any @ontrails/* scoped package', () => {
    const ast = parseOrThrow(`
      import * as core from '@ontrails/core';
      import * as warden from '@ontrails/warden';
    `);
    expect([...collectFrameworkNamespaceBindings(ast)].toSorted()).toEqual([
      'core',
      'warden',
    ]);
  });

  test('ignores namespace imports from non-framework packages', () => {
    const ast = parseOrThrow(`
      import * as analytics from 'analytics';
    `);
    expect([...collectFrameworkNamespaceBindings(ast)]).toEqual([]);
  });

  test('ignores named imports from @ontrails/* packages', () => {
    const ast = parseOrThrow(`
      import {
  trail
} from '@ontrails/core';
    `);
    expect([...collectFrameworkNamespaceBindings(ast)]).toEqual([]);
  });
});

describe('findTrailDefinitions with namespaced callees', () => {
  test('discovers core.trail("id", { ... }) definitions', () => {
    const source = `
      import * as core from '@ontrails/core';
      export const t = core.trail('entity.show', {
        input: {},
      });
    `;
    const ast = parseOrThrow(source);
    const defs = findTrailDefinitions(ast);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.id).toBe('entity.show');
    expect(defs[0]?.kind).toBe('trail');
  });

  test('discovers core.trail({ id: "x", ... }) single-object form', () => {
    // Regression: confirms the single-object form (`trail({ id: 'x', ... })`)
    // is discovered the same way as the two-arg form via a namespaced callee.
    const source = `
      import * as core from '@ontrails/core';
      export const t = core.trail({ id: 'entity.show', input: {} });
    `;
    const ast = parseOrThrow(source);
    const defs = findTrailDefinitions(ast);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.id).toBe('entity.show');
    expect(defs[0]?.kind).toBe('trail');
  });

  test('discovers core.signal("id", { ... }) definitions', () => {
    const source = `
      import * as core from '@ontrails/core';
      export const s = core.signal('entity.created', { payload: {} });
    `;
    const ast = parseOrThrow(source);
    const defs = findTrailDefinitions(ast);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.id).toBe('entity.created');
    expect(defs[0]?.kind).toBe('signal');
  });

  test('still ignores computed-member access ns[trail]("id", ...)', () => {
    const source = `
      const trail = 'x';
      ns[trail]('entity.show', { input: {} });
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });

  test('ignores unrelated ns.trail(...) where ns is not an @ontrails import', () => {
    // Regression: `analytics.trail(...)` where `analytics` is not a framework
    // namespace must not be picked up as a trail definition.
    const source = `
      import * as analytics from 'analytics';
      analytics.trail('entity.show', { input: {} });
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });
});

describe('findTrailDefinitions scope-aware shadowing', () => {
  test('ignores core.trail(...) inside a function that locally shadows the namespace', () => {
    // Regression: a function-local `const core = {...}` must shadow the
    // module-level `import * as core from '@ontrails/core'` for the duration
    // of that function. A name-only check would let the local `core.trail()`
    // through; scope-aware resolution rejects it.
    const source = `
      import * as core from '@ontrails/core';
      function weird() {
        const core = { trail: (_id: string, _cfg: object) => undefined };
        core.trail('entity.show', { input: {} });
      }
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });

  test('still discovers module-level core.trail(...) when a sibling function shadows the namespace', () => {
    // Sanity check: a shadow inside one function must not suppress a
    // legitimate `core.trail(...)` at module scope.
    const source = `
      import * as core from '@ontrails/core';
      function weird() {
        const core = { trail: (_id: string, _cfg: object) => undefined };
        core.trail('entity.local', { input: {} });
      }
      export const t = core.trail('entity.show', { input: {} });
    `;
    const ast = parseOrThrow(source);
    const defs = findTrailDefinitions(ast);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.id).toBe('entity.show');
  });

  test('ignores core.trail(...) when a function parameter shadows the namespace', () => {
    const source = `
      import * as core from '@ontrails/core';
      function weird(core: { trail: (id: string, cfg: object) => void }) {
        core.trail('entity.show', { input: {} });
      }
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });

  test('ignores core.trail(...) when a ClassDeclaration shadows the namespace', () => {
    // A class declaration binds its name in the enclosing scope. Inside the
    // class body the name refers to the class, shadowing any module-level
    // namespace import of the same name.
    const source = `
      import * as core from '@ontrails/core';
      class core {
        field = core.trail('entity.show', { input: {} });
      }
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });

  test('ignores core.trail(...) when a named ClassExpression shadows the namespace inside its body', () => {
    // A named class expression's name is visible only inside its own body.
    const source = `
      import * as core from '@ontrails/core';
      const C = class core {
        field = core.trail('entity.show', { input: {} });
      };
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });

  test('ignores core.trail(...) when a TSEnumDeclaration shadows the namespace', () => {
    const source = `
      import * as core from '@ontrails/core';
      enum core { A, B }
      core.trail('entity.show', { input: {} });
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });

  test('ignores core.trail(...) when a TSModuleDeclaration (namespace) shadows the namespace', () => {
    const source = `
      import * as core from '@ontrails/core';
      namespace core { export const x = 1; }
      core.trail('entity.show', { input: {} });
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });

  test('ignores core.trail(...) inside a FunctionExpression body that locally shadows the namespace', () => {
    // oxc-parser emits `FunctionBody` for `function` expression bodies, not
    // `BlockStatement`. Without a `FunctionBody` entry in the scope-frame
    // collectors, a local `const core = {...}` at the top of the expression
    // body would not push a frame and the shadow would be missed.
    const source = `
      import * as core from '@ontrails/core';
      const fn = function weird() {
        const core = { trail: (_id: string, _cfg: object) => undefined };
        core.trail('entity.show', { input: {} });
      };
    `;
    const ast = parseOrThrow(source);
    expect(findTrailDefinitions(ast)).toHaveLength(0);
  });

  test('does not hoist block-local function declarations out of their block', () => {
    // A `function core(){}` inside an `if` block is block-scoped in strict
    // (module) code. Hoisting it to the enclosing function frame would
    // wrongly shadow the module-level `core` namespace for later code in
    // the same function, dropping the trail detection below.
    const source = `
      import * as core from '@ontrails/core';
      export function outer() {
        if (Math.random() > 0) {
          function core() { return 0; }
          core();
        }
        return core.trail('entity.show', { input: {} });
      }
    `;
    const ast = parseOrThrow(source);
    const defs = findTrailDefinitions(ast);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.id).toBe('entity.show');
  });
});

describe('getTrailCalleeName permissive fallback', () => {
  test('resolves namespaced core.trail(...) when no context is provided', () => {
    // Inline resolution paths (`composes: [core.trail(...)]`,
    // `on: [core.signal(...)]`) do not have access to the surrounding file
    // AST and so cannot build a FrameworkNamespaceContext. They must still
    // be able to recognize the trail/signal primitive by name.
    expect(
      __getTrailCalleeNameForTest(parseCallee('core.trail("foo", {});'))
    ).toBe('trail');
    expect(
      __getTrailCalleeNameForTest(parseCallee('core.signal("evt", {});'))
    ).toBe('signal');
  });
});

describe('findEntityDefinitions with namespaced callees', () => {
  test('discovers core.entity("name", { ... }) definitions', () => {
    const source = `
      import * as core from '@ontrails/core';
      export const user = core.entity('user', { id: 'string' });
    `;
    const ast = parseOrThrow(source);
    const defs = findEntityDefinitions(ast);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('user');
  });

  test('ignores unrelated ns.entity(...) where ns is not @ontrails/*', () => {
    const source = `
      import * as analytics from 'analytics';
      analytics.entity('user', { id: 'string' });
    `;
    const ast = parseOrThrow(source);
    expect(findEntityDefinitions(ast)).toHaveLength(0);
  });

  test('still rejects computed member access', () => {
    const source = `
      const entity = 'x';
      ns[entity]('user', { id: 'string' });
    `;
    const ast = parseOrThrow(source);
    expect(findEntityDefinitions(ast)).toHaveLength(0);
  });
});

describe('findEntityDefinitions inline discovery', () => {
  // Regression: `findEntityDefinitions` descends into nested object
  // expressions and surfaces inline `core.entity('inner', ...)` calls as
  // definitions alongside the outer binding. This behavior is load-bearing for
  // reference-site resolution (see `collectEntityReferenceSites`) and must
  // not silently regress.
  const inlineSource = `
      import * as core from '@ontrails/core';
      import {
  z
} from 'zod';

      export const outer = core.entity('outer', {
        id: z.string().uuid(),
        inner: core.entity('inner', { id: z.string().uuid() }).id(),
      });
    `;

  test('returns both outer and inline entity definitions by default', () => {
    const ast = parseOrThrow(inlineSource);
    const defs = findEntityDefinitions(ast);

    expect(defs).toHaveLength(2);
    const names = defs.map((d) => d.name).toSorted();
    expect(names).toEqual(['inner', 'outer']);

    const outer = defs.find((d) => d.name === 'outer');
    const inner = defs.find((d) => d.name === 'inner');
    expect(outer?.bindingName).toBe('outer');
    // Inline entities are anonymous call expressions — no binding name.
    expect(inner?.bindingName).toBeUndefined();
  });

  test('collectEntityDefinitionIds includes inline entity ids', () => {
    const ast = parseOrThrow(inlineSource);
    const ids = collectEntityDefinitionIds(ast);

    expect(ids.has('outer')).toBe(true);
    expect(ids.has('inner')).toBe(true);
  });

  test('collectNamedEntityIds excludes inline entities (no bindingName)', () => {
    const ast = parseOrThrow(inlineSource);
    const named = collectNamedEntityIds(ast);

    expect([...named.keys()].toSorted()).toEqual(['outer']);
    expect(named.get('outer')).toBe('outer');
    expect(named.has('inner')).toBe(false);
  });

  test('topLevelOnly: true skips inline entity discovery', () => {
    const ast = parseOrThrow(inlineSource);
    const defs = findEntityDefinitions(ast, undefined, {
      topLevelOnly: true,
    });

    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('outer');
    expect(defs[0]?.bindingName).toBe('outer');
  });

  test('topLevelOnly: true still surfaces top-level statement-form calls', () => {
    // Regression for Codex P2 on PR #222: the `topLevelOnly` guard must only
    // exclude inline nested entity calls. Top-level bare-statement forms
    // (`core.entity('name', {...});` directly in the program body, not
    // bound to a variable) are top-level and should still be returned.
    const statementFormSource = `
      import * as core from '@ontrails/core';
      import {
  z
} from 'zod';

      export const bound = core.entity('bound', {
        id: z.string().uuid(),
      });

      core.entity('bare', { id: z.string().uuid() });
    `;
    const ast = parseOrThrow(statementFormSource);
    const defs = findEntityDefinitions(ast, undefined, {
      topLevelOnly: true,
    });

    const names = defs.map((d) => d.name).toSorted();
    expect(names).toEqual(['bare', 'bound']);

    const bound = defs.find((d) => d.name === 'bound');
    const bare = defs.find((d) => d.name === 'bare');
    expect(bound?.bindingName).toBe('bound');
    // Bare statement-form calls have no local binding.
    expect(bare?.bindingName).toBeUndefined();
  });

  test('topLevelOnly: true surfaces export default core.entity(...) form', () => {
    // Regression for Greptile P2 on PR #227: collectTopLevelStatementCallStarts
    // branches on ExportDefaultDeclaration via getCandidateCallHosts, so an
    // export-default entity declaration must still be surfaced under the
    // topLevelOnly: true flag.
    const exportDefaultSource = `
      import * as core from '@ontrails/core';
      import {
  z
} from 'zod';

      export default core.entity('default-export', {
        id: z.string().uuid(),
      });
    `;
    const ast = parseOrThrow(exportDefaultSource);
    const defs = findEntityDefinitions(ast, undefined, {
      topLevelOnly: true,
    });

    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('default-export');
    // Export-default call expressions have no local binding name.
    expect(defs[0]?.bindingName).toBeUndefined();
  });
});

describe('collectEntityReferenceSites with namespaced inline entities', () => {
  test('resolves core.entity(...).id() when the file context is available', () => {
    const source = `
      import * as core from '@ontrails/core';
      import {
  z
} from 'zod';

      const gist = core.entity('gist', {
        id: z.string().uuid(),
        ownerId: core.entity('user', { id: z.string().uuid() }).id(),
      });
    `;
    const ast = parseOrThrow(source);
    const refs = collectEntityReferenceSites(ast);

    expect(refs).toHaveLength(1);
    expect(refs[0]?.source).toBe('gist');
    expect(refs[0]?.field).toBe('ownerId');
    expect(refs[0]?.target).toBe('user');
  });

  test('ignores analytics.entity(...).id() when the receiver is not a framework namespace', () => {
    const source = `
      import * as analytics from 'analytics';
      import {
  z
} from 'zod';

      const gist = entity('gist', {
        id: z.string().uuid(),
        ownerId: analytics.entity('user', { id: z.string().uuid() }).id(),
      });
    `;
    const ast = parseOrThrow(source);

    expect(collectEntityReferenceSites(ast)).toEqual([]);
  });

  test('unwraps wrapped entity id schemas before resolving the target', () => {
    const source = `
      import {
  entity
} from '@ontrails/core';
      import {
  z
} from 'zod';

      const user = entity('user', {
        id: z.string().uuid(),
      });

      const gist = entity('gist', {
        id: z.string().uuid(),
        ownerId: user.id().nullable().optional().default(null),
      });
    `;
    const ast = parseOrThrow(source);
    const refs = collectEntityReferenceSites(ast);

    expect(refs).toHaveLength(1);
    expect(refs[0]?.source).toBe('gist');
    expect(refs[0]?.field).toBe('ownerId');
    expect(refs[0]?.target).toBe('user');
  });
});
