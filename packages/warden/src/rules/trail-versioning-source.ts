import {
  findConfigProperty,
  findImplementationBodies,
  findTrailDefinitions,
  getNodeArgument,
  getNodeArguments,
  getNodeCallee,
  getNodeElements,
  getNodeExpression,
  getNodeId,
  getNodeInit,
  getNodeKey,
  getNodeLeft,
  getNodeName,
  getNodeObject,
  getNodeParams,
  getNodeProperties,
  getNodeProperty,
  getNodeValue,
  getNodeValueNode,
  isMemberAccessNonComputed,
  offsetToLine,
  parse,
  walk,
  walkScope,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import type { WardenDiagnostic, WardenRule } from './types.js';

const VERSION_PINNED_COMPOSE = 'version-pinned-compose';
const FORK_WITHOUT_PRESERVED_IMPLEMENTATION =
  'fork-without-preserved-implementation';
const MARKER_SCHEMA_UNSUPPORTED = 'marker-schema-unsupported';

interface SchemaBindingRecord {
  readonly initializer: AstNode | undefined;
  readonly scopeEnd: number;
  readonly scopeStart: number;
  readonly start: number;
}

type SchemaBindings = ReadonlyMap<string, readonly SchemaBindingRecord[]>;

// Zod schema constructors and modifiers outside the marker subset that the
// runtime guard in packages/core/src/version-marker.ts rejects. This deny-list
// is best-effort source-static coverage; the runtime allow-list remains the
// authoritative gate. Entries are evidence-verified against the runtime guard.
const unsupportedSchemaCalls = new Set([
  'and',
  'any',
  'base64',
  'base64url',
  'bigint',
  'catch',
  'catchall',
  'check',
  'cidrv4',
  'cidrv6',
  'codec',
  'cuid',
  'cuid2',
  'custom',
  'date',
  'datetime',
  'default',
  'duration',
  'e164',
  'email',
  'emoji',
  'endsWith',
  'file',
  'finite',
  'function',
  'gt',
  'gte',
  'guid',
  'hash',
  'includes',
  'instanceof',
  'int',
  'intersection',
  'ipv4',
  'ipv6',
  'json',
  'jwt',
  'ksuid',
  'lazy',
  'length',
  'loose',
  'looseObject',
  'looseRecord',
  'lowercase',
  'lt',
  'lte',
  'map',
  'max',
  'min',
  'multipleOf',
  'nan',
  'nanoid',
  'negative',
  'never',
  'nonempty',
  'nonnegative',
  'nonoptional',
  'nonpositive',
  'normalize',
  'null',
  'overwrite',
  'partialRecord',
  'passthrough',
  'pipe',
  'positive',
  'prefault',
  'preprocess',
  'promise',
  'record',
  'refine',
  'regex',
  'required',
  'safe',
  'set',
  'slugify',
  'startsWith',
  'step',
  'strict',
  'strictObject',
  'stringbool',
  'superRefine',
  'symbol',
  'templateLiteral',
  'time',
  'toLowerCase',
  'toUpperCase',
  'transform',
  'trim',
  'tuple',
  'ulid',
  'undefined',
  'unknown',
  'uppercase',
  'url',
  'uuid',
  'uuidv4',
  'uuidv6',
  'uuidv7',
  'void',
  'xid',
]);

const diagnostic = (
  rule: string,
  severity: WardenDiagnostic['severity'],
  filePath: string,
  sourceCode: string,
  node: AstNode,
  message: string
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, node.start),
  message,
  rule,
  severity,
});

const staticPropertyKeyName = (node: AstNode | undefined): string | null => {
  if (node?.type === 'Identifier') {
    return getNodeName(node) ?? null;
  }
  if (
    node?.type === 'Literal' ||
    node?.type === 'StringLiteral' ||
    node?.type === 'NumericLiteral'
  ) {
    const value = getNodeValue(node);
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : null;
  }
  return null;
};

const objectProperties = (node: AstNode | undefined): readonly AstNode[] =>
  node?.type === 'ObjectExpression' ? (getNodeProperties(node) ?? []) : [];

const propertyName = (node: AstNode): string | null =>
  node.type === 'Property' ? staticPropertyKeyName(getNodeKey(node)) : null;

const hasProperty = (node: AstNode, name: string): boolean =>
  objectProperties(node).some((property) => propertyName(property) === name);

const propertyValue = (property: AstNode | null): AstNode | undefined =>
  property?.type === 'Property'
    ? (getNodeValueNode(property) ?? undefined)
    : undefined;

const trailIsVersioned = (config: AstNode): boolean =>
  findConfigProperty(config, 'version') !== null ||
  findConfigProperty(config, 'versions') !== null;

const versionEntries = (config: AstNode): readonly AstNode[] => {
  const versions = propertyValue(findConfigProperty(config, 'versions'));
  return objectProperties(versions)
    .map((property) => propertyValue(property))
    .filter((entry): entry is AstNode => entry?.type === 'ObjectExpression');
};

const identifierName = (node: AstNode | undefined): string | undefined =>
  node?.type === 'Identifier' ? getNodeName(node) : undefined;

const schemaBindingInitializer = (
  schemaBindings: SchemaBindings,
  name: string,
  referenceStart: number
): AstNode | undefined => {
  let resolved: SchemaBindingRecord | undefined;
  for (const record of schemaBindings.get(name) ?? []) {
    if (record.start >= referenceStart) {
      break;
    }
    if (
      record.scopeStart > referenceStart ||
      record.scopeEnd < referenceStart
    ) {
      continue;
    }
    resolved = record;
  }
  return resolved?.initializer;
};

const memberObject = (node: AstNode | undefined): AstNode | undefined =>
  node !== undefined && isMemberAccessNonComputed(node)
    ? getNodeObject(node)
    : undefined;

const memberPropertyName = (node: AstNode | undefined): string | undefined =>
  node !== undefined && isMemberAccessNonComputed(node)
    ? identifierName(getNodeProperty(node))
    : undefined;

const callCallee = (node: AstNode): AstNode | undefined =>
  node.type === 'CallExpression' ? getNodeCallee(node) : undefined;

const isZodSchemaReceiver = (
  node: AstNode | undefined,
  schemaBindings: SchemaBindings = new Map(),
  referenceStart = node?.start ?? Number.POSITIVE_INFINITY
): boolean => {
  if (!node) {
    return false;
  }
  const name = identifierName(node);
  if (
    name === 'z' ||
    (name !== undefined &&
      schemaBindingInitializer(schemaBindings, name, referenceStart) !==
        undefined)
  ) {
    return true;
  }
  if (node.type === 'CallExpression') {
    return isZodSchemaReceiver(
      memberObject(callCallee(node)),
      schemaBindings,
      referenceStart
    );
  }
  return isZodSchemaReceiver(
    memberObject(node),
    schemaBindings,
    referenceStart
  );
};

const isZodSchemaCallee = (
  node: AstNode | undefined,
  schemaBindings: SchemaBindings = new Map()
): boolean =>
  node !== undefined && isZodSchemaReceiver(memberObject(node), schemaBindings);

const callArguments = (node: AstNode): readonly AstNode[] =>
  node.type === 'CallExpression' ? (getNodeArguments(node) ?? []) : [];

const unwrapExpression = (node: AstNode | undefined): AstNode | undefined => {
  let current = node;
  while (
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSSatisfiesExpression' ||
    current?.type === 'TSNonNullExpression'
  ) {
    current = getNodeExpression(current);
  }
  return current;
};

const arrayExpressionLength = (node: AstNode | undefined): number => {
  const expression = unwrapExpression(node);
  return expression?.type === 'ArrayExpression'
    ? (getNodeElements(expression) ?? []).length
    : 0;
};

const isNumberProperty = (
  node: AstNode | undefined,
  names: ReadonlySet<string>
): boolean =>
  node !== undefined &&
  isMemberAccessNonComputed(node) &&
  identifierName(memberObject(node)) === 'Number' &&
  names.has(memberPropertyName(node) ?? '');

const nonFiniteNumberProperties = new Set([
  'NaN',
  'NEGATIVE_INFINITY',
  'POSITIVE_INFINITY',
]);

const literalExpressionIsJsonLossy = (expression: AstNode): boolean => {
  if (
    expression.type === 'BigIntLiteral' ||
    expression.type === 'RegExpLiteral'
  ) {
    return true;
  }
  if (expression['bigint'] !== undefined || expression['regex'] !== undefined) {
    return true;
  }
  const value = getNodeValue(expression);
  if (value instanceof RegExp) {
    return true;
  }
  return typeof value === 'number' && !Number.isFinite(value);
};

const expressionIsJsonLossy = (node: AstNode | undefined): boolean => {
  const expression = unwrapExpression(node);
  if (!expression) {
    return true;
  }

  const name = identifierName(expression);
  if (name === 'NaN' || name === 'Infinity' || name === 'undefined') {
    return true;
  }

  if (isNumberProperty(expression, nonFiniteNumberProperties)) {
    return true;
  }

  if (expression.type === 'UnaryExpression') {
    return expressionIsJsonLossy(getNodeArgument(expression));
  }

  if (expression.type === 'Literal' || expression.type === 'NumericLiteral') {
    return literalExpressionIsJsonLossy(expression);
  }

  if (expression.type === 'ArrayExpression') {
    const elements = getNodeElements(expression);
    return elements.some((element) =>
      expressionIsJsonLossy(element ?? undefined)
    );
  }

  if (expression.type === 'ObjectExpression') {
    return objectProperties(expression).some((property) => {
      if (property.type !== 'Property') {
        return false;
      }
      return expressionIsJsonLossy(propertyValue(property));
    });
  }

  return false;
};

const expressionIsReferenceValued = (node: AstNode | undefined): boolean => {
  const expression = unwrapExpression(node);
  return (
    expression?.type === 'ArrayExpression' ||
    expression?.type === 'ObjectExpression'
  );
};

const isMultiValueLiteralCall = (
  node: AstNode,
  schemaBindings: SchemaBindings
): boolean => {
  const callee = callCallee(node);
  return (
    node.type === 'CallExpression' &&
    memberPropertyName(callee) === 'literal' &&
    isZodSchemaCallee(callee, schemaBindings) &&
    arrayExpressionLength(callArguments(node)[0]) > 1
  );
};

const isJsonLossyLiteralCall = (
  node: AstNode,
  schemaBindings: SchemaBindings
): boolean => {
  const callee = callCallee(node);
  return (
    node.type === 'CallExpression' &&
    memberPropertyName(callee) === 'literal' &&
    isZodSchemaCallee(callee, schemaBindings) &&
    expressionIsJsonLossy(callArguments(node)[0])
  );
};

const isReferenceValuedLiteralCall = (
  node: AstNode,
  schemaBindings: SchemaBindings
): boolean => {
  const callee = callCallee(node);
  if (
    node.type !== 'CallExpression' ||
    memberPropertyName(callee) !== 'literal' ||
    !isZodSchemaCallee(callee, schemaBindings)
  ) {
    return false;
  }

  const [rawValue] = callArguments(node);
  const value = unwrapExpression(rawValue);
  if (value?.type === 'ObjectExpression') {
    return true;
  }
  if (value?.type !== 'ArrayExpression') {
    return false;
  }
  return (getNodeElements(value) ?? []).some((element) =>
    expressionIsReferenceValued(element ?? undefined)
  );
};

const isJsonLossyEnumCall = (
  node: AstNode,
  schemaBindings: SchemaBindings
): boolean => {
  const callee = callCallee(node);
  if (
    node.type !== 'CallExpression' ||
    memberPropertyName(callee) !== 'enum' ||
    !isZodSchemaCallee(callee, schemaBindings)
  ) {
    return false;
  }

  const [rawOptions] = callArguments(node);
  const options = unwrapExpression(rawOptions);
  if (options?.type === 'ArrayExpression') {
    return expressionIsJsonLossy(options);
  }
  if (options?.type !== 'ObjectExpression') {
    return false;
  }
  return objectProperties(options).some((property) => {
    if (property.type !== 'Property') {
      return false;
    }
    return expressionIsJsonLossy(propertyValue(property));
  });
};

const isReferenceValuedEnumCall = (
  node: AstNode,
  schemaBindings: SchemaBindings
): boolean => {
  const callee = callCallee(node);
  if (
    node.type !== 'CallExpression' ||
    memberPropertyName(callee) !== 'enum' ||
    !isZodSchemaCallee(callee, schemaBindings)
  ) {
    return false;
  }

  const [rawOptions] = callArguments(node);
  const options = unwrapExpression(rawOptions);
  if (options?.type === 'ArrayExpression') {
    return getNodeElements(options).some((element) =>
      expressionIsReferenceValued(element ?? undefined)
    );
  }
  if (options?.type !== 'ObjectExpression') {
    return false;
  }
  return objectProperties(options).some((property) => {
    if (property.type !== 'Property') {
      return false;
    }
    return expressionIsReferenceValued(propertyValue(property));
  });
};

const markerWrapperCanHideOptional = new Set(['nullable', 'readonly']);

const isOptionalWrapperCall = (
  node: AstNode,
  schemaBindings: SchemaBindings
): boolean => {
  const callee = callCallee(node);
  return (
    node.type === 'CallExpression' &&
    memberPropertyName(callee) === 'optional' &&
    isZodSchemaCallee(callee, schemaBindings)
  );
};

const callChainHasOptionalWrapper = (
  node: AstNode | undefined,
  schemaBindings: SchemaBindings
): boolean => {
  const seen = new Set<number>();
  const visit = (current: AstNode | undefined): boolean => {
    const expression = unwrapExpression(current);
    if (expression === undefined || seen.has(expression.start)) {
      return false;
    }
    seen.add(expression.start);

    const name = identifierName(expression);
    if (name !== undefined) {
      return visit(
        schemaBindingInitializer(schemaBindings, name, expression.start)
      );
    }

    if (expression.type === 'CallExpression') {
      const callee = callCallee(expression);
      if (
        memberPropertyName(callee) === 'optional' &&
        isZodSchemaCallee(callee, schemaBindings)
      ) {
        return true;
      }
      return visit(memberObject(callee));
    }
    if (!isMemberAccessNonComputed(expression)) {
      return false;
    }
    return visit(memberObject(expression));
  };
  return visit(node);
};

const isHiddenOptionalWrapperCall = (
  node: AstNode,
  schemaBindings: SchemaBindings
): boolean => {
  const callee = callCallee(node);
  return (
    node.type === 'CallExpression' &&
    markerWrapperCanHideOptional.has(memberPropertyName(callee) ?? '') &&
    isZodSchemaCallee(callee, schemaBindings) &&
    callChainHasOptionalWrapper(memberObject(callee), schemaBindings)
  );
};

const nestedSchemaArguments = (node: AstNode): readonly AstNode[] => {
  if (node.type !== 'CallExpression') {
    return [];
  }
  const name = memberPropertyName(callCallee(node));
  if (name === 'array') {
    return callArguments(node).slice(0, 1);
  }
  if (name === 'or') {
    return callArguments(node).slice(0, 1);
  }
  if (name !== 'union') {
    return [];
  }
  const [rawOptions] = callArguments(node);
  const options = unwrapExpression(rawOptions);
  return options?.type === 'ArrayExpression'
    ? getNodeElements(options).filter(
        (element): element is AstNode => element !== null
      )
    : [];
};

const collectUnsupportedOptionalWrapperStarts = (
  node: AstNode,
  schemaBindings: SchemaBindings,
  unsupported: Set<number>,
  options: { readonly optionalWrapperAllowed?: boolean } = {}
): void => {
  const expression = unwrapExpression(node);
  if (expression === undefined) {
    return;
  }
  const name = identifierName(expression);
  if (name !== undefined) {
    const initializer = schemaBindingInitializer(
      schemaBindings,
      name,
      expression.start
    );
    if (initializer !== undefined) {
      collectUnsupportedOptionalWrapperStarts(
        initializer,
        schemaBindings,
        unsupported,
        options
      );
    }
    return;
  }
  if (isOptionalWrapperCall(expression, schemaBindings)) {
    if (options.optionalWrapperAllowed !== true) {
      unsupported.add(expression.start);
    }
    const inner = memberObject(callCallee(expression));
    if (inner) {
      collectUnsupportedOptionalWrapperStarts(
        inner,
        schemaBindings,
        unsupported
      );
    }
    return;
  }
  if (expression.type === 'ObjectExpression') {
    for (const property of objectProperties(expression)) {
      collectUnsupportedOptionalWrapperStarts(
        propertyValue(property) ?? property,
        schemaBindings,
        unsupported,
        { optionalWrapperAllowed: true }
      );
    }
    return;
  }
  if (
    expression.type === 'CallExpression' &&
    memberPropertyName(callCallee(expression)) === 'object'
  ) {
    const [rawShape] = callArguments(expression);
    const shape = unwrapExpression(rawShape);
    if (shape?.type === 'ObjectExpression') {
      for (const property of objectProperties(shape)) {
        collectUnsupportedOptionalWrapperStarts(
          propertyValue(property) ?? property,
          schemaBindings,
          unsupported,
          { optionalWrapperAllowed: true }
        );
      }
    }
    return;
  }
  for (const argument of nestedSchemaArguments(expression)) {
    collectUnsupportedOptionalWrapperStarts(
      argument,
      schemaBindings,
      unsupported
    );
  }
};

const isMemberCallNamed = (
  node: AstNode,
  names: ReadonlySet<string>,
  schemaBindings: SchemaBindings
): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = callCallee(node);
  if (!callee) {
    return false;
  }
  if (!isZodSchemaCallee(callee, schemaBindings)) {
    return false;
  }
  return names.has(memberPropertyName(callee) ?? '');
};

const bindingName = (node: AstNode): string | undefined =>
  node.type === 'VariableDeclarator'
    ? identifierName(getNodeId(node))
    : undefined;

const lexicalScopeTypes = new Set([
  'ArrowFunctionExpression',
  'BlockStatement',
  'FunctionDeclaration',
  'FunctionExpression',
  'Program',
  'StaticBlock',
]);

const addPatternBindingNames = (
  node: AstNode | undefined,
  into: Set<string>
) => {
  if (!node) {
    return;
  }
  if (node.type === 'Identifier') {
    const name = identifierName(node);
    if (name !== undefined) {
      into.add(name);
    }
    return;
  }
  if (node.type === 'AssignmentPattern') {
    addPatternBindingNames(getNodeLeft(node), into);
    return;
  }
  if (node.type === 'RestElement') {
    addPatternBindingNames(getNodeArgument(node), into);
    return;
  }
  if (node.type === 'ArrayPattern') {
    const elements = getNodeElements(node);
    for (const element of elements) {
      addPatternBindingNames(element ?? undefined, into);
    }
    return;
  }
  if (node.type !== 'ObjectPattern') {
    return;
  }
  const properties = getNodeProperties(node) ?? [];
  for (const property of properties) {
    if (property.type === 'RestElement') {
      addPatternBindingNames(property, into);
      continue;
    }
    addPatternBindingNames(getNodeValueNode(property), into);
  }
};

const parameterBindingNames = (node: AstNode): readonly string[] => {
  if (!lexicalScopeTypes.has(node.type) || node.type === 'BlockStatement') {
    return [];
  }
  const names = new Set<string>();
  const params = getNodeParams(node) ?? [];
  for (const param of params) {
    addPatternBindingNames(param, names);
  }
  return [...names];
};

const variableInitializer = (node: AstNode): AstNode | undefined =>
  node.type === 'VariableDeclarator'
    ? (getNodeInit(node) ?? undefined)
    : undefined;

const isZodSchemaExpression = (
  node: AstNode | undefined,
  schemaBindings: SchemaBindings
): boolean =>
  node?.type === 'CallExpression' &&
  isZodSchemaCallee(callCallee(node), schemaBindings);

const schemaBindingExpressionInitializer = (
  node: AstNode | undefined,
  schemaBindings: SchemaBindings
): AstNode | undefined => {
  if (isZodSchemaExpression(node, schemaBindings)) {
    return node;
  }
  const name = identifierName(node);
  return name === undefined || node === undefined
    ? undefined
    : schemaBindingInitializer(schemaBindings, name, node.start);
};

const astChildNodes = (node: AstNode): readonly AstNode[] => {
  const children: AstNode[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      children.push(
        ...value.filter(
          (entry): entry is AstNode =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as AstNode).type === 'string'
        )
      );
      continue;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as AstNode).type === 'string'
    ) {
      children.push(value as AstNode);
    }
  }
  return children;
};

const collectZodSchemaBindings = (ast: AstNode): SchemaBindings => {
  const bindings = new Map<string, SchemaBindingRecord[]>();

  const visit = (
    node: AstNode,
    scope: { readonly end: number; readonly start: number }
  ): void => {
    const nextScope = lexicalScopeTypes.has(node.type)
      ? { end: node.end, start: node.start }
      : scope;
    const name = bindingName(node);
    const initializer = variableInitializer(node);
    for (const parameterName of parameterBindingNames(node)) {
      const records = bindings.get(parameterName) ?? [];
      records.push({
        initializer: undefined,
        scopeEnd: nextScope.end,
        scopeStart: nextScope.start,
        start: node.start,
      });
      bindings.set(parameterName, records);
    }
    if (name !== undefined) {
      const records = bindings.get(name) ?? [];
      records.push({
        initializer: schemaBindingExpressionInitializer(initializer, bindings),
        scopeEnd: nextScope.end,
        scopeStart: nextScope.start,
        start: node.start,
      });
      bindings.set(name, records);
    }

    for (const child of astChildNodes(node)) {
      visit(child, nextScope);
    }
  };

  visit(ast, { end: ast.end, start: ast.start });
  return bindings;
};

/**
 * Detect coerced primitive schema calls such as `z.coerce.number()`. The final
 * callee property is a supported primitive name, so the deny-list never matches;
 * the coercion lives on the intermediate `.coerce` member. The runtime marker
 * guard rejects `def.coerce === true`, so Warden must flag the same shape.
 */
const isCoerceMarkerCall = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = callCallee(node);
  if (!callee || !isMemberAccessNonComputed(callee)) {
    return false;
  }
  const object = memberObject(callee);
  return (
    object !== undefined &&
    isMemberAccessNonComputed(object) &&
    memberPropertyName(object) === 'coerce' &&
    isZodSchemaReceiver(memberObject(object))
  );
};

const hasVersionOption = (node: AstNode | undefined): boolean =>
  node?.type === 'ObjectExpression' && hasProperty(node, 'version');

const composeCallHasVersionPin = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const args = getNodeArguments(node);
  const callee = getNodeCallee(node);
  if (!callee || !args) {
    return false;
  }

  const isComposeIdentifier =
    callee.type === 'Identifier' && getNodeName(callee) === 'compose';
  const property = getNodeProperty(callee);
  const isComposeMember =
    isMemberAccessNonComputed(callee) &&
    property?.type === 'Identifier' &&
    getNodeName(property) === 'compose';

  return (isComposeIdentifier || isComposeMember) && hasVersionOption(args[2]);
};

export const versionPinnedCompose: WardenRule = {
  check(sourceCode, filePath) {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    for (const implementation of findImplementationBodies(ast)) {
      walk(implementation, (node) => {
        if (!composeCallHasVersionPin(node)) {
          return;
        }
        diagnostics.push(
          diagnostic(
            VERSION_PINNED_COMPOSE,
            'warn',
            filePath,
            sourceCode,
            node,
            'ctx.compose() version pins are temporary migration debt. Prefer keeping composition current, or document why this pin can be removed later.'
          )
        );
      });
    }
    return diagnostics;
  },
  description:
    'Warn when ctx.compose() calls pin a specific trail version instead of composing with the current trail.',
  name: VERSION_PINNED_COMPOSE,
  severity: 'warn',
};

export const forkWithoutPreservedImplementation: WardenRule = {
  check(sourceCode, filePath) {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    for (const definition of findTrailDefinitions(ast)) {
      if (definition.kind !== 'trail') {
        continue;
      }
      for (const entry of versionEntries(definition.config)) {
        if (
          hasProperty(entry, 'transpose') ||
          hasProperty(entry, 'implementation')
        ) {
          continue;
        }
        diagnostics.push(
          diagnostic(
            FORK_WITHOUT_PRESERVED_IMPLEMENTATION,
            'error',
            filePath,
            sourceCode,
            entry,
            `Trail "${definition.id}" has a historical version entry without transpose or implementation. Add transpose for a revision entry, or preserve the historical implementation for a fork entry.`
          )
        );
      }
    }
    return diagnostics;
  },
  description:
    'Require historical fork version entries to preserve an implementation, while revision entries declare transpose.',
  name: FORK_WITHOUT_PRESERVED_IMPLEMENTATION,
  severity: 'error',
};

const directSchemaNodesForTrail = (config: AstNode): readonly AstNode[] => {
  const nodes: AstNode[] = [];
  for (const key of ['input', 'output']) {
    const value = propertyValue(findConfigProperty(config, key));
    if (value) {
      nodes.push(value);
    }
  }
  for (const entry of versionEntries(config)) {
    for (const key of ['input', 'output']) {
      const value = propertyValue(findConfigProperty(entry, key));
      if (value) {
        nodes.push(value);
      }
    }
  }
  return nodes;
};

const schemaNodesForTrail = (
  config: AstNode,
  schemaBindings: SchemaBindings
): readonly AstNode[] => {
  const nodes: AstNode[] = [...directSchemaNodesForTrail(config)];
  const seenBindings = new Set<string>();
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index];
    index += 1;
    if (node === undefined) {
      continue;
    }
    walkScope(node, (candidate) => {
      const name = identifierName(candidate);
      if (name === undefined || seenBindings.has(name)) {
        return;
      }
      const initializer = schemaBindingInitializer(
        schemaBindings,
        name,
        candidate.start
      );
      if (initializer === undefined) {
        return;
      }
      seenBindings.add(name);
      nodes.push(initializer);
    });
  }
  return nodes;
};

export const markerSchemaUnsupported: WardenRule = {
  check(sourceCode, filePath) {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const schemaBindings = collectZodSchemaBindings(ast);
    for (const definition of findTrailDefinitions(ast)) {
      if (definition.kind !== 'trail' || !trailIsVersioned(definition.config)) {
        continue;
      }
      const seenDiagnostics = new Set<number>();
      const unsupportedOptionalWrapperStarts = new Set<number>();
      for (const schema of directSchemaNodesForTrail(definition.config)) {
        collectUnsupportedOptionalWrapperStarts(
          schema,
          schemaBindings,
          unsupportedOptionalWrapperStarts
        );
      }
      for (const schema of schemaNodesForTrail(
        definition.config,
        schemaBindings
      )) {
        walkScope(schema, (node) => {
          if (
            !unsupportedOptionalWrapperStarts.has(node.start) &&
            !isMemberCallNamed(node, unsupportedSchemaCalls, schemaBindings) &&
            !isCoerceMarkerCall(node) &&
            !isMultiValueLiteralCall(node, schemaBindings) &&
            !isJsonLossyLiteralCall(node, schemaBindings) &&
            !isJsonLossyEnumCall(node, schemaBindings) &&
            !isReferenceValuedLiteralCall(node, schemaBindings) &&
            !isReferenceValuedEnumCall(node, schemaBindings) &&
            !isHiddenOptionalWrapperCall(node, schemaBindings)
          ) {
            return;
          }
          if (seenDiagnostics.has(node.start)) {
            return;
          }
          seenDiagnostics.add(node.start);
          diagnostics.push(
            diagnostic(
              MARKER_SCHEMA_UNSUPPORTED,
              'error',
              filePath,
              sourceCode,
              node,
              `Trail "${definition.id}" uses a schema construct outside the supported version-marker subset. Use explicit object, primitive, enum, array, optional, nullable, and union schemas for versioned contracts.`
            )
          );
        });
      }
    }
    return diagnostics;
  },
  description:
    'Reject versioned trail schema constructs that cannot be projected into stable marker contracts.',
  name: MARKER_SCHEMA_UNSUPPORTED,
  severity: 'error',
};
