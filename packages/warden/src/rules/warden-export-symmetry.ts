/**
 * Enforces ADR-0036: `@ontrails/warden` exposes only a trail-wrapper + registry
 * surface. Raw rule objects stay internal to `./rules/`. The public barrel
 * (`packages/warden/src/index.ts`) must:
 *
 *  1. Export a matching `*Trail` identifier for every entry in
 *     `wardenRules` / `wardenTopoRules`.
 *  2. Not expose a `*Trail` identifier with no matching registry entry.
 *  3. Not re-export a raw rule object by its camelCased name.
 *
 * Properties 1 and 2 cannot be fully derived today because the registry holds
 * raw `WardenRule` objects whose `.check()` methods are called by the trail
 * wrappers; flipping the dependency (registry ← trails) would require unwrapping
 * trails at dispatch time and is out of scope for TRL-341. Enforcement therefore
 * lives as a lint rule keyed on the warden barrel file path.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk, offsetToLine, parse } from './ast.js';
import type { AstNode } from './ast.js';
import { registeredRuleNames } from './registry-names.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const SELF_RULE_NAME = 'warden-export-symmetry';

/**
 * Absolute path to this package's own `src/index.ts`, resolved from the rule's
 * own module URL. Anchoring to the real on-disk location prevents the rule
 * from firing against a foreign `packages/warden/src/index.ts` in a consumer
 * repository with the same folder structure — the rule would otherwise compare
 * that unrelated barrel against `@ontrails/warden`'s internal registry and
 * emit bogus missing/orphan diagnostics that break consumer CI.
 */
const SELF_BARREL_PATH = resolve(
  fileURLToPath(new URL('../index.ts', import.meta.url))
);

const isTargetFile = (filePath: string): boolean =>
  resolve(filePath) === SELF_BARREL_PATH;

const kebabToCamel = (value: string): string =>
  value.replaceAll(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

interface ExportSite {
  /** Public export name — what consumers see on the barrel. */
  readonly name: string;
  /**
   * Local source binding name. For alias re-exports
   * (`export { foo as bar }`) this is `foo`. Equals `name` for non-aliased
   * exports and for declaration-form exports (`export const foo = ...`).
   * Used by `rawRuleLeakDiagnostics` so aliasing a raw rule does not sanitize it.
   */
  readonly localName: string;
  readonly start: number;
}

const readIdentifierOrStringName = (
  node: AstNode | undefined
): string | null => {
  if (!node) {
    return null;
  }
  if (node.type === 'Identifier') {
    return (node as unknown as { name?: string }).name ?? null;
  }
  if (node.type === 'Literal' || node.type === 'StringLiteral') {
    const { value } = node as unknown as { value?: unknown };
    return typeof value === 'string' ? value : null;
  }
  return null;
};

const extractSpecifierNames = (
  specifier: AstNode
): { readonly name: string; readonly localName: string } | null => {
  const { exported, local } = specifier as unknown as {
    exported?: AstNode;
    local?: AstNode;
  };
  const name = readIdentifierOrStringName(exported);
  if (!name) {
    return null;
  }
  const localName = readIdentifierOrStringName(local) ?? name;
  return { localName, name };
};

const isTypeExportSpecifier = (specifier: AstNode): boolean =>
  (specifier as unknown as { exportKind?: string }).exportKind === 'type';

const specifierSite = (specifier: AstNode): ExportSite | null => {
  if (
    specifier.type !== 'ExportSpecifier' ||
    isTypeExportSpecifier(specifier)
  ) {
    return null;
  }
  const names = extractSpecifierNames(specifier);
  return names ? { ...names, start: specifier.start } : null;
};

const TYPE_ONLY_DECL_TYPES = new Set([
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
]);

const namedSiteFromDeclId = (
  declId: AstNode | undefined,
  start: number
): ExportSite | null => {
  const name = readIdentifierOrStringName(declId);
  return name ? { localName: name, name, start } : null;
};

/**
 * Extract an identifier or `AssignmentPattern`'s left-hand identifier as a
 * single export site. Returns null for anything else (nested patterns should
 * be routed through `sitesFromPattern`).
 */
const siteFromSimpleBinding = (
  node: AstNode | undefined,
  start: number
): ExportSite | null => {
  if (!node) {
    return null;
  }
  if (node.type === 'Identifier') {
    const name = readIdentifierOrStringName(node);
    return name ? { localName: name, name, start } : null;
  }
  if (node.type === 'AssignmentPattern') {
    const { left } = node as unknown as { left?: AstNode };
    return left ? siteFromSimpleBinding(left, start) : null;
  }
  return null;
};

/** Callback type to break the recursion cycle without use-before-define. */
type PatternSitesFn = (
  pattern: AstNode | undefined,
  start: number
) => readonly ExportSite[];

/**
 * Compose a rename-pair site from an `ObjectPattern` property's `key` and a
 * resolved value site. Rename pairs (`{ foo: bar }`) emit one site whose
 * `localName` is the source binding `foo` and whose public `name` is the
 * target `bar`, mirroring `extractSpecifierNames` for `export { foo as bar }`.
 */
const renamePairSite = (
  key: AstNode | undefined,
  valueSite: ExportSite,
  start: number
): ExportSite => {
  const keyName = readIdentifierOrStringName(key);
  return {
    localName: keyName ?? valueSite.localName,
    name: valueSite.name,
    start,
  };
};

const isNestedPatternValue = (value: AstNode | undefined): boolean =>
  !!value && value.type !== 'Identifier' && value.type !== 'AssignmentPattern';

/**
 * Extract sites from a single `ObjectPattern` property.
 */
const sitesFromObjectProperty = (
  prop: AstNode,
  start: number,
  recurse: PatternSitesFn
): readonly ExportSite[] => {
  if (prop.type === 'RestElement') {
    const { argument } = prop as unknown as { argument?: AstNode };
    return recurse(argument, start);
  }
  if (prop.type !== 'Property') {
    return [];
  }
  const { key, value } = prop as unknown as {
    key?: AstNode;
    value?: AstNode;
  };
  if (isNestedPatternValue(value)) {
    return recurse(value, start);
  }
  const valueSite = siteFromSimpleBinding(value, start);
  return valueSite ? [renamePairSite(key, valueSite, start)] : [];
};

const sitesFromArrayElement = (
  element: AstNode | null,
  start: number,
  recurse: PatternSitesFn
): readonly ExportSite[] => {
  if (!element) {
    return [];
  }
  if (element.type === 'RestElement') {
    const { argument } = element as unknown as { argument?: AstNode };
    return recurse(argument, start);
  }
  return recurse(element, start);
};

const sitesFromObjectPattern = (
  pattern: AstNode,
  start: number,
  recurse: PatternSitesFn
): readonly ExportSite[] => {
  const properties =
    (pattern as unknown as { properties?: readonly AstNode[] }).properties ??
    [];
  return properties.flatMap((prop) =>
    sitesFromObjectProperty(prop, start, recurse)
  );
};

const sitesFromArrayPattern = (
  pattern: AstNode,
  start: number,
  recurse: PatternSitesFn
): readonly ExportSite[] => {
  const elements =
    (pattern as unknown as { elements?: readonly (AstNode | null)[] })
      .elements ?? [];
  return elements.flatMap((element) =>
    sitesFromArrayElement(element, start, recurse)
  );
};

/**
 * Recursively extract export sites from a declarator id, supporting
 * `ObjectPattern` and `ArrayPattern` destructuring. Without this, a
 * destructured `export const { wardenExportSymmetry } = rulesModule` silently
 * bypasses orphan-trail and raw-rule-leak checks because the id is not an
 * `Identifier`.
 */
const sitesFromPattern: PatternSitesFn = (pattern, start) => {
  if (!pattern) {
    return [];
  }
  const simple = siteFromSimpleBinding(pattern, start);
  if (simple) {
    return [simple];
  }
  if (pattern.type === 'ObjectPattern') {
    return sitesFromObjectPattern(pattern, start, sitesFromPattern);
  }
  if (pattern.type === 'ArrayPattern') {
    return sitesFromArrayPattern(pattern, start, sitesFromPattern);
  }
  return [];
};

const sitesForDeclaration = (declaration: AstNode): readonly ExportSite[] => {
  if (TYPE_ONLY_DECL_TYPES.has(declaration.type)) {
    return [];
  }
  if (
    declaration.type === 'FunctionDeclaration' ||
    declaration.type === 'ClassDeclaration'
  ) {
    const { id } = declaration as unknown as { id?: AstNode };
    const site = namedSiteFromDeclId(id, declaration.start);
    return site ? [site] : [];
  }
  if (declaration.type === 'VariableDeclaration') {
    const declarations =
      (declaration as unknown as { declarations?: readonly AstNode[] })
        .declarations ?? [];
    return declarations.flatMap((declarator) => {
      const { id } = declarator as unknown as { id?: AstNode };
      return sitesFromPattern(id, declarator.start);
    });
  }
  return [];
};

const sitesForExportNode = (node: AstNode): readonly ExportSite[] => {
  if (node.type !== 'ExportNamedDeclaration') {
    return [];
  }
  if ((node as unknown as { exportKind?: string }).exportKind === 'type') {
    return [];
  }
  const { declaration } = node as unknown as { declaration?: AstNode };
  if (declaration) {
    return sitesForDeclaration(declaration);
  }
  const specifiers =
    (node['specifiers'] as readonly AstNode[] | undefined) ?? [];
  return specifiers.flatMap((specifier) => {
    const site = specifierSite(specifier);
    return site ? [site] : [];
  });
};

const collectNamedExports = (ast: AstNode): readonly ExportSite[] => {
  const sites: ExportSite[] = [];
  walk(ast, (node) => {
    sites.push(...sitesForExportNode(node));
  });
  return sites;
};

interface NamespaceReexportSite {
  /** Source module path, e.g. `'./trails/index.js'`. */
  readonly target: string;
  /** Alias for `export * as <alias> from '...'`, null for bare `export *`. */
  readonly alias: string | null;
  readonly start: number;
}

const collectNamespaceReexports = (
  ast: AstNode
): readonly NamespaceReexportSite[] => {
  const sites: NamespaceReexportSite[] = [];
  walk(ast, (node) => {
    if (node.type !== 'ExportAllDeclaration') {
      return;
    }
    // Mirror the `ExportNamedDeclaration` guard: `export type * from ...` and
    // `export type * as ns from ...` propagate types only, never runtime
    // identifiers, so they cannot leak raw rule objects and must be allowed.
    if ((node as unknown as { exportKind?: string }).exportKind === 'type') {
      return;
    }
    const { source, exported } = node as unknown as {
      source?: { value?: unknown };
      exported?: AstNode;
    };
    const target =
      typeof source?.value === 'string' ? source.value : '<unknown>';
    // `export * as <alias> from '...'` exposes the alias as an
    // `IdentifierName` / string-literal node on `exported`. Bare `export *`
    // has `exported === null`.
    const alias = readIdentifierOrStringName(exported);
    sites.push({ alias, start: node.start, target });
  });
  return sites;
};

const formatNamespaceReexport = (site: NamespaceReexportSite): string =>
  site.alias
    ? `* as ${site.alias} from '${site.target}'`
    : `* from '${site.target}'`;

const namespaceReexportDiagnostics = (
  sourceCode: string,
  filePath: string,
  sites: readonly NamespaceReexportSite[]
): readonly WardenDiagnostic[] =>
  sites.map((site) => ({
    filePath,
    line: offsetToLine(sourceCode, site.start),
    message:
      `warden-export-symmetry: namespace re-export "export ${formatNamespaceReexport(site)}" is not permitted on the warden public barrel. ` +
      'The rule cannot verify registry ↔ trail symmetry through a star export — list each *Trail by name instead (ADR-0036).',
    rule: 'warden-export-symmetry',
    severity: 'error' as const,
  }));

const buildRegistryNameSets = (): {
  readonly ruleNames: readonly string[];
  readonly expectedTrailExports: ReadonlySet<string>;
  readonly rawRuleCamelNames: ReadonlySet<string>;
} => {
  const ruleNames = [...registeredRuleNames, SELF_RULE_NAME];
  const camelNames = ruleNames.map(kebabToCamel);
  return {
    expectedTrailExports: new Set(camelNames.map((name) => `${name}Trail`)),
    rawRuleCamelNames: new Set(camelNames),
    ruleNames,
  };
};

const missingTrailDiagnostics = (
  filePath: string,
  expected: ReadonlySet<string>,
  present: ReadonlySet<string>
): readonly WardenDiagnostic[] =>
  [...expected]
    .filter((name) => !present.has(name))
    .map((name) => ({
      filePath,
      line: 1,
      message:
        `warden-export-symmetry: missing trail export "${name}" for registered warden rule. ` +
        'Every wardenRules / wardenTopoRules entry must have a matching *Trail export on the public barrel (ADR-0036).',
      rule: 'warden-export-symmetry',
      severity: 'error' as const,
    }));

const orphanTrailDiagnostics = (
  sourceCode: string,
  filePath: string,
  exports: readonly ExportSite[],
  expected: ReadonlySet<string>
): readonly WardenDiagnostic[] =>
  exports
    .filter((site) => site.name.endsWith('Trail') && !expected.has(site.name))
    .map((site) => ({
      filePath,
      line: offsetToLine(sourceCode, site.start),
      message:
        `warden-export-symmetry: orphan trail export "${site.name}" has no matching wardenRules / wardenTopoRules entry. ` +
        'Remove the export or register the corresponding rule (ADR-0036).',
      rule: 'warden-export-symmetry',
      severity: 'error' as const,
    }));

const pickRawRuleMatch = (
  site: ExportSite,
  rawNames: ReadonlySet<string>
): string | null => {
  if (rawNames.has(site.localName)) {
    return site.localName;
  }
  if (rawNames.has(site.name)) {
    return site.name;
  }
  return null;
};

const rawRuleLeakDiagnostics = (
  sourceCode: string,
  filePath: string,
  exports: readonly ExportSite[],
  rawNames: ReadonlySet<string>
): readonly WardenDiagnostic[] =>
  exports.flatMap((site) => {
    // Check BOTH the public name and the local source binding — aliasing a
    // raw rule (`export { wardenExportSymmetry as disguised }`) must not
    // sanitize the leak. Prefer the raw-matching name in the diagnostic so
    // the incident points at the actual rule identifier.
    const matched = pickRawRuleMatch(site, rawNames);
    if (!matched) {
      return [];
    }
    const alias =
      site.localName === site.name ? '' : ` (aliased as "${site.name}")`;
    return [
      {
        filePath,
        line: offsetToLine(sourceCode, site.start),
        message:
          `warden-export-symmetry: raw rule export "${matched}"${alias} must not appear on the public barrel. ` +
          'Raw WardenRule objects are internal; expose the matching *Trail wrapper instead (ADR-0036).',
        rule: 'warden-export-symmetry',
        severity: 'error' as const,
      },
    ];
  });

const collectDefaultExports = (ast: AstNode): readonly ExportSite[] => {
  const sites: ExportSite[] = [];
  walk(ast, (node) => {
    if (node.type !== 'ExportDefaultDeclaration') {
      return;
    }
    sites.push({ localName: 'default', name: 'default', start: node.start });
  });
  return sites;
};

const defaultExportDiagnostics = (
  sourceCode: string,
  filePath: string,
  sites: readonly ExportSite[]
): readonly WardenDiagnostic[] =>
  sites.map((site) => ({
    filePath,
    line: offsetToLine(sourceCode, site.start),
    message:
      'warden-export-symmetry: default export is not permitted on the warden public barrel. ' +
      'Use named exports only so registry ↔ trail symmetry is discoverable (ADR-0036).',
    rule: 'warden-export-symmetry',
    severity: 'error' as const,
  }));

const analyzeBarrel = (
  sourceCode: string,
  filePath: string,
  ast: AstNode
): readonly WardenDiagnostic[] => {
  const exports = collectNamedExports(ast);
  const presentExports = new Set(exports.map((site) => site.name));
  const { expectedTrailExports, rawRuleCamelNames } = buildRegistryNameSets();

  return [
    ...namespaceReexportDiagnostics(
      sourceCode,
      filePath,
      collectNamespaceReexports(ast)
    ),
    ...defaultExportDiagnostics(
      sourceCode,
      filePath,
      collectDefaultExports(ast)
    ),
    ...missingTrailDiagnostics(filePath, expectedTrailExports, presentExports),
    ...orphanTrailDiagnostics(
      sourceCode,
      filePath,
      exports,
      expectedTrailExports
    ),
    ...rawRuleLeakDiagnostics(sourceCode, filePath, exports, rawRuleCamelNames),
  ];
};

/**
 * Warden rule enforcing ADR-0036 registry ↔ trail export symmetry on the
 * `@ontrails/warden` public barrel.
 */
export const wardenExportSymmetry: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (!isTargetFile(filePath)) {
      return [];
    }
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return analyzeBarrel(sourceCode, filePath, ast);
  },
  description:
    'Enforces ADR-0036: every wardenRules / wardenTopoRules entry has a matching *Trail export, no orphan *Trail exports, and no raw rule objects leak onto the @ontrails/warden public barrel.',
  name: 'warden-export-symmetry',
  severity: 'error',
};
