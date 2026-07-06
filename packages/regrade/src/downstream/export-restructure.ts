/**
 * Export-restructure Regrade classes (TRL-1210).
 *
 * The TRL-1207 surfaces-overlay cutover replaced two pre-cutover conventions
 * with `surfaceOverlay()` bindings inside an app module's `trailsOverlays`
 * array export:
 *
 * - legacy CLI alias exports (`export const cliAliases = { trailId: paths }`
 *   or `trailsCliAliases`) became `surfaceOverlay({ cli: { alias: trailId } })`
 *   bindings, and
 * - call-site MCP trailhead maps became `surfaceOverlay({ mcp: { name:
 *   [selectors] } })` group bindings, with the call-site map surviving only as
 *   the richer-metadata override-in-context.
 *
 * These classes automate the restructure for downstream apps bridging the
 * pre-1.0 gap. Occurrences the classes cannot prove safe route to
 * `needs-review` with the exact target shape named — a rewrite is never
 * emitted on a guess.
 */

import type { AstNode, SourceEdit } from '@ontrails/warden/ast';
import {
  applySourceEdits,
  createSourceEdit,
  getNodeArgument,
  getNodeArguments,
  getNodeCallee,
  getNodeComputed,
  getNodeDeclaration,
  getNodeDeclarations,
  getNodeElements,
  getNodeExportKind,
  getNodeExpression,
  getNodeId,
  getNodeInit,
  getNodeKey,
  getNodeKind,
  getNodeLocal,
  getNodeProperties,
  getNodeProperty,
  getNodeSource,
  getNodeSpecifiers,
  getNodeTypeAnnotation,
  getNodeValueNode,
  getNodeBodyStatements,
  getStringValue,
  identifierName,
  isArrayExpression,
  isCallExpression,
  isExportNamedDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isMemberExpression,
  isObjectExpression,
  isProperty,
  isStringLiteral,
  isVariableDeclaration,
  offsetToLineColumn,
  parseWithDiagnostics,
  validateSourceEdits,
  walkWithParents,
} from '@ontrails/warden/ast';
import type { WardenRule } from '@ontrails/warden';
import {
  getWardenRuleMetadata,
  isWardenSourceScanTarget,
  loadProjectWardenRules,
  wardenRules,
} from '@ontrails/warden';

import type {
  RegradeClass,
  RegradeClassContext,
  RegradeClassResult,
  RegradeReviewDetail,
  RegradeWardenClassSet,
} from './report.js';
import { loadWardenTermRewriteClasses } from './report.js';

const EXPORT_RESTRUCTURE_FIX_CLASS = 'export-restructure';

const CLI_ALIASES_CLASS_ID = 'export-restructure:cli-aliases';
const MCP_TRAILHEADS_CLASS_ID = 'export-restructure:mcp-trailheads';

/** Legacy app-module CLI alias export names removed in TRL-1207. */
const LEGACY_CLI_ALIAS_NAMES: ReadonlySet<string> = new Set([
  'cliAliases',
  'trailsCliAliases',
]);

const OVERLAYS_EXPORT_NAME = 'trailsOverlays';
const SURFACE_OVERLAY_NAME = 'surfaceOverlay';
const CORE_MODULE_SPECIFIER = '@ontrails/core';

/** Authored value of one surface binding: a synonym trail id or a group. */
type BindingValue = string | readonly string[];

const IDENTIFIER_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const quoteString = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

const quoteKey = (key: string): string =>
  IDENTIFIER_KEY_PATTERN.test(key) ? key : quoteString(key);

const bindingValueText = (value: BindingValue): string =>
  typeof value === 'string'
    ? quoteString(value)
    : `[${value.map(quoteString).join(', ')}]`;

const bindingValuesEqual = (left: BindingValue, right: BindingValue): boolean =>
  typeof left === 'string' || typeof right === 'string'
    ? left === right
    : left.length === right.length &&
      left.every((member, index) => member === right[index]);

const sortedBindingEntries = (
  bindings: ReadonlyMap<string, BindingValue>
): readonly (readonly [string, BindingValue])[] =>
  [...bindings.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right)
  );

const bindingsObjectText = (
  bindings: ReadonlyMap<string, BindingValue>,
  indent: string
): string => {
  const inner = sortedBindingEntries(bindings)
    .map(
      ([name, value]) =>
        `${indent}  ${quoteKey(name)}: ${bindingValueText(value)},`
    )
    .join('\n');
  return `{\n${inner}\n${indent}}`;
};

const bindingsObjectTextSingleLine = (
  bindings: ReadonlyMap<string, BindingValue>
): string =>
  `{ ${sortedBindingEntries(bindings)
    .map(([name, value]) => `${quoteKey(name)}: ${bindingValueText(value)}`)
    .join(', ')} }`;

/** Compact one-line target shape used in review reasons and details. */
const surfaceOverlayTargetShape = (
  surfaceKey: 'cli' | 'mcp',
  bindings: ReadonlyMap<string, BindingValue>
): string =>
  `surfaceOverlay({ ${surfaceKey}: ${bindingsObjectTextSingleLine(bindings)} })`;

const lineIndent = (source: string, offset: number): string => {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, offset));
  return match?.[0] ?? '';
};

const spansSingleLine = (source: string, start: number, end: number): boolean =>
  !source.slice(start, end).includes('\n');

const COMMENT_MARKER_PATTERN = /\/[/*]/;

const spanCarriesComments = (
  source: string,
  start: number,
  end: number
): boolean => COMMENT_MARKER_PATTERN.test(source.slice(start, end));

/** Unwrap `as const`, `satisfies`, and parenthesized wrappers. */
const unwrapExpression = (node: AstNode | undefined): AstNode | undefined => {
  let current = node;
  while (
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSSatisfiesExpression' ||
    current?.type === 'ParenthesizedExpression'
  ) {
    current = getNodeExpression(current) ?? getNodeArgument(current);
  }
  return current;
};

const propertyKeyName = (property: AstNode): string | null => {
  if (!isProperty(property) || getNodeComputed(property) === true) {
    return null;
  }
  const key = getNodeKey(property);
  const name = identifierName(key);
  if (name !== null) {
    return name;
  }
  return key !== undefined && isStringLiteral(key) ? getStringValue(key) : null;
};

interface TopLevelConst {
  /** Whole top-level statement (export wrapper when exported). */
  readonly statement: AstNode;
  readonly declarator: AstNode;
  readonly name: string;
  readonly exported: boolean;
  readonly kind: string | undefined;
  readonly init: AstNode | undefined;
}

const collectTopLevelConsts = (program: AstNode): readonly TopLevelConst[] => {
  const consts: TopLevelConst[] = [];
  const visitDeclaration = (
    statement: AstNode,
    declaration: AstNode,
    exported: boolean
  ): void => {
    if (!isVariableDeclaration(declaration)) {
      return;
    }
    for (const declarator of getNodeDeclarations(declaration)) {
      const name = identifierName(getNodeId(declarator));
      if (name === null) {
        continue;
      }
      consts.push({
        declarator,
        exported,
        init: getNodeInit(declarator),
        kind: getNodeKind(declaration),
        name,
        statement,
      });
    }
  };
  for (const statement of getNodeBodyStatements(program)) {
    if (
      isExportNamedDeclaration(statement) &&
      getNodeExportKind(statement) !== 'type'
    ) {
      const declaration = getNodeDeclaration(statement);
      if (declaration) {
        visitDeclaration(statement, declaration, true);
      }
      continue;
    }
    if (isVariableDeclaration(statement)) {
      visitDeclaration(statement, statement, false);
    }
  }
  return consts;
};

/**
 * Count identifier references to `name` outside its own declarator id,
 * property keys, and member-expression property positions. A non-zero count
 * means deleting the declaration would break the module.
 */
const countOtherReferences = (
  program: AstNode,
  name: string,
  declaratorId?: AstNode
): number => {
  let count = 0;
  walkWithParents(program, (node, context) => {
    if (!isIdentifier(node) || identifierName(node) !== name) {
      return;
    }
    if (node === declaratorId) {
      return;
    }
    const { parent } = context;
    if (
      parent !== null &&
      isProperty(parent) &&
      getNodeKey(parent) === node &&
      getNodeComputed(parent) !== true
    ) {
      return;
    }
    if (
      parent !== null &&
      isMemberExpression(parent) &&
      getNodeProperty(parent) === node &&
      getNodeComputed(parent) !== true
    ) {
      return;
    }
    count += 1;
  });
  return count;
};

const moduleReferencesIdentifier = (program: AstNode, name: string): boolean =>
  countOtherReferences(program, name) > 0;

type BindingsParse =
  | { readonly ok: true; readonly bindings: ReadonlyMap<string, BindingValue> }
  | { readonly ok: false; readonly reason: string };

const bindingsParseFailure = (reason: string): BindingsParse => ({
  ok: false,
  reason,
});

/**
 * Invert a legacy alias-map object literal (`Record<trailId,
 * (string | string[])[]>`) into cli bindings (`aliasPath -> trailId`), where
 * alias path segments join with `.`.
 */
const invertLegacyAliasMap = (
  objectNode: AstNode | undefined
): BindingsParse => {
  const object = unwrapExpression(objectNode);
  if (object === undefined || !isObjectExpression(object)) {
    return bindingsParseFailure('the initializer is not an object literal');
  }
  const bindings = new Map<string, BindingValue>();
  for (const property of getNodeProperties(object)) {
    const trailId = propertyKeyName(property);
    if (trailId === null) {
      return bindingsParseFailure(
        'a property uses a computed key, spread, or non-literal shape'
      );
    }
    const value = unwrapExpression(getNodeValueNode(property));
    if (value === undefined || !isArrayExpression(value)) {
      return bindingsParseFailure(
        `alias paths for "${trailId}" are not an array literal`
      );
    }
    for (const element of getNodeElements(value)) {
      const alias = unwrapExpression(element ?? undefined);
      let segments: readonly string[] | null = null;
      if (alias !== undefined && isStringLiteral(alias)) {
        const segment = getStringValue(alias);
        segments = segment === null ? null : [segment];
      } else if (alias !== undefined && isArrayExpression(alias)) {
        const literals = getNodeElements(alias).map((segmentNode) => {
          const segment = unwrapExpression(segmentNode ?? undefined);
          return segment !== undefined && isStringLiteral(segment)
            ? getStringValue(segment)
            : null;
        });
        segments = literals.every(
          (segment): segment is string => segment !== null
        )
          ? literals
          : null;
      }
      if (segments === null || segments.length === 0) {
        return bindingsParseFailure(
          `an alias path for "${trailId}" is not a string or string-array literal`
        );
      }
      const bindingName = segments.join('.');
      const existing = bindings.get(bindingName);
      if (existing !== undefined && !bindingValuesEqual(existing, trailId)) {
        return bindingsParseFailure(
          `alias "${bindingName}" maps to multiple trails`
        );
      }
      bindings.set(bindingName, trailId);
    }
  }
  if (bindings.size === 0) {
    return bindingsParseFailure('the alias map declares no alias paths');
  }
  return { bindings, ok: true };
};

/** Parse an authored bindings object literal into name -> value entries. */
const parseBindingsObject = (
  objectNode: AstNode | undefined
): BindingsParse => {
  const object = unwrapExpression(objectNode);
  if (object === undefined || !isObjectExpression(object)) {
    return bindingsParseFailure('existing bindings are not an object literal');
  }
  const bindings = new Map<string, BindingValue>();
  for (const property of getNodeProperties(object)) {
    const name = propertyKeyName(property);
    if (name === null) {
      return bindingsParseFailure(
        'existing bindings use a computed key, spread, or non-literal shape'
      );
    }
    const value = unwrapExpression(getNodeValueNode(property));
    if (value !== undefined && isStringLiteral(value)) {
      const literal = getStringValue(value);
      if (literal === null) {
        return bindingsParseFailure(
          `existing binding "${name}" is not a plain string literal`
        );
      }
      bindings.set(name, literal);
      continue;
    }
    if (value !== undefined && isArrayExpression(value)) {
      const members = getNodeElements(value).map((element) => {
        const member = unwrapExpression(element ?? undefined);
        return member !== undefined && isStringLiteral(member)
          ? getStringValue(member)
          : null;
      });
      if (!members.every((member): member is string => member !== null)) {
        return bindingsParseFailure(
          `existing binding "${name}" carries non-literal members`
        );
      }
      bindings.set(name, members);
      continue;
    }
    return bindingsParseFailure(
      `existing binding "${name}" is not a literal string or array`
    );
  }
  return { bindings, ok: true };
};

interface OverlaysExport {
  readonly arrayNode: AstNode;
  /** The `surfaceOverlay({ ... })` object argument, when one exists. */
  readonly overlayObject: AstNode | undefined;
}

const findOverlaysExport = (
  program: AstNode
): { readonly parse: OverlaysExport | null; readonly declared: boolean } => {
  const declarator = collectTopLevelConsts(program).find(
    (candidate) => candidate.exported && candidate.name === OVERLAYS_EXPORT_NAME
  );
  if (declarator === undefined) {
    return { declared: false, parse: null };
  }
  const arrayNode = unwrapExpression(declarator.init);
  if (arrayNode === undefined || !isArrayExpression(arrayNode)) {
    return { declared: true, parse: null };
  }
  for (const element of getNodeElements(arrayNode)) {
    const call = unwrapExpression(element ?? undefined);
    if (
      call === undefined ||
      !isCallExpression(call) ||
      identifierName(getNodeCallee(call)) !== SURFACE_OVERLAY_NAME
    ) {
      continue;
    }
    const [argument] = getNodeArguments(call);
    const overlayObject = unwrapExpression(argument);
    if (overlayObject === undefined || !isObjectExpression(overlayObject)) {
      return { declared: true, parse: null };
    }
    return { declared: true, parse: { arrayNode, overlayObject } };
  }
  return { declared: true, parse: { arrayNode, overlayObject: undefined } };
};

type ImportEditResult =
  | { readonly ok: true; readonly edit: SourceEdit | null }
  | { readonly ok: false; readonly reason: string };

const isTypeOnlyImportStatement = (
  source: string,
  statement: AstNode
): boolean => /^import\s+type\b/.test(source.slice(statement.start));

const importSourceValue = (statement: AstNode): string | null => {
  const sourceNode = getNodeSource(statement);
  return sourceNode !== undefined && isStringLiteral(sourceNode)
    ? getStringValue(sourceNode)
    : null;
};

/**
 * Build the edit that makes `surfaceOverlay` importable from
 * `@ontrails/core`, or `null` when the import already exists.
 */
const surfaceOverlayImportEdit = (
  program: AstNode,
  source: string
): ImportEditResult => {
  const importStatements = getNodeBodyStatements(program).filter((statement) =>
    isImportDeclaration(statement)
  );

  for (const statement of importStatements) {
    for (const specifier of getNodeSpecifiers(statement)) {
      if (!isImportSpecifier(specifier)) {
        continue;
      }
      const local = identifierName(getNodeLocal(specifier));
      if (local !== SURFACE_OVERLAY_NAME) {
        continue;
      }
      const from = importSourceValue(statement);
      if (
        from === CORE_MODULE_SPECIFIER &&
        !isTypeOnlyImportStatement(source, statement)
      ) {
        return { edit: null, ok: true };
      }
      return {
        ok: false,
        reason: `the module already binds "${SURFACE_OVERLAY_NAME}" from a different module or a type-only import`,
      };
    }
  }
  if (
    collectTopLevelConsts(program).some(
      (candidate) => candidate.name === SURFACE_OVERLAY_NAME
    )
  ) {
    return {
      ok: false,
      reason: `the module declares a conflicting "${SURFACE_OVERLAY_NAME}" binding`,
    };
  }

  const coreImport = importStatements.find(
    (statement) =>
      importSourceValue(statement) === CORE_MODULE_SPECIFIER &&
      !isTypeOnlyImportStatement(source, statement) &&
      getNodeSpecifiers(statement).some((specifier) =>
        isImportSpecifier(specifier)
      )
  );
  if (coreImport !== undefined) {
    const named = getNodeSpecifiers(coreImport).filter((specifier) =>
      isImportSpecifier(specifier)
    );
    const multiLine = !spansSingleLine(
      source,
      coreImport.start,
      coreImport.end
    );
    const anchor = named.find((specifier) => {
      const local = identifierName(getNodeLocal(specifier));
      return local !== null && local.localeCompare(SURFACE_OVERLAY_NAME) > 0;
    });
    if (anchor !== undefined) {
      const text = multiLine
        ? `${SURFACE_OVERLAY_NAME},\n${lineIndent(source, anchor.start)}`
        : `${SURFACE_OVERLAY_NAME}, `;
      return {
        edit: createSourceEdit(anchor.start, anchor.start, text),
        ok: true,
      };
    }
    const last = named.at(-1);
    if (last !== undefined) {
      const text = multiLine
        ? `,\n${lineIndent(source, last.start)}${SURFACE_OVERLAY_NAME}`
        : `, ${SURFACE_OVERLAY_NAME}`;
      return { edit: createSourceEdit(last.end, last.end, text), ok: true };
    }
  }

  const statementText = `import { ${SURFACE_OVERLAY_NAME} } from '${CORE_MODULE_SPECIFIER}';\n`;
  const lastImport = importStatements.at(-1);
  if (lastImport !== undefined) {
    return {
      edit: createSourceEdit(
        lastImport.end,
        lastImport.end,
        `\n${statementText.trimEnd()}`
      ),
      ok: true,
    };
  }
  const [firstStatement] = getNodeBodyStatements(program);
  const insertAt = firstStatement?.start ?? 0;
  return {
    edit: createSourceEdit(insertAt, insertAt, `${statementText}\n`),
    ok: true,
  };
};

type OverlayMergeResult =
  | { readonly ok: true; readonly edit: SourceEdit; readonly note: string }
  | { readonly ok: true; readonly edit: null; readonly note: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Merge `bindings` into the `surfaceKey` bindings of an existing
 * `surfaceOverlay({ ... })` object, creating the surface key when absent.
 * Returns `edit: null` when the overlay already covers every binding.
 */
const mergeIntoOverlayObject = (params: {
  readonly bindings: ReadonlyMap<string, BindingValue>;
  readonly overlayObject: AstNode;
  readonly source: string;
  readonly surfaceKey: 'cli' | 'mcp';
}): OverlayMergeResult => {
  const { bindings, overlayObject, source, surfaceKey } = params;
  const properties = getNodeProperties(overlayObject);
  const surfaceProperty = properties.find(
    (property) => propertyKeyName(property) === surfaceKey
  );

  if (surfaceProperty !== undefined) {
    const valueNode = getNodeValueNode(surfaceProperty);
    if (valueNode === undefined) {
      return {
        ok: false,
        reason: `the existing ${surfaceKey} bindings are not a plain object literal`,
      };
    }
    if (spanCarriesComments(source, valueNode.start, valueNode.end)) {
      return {
        ok: false,
        reason: `the existing ${surfaceKey} bindings carry comments a mechanical merge would drop`,
      };
    }
    const existing = parseBindingsObject(valueNode);
    if (!existing.ok) {
      return { ok: false, reason: existing.reason };
    }
    const merged = new Map(existing.bindings);
    let added = 0;
    for (const [name, value] of bindings) {
      const current = merged.get(name);
      if (current === undefined) {
        merged.set(name, value);
        added += 1;
        continue;
      }
      if (!bindingValuesEqual(current, value)) {
        return {
          ok: false,
          reason: `the existing ${surfaceKey} binding "${name}" conflicts with the migrated value`,
        };
      }
    }
    if (added === 0) {
      return {
        edit: null,
        note: `Existing surfaceOverlay ${surfaceKey} bindings already cover the migrated entries.`,
        ok: true,
      };
    }
    const indent = lineIndent(source, surfaceProperty.start);
    const text = spansSingleLine(source, valueNode.start, valueNode.end)
      ? bindingsObjectTextSingleLine(merged)
      : bindingsObjectText(merged, indent);
    return {
      edit: createSourceEdit(valueNode.start, valueNode.end, text),
      note: `Merged ${added} ${surfaceKey} binding(s) into the existing surfaceOverlay entry.`,
      ok: true,
    };
  }

  const singleLine = spansSingleLine(
    source,
    overlayObject.start,
    overlayObject.end
  );
  const anchor = properties.find((property) => {
    const name = propertyKeyName(property);
    return name !== null && name.localeCompare(surfaceKey) > 0;
  });
  if (anchor !== undefined) {
    const indent = lineIndent(source, anchor.start);
    const text = singleLine
      ? `${surfaceKey}: ${bindingsObjectTextSingleLine(bindings)}, `
      : `${surfaceKey}: ${bindingsObjectText(bindings, indent)},\n${indent}`;
    return {
      edit: createSourceEdit(anchor.start, anchor.start, text),
      note: `Added ${surfaceKey} bindings to the existing surfaceOverlay entry.`,
      ok: true,
    };
  }
  const last = properties.at(-1);
  if (last !== undefined) {
    const indent = lineIndent(source, last.start);
    const text = singleLine
      ? `, ${surfaceKey}: ${bindingsObjectTextSingleLine(bindings)}`
      : `,\n${indent}${surfaceKey}: ${bindingsObjectText(bindings, indent)}`;
    return {
      edit: createSourceEdit(last.end, last.end, text),
      note: `Added ${surfaceKey} bindings to the existing surfaceOverlay entry.`,
      ok: true,
    };
  }
  const indent = lineIndent(source, overlayObject.start);
  const text = singleLine
    ? `{ ${surfaceKey}: ${bindingsObjectTextSingleLine(bindings)} }`
    : `{\n${indent}  ${surfaceKey}: ${bindingsObjectText(bindings, `${indent}  `)},\n${indent}}`;
  return {
    edit: createSourceEdit(overlayObject.start, overlayObject.end, text),
    note: `Added ${surfaceKey} bindings to the existing surfaceOverlay entry.`,
    ok: true,
  };
};

/** Append a `surfaceOverlay({ surfaceKey: ... })` element to the array. */
const appendOverlayElementEdit = (params: {
  readonly arrayNode: AstNode;
  readonly bindings: ReadonlyMap<string, BindingValue>;
  readonly source: string;
  readonly surfaceKey: 'cli' | 'mcp';
}): SourceEdit => {
  const { arrayNode, bindings, source, surfaceKey } = params;
  const elements = getNodeElements(arrayNode).filter(
    (element): element is AstNode => element !== null
  );
  const last = elements.at(-1);
  if (last === undefined) {
    const indent = lineIndent(source, arrayNode.start);
    const text = `[\n${indent}  ${SURFACE_OVERLAY_NAME}({\n${indent}    ${surfaceKey}: ${bindingsObjectText(bindings, `${indent}    `)},\n${indent}  }),\n${indent}]`;
    return createSourceEdit(arrayNode.start, arrayNode.end, text);
  }
  if (spansSingleLine(source, arrayNode.start, arrayNode.end)) {
    const text = `, ${SURFACE_OVERLAY_NAME}({ ${surfaceKey}: ${bindingsObjectTextSingleLine(bindings)} })`;
    return createSourceEdit(last.end, last.end, text);
  }
  const indent = lineIndent(source, last.start);
  // No trailing comma on the inserted element: the insertion lands at
  // `last.end`, BEFORE any trailing comma already in the source, so emitting
  // one here would produce `}),,` — a sparse-array hole.
  const text = `,\n${indent}${SURFACE_OVERLAY_NAME}({\n${indent}  ${surfaceKey}: ${bindingsObjectText(bindings, `${indent}  `)},\n${indent}})`;
  return createSourceEdit(last.end, last.end, text);
};

/** Replacement text for a brand-new `trailsOverlays` export. */
const overlaysExportText = (
  surfaceKey: 'cli' | 'mcp',
  bindings: ReadonlyMap<string, BindingValue>
): string =>
  `export const ${OVERLAYS_EXPORT_NAME} = [\n  ${SURFACE_OVERLAY_NAME}({\n    ${surfaceKey}: ${bindingsObjectText(bindings, '    ')},\n  }),\n];`;

/** Statement span extended over trailing horizontal whitespace + newline. */
const statementDeletionEdit = (
  source: string,
  statement: AstNode
): SourceEdit => {
  let { end } = statement;
  while (end < source.length && (source[end] === ' ' || source[end] === '\t')) {
    end += 1;
  }
  if (source[end] === '\n') {
    end += 1;
  }
  return createSourceEdit(statement.start, end, '');
};

const reviewDetailAt = (params: {
  readonly expectedTarget: string;
  readonly node: AstNode;
  readonly reason: string;
  readonly source: string;
  readonly symbol: string;
}): RegradeReviewDetail => {
  const location = offsetToLineColumn(params.source, params.node.start);
  return {
    expectedTarget: params.expectedTarget,
    nodeKind: params.node.type,
    reason: params.reason,
    span: {
      column: location.column,
      end: params.node.end,
      line: location.line,
      start: params.node.start,
    },
    suggestedValidation: 'bun run typecheck && trails compile',
    symbol: params.symbol,
  };
};

const needsReview = (params: {
  readonly detail: RegradeReviewDetail;
  readonly notes: readonly string[];
  readonly reason: string;
}): RegradeClassResult => ({
  kind: 'needs-review',
  notes: params.notes,
  reason: params.reason,
  reviewDetails: [params.detail],
});

const scanTargetSkip = (
  context: RegradeClassContext | undefined
): RegradeClassResult | null => {
  const path = context?.path ?? context?.absolutePath ?? '<regrade-source>';
  if (isWardenSourceScanTarget(path)) {
    return null;
  }
  return {
    kind: 'skipped',
    notes: ['Skipped by Warden source scan-target filtering.'],
    reason: 'warden-scan-target-filtered',
  };
};

const parseFailureResult = (
  path: string,
  diagnostics: readonly { readonly message: string }[]
): RegradeClassResult => ({
  kind: 'needs-review',
  notes:
    diagnostics.length > 0
      ? diagnostics.map(
          (diagnostic) =>
            `Could not safely parse ${path}: ${diagnostic.message}`
        )
      : [`Could not parse ${path} for export restructure.`],
  reason: 'export-restructure-parse-failed',
});

const cliAliasTargetSummary = (
  bindings: ReadonlyMap<string, BindingValue> | null
): string =>
  bindings === null
    ? `wrap the inverted alias map into surfaceOverlay({ cli: { '<alias.path>': '<trail.id>' } }) inside the module's trailsOverlays array export`
    : `wrap into ${surfaceOverlayTargetShape('cli', bindings)} inside the module's trailsOverlays array export`;

interface CliAliasReview {
  readonly note: string;
  readonly reason: string;
}

/**
 * The guard chain that decides whether a legacy alias declaration is the
 * provable exported app-module convention. Returns a review classification
 * when a rewrite cannot be proven safe.
 */
const cliAliasCandidateReview = (
  program: AstNode,
  candidate: TopLevelConst,
  inverted: BindingsParse,
  targetSummary: string
): CliAliasReview | null => {
  if (!inverted.ok) {
    return {
      note: `Legacy CLI alias map "${candidate.name}" could not be proven safe (${inverted.reason}); ${targetSummary}.`,
      reason: 'cli-aliases-not-statically-provable',
    };
  }
  const references = countOtherReferences(
    program,
    candidate.name,
    getNodeId(candidate.declarator)
  );
  if (references > 0) {
    return {
      note: `Legacy CLI alias map "${candidate.name}" is referenced ${references} time(s) in this module (for example a surface-option aliases: usage); ${targetSummary} and pass overlays to the surface call instead.`,
      reason: 'cli-aliases-referenced-in-module',
    };
  }
  if (!candidate.exported) {
    return {
      note: `Legacy CLI alias map "${candidate.name}" is a local const, not the exported app-module convention; ${targetSummary}.`,
      reason: 'cli-aliases-const-not-exported',
    };
  }
  if (candidate.kind !== 'const') {
    return {
      note: `Legacy CLI alias export "${candidate.name}" uses a mutable ${candidate.kind ?? 'binding'}; ${targetSummary}.`,
      reason: 'cli-aliases-mutable-binding',
    };
  }
  return null;
};

type CliAliasRestructure =
  | {
      readonly ok: true;
      readonly edits: SourceEdit[];
      readonly notes: string[];
    }
  | { readonly ok: false; readonly review: CliAliasReview };

/** Build the overlay-side edits for a proven legacy alias export. */
const buildCliAliasRestructure = (params: {
  readonly bindings: ReadonlyMap<string, BindingValue>;
  readonly candidate: TopLevelConst;
  readonly program: AstNode;
  readonly source: string;
  readonly targetSummary: string;
}): CliAliasRestructure => {
  const { bindings, candidate, program, source, targetSummary } = params;
  const overlays = findOverlaysExport(program);
  const edits: SourceEdit[] = [];
  const notes: string[] = [];

  if (!overlays.declared) {
    edits.push(
      createSourceEdit(
        candidate.statement.start,
        candidate.statement.end,
        overlaysExportText('cli', bindings)
      )
    );
    notes.push(
      `Replaced legacy "${candidate.name}" export with surfaceOverlay({ cli }) bindings inside a new trailsOverlays export.`
    );
    return { edits, notes, ok: true };
  }
  if (overlays.parse === null) {
    return {
      ok: false,
      review: {
        note: `The module's trailsOverlays export is not a statically provable array literal; ${targetSummary}.`,
        reason: 'cli-aliases-overlays-not-statically-provable',
      },
    };
  }
  if (overlays.parse.overlayObject === undefined) {
    edits.push(
      appendOverlayElementEdit({
        arrayNode: overlays.parse.arrayNode,
        bindings,
        source,
        surfaceKey: 'cli',
      })
    );
    edits.push(statementDeletionEdit(source, candidate.statement));
    notes.push(
      `Appended surfaceOverlay({ cli }) to trailsOverlays and removed the legacy "${candidate.name}" export.`
    );
    return { edits, notes, ok: true };
  }
  const merge = mergeIntoOverlayObject({
    bindings,
    overlayObject: overlays.parse.overlayObject,
    source,
    surfaceKey: 'cli',
  });
  if (!merge.ok) {
    return {
      ok: false,
      review: {
        note: `${merge.reason}; ${targetSummary}.`,
        reason: 'cli-aliases-overlay-merge-conflict',
      },
    };
  }
  if (merge.edit !== null) {
    edits.push(merge.edit);
  }
  edits.push(statementDeletionEdit(source, candidate.statement));
  notes.push(merge.note);
  notes.push(`Removed the legacy "${candidate.name}" export.`);
  return { edits, notes, ok: true };
};

const applyValidatedEdits = (
  source: string,
  edits: readonly SourceEdit[],
  notes: readonly string[]
): RegradeClassResult | { readonly failure: string } => {
  try {
    validateSourceEdits(edits);
    return {
      kind: 'rewrite',
      nextSource: applySourceEdits(source, edits),
      notes,
    };
  } catch (error) {
    return {
      failure:
        error instanceof Error
          ? `Export restructure edits could not be applied: ${error.message}`
          : 'Export restructure edits could not be applied.',
    };
  }
};

const applyCliAliasesClass = (
  source: string,
  context: RegradeClassContext | undefined
): RegradeClassResult => {
  const skip = scanTargetSkip(context);
  if (skip !== null) {
    return skip;
  }
  if (!source.includes('cliAliases') && !source.includes('trailsCliAliases')) {
    return { kind: 'no-op', notes: ['No legacy CLI alias exports found.'] };
  }
  const path = context?.path ?? '<regrade-source>';
  const parsed = parseWithDiagnostics(path, source);
  if (!parsed.ast || parsed.diagnostics.length > 0) {
    return parseFailureResult(path, parsed.diagnostics);
  }
  const program = parsed.ast;
  const candidates = collectTopLevelConsts(program).filter((candidate) =>
    LEGACY_CLI_ALIAS_NAMES.has(candidate.name)
  );
  const [candidate] = candidates;
  if (candidate === undefined) {
    return {
      kind: 'no-op',
      notes: ['No legacy CLI alias declarations found.'],
    };
  }
  if (candidates.length > 1) {
    return needsReview({
      detail: reviewDetailAt({
        expectedTarget: cliAliasTargetSummary(null),
        node: candidate.statement,
        reason: 'cli-aliases-multiple-declarations',
        source,
        symbol: candidate.name,
      }),
      notes: [
        `Found ${candidates.length} legacy CLI alias declarations; ${cliAliasTargetSummary(null)}.`,
      ],
      reason: 'cli-aliases-multiple-declarations',
    });
  }

  const inverted = invertLegacyAliasMap(candidate.init);
  const targetSummary = cliAliasTargetSummary(
    inverted.ok ? inverted.bindings : null
  );
  const reviewFor = (review: CliAliasReview): RegradeClassResult =>
    needsReview({
      detail: reviewDetailAt({
        expectedTarget: `${targetSummary}.`,
        node: candidate.statement,
        reason: review.reason,
        source,
        symbol: candidate.name,
      }),
      notes: [review.note],
      reason: review.reason,
    });

  const guardReview = cliAliasCandidateReview(
    program,
    candidate,
    inverted,
    targetSummary
  );
  if (guardReview !== null || !inverted.ok) {
    return reviewFor(
      guardReview ?? {
        note: `Legacy CLI alias map "${candidate.name}" could not be proven safe; ${targetSummary}.`,
        reason: 'cli-aliases-not-statically-provable',
      }
    );
  }

  const importEdit = surfaceOverlayImportEdit(program, source);
  if (!importEdit.ok) {
    return reviewFor({
      note: `${importEdit.reason}; ${targetSummary}.`,
      reason: 'cli-aliases-import-conflict',
    });
  }

  const restructure = buildCliAliasRestructure({
    bindings: inverted.bindings,
    candidate,
    program,
    source,
    targetSummary,
  });
  if (!restructure.ok) {
    return reviewFor(restructure.review);
  }
  const edits = [...restructure.edits];
  if (importEdit.edit !== null) {
    edits.push(importEdit.edit);
  }
  const applied = applyValidatedEdits(source, edits, restructure.notes);
  if ('failure' in applied) {
    return reviewFor({
      note: applied.failure,
      reason: 'cli-aliases-invalid-edits',
    });
  }
  return applied;
};

/**
 * Invert legacy `cliAliases` / `trailsCliAliases` alias-map exports into
 * `surfaceOverlay({ cli: { ... } })` bindings inside the module's
 * `trailsOverlays` array export, adding the `surfaceOverlay` import from
 * `@ontrails/core` and deleting the legacy export. Occurrences that cannot be
 * proven safe — computed keys, spreads, non-literal values, in-module
 * references such as a surface-option `aliases:` usage, or a non-exported
 * const — route to `needs-review` with the exact target shape named.
 *
 * @example
 * ```ts
 * import { cliAliasesExportRestructureClass } from '@ontrails/regrade';
 *
 * const result = cliAliasesExportRestructureClass.apply(
 *   "export const trailsCliAliases = { 'survey.diff': [['diff']] };",
 *   { path: 'apps/example/src/app.ts' }
 * );
 * // result.kind === 'rewrite'; result.nextSource wraps the inverted map into
 * // surfaceOverlay({ cli: { diff: 'survey.diff' } }) inside trailsOverlays.
 * ```
 */
export const cliAliasesExportRestructureClass: RegradeClass = {
  apply: applyCliAliasesClass,
  describe:
    'Invert legacy cliAliases/trailsCliAliases exports into surfaceOverlay({ cli }) bindings inside trailsOverlays (review export-restructure).',
  id: CLI_ALIASES_CLASS_ID,
};

interface TrailheadMapCandidate {
  readonly candidate: TopLevelConst;
  readonly groups: ReadonlyMap<string, BindingValue> | null;
  readonly failureReason: string | null;
}

const isTrailheadMapBindingName = (name: string): boolean =>
  name === 'trailheads' ||
  name.endsWith('Trailheads') ||
  name.endsWith('TrailheadMap');

const TRAILHEAD_MAP_TYPE_PATTERN = /\bMcpSurfaceTrailheadMap\b/;

/**
 * Whether the declarator is explicitly typed as a trailhead map: an id type
 * annotation or an `as`/`satisfies` wrapper naming `McpSurfaceTrailheadMap`.
 * Checked on the annotation and wrapper spans only, so string or comment
 * mentions of the type name elsewhere in the declarator never match.
 */
const declaratorHasTrailheadMapType = (
  source: string,
  candidate: TopLevelConst
): boolean => {
  // The raw AST field can be null; guard on truthiness before slicing spans.
  const annotation = getNodeTypeAnnotation(getNodeId(candidate.declarator));
  if (
    annotation &&
    TRAILHEAD_MAP_TYPE_PATTERN.test(
      source.slice(annotation.start, annotation.end)
    )
  ) {
    return true;
  }
  if (candidate.init === undefined) {
    return false;
  }
  const inner = unwrapExpression(candidate.init);
  if (inner === undefined || inner === candidate.init) {
    return false;
  }
  return TRAILHEAD_MAP_TYPE_PATTERN.test(
    source.slice(inner.end, candidate.init.end)
  );
};

/**
 * Whether an object literal is shaped like a trailhead map: at least one
 * entry whose definition object carries a `trails` key. Guards name-convention
 * matches so unrelated objects named `*Trailheads` are not flagged.
 */
const objectLooksLikeTrailheadMap = (object: AstNode): boolean =>
  getNodeProperties(object).some((property) => {
    const definition = unwrapExpression(getNodeValueNode(property));
    return (
      definition !== undefined &&
      isObjectExpression(definition) &&
      getNodeProperties(definition).some(
        (definitionProperty) => propertyKeyName(definitionProperty) === 'trails'
      )
    );
  });

const parseTrailheadGroups = (
  objectNode: AstNode | undefined
): BindingsParse => {
  const object = unwrapExpression(objectNode);
  if (object === undefined || !isObjectExpression(object)) {
    return bindingsParseFailure('the trailhead map is not an object literal');
  }
  const groups = new Map<string, BindingValue>();
  for (const property of getNodeProperties(object)) {
    const name = propertyKeyName(property);
    if (name === null) {
      return bindingsParseFailure(
        'a trailhead entry uses a computed key, spread, or non-literal shape'
      );
    }
    const definition = unwrapExpression(getNodeValueNode(property));
    if (definition === undefined || !isObjectExpression(definition)) {
      return bindingsParseFailure(
        `trailhead "${name}" is not an object-literal definition`
      );
    }
    const trailsProperty = getNodeProperties(definition).find(
      (definitionProperty) => propertyKeyName(definitionProperty) === 'trails'
    );
    if (trailsProperty === undefined) {
      return bindingsParseFailure(
        `trailhead "${name}" declares no literal trails selector list`
      );
    }
    const selectorsNode = unwrapExpression(getNodeValueNode(trailsProperty));
    if (selectorsNode === undefined || !isArrayExpression(selectorsNode)) {
      return bindingsParseFailure(
        `trailhead "${name}" uses a dynamic trails selector`
      );
    }
    const selectors = getNodeElements(selectorsNode).map((element) => {
      const selector = unwrapExpression(element ?? undefined);
      return selector !== undefined && isStringLiteral(selector)
        ? getStringValue(selector)
        : null;
    });
    if (
      !selectors.every((selector): selector is string => selector !== null) ||
      selectors.length === 0
    ) {
      return bindingsParseFailure(
        `trailhead "${name}" carries non-literal trails selectors`
      );
    }
    groups.set(name, selectors);
  }
  if (groups.size === 0) {
    return bindingsParseFailure('the trailhead map declares no entries');
  }
  return { bindings: groups, ok: true };
};

const collectTrailheadMapCandidates = (
  program: AstNode,
  source: string
): readonly TrailheadMapCandidate[] =>
  collectTopLevelConsts(program).flatMap((candidate) => {
    const typed = declaratorHasTrailheadMapType(source, candidate);
    const object = unwrapExpression(candidate.init);
    const isObjectLiteral = object !== undefined && isObjectExpression(object);
    // A candidate is an object-literal map matching the naming convention or
    // the explicit type, or an explicitly typed dynamic value. Helper
    // functions and unrelated values that merely share the naming suffix are
    // not migration targets.
    const isCandidate =
      (isObjectLiteral &&
        (typed ||
          (isTrailheadMapBindingName(candidate.name) &&
            objectLooksLikeTrailheadMap(object)))) ||
      (typed && !isObjectLiteral);
    if (!isCandidate) {
      return [];
    }
    const parsedGroups = parseTrailheadGroups(candidate.init);
    return [
      parsedGroups.ok
        ? { candidate, failureReason: null, groups: parsedGroups.bindings }
        : { candidate, failureReason: parsedGroups.reason, groups: null },
    ];
  });

const mcpTargetSummary = (
  groups: ReadonlyMap<string, BindingValue> | null
): string =>
  groups === null
    ? `author surfaceOverlay({ mcp: { '<name>': ['<trail.id>', ...] } }) in the app module's trailsOverlays array export; keep this call-site trailhead map as the runtime override-in-context`
    : `author ${surfaceOverlayTargetShape('mcp', groups)} in the app module's trailsOverlays array export; keep this call-site trailhead map as the runtime override-in-context`;

interface McpReviewParams {
  readonly node: AstNode;
  readonly note: string;
  readonly reason: string;
  readonly symbol: string;
  readonly target: string;
}

const mcpNeedsReview = (
  source: string,
  params: McpReviewParams
): RegradeClassResult =>
  needsReview({
    detail: reviewDetailAt({
      expectedTarget: `${params.target}.`,
      node: params.node,
      reason: params.reason,
      source,
      symbol: params.symbol,
    }),
    notes: [params.note],
    reason: params.reason,
  });

type TrailheadGroupsMerge =
  | { readonly ok: true; readonly groups: ReadonlyMap<string, BindingValue> }
  | { readonly ok: false; readonly review: McpReviewParams };

/** Merge every candidate map's groups, flagging unprovable or conflicting entries. */
const mergeTrailheadGroups = (
  mapCandidates: readonly TrailheadMapCandidate[]
): TrailheadGroupsMerge => {
  const unprovable = mapCandidates.find(
    (entry) => entry.failureReason !== null
  );
  if (unprovable !== undefined) {
    return {
      ok: false,
      review: {
        node: unprovable.candidate.statement,
        note: `Trailhead map "${unprovable.candidate.name}" could not be proven safe (${unprovable.failureReason}); ${mcpTargetSummary(null)}.`,
        reason: 'mcp-trailheads-not-statically-provable',
        symbol: unprovable.candidate.name,
        target: mcpTargetSummary(null),
      },
    };
  }
  const groups = new Map<string, BindingValue>();
  for (const entry of mapCandidates) {
    for (const [name, members] of entry.groups ?? []) {
      const existing = groups.get(name);
      if (existing !== undefined && !bindingValuesEqual(existing, members)) {
        return {
          ok: false,
          review: {
            node: entry.candidate.statement,
            note: `Trailhead "${name}" is declared with conflicting members across maps; ${mcpTargetSummary(null)}.`,
            reason: 'mcp-trailheads-conflicting-groups',
            symbol: name,
            target: mcpTargetSummary(null),
          },
        };
      }
      groups.set(name, members);
    }
  }
  return { groups, ok: true };
};

/** Rewrite path: the module exports `trailsOverlays`, so merge in place. */
const rewriteTrailheadsIntoOverlays = (params: {
  readonly anchor: AstNode;
  readonly anchorSymbol: string;
  readonly groups: ReadonlyMap<string, BindingValue>;
  readonly overlays: ReturnType<typeof findOverlaysExport>;
  readonly program: AstNode;
  readonly source: string;
}): RegradeClassResult => {
  const { anchor, anchorSymbol, groups, overlays, program, source } = params;
  const target = mcpTargetSummary(groups);
  if (overlays.parse === null) {
    return mcpNeedsReview(source, {
      node: anchor,
      note: `The module's trailsOverlays export is not a statically provable array literal; ${target}.`,
      reason: 'mcp-trailheads-overlays-not-statically-provable',
      symbol: anchorSymbol,
      target,
    });
  }
  const importEdit = surfaceOverlayImportEdit(program, source);
  if (!importEdit.ok) {
    return mcpNeedsReview(source, {
      node: anchor,
      note: `${importEdit.reason}; ${target}.`,
      reason: 'mcp-trailheads-import-conflict',
      symbol: anchorSymbol,
      target,
    });
  }

  const edits: SourceEdit[] = [];
  const notes: string[] = [];
  if (overlays.parse.overlayObject === undefined) {
    edits.push(
      appendOverlayElementEdit({
        arrayNode: overlays.parse.arrayNode,
        bindings: groups,
        source,
        surfaceKey: 'mcp',
      })
    );
    notes.push(
      'Appended surfaceOverlay({ mcp }) group bindings to trailsOverlays; the call-site trailhead map stays as the runtime override-in-context.'
    );
  } else {
    const merge = mergeIntoOverlayObject({
      bindings: groups,
      overlayObject: overlays.parse.overlayObject,
      source,
      surfaceKey: 'mcp',
    });
    if (!merge.ok) {
      return mcpNeedsReview(source, {
        node: anchor,
        note: `${merge.reason}; ${target}.`,
        reason: 'mcp-trailheads-overlay-merge-conflict',
        symbol: anchorSymbol,
        target,
      });
    }
    if (merge.edit === null) {
      return {
        kind: 'no-op',
        notes: [
          'Module overlay already covers the trailhead map; the call-site map stays as the runtime override-in-context.',
        ],
      };
    }
    edits.push(merge.edit);
    notes.push(
      `${merge.note} The call-site trailhead map stays as the runtime override-in-context.`
    );
  }
  if (importEdit.edit !== null) {
    edits.push(importEdit.edit);
  }
  const applied = applyValidatedEdits(source, edits, notes);
  if ('failure' in applied) {
    return mcpNeedsReview(source, {
      node: anchor,
      note: applied.failure,
      reason: 'mcp-trailheads-invalid-edits',
      symbol: anchorSymbol,
      target,
    });
  }
  return applied;
};

const applyMcpTrailheadsClass = (
  source: string,
  context: RegradeClassContext | undefined
): RegradeClassResult => {
  const skip = scanTargetSkip(context);
  if (skip !== null) {
    return skip;
  }
  if (!source.includes('railhead')) {
    return { kind: 'no-op', notes: ['No trailhead maps found.'] };
  }
  const path = context?.path ?? '<regrade-source>';
  const parsed = parseWithDiagnostics(path, source);
  if (!parsed.ast || parsed.diagnostics.length > 0) {
    return parseFailureResult(path, parsed.diagnostics);
  }
  const program = parsed.ast;
  const mapCandidates = collectTrailheadMapCandidates(program, source);
  const [first] = mapCandidates;
  if (first === undefined) {
    return { kind: 'no-op', notes: ['No trailhead maps found.'] };
  }

  const merged = mergeTrailheadGroups(mapCandidates);
  if (!merged.ok) {
    return mcpNeedsReview(source, merged.review);
  }

  const overlays = findOverlaysExport(program);
  if (overlays.declared) {
    return rewriteTrailheadsIntoOverlays({
      anchor: first.candidate.statement,
      anchorSymbol: first.candidate.name,
      groups: merged.groups,
      overlays,
      program,
      source,
    });
  }

  if (moduleReferencesIdentifier(program, OVERLAYS_EXPORT_NAME)) {
    return {
      kind: 'no-op',
      notes: [
        'Module already threads trailsOverlays next to the trailhead map; the call-site map stays as the runtime override-in-context.',
      ],
    };
  }

  const target = mcpTargetSummary(merged.groups);
  return mcpNeedsReview(source, {
    node: first.candidate.statement,
    note: `Trailhead map lives outside the app module; ${target}.`,
    reason: 'mcp-trailheads-module-overlay-missing',
    symbol: first.candidate.name,
    target,
  });
};

/**
 * Project call-site MCP trailhead maps into `surfaceOverlay({ mcp: { name:
 * [selectors] } })` group bindings. Because the map usually lives in a
 * different file than the app module, the default outcome is a classified
 * `needs-review` handoff naming the exact target shape; when the same file
 * already exports `trailsOverlays`, the bindings are merged in place and the
 * call-site map is kept as the richer-metadata runtime override.
 *
 * @example
 * ```ts
 * import { mcpTrailheadsExportRestructureClass } from '@ontrails/regrade';
 *
 * const result = mcpTrailheadsExportRestructureClass.apply(
 *   "export const trailheads = { search: { description: 'Search.', trails: ['search.query'] } };",
 *   { path: 'apps/example/src/mcp-options.ts' }
 * );
 * // result.kind === 'needs-review'; the review detail names
 * // surfaceOverlay({ mcp: { search: ['search.query'] } }) as the target.
 * ```
 */
export const mcpTrailheadsExportRestructureClass: RegradeClass = {
  apply: applyMcpTrailheadsClass,
  describe:
    'Project call-site MCP trailhead maps into surfaceOverlay({ mcp }) group bindings inside trailsOverlays (classified handoff).',
  id: MCP_TRAILHEADS_CLASS_ID,
};

/**
 * The export-restructure Regrade class family (TRL-1210), in deterministic
 * id order.
 *
 * @example
 * ```ts
 * import { exportRestructureClasses } from '@ontrails/regrade';
 *
 * exportRestructureClasses.map((cls) => cls.id);
 * // => ['export-restructure:cli-aliases', 'export-restructure:mcp-trailheads']
 * ```
 */
export const exportRestructureClasses: readonly RegradeClass[] = Object.freeze([
  cliAliasesExportRestructureClass,
  mcpTrailheadsExportRestructureClass,
]);

/**
 * Project a Warden rule that advertises the `export-restructure` fix class
 * into its registered Regrade class. Warden owns detection and fix metadata;
 * Regrade owns the structural transform. Returns `null` for rules without an
 * `export-restructure` fix class or without a registered transform.
 *
 * @example
 * ```ts
 * import { createWardenExportRestructureClass } from '@ontrails/regrade';
 * import { wardenRules } from '@ontrails/warden';
 *
 * const rule = wardenRules.get('no-legacy-cli-alias-export');
 * const cls = rule ? createWardenExportRestructureClass(rule) : null;
 * // cls?.id === 'export-restructure:cli-aliases'
 * ```
 */
export const createWardenExportRestructureClass = (
  rule: WardenRule
): RegradeClass | null => {
  const metadata = getWardenRuleMetadata(rule);
  if (metadata?.fix?.class !== EXPORT_RESTRUCTURE_FIX_CLASS) {
    return null;
  }
  if (rule.name === 'no-legacy-cli-alias-export') {
    return cliAliasesExportRestructureClass;
  }
  return null;
};

/**
 * Load every Warden-routed Regrade class: built-in and project-local
 * term-rewrite classes plus the export-restructure family. This is the
 * broader successor to {@link loadWardenTermRewriteClasses}, which stays
 * exported for callers that want span-rewrite classes only.
 *
 * @example
 * ```ts
 * import { loadWardenRegradeClasses } from '@ontrails/regrade';
 *
 * const { classes } = await loadWardenRegradeClasses(process.cwd());
 * classes.some((cls) => cls.id === 'export-restructure:cli-aliases');
 * // => true
 * ```
 */
export const loadWardenRegradeClasses = async (
  root?: string
): Promise<RegradeWardenClassSet> => {
  const termRewrite = await loadWardenTermRewriteClasses(root);

  const restructureRules = [...wardenRules.values()];
  if (root !== undefined) {
    // Project diagnostics are already carried by the term-rewrite loader; this
    // second pass only projects export-restructure-capable project rules.
    const projectRules = await loadProjectWardenRules(root);
    restructureRules.push(...projectRules.sourceRules);
  }
  const wardenRestructureClasses = restructureRules.flatMap((rule) => {
    const cls = createWardenExportRestructureClass(rule);
    return cls === null ? [] : [cls];
  });

  const classes = [...termRewrite.classes];
  const seen = new Set(classes.map((cls) => cls.id));
  for (const cls of [
    ...wardenRestructureClasses,
    ...exportRestructureClasses,
  ]) {
    if (seen.has(cls.id)) {
      continue;
    }
    seen.add(cls.id);
    classes.push(cls);
  }
  return { classes, diagnostics: termRewrite.diagnostics };
};
