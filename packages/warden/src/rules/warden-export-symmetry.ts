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
import { walk, offsetToLine, parse } from './ast.js';
import type { AstNode } from './ast.js';
import { registeredRuleNames } from './registry-names.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const SELF_RULE_NAME = 'warden-export-symmetry';

const TARGET_FILE_SUFFIX = 'packages/warden/src/index.ts';

const normalize = (filePath: string): string => filePath.replaceAll('\\', '/');

const isTargetFile = (filePath: string): boolean =>
  normalize(filePath).endsWith(TARGET_FILE_SUFFIX);

const kebabToCamel = (value: string): string =>
  value.replaceAll(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

interface ExportSite {
  readonly name: string;
  readonly start: number;
}

const extractSpecifierName = (specifier: AstNode): string | null => {
  const { exported } = specifier as unknown as { exported?: AstNode };
  if (exported?.type === 'Identifier') {
    return (exported as unknown as { name?: string }).name ?? null;
  }
  if (exported?.type === 'Literal' || exported?.type === 'StringLiteral') {
    const { value } = exported as unknown as { value?: unknown };
    return typeof value === 'string' ? value : null;
  }
  return null;
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
  const name = extractSpecifierName(specifier);
  return name ? { name, start: specifier.start } : null;
};

const sitesForExportNode = (node: AstNode): readonly ExportSite[] => {
  if (node.type !== 'ExportNamedDeclaration') {
    return [];
  }
  if ((node as unknown as { exportKind?: string }).exportKind === 'type') {
    return [];
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

const collectNamespaceReexports = (ast: AstNode): readonly ExportSite[] => {
  const sites: ExportSite[] = [];
  walk(ast, (node) => {
    if (node.type !== 'ExportAllDeclaration') {
      return;
    }
    const { source } = node as unknown as {
      source?: { value?: unknown };
    };
    const target =
      typeof source?.value === 'string' ? source.value : '<unknown>';
    sites.push({ name: target, start: node.start });
  });
  return sites;
};

const namespaceReexportDiagnostics = (
  sourceCode: string,
  filePath: string,
  sites: readonly ExportSite[]
): readonly WardenDiagnostic[] =>
  sites.map((site) => ({
    filePath,
    line: offsetToLine(sourceCode, site.start),
    message:
      `warden-export-symmetry: namespace re-export "export * from '${site.name}'" is not permitted on the warden public barrel. ` +
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

const rawRuleLeakDiagnostics = (
  sourceCode: string,
  filePath: string,
  exports: readonly ExportSite[],
  rawNames: ReadonlySet<string>
): readonly WardenDiagnostic[] =>
  exports
    .filter((site) => rawNames.has(site.name))
    .map((site) => ({
      filePath,
      line: offsetToLine(sourceCode, site.start),
      message:
        `warden-export-symmetry: raw rule export "${site.name}" must not appear on the public barrel. ` +
        'Raw WardenRule objects are internal; expose the matching *Trail wrapper instead (ADR-0036).',
      rule: 'warden-export-symmetry',
      severity: 'error' as const,
    }));

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

    const exports = collectNamedExports(ast);
    const presentExports = new Set(exports.map((site) => site.name));
    const namespaceSites = collectNamespaceReexports(ast);
    const { expectedTrailExports, rawRuleCamelNames } = buildRegistryNameSets();

    return [
      ...namespaceReexportDiagnostics(sourceCode, filePath, namespaceSites),
      ...missingTrailDiagnostics(
        filePath,
        expectedTrailExports,
        presentExports
      ),
      ...orphanTrailDiagnostics(
        sourceCode,
        filePath,
        exports,
        expectedTrailExports
      ),
      ...rawRuleLeakDiagnostics(
        sourceCode,
        filePath,
        exports,
        rawRuleCamelNames
      ),
    ];
  },
  description:
    'Enforces ADR-0036: every wardenRules / wardenTopoRules entry has a matching *Trail export, no orphan *Trail exports, and no raw rule objects leak onto the @ontrails/warden public barrel.',
  name: 'warden-export-symmetry',
  severity: 'error',
};
