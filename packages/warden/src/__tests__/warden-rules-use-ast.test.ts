import { readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { describe, expect, test } from 'bun:test';

import {
  replaceLastDistSegmentWithSrc,
  wardenRulesUseAst,
} from '../rules/warden-rules-use-ast.js';

const RULES_DIR = resolve(
  Bun.fileURLToPath(new URL('../rules/', import.meta.url))
);

const ruleFilePath = (basename: string): string => resolve(RULES_DIR, basename);

const isNonTestTypeScriptFile = (name: string): boolean =>
  name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts');

const diagnoseRuleFile = async (
  name: string
): Promise<{ readonly file: string; readonly count: number }> => {
  const filePath = ruleFilePath(name);
  const source = await Bun.file(filePath).text();
  return {
    count: wardenRulesUseAst.check(source, filePath).length,
    file: name,
  };
};

const collectBaselineFailures = async (): Promise<
  readonly {
    readonly file: string;
    readonly count: number;
  }[]
> => {
  const entries = await readdir(RULES_DIR);
  const ruleFiles = entries.filter(isNonTestTypeScriptFile);
  const results = await Promise.all(ruleFiles.map(diagnoseRuleFile));
  return results.filter((r) => r.count > 0);
};

describe('warden-rules-use-ast', () => {
  describe('scope', () => {
    test('ignores files outside packages/warden/src/rules/', () => {
      const foreign = resolve('/tmp/other-pkg/src/foo.ts');
      const diagnostics = wardenRulesUseAst.check(
        `const lines = sourceCode.split('\\n');\n`,
        foreign
      );
      expect(diagnostics).toEqual([]);
    });

    test('ignores ast.ts itself even if it contains raw-text patterns', () => {
      const diagnostics = wardenRulesUseAst.check(
        `export const parse = (s: string) => s.split('\\n');\nconst x = sourceCode.split('\\n');\n`,
        ruleFilePath('ast.ts')
      );
      expect(diagnostics).toEqual([]);
    });

    test('ignores support modules (types.ts, index.ts, registry-names.ts)', () => {
      const src = `const lines = sourceCode.split('\\n');\n`;
      expect(wardenRulesUseAst.check(src, ruleFilePath('types.ts'))).toEqual(
        []
      );
      expect(wardenRulesUseAst.check(src, ruleFilePath('index.ts'))).toEqual(
        []
      );
      expect(
        wardenRulesUseAst.check(src, ruleFilePath('registry-names.ts'))
      ).toEqual([]);
    });

    test('ignores dist-layout support modules (ast.js, index.js, types.js, etc.)', () => {
      // When this rule is bundled to packages/warden/dist/rules/, the support
      // modules ship alongside it as `.js` files. `ast.js` in particular is
      // the raw-text interface to the parser and would false-positive if
      // scanned, so EXCLUDED_BASENAMES must cover both `.ts` and `.js` stems.
      const raw = `export const parse = (s: string) => s.split('\\n');\nconst x = sourceCode.split('\\n');\n`;
      expect(wardenRulesUseAst.check(raw, ruleFilePath('ast.js'))).toEqual([]);
      expect(wardenRulesUseAst.check(raw, ruleFilePath('index.js'))).toEqual(
        []
      );
      expect(wardenRulesUseAst.check(raw, ruleFilePath('types.js'))).toEqual(
        []
      );
      expect(
        wardenRulesUseAst.check(raw, ruleFilePath('registry-names.js'))
      ).toEqual([]);
      expect(wardenRulesUseAst.check(raw, ruleFilePath('scan.js'))).toEqual([]);
      expect(wardenRulesUseAst.check(raw, ruleFilePath('specs.js'))).toEqual(
        []
      );
      expect(
        wardenRulesUseAst.check(raw, ruleFilePath('structure.js'))
      ).toEqual([]);
    });

    test('ignores test files colocated under the rules directory', () => {
      const diagnostics = wardenRulesUseAst.check(
        `const lines = sourceCode.split('\\n');\n`,
        ruleFilePath('some-rule.test.ts')
      );
      expect(diagnostics).toEqual([]);
    });
  });

  describe('baseline', () => {
    test('every real rule file in packages/warden/src/rules/ is clean', async () => {
      const failures = await collectBaselineFailures();
      expect(failures).toEqual([]);
    });
  });

  describe('positive fixtures: string-method scans', () => {
    const targetFile = ruleFilePath('fake-rule.ts');

    test('flags sourceCode.split("\\n")', () => {
      const source = `export const r = { check(sourceCode: string) { const lines = sourceCode.split('\\n'); return lines; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.rule).toBe('warden-rules-use-ast');
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('split');
    });

    test('flags sourceCode.matchAll(/.../ g)', () => {
      const source = `export const r = { check(sourceCode: string) { for (const m of sourceCode.matchAll(/foo/g)) { void m; } return []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('matchAll');
    });

    test('flags text.split(/\\n/)', () => {
      const source = `export const r = { check(text: string) { const lines = text.split(/\\n/); return lines; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('split');
    });

    test('flags sourceCode.match(/.../)', () => {
      const source = `export const r = { check(sourceCode: string) { return sourceCode.match(/foo/) ?? []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('match');
    });

    test('flags rawText.matchAll(/.../ g)', () => {
      const source = `export const r = { check(rawText: string) { return [...rawText.matchAll(/foo/g)]; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('matchAll');
    });

    test('sourceCode.split(/regex/) fires once, not twice', () => {
      // sourceCode.split(/.../) is covered by the receiver.method path;
      // confirm the regex-arg path does not double-fire on the same site.
      const source = `export const r = { check(sourceCode: string) { const parts = sourceCode.split(/foo/); return parts; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('split');
    });

    // oxc-parser can emit either `MemberExpression` or `StaticMemberExpression`
    // for non-computed member access depending on context. The rule must flow
    // through both shapes.
    test('flags sourceCode.split regardless of MemberExpression vs StaticMemberExpression shape', () => {
      const source = `export const r = { check(sourceCode: string) { return sourceCode.split('\\n'); } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
    });

    test('flags /regex/.test(sourceCode) regardless of MemberExpression vs StaticMemberExpression shape', () => {
      const source = `export const r = { check(sourceCode: string) { return /foo/.test(sourceCode) ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
    });
  });

  describe('positive fixtures: replace/search scans', () => {
    const targetFile = ruleFilePath('fake-rule.ts');

    test('flags sourceCode.replace(/.../, ...)', () => {
      const source = `export const r = { check(sourceCode: string) { return sourceCode.replace(/foo/, 'bar'); } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('replace');
    });

    test('flags sourceCode.replaceAll(/.../, ...)', () => {
      const source = `export const r = { check(sourceCode: string) { return sourceCode.replaceAll(/foo/g, 'bar'); } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('replaceAll');
    });

    test('flags sourceCode.search(/.../)', () => {
      const source = `export const r = { check(sourceCode: string) { return sourceCode.search(/foo/); } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('search');
    });

    test('flags sourceCode.replace("literal", "other") — consistent with split', () => {
      // Mirrors split(string) behavior: the method name alone is enough to
      // flag, because any replace-on-source-text indicates raw scanning.
      const source = `export const r = { check(sourceCode: string) { return sourceCode.replace('foo', 'bar'); } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('replace');
    });
  });

  describe('positive fixtures: regex-method scans', () => {
    const targetFile = ruleFilePath('fake-rule.ts');

    test('flags /regex/.test(sourceCode)', () => {
      const source = `export const r = { check(sourceCode: string) { const has = /\\btrail\\s*\\(/.test(sourceCode); return has ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('test');
      expect(diagnostics[0]?.rule).toBe('warden-rules-use-ast');
    });

    test('flags /regex/.exec(sourceCode)', () => {
      const source = `export const r = { check(sourceCode: string) { const m = /foo/.exec(sourceCode); return m ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('exec');
    });

    test('flags new RegExp(...).test(sourceCode)', () => {
      const source = `export const r = { check(sourceCode: string) { const has = new RegExp('foo').test(sourceCode); return has ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('test');
    });

    test('flags /regex/.test(text)', () => {
      const source = `export const r = { check(text: string) { return /foo/.test(text) ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('test');
    });
  });

  describe('positive fixtures: regex construction from raw source', () => {
    const targetFile = ruleFilePath('fake-rule.ts');

    test('flags new RegExp(sourceCode)', () => {
      const source = `export const r = { check(sourceCode: string) { const pattern = new RegExp(sourceCode); return pattern ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.rule).toBe('warden-rules-use-ast');
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('new RegExp(sourceCode)');
      expect(diagnostics[0]?.message).toContain('constructs a regex');
    });

    test('flags new RegExp(rawText, "g")', () => {
      const source = `export const r = { check(rawText: string) { const pattern = new RegExp(rawText, 'g'); return pattern ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('new RegExp(rawText)');
    });

    test('flags RegExp(sourceCode) without new', () => {
      const source = `export const r = { check(sourceCode: string) { const pattern = RegExp(sourceCode); return pattern ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('RegExp(sourceCode)');
      expect(diagnostics[0]?.message).not.toContain('new RegExp');
    });

    test('does not flag new RegExp("literal") with string literal arg', () => {
      const source = `export const r = { check() { const pattern = new RegExp('foo'); return pattern ? [] : []; } };\n`;
      expect(wardenRulesUseAst.check(source, targetFile)).toEqual([]);
    });

    test('flags new RegExp(userInput) when userInput is the first param of check (custom name)', () => {
      // Under parameter-origin tracking (TRL-346 / Option A), the *binding
      // identity* of the first `check` parameter is what matters — not its
      // spelling. A rule author who renames the source parameter cannot
      // silently opt out of the diagnostic by picking an unusual name.
      const source = `export const r = { check(userInput: string) { const pattern = new RegExp(userInput); return pattern ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('new RegExp(userInput)');
    });
  });

  describe('parameter-origin tracking (TRL-346 / Option A)', () => {
    // The pre-TRL-346 detectors gated on identifier spelling alone (a fixed
    // set of raw-source names). That over-fired on unrelated locals whose
    // names happened to appear in the list, and under-fired when a rule
    // author picked a different name for the source parameter. These tests
    // exercise the scope-aware replacement.
    const targetFile = ruleFilePath('fake-rule.ts');

    test('does not flag inner const that shadows the check parameter', () => {
      // The inner `const sourceCode` is a local, not the rule's source
      // parameter — flagging would be a false positive.
      const source = `export const r = { check(sourceCode: string, filePath: string) { const inner: string = filePath; { const sourceCode = inner; const pattern = new RegExp(sourceCode); return pattern ? [] : []; } } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });

    test('scope: does not flag a local named `text` unrelated to the source param', () => {
      // Pre-Option A, the old RAW_SOURCE_IDENTIFIERS heuristic would fire
      // here because `text` is in the set. Under parameter-origin tracking
      // the local `text` shadows nothing and does not resolve to the rule's
      // first parameter, so no diagnostic.
      const source = `export const r = { check(src: string, filePath: string) { const text: string = filePath; const pattern = new RegExp(text); return pattern ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });

    test('scope: flags new RegExp(src) when src is the first param of check (custom name)', () => {
      // The param binding, not the spelling, drives the diagnostic.
      const source = `export const r = { check(src: string) { const pattern = new RegExp(src); return pattern ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('new RegExp(src)');
    });

    test('scope: flags sourceCode.split when sourceCode is a checkWithContext param', () => {
      // `checkWithContext` is the project-aware sibling of `check`; its
      // first parameter is also raw source text and must be tracked.
      const source = `export const r = { checkWithContext(sourceCode: string, filePath: string, ctx: unknown) { return sourceCode.split('\\n'); } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('split');
    });

    test('scope: does not flag sourceCode.split inside checkTopo (no raw source param)', () => {
      // `checkTopo(topo)` does not receive raw source text. A local named
      // `sourceCode` inside it is just a domain string and must not fire
      // — this was the core false-positive scenario TRL-346 fixes.
      const source = `export const r = { checkTopo(topo: unknown) { const sourceCode = 'arbitrary-data'; return sourceCode.split(','); } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });

    test('scope: does not flag source-like identifiers at module scope', () => {
      // Free identifiers with no enclosing `check` method cannot resolve to
      // a tracked source-param binding, so detection stays silent.
      const source = `const sourceCode = 'abc'; const pattern = new RegExp(sourceCode);\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });

    test('scope: catch-clause param shadowing does not fire', () => {
      // The `catch (sourceCode)` binding is a different scope from the
      // enclosing `check` parameter. The `.split()` inside the catch block
      // reads the catch param, not the rule's source-text parameter.
      const source =
        "export const r = { check(sourceCode: string, filePath: string) { try { return []; } catch (sourceCode) { return sourceCode.split('\\n'); } } };\n";
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });

    test('scope: hoisted var inside a block shadows the check param', () => {
      // `var sourceCode` inside `if (cond) { ... }` hoists to the function
      // body and shadows the parameter. The `.split(...)` after the block
      // reads the hoisted var, not the param, so no diagnostic.
      const source =
        "export const r = { check(sourceCode: string, filePath: string) { if (filePath) { var sourceCode = 'local'; } return sourceCode.split('\\n'); } };\n";
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });
  });

  describe('idiomatic patterns are not flagged', () => {
    const targetFile = ruleFilePath('fake-rule.ts');

    test('sourceCode.slice(node.start, node.end) is allowed (AST-guided)', () => {
      const source = `export const r = { check(sourceCode: string) { const t = sourceCode.slice(0, 10); return t; } };\n`;
      expect(wardenRulesUseAst.check(source, targetFile)).toEqual([]);
    });

    test('sourceCode.includes("marker") is allowed (fast-bail)', () => {
      const source = `export const r = { check(sourceCode: string) { if (!sourceCode.includes('marker')) return []; return []; } };\n`;
      expect(wardenRulesUseAst.check(source, targetFile)).toEqual([]);
    });

    test('sourceCode.indexOf is allowed', () => {
      const source = `export const r = { check(sourceCode: string) { const i = sourceCode.indexOf('x'); return i; } };\n`;
      expect(wardenRulesUseAst.check(source, targetFile)).toEqual([]);
    });
  });

  describe('negative fixtures', () => {
    const targetFile = ruleFilePath('fake-rule.ts');

    test('does not flag AST helpers (findStringLiterals, walk)', () => {
      const source = `import { findStringLiterals, parse, walk } from './ast.js';
export const r = {
  check(sourceCode: string, filePath: string) {
    const ast = parse(filePath, sourceCode);
    if (!ast) return [];
    const hits = findStringLiterals(ast, /foo/);
    walk(ast, (node) => { void node; });
    return hits.map((h) => ({ line: 1, rule: 'x', message: '', severity: 'error', filePath })) ;
  }
};
`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });

    test('does not flag findTrailDefinitions walker usage', () => {
      const source = `import { findTrailDefinitions } from './ast.js';
export const r = { check(sourceCode: string, filePath: string) { const defs = findTrailDefinitions(sourceCode as unknown as never); return defs.length ? [] : []; } };
`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });

    test('does not flag string methods on unrelated identifiers', () => {
      const source = `export const r = { check() { const arr = ['a', 'b']; const s = arr.join(',').split(','); const path = 'foo.ts'; path.includes('foo'); return s; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });

    test('does not flag /regex/.test on non-raw-text identifier', () => {
      const source = `export const r = { check() { const name = 'foo'; return /bar/.test(name) ? [] : []; } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });

    test('does not flag computed member access', () => {
      // Defensive: computed member access is too ambiguous to flag reliably.
      const source = `export const r = { check(sourceCode: string) { const m = 'split'; return (sourceCode as unknown as { [k: string]: Function })[m]('\\n'); } };\n`;
      const diagnostics = wardenRulesUseAst.check(source, targetFile);
      expect(diagnostics).toEqual([]);
    });
  });

  describe('replaceLastDistSegmentWithSrc', () => {
    test('replaces a single /dist/ segment', () => {
      const input = `${sep}home${sep}user${sep}pkg${sep}dist${sep}rules`;
      const expected = `${sep}home${sep}user${sep}pkg${sep}src${sep}rules`;
      expect(replaceLastDistSegmentWithSrc(input)).toBe(expected);
    });

    test('replaces only the LAST /dist/ segment when multiple are present', () => {
      // Simulates a CI path like /home/runner/dist-artifacts/... except with
      // a real /dist/ higher up the tree. A blanket replaceAll would mangle
      // both segments and yield a nonexistent directory.
      const input = `${sep}srv${sep}dist${sep}warden${sep}dist${sep}rules`;
      const expected = `${sep}srv${sep}dist${sep}warden${sep}src${sep}rules`;
      expect(replaceLastDistSegmentWithSrc(input)).toBe(expected);
    });

    test('returns the path unchanged when no /dist/ segment is present', () => {
      const input = `${sep}home${sep}user${sep}pkg${sep}src${sep}rules`;
      expect(replaceLastDistSegmentWithSrc(input)).toBe(input);
    });

    test('does not substitute inside /dist-artifacts/ lookalikes', () => {
      // The delimiter requires /dist/ surrounded by separators, so
      // `dist-artifacts` must be preserved verbatim.
      const input = `${sep}runner${sep}dist-artifacts${sep}pkg${sep}dist${sep}rules`;
      const expected = `${sep}runner${sep}dist-artifacts${sep}pkg${sep}src${sep}rules`;
      expect(replaceLastDistSegmentWithSrc(input)).toBe(expected);
    });
  });
});
