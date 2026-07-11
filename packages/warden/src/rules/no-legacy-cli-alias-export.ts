/**
 * Flags leftover legacy app-module CLI alias exports removed in TRL-1207.
 *
 * Before the surfaces-overlay cutover, apps published CLI alias maps through
 * a module-level export named `cliAliases` or `trailsCliAliases`. TRL-1207 is
 * a hard cutover: app-owned CLI bindings now live in a
 * `surfaceOverlay({ cli: { ... } })` envelope inside the app module's
 * `trailsOverlays` array export, and the legacy export convention was
 * deleted. This rule makes a leftover legacy export an error so stale app
 * modules get a fix-forward diagnostic instead of silently losing their
 * bindings.
 *
 * Detection is AST-scoped and export-shaped:
 *
 *   - `export const cliAliases = { ... }` (also `let`/`var`, destructured
 *     bindings, and function/class declarations) is flagged.
 *   - `export { cliAliases }` and `export { whatever as trailsCliAliases }`
 *     specifiers are flagged, including re-export statements such as
 *     `export { trailsCliAliases } from './app.js'`.
 *   - A non-exported local `const cliAliases = ...` is legal and never
 *     flagged, and the identifiers appearing only in strings or comments do
 *     not match because the rule inspects export bindings, not raw text.
 */

import {
  getStringValue,
  identifierName,
  isStringLiteral,
} from '../source/literals.js';
import { offsetToLine } from '../source/locations.js';
import {
  getNodeArgument,
  getNodeBodyStatements,
  getNodeDeclaration,
  getNodeDeclarations,
  getNodeElements,
  getNodeExported,
  getNodeExportKind,
  getNodeId,
  getNodeLeft,
  getNodeProperties,
  getNodeSpecifiers,
  getNodeValueNode,
} from '../source/nodes.js';
import { parse } from '../source/parse.js';
import type { AstNode } from '../source/nodes.js';
import type { WardenDiagnostic, WardenFix, WardenRule } from './types.js';

const RULE_NAME = 'no-legacy-cli-alias-export';

/** Legacy app-module CLI alias export names removed in TRL-1207. */
const LEGACY_CLI_ALIAS_EXPORT_NAMES: ReadonlySet<string> = new Set([
  'cliAliases',
  'trailsCliAliases',
]);

/** Declaration node types that only propagate types, never value bindings. */
const TYPE_ONLY_DECLARATION_TYPES: ReadonlySet<string> = new Set([
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
]);

interface ExportedBinding {
  readonly name: string;
  readonly start: number;
}

/** Exported name of a specifier: identifier or string-literal alias. */
const exportedSpecifierName = (node: AstNode | undefined): string | null =>
  identifierName(node) ??
  (node && isStringLiteral(node) ? getStringValue(node) : null);

/**
 * Expand one binding-pattern node into legacy-named bindings, pushing child
 * patterns onto the worklist. Destructured exports such as
 * `export const { cliAliases } = mod` still introduce a module-level exported
 * value binding, so patterns cannot be skipped.
 */
const visitBindingPatternNode = (
  node: AstNode,
  into: ExportedBinding[],
  worklist: AstNode[]
): void => {
  const name = identifierName(node);
  if (name !== null) {
    if (LEGACY_CLI_ALIAS_EXPORT_NAMES.has(name)) {
      into.push({ name, start: node.start });
    }
    return;
  }
  if (node.type === 'AssignmentPattern') {
    const left = getNodeLeft(node);
    if (left) {
      worklist.push(left);
    }
    return;
  }
  if (node.type === 'RestElement') {
    const argument = getNodeArgument(node);
    if (argument) {
      worklist.push(argument);
    }
    return;
  }
  if (node.type === 'ObjectPattern') {
    for (const property of getNodeProperties(node)) {
      const value = getNodeValueNode(property) ?? getNodeArgument(property);
      if (value) {
        worklist.push(value);
      }
    }
    return;
  }
  if (node.type === 'ArrayPattern') {
    for (const element of getNodeElements(node)) {
      if (element) {
        worklist.push(element);
      }
    }
  }
};

const collectLegacyPatternBindings = (
  pattern: AstNode | undefined,
  into: ExportedBinding[]
): void => {
  if (!pattern) {
    return;
  }
  const worklist: AstNode[] = [pattern];
  while (worklist.length > 0) {
    const node = worklist.pop();
    if (node) {
      visitBindingPatternNode(node, into, worklist);
    }
  }
};

const collectLegacyDeclarationBindings = (
  declaration: AstNode
): readonly ExportedBinding[] => {
  if (TYPE_ONLY_DECLARATION_TYPES.has(declaration.type)) {
    return [];
  }
  const bindings: ExportedBinding[] = [];
  if (declaration.type === 'VariableDeclaration') {
    for (const declarator of getNodeDeclarations(declaration)) {
      collectLegacyPatternBindings(getNodeId(declarator), bindings);
    }
    return bindings;
  }
  const name = identifierName(getNodeId(declaration));
  if (name !== null && LEGACY_CLI_ALIAS_EXPORT_NAMES.has(name)) {
    bindings.push({ name, start: declaration.start });
  }
  return bindings;
};

const collectLegacySpecifierBindings = (
  statement: AstNode
): readonly ExportedBinding[] => {
  const bindings: ExportedBinding[] = [];
  for (const specifier of getNodeSpecifiers(statement)) {
    if (
      specifier.type !== 'ExportSpecifier' ||
      getNodeExportKind(specifier) === 'type'
    ) {
      continue;
    }
    const name = exportedSpecifierName(getNodeExported(specifier));
    if (name !== null && LEGACY_CLI_ALIAS_EXPORT_NAMES.has(name)) {
      bindings.push({ name, start: specifier.start });
    }
  }
  return bindings;
};

const collectLegacyExportBindings = (
  ast: AstNode
): readonly ExportedBinding[] => {
  const bindings: ExportedBinding[] = [];
  for (const statement of getNodeBodyStatements(ast)) {
    if (
      statement.type !== 'ExportNamedDeclaration' ||
      getNodeExportKind(statement) === 'type'
    ) {
      continue;
    }
    const declaration = getNodeDeclaration(statement);
    if (declaration) {
      bindings.push(...collectLegacyDeclarationBindings(declaration));
      continue;
    }
    bindings.push(...collectLegacySpecifierBindings(statement));
  }
  return bindings;
};

const buildMessage = (name: string): string =>
  `Legacy CLI alias export '${name}' was removed in the TRL-1207 surfaces-overlay cutover. Wrap the alias map into surfaceOverlay({ cli: { ... } }) from @ontrails/core inside the module's trailsOverlays array export.`;

/**
 * Build the fix metadata for a legacy CLI alias export finding.
 *
 * The rewrite is an export restructure, not a rename, so there is no
 * mechanical single-span replacement: the fix carries no edits and Warden
 * never applies it. Downstream, the `export-restructure` fix class routes the
 * finding to the Regrade `export-restructure:cli-aliases` class (TRL-1210),
 * which inverts the alias map into `surfaceOverlay({ cli: { ... } })`
 * bindings inside the module's `trailsOverlays` array export.
 */
const buildFix = (name: string): WardenFix => ({
  class: 'export-restructure',
  reason: `Legacy CLI alias export '${name}' must be rewritten into a surfaceOverlay({ cli: { ... } }) entry inside the module's trailsOverlays array export; run the Regrade class export-restructure:cli-aliases (TRL-1210) to automate this restructure.`,
  safety: 'review',
});

/**
 * Flags exported bindings named `cliAliases` or `trailsCliAliases`, the
 * legacy app-module CLI alias export convention deleted in TRL-1207.
 */
export const noLegacyCliAliasExport: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (
      !(
        sourceCode.includes('cliAliases') ||
        sourceCode.includes('trailsCliAliases')
      )
    ) {
      return [];
    }
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return collectLegacyExportBindings(ast).map((binding) => ({
      filePath,
      fix: buildFix(binding.name),
      line: offsetToLine(sourceCode, binding.start),
      message: buildMessage(binding.name),
      rule: RULE_NAME,
      severity: 'error',
    }));
  },
  description:
    'Disallow the legacy app-module CLI alias exports (cliAliases, trailsCliAliases) removed in the TRL-1207 surfaces-overlay cutover.',
  name: RULE_NAME,
  severity: 'error',
};
