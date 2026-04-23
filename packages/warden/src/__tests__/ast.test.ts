import { describe, expect, test } from 'bun:test';

import {
  __collectFrameworkNamespaceBindingsForTest,
  collectContourDefinitionIds,
  collectContourReferenceSites,
  collectNamedContourIds,
  __getTrailCalleeNameForTest,
  deriveContourIdentifierName,
  findContourDefinitions,
  findTrailDefinitions,
  hasIgnoreCommentOnLine,
  parse,
  splitSourceLines,
} from '../rules/ast.js';

describe('deriveContourIdentifierName', () => {
  test('supports the common *Contour binding suffix when resolving known contours', () => {
    expect(
      deriveContourIdentifierName(
        'userContour',
        new Map<string, string>(),
        new Set(['user'])
      )
    ).toBe('user');
  });

  test('prefers exact contour ids over the *Contour fallback', () => {
    expect(
      deriveContourIdentifierName(
        'userContour',
        new Map<string, string>(),
        new Set(['user', 'userContour'])
      )
    ).toBe('userContour');
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

const parseCallee = (source: string) => {
  const ast = parseOrThrow(source);
  // The first statement is an ExpressionStatement wrapping the CallExpression.
  const [stmt] = (ast as unknown as { body: readonly unknown[] }).body;
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
    expect(
      [...__collectFrameworkNamespaceBindingsForTest(ast)].toSorted()
    ).toEqual(['core']);
  });

  test('collects bindings for any @ontrails/* scoped package', () => {
    const ast = parseOrThrow(`
      import * as core from '@ontrails/core';
      import * as warden from '@ontrails/warden';
    `);
    expect(
      [...__collectFrameworkNamespaceBindingsForTest(ast)].toSorted()
    ).toEqual(['core', 'warden']);
  });

  test('ignores namespace imports from non-framework packages', () => {
    const ast = parseOrThrow(`
      import * as analytics from 'analytics';
    `);
    expect([...__collectFrameworkNamespaceBindingsForTest(ast)]).toEqual([]);
  });

  test('ignores named imports from @ontrails/* packages', () => {
    const ast = parseOrThrow(`
      import { trail } from '@ontrails/core';
    `);
    expect([...__collectFrameworkNamespaceBindingsForTest(ast)]).toEqual([]);
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
    // Inline resolution paths (`crosses: [core.trail(...)]`,
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

describe('findContourDefinitions with namespaced callees', () => {
  test('discovers core.contour("name", { ... }) definitions', () => {
    const source = `
      import * as core from '@ontrails/core';
      export const user = core.contour('user', { id: 'string' });
    `;
    const ast = parseOrThrow(source);
    const defs = findContourDefinitions(ast);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('user');
  });

  test('ignores unrelated ns.contour(...) where ns is not @ontrails/*', () => {
    const source = `
      import * as analytics from 'analytics';
      analytics.contour('user', { id: 'string' });
    `;
    const ast = parseOrThrow(source);
    expect(findContourDefinitions(ast)).toHaveLength(0);
  });

  test('still rejects computed member access', () => {
    const source = `
      const contour = 'x';
      ns[contour]('user', { id: 'string' });
    `;
    const ast = parseOrThrow(source);
    expect(findContourDefinitions(ast)).toHaveLength(0);
  });
});

describe('findContourDefinitions inline discovery', () => {
  // Regression: `findContourDefinitions` descends into nested object
  // expressions and surfaces inline `core.contour('inner', ...)` calls as
  // definitions alongside the outer binding. This behavior is load-bearing for
  // reference-site resolution (see `collectContourReferenceSites`) and must
  // not silently regress.
  const inlineSource = `
      import * as core from '@ontrails/core';
      import { z } from 'zod';

      export const outer = core.contour('outer', {
        id: z.string().uuid(),
        inner: core.contour('inner', { id: z.string().uuid() }).id(),
      });
    `;

  test('returns both outer and inline contour definitions by default', () => {
    const ast = parseOrThrow(inlineSource);
    const defs = findContourDefinitions(ast);

    expect(defs).toHaveLength(2);
    const names = defs.map((d) => d.name).toSorted();
    expect(names).toEqual(['inner', 'outer']);

    const outer = defs.find((d) => d.name === 'outer');
    const inner = defs.find((d) => d.name === 'inner');
    expect(outer?.bindingName).toBe('outer');
    // Inline contours are anonymous call expressions — no binding name.
    expect(inner?.bindingName).toBeUndefined();
  });

  test('collectContourDefinitionIds includes inline contour ids', () => {
    const ast = parseOrThrow(inlineSource);
    const ids = collectContourDefinitionIds(ast);

    expect(ids.has('outer')).toBe(true);
    expect(ids.has('inner')).toBe(true);
  });

  test('collectNamedContourIds excludes inline contours (no bindingName)', () => {
    const ast = parseOrThrow(inlineSource);
    const named = collectNamedContourIds(ast);

    expect([...named.keys()].toSorted()).toEqual(['outer']);
    expect(named.get('outer')).toBe('outer');
    expect(named.has('inner')).toBe(false);
  });

  test('topLevelOnly: true skips inline contour discovery', () => {
    const ast = parseOrThrow(inlineSource);
    const defs = findContourDefinitions(ast, undefined, {
      topLevelOnly: true,
    });

    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('outer');
    expect(defs[0]?.bindingName).toBe('outer');
  });

  test('topLevelOnly: true still surfaces top-level statement-form calls', () => {
    // Regression for Codex P2 on PR #222: the `topLevelOnly` guard must only
    // exclude inline nested contour calls. Top-level bare-statement forms
    // (`core.contour('name', {...});` directly in the program body, not
    // bound to a variable) are top-level and should still be returned.
    const statementFormSource = `
      import * as core from '@ontrails/core';
      import { z } from 'zod';

      export const bound = core.contour('bound', {
        id: z.string().uuid(),
      });

      core.contour('bare', { id: z.string().uuid() });
    `;
    const ast = parseOrThrow(statementFormSource);
    const defs = findContourDefinitions(ast, undefined, {
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

  test('topLevelOnly: true surfaces export default core.contour(...) form', () => {
    // Regression for Greptile P2 on PR #227: collectTopLevelStatementCallStarts
    // branches on ExportDefaultDeclaration via getCandidateCallHosts, so an
    // export-default contour declaration must still be surfaced under the
    // topLevelOnly: true flag.
    const exportDefaultSource = `
      import * as core from '@ontrails/core';
      import { z } from 'zod';

      export default core.contour('default-export', {
        id: z.string().uuid(),
      });
    `;
    const ast = parseOrThrow(exportDefaultSource);
    const defs = findContourDefinitions(ast, undefined, {
      topLevelOnly: true,
    });

    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('default-export');
    // Export-default call expressions have no local binding name.
    expect(defs[0]?.bindingName).toBeUndefined();
  });
});

describe('collectContourReferenceSites with namespaced inline contours', () => {
  test('resolves core.contour(...).id() when the file context is available', () => {
    const source = `
      import * as core from '@ontrails/core';
      import { z } from 'zod';

      const gist = core.contour('gist', {
        id: z.string().uuid(),
        ownerId: core.contour('user', { id: z.string().uuid() }).id(),
      });
    `;
    const ast = parseOrThrow(source);
    const refs = collectContourReferenceSites(ast);

    expect(refs).toHaveLength(1);
    expect(refs[0]?.source).toBe('gist');
    expect(refs[0]?.field).toBe('ownerId');
    expect(refs[0]?.target).toBe('user');
  });

  test('ignores analytics.contour(...).id() when the receiver is not a framework namespace', () => {
    const source = `
      import * as analytics from 'analytics';
      import { z } from 'zod';

      const gist = contour('gist', {
        id: z.string().uuid(),
        ownerId: analytics.contour('user', { id: z.string().uuid() }).id(),
      });
    `;
    const ast = parseOrThrow(source);

    expect(collectContourReferenceSites(ast)).toEqual([]);
  });

  test('unwraps wrapped contour id schemas before resolving the target', () => {
    const source = `
      import { contour } from '@ontrails/core';
      import { z } from 'zod';

      const user = contour('user', {
        id: z.string().uuid(),
      });

      const gist = contour('gist', {
        id: z.string().uuid(),
        ownerId: user.id().nullable().optional().default(null),
      });
    `;
    const ast = parseOrThrow(source);
    const refs = collectContourReferenceSites(ast);

    expect(refs).toHaveLength(1);
    expect(refs[0]?.source).toBe('gist');
    expect(refs[0]?.field).toBe('ownerId');
    expect(refs[0]?.target).toBe('user');
  });
});
