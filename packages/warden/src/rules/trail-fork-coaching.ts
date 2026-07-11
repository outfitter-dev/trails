import {
  extractStringOrTemplateLiteral,
  findImplementationBodies,
  findConfigProperty,
  findTrailDefinitions,
  getNodeArgument,
  getNodeArguments,
  getNodeCallee,
  getNodeDiscriminant,
  getNodeElements,
  getNodeExpression,
  getNodeId,
  getNodeInit,
  getNodeKey,
  getNodeLeft,
  getNodeObject,
  getNodeOperator,
  getNodeParams,
  getNodeProperties,
  getNodeProperty,
  getNodeRight,
  getNodeTest,
  getNodeValueNode,
  getPropertyName,
  identifierName,
  offsetToLine,
  parse,
  walkScope,
} from './ast.js';
import type { AstNode } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'trail-fork-coaching';

const CONTROL_FIELD_NAMES = new Set(['action', 'operation']);

interface ControlField {
  readonly name: string;
  readonly node: AstNode;
  readonly options: readonly string[];
}

interface SchemaBindingRecord {
  readonly initializer: AstNode | undefined;
  readonly scopeEnd: number;
  readonly scopeStart: number;
  readonly start: number;
}

type SchemaBindings = ReadonlyMap<string, readonly SchemaBindingRecord[]>;

interface ImplementationInputBindings {
  readonly aliases: ReadonlyMap<string, string>;
  readonly inputParamName: string | null;
}

const LEXICAL_SCOPE_TYPES = new Set([
  'ArrowFunctionExpression',
  'BlockStatement',
  'CatchClause',
  'ClassStaticBlock',
  'ForInStatement',
  'ForOfStatement',
  'ForStatement',
  'FunctionBody',
  'FunctionDeclaration',
  'FunctionExpression',
  'Program',
  'StaticBlock',
  'SwitchStatement',
]);

const unwrapExpression = (node: AstNode | undefined): AstNode | undefined => {
  let current = node;
  while (
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSSatisfiesExpression'
  ) {
    current = getNodeExpression(current) ?? getNodeArgument(current);
  }
  return current;
};

const callArguments = (node: AstNode): readonly AstNode[] =>
  getNodeArguments(node) ?? [];

const callName = (node: AstNode | undefined): string | null => {
  const unwrapped = unwrapExpression(node);
  if (unwrapped?.type !== 'CallExpression') {
    return null;
  }
  const callee = getNodeCallee(unwrapped);
  if (callee?.type !== 'MemberExpression') {
    return identifierName(callee);
  }
  return getPropertyName(getNodeProperty(callee));
};

const callObject = (node: AstNode): AstNode | undefined => {
  const callee = getNodeCallee(node);
  if (callee?.type !== 'MemberExpression') {
    return undefined;
  }
  return getNodeObject(callee);
};

const schemaBindingInitializer = (
  schemaBindings: SchemaBindings,
  name: string,
  referenceStart: number
): AstNode | undefined => {
  const records = schemaBindings.get(name) ?? [];
  for (const record of records) {
    if (
      record.start < referenceStart &&
      record.scopeStart <= referenceStart &&
      referenceStart <= record.scopeEnd
    ) {
      return record.initializer;
    }
  }
  return undefined;
};

const resolveSchemaReference = (
  node: AstNode | undefined,
  schemaBindings: SchemaBindings,
  seenBindings = new Set<string>()
): AstNode | undefined => {
  const current = unwrapExpression(node);
  const name = identifierName(current);
  if (!name || seenBindings.has(name)) {
    return current;
  }

  const initializer = schemaBindingInitializer(
    schemaBindings,
    name,
    current?.start ?? 0
  );
  if (!initializer) {
    return current;
  }

  seenBindings.add(name);
  return resolveSchemaReference(initializer, schemaBindings, seenBindings);
};

const unwrapZodDecorators = (
  node: AstNode | undefined,
  schemaBindings: SchemaBindings
): AstNode | undefined => {
  let current = resolveSchemaReference(node, schemaBindings);
  while (current?.type === 'CallExpression') {
    const name = callName(current);
    if (
      name !== 'default' &&
      name !== 'describe' &&
      name !== 'optional' &&
      name !== 'nullable' &&
      name !== 'nullish' &&
      name !== 'passthrough' &&
      name !== 'readonly' &&
      name !== 'strict' &&
      name !== 'strip'
    ) {
      break;
    }
    const next = callObject(current);
    if (!next) {
      break;
    }
    current = resolveSchemaReference(next, schemaBindings);
  }
  return current;
};

const objectProperties = (node: AstNode): readonly AstNode[] =>
  node.type === 'ObjectExpression' || node.type === 'ObjectPattern'
    ? (getNodeProperties(node) ?? [])
    : [];

const propertyValue = (property: AstNode): AstNode | undefined =>
  property.type === 'Property' ? getNodeValueNode(property) : undefined;

const arrayElements = (node: AstNode | undefined): readonly AstNode[] => {
  const unwrapped = unwrapExpression(node);
  if (unwrapped?.type !== 'ArrayExpression') {
    return [];
  }
  return getNodeElements(unwrapped).filter(
    (element): element is AstNode => element !== null
  );
};

const literalOptionsFromEnum = (node: AstNode): readonly string[] => {
  const [options] = callArguments(node);
  return arrayElements(options)
    .map((element) => extractStringOrTemplateLiteral(element))
    .filter((value): value is string => value !== null);
};

const literalOptionFromLiteral = (node: AstNode): string | null => {
  const [literal] = callArguments(node);
  return extractStringOrTemplateLiteral(literal);
};

const literalOptionsFromUnion = (node: AstNode): readonly string[] => {
  const [branches] = callArguments(node);
  return arrayElements(branches)
    .map((branch) => {
      const base = unwrapZodDecorators(branch, new Map());
      return base?.type === 'CallExpression' && callName(base) === 'literal'
        ? literalOptionFromLiteral(base)
        : null;
    })
    .filter((value): value is string => value !== null);
};

const literalOptionsForSchema = (
  schemaNode: AstNode | undefined,
  schemaBindings: SchemaBindings
): readonly string[] => {
  const base = unwrapZodDecorators(schemaNode, schemaBindings);
  if (base?.type !== 'CallExpression') {
    return [];
  }

  if (callName(base) === 'enum') {
    return literalOptionsFromEnum(base);
  }
  if (callName(base) === 'union') {
    return literalOptionsFromUnion(base);
  }
  return [];
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

const variableDeclaratorName = (node: AstNode): string | undefined => {
  if (node.type !== 'VariableDeclarator') {
    return undefined;
  }
  const id = getNodeId(node);
  return identifierName(id) ?? undefined;
};

const collectSchemaBindings = (ast: AstNode): SchemaBindings => {
  const bindings = new Map<string, SchemaBindingRecord[]>();

  const visit = (
    node: AstNode,
    scope: { readonly end: number; readonly start: number }
  ): void => {
    const nextScope = LEXICAL_SCOPE_TYPES.has(node.type)
      ? { end: node.end, start: node.start }
      : scope;
    const name = variableDeclaratorName(node);
    if (name !== undefined) {
      const records = bindings.get(name) ?? [];
      records.push({
        initializer: getNodeInit(node) ?? undefined,
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

const inputShapeObject = (
  config: AstNode,
  schemaBindings: SchemaBindings
): AstNode | null => {
  const input = findConfigProperty(config, 'input');
  const value = unwrapZodDecorators(
    propertyValue(input ?? config),
    schemaBindings
  );
  if (value?.type !== 'CallExpression' || callName(value) !== 'object') {
    return null;
  }

  const [shape] = callArguments(value);
  const unwrappedShape = unwrapExpression(shape);
  return unwrappedShape?.type === 'ObjectExpression' ? unwrappedShape : null;
};

const findControlFields = (
  config: AstNode,
  schemaBindings: SchemaBindings
): readonly ControlField[] => {
  const shape = inputShapeObject(config, schemaBindings);
  if (!shape) {
    return [];
  }

  const fields: ControlField[] = [];
  for (const property of objectProperties(shape)) {
    const name = getPropertyName(getNodeKey(property));
    if (!name || !CONTROL_FIELD_NAMES.has(name)) {
      continue;
    }

    const options = literalOptionsForSchema(
      propertyValue(property),
      schemaBindings
    );
    if (options.length >= 2) {
      fields.push({ name, node: property, options });
    }
  }
  return fields;
};

const implementationParams = (implementation: AstNode): readonly AstNode[] =>
  getNodeParams(implementation) ?? [];

const memberFieldName = (
  node: AstNode | undefined,
  inputParamName: string | null
): string | null => {
  if (!inputParamName) {
    return null;
  }
  const unwrapped = unwrapExpression(node);
  if (unwrapped?.type !== 'MemberExpression') {
    return null;
  }
  const object = getNodeObject(unwrapped);
  if (identifierName(object) !== inputParamName) {
    return null;
  }
  return getPropertyName(getNodeProperty(unwrapped));
};

const patternAliasName = (node: AstNode | undefined): string | null => {
  const unwrapped = unwrapExpression(node);
  if (unwrapped?.type === 'AssignmentPattern') {
    return identifierName(getNodeLeft(unwrapped));
  }
  return identifierName(unwrapped);
};

const collectDestructuredFieldAliasesFromPattern = (
  pattern: AstNode | undefined,
  fields: ReadonlySet<string>
): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();
  if (pattern?.type !== 'ObjectPattern') {
    return aliases;
  }

  for (const property of objectProperties(pattern)) {
    if (property.type === 'RestElement') {
      continue;
    }
    const fieldName = getPropertyName(getNodeKey(property));
    if (!fieldName || !fields.has(fieldName)) {
      continue;
    }
    const alias = patternAliasName(propertyValue(property)) ?? fieldName;
    aliases.set(alias, fieldName);
  }
  return aliases;
};

const collectDestructuredFieldAliases = (
  implementation: AstNode,
  inputParamName: string,
  fields: ReadonlySet<string>
): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();

  walkScope(implementation, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }
    const id = getNodeId(node);
    const init = getNodeInit(node);
    if (
      identifierName(init) !== inputParamName ||
      id?.type !== 'ObjectPattern'
    ) {
      return;
    }

    for (const [alias, fieldName] of collectDestructuredFieldAliasesFromPattern(
      id,
      fields
    )) {
      aliases.set(alias, fieldName);
    }
  });

  return aliases;
};

const collectImplementationInputBindings = (
  implementation: AstNode,
  fields: ReadonlySet<string>
): ImplementationInputBindings | null => {
  const [inputParam] = implementationParams(implementation);
  const inputParamName = identifierName(inputParam);
  if (inputParamName) {
    return {
      aliases: collectDestructuredFieldAliases(
        implementation,
        inputParamName,
        fields
      ),
      inputParamName,
    };
  }

  if (inputParam?.type === 'ObjectPattern') {
    return {
      aliases: collectDestructuredFieldAliasesFromPattern(inputParam, fields),
      inputParamName: null,
    };
  }

  return null;
};

const branchFieldName = (
  node: AstNode | undefined,
  inputParamName: string | null,
  aliases: ReadonlyMap<string, string>
): string | null => {
  const memberName = memberFieldName(node, inputParamName);
  if (memberName) {
    return memberName;
  }
  const identifier = identifierName(unwrapExpression(node));
  return identifier ? (aliases.get(identifier) ?? null) : null;
};

const comparisonBranchesOnField = (
  node: AstNode | undefined,
  inputParamName: string | null,
  fieldName: string,
  aliases: ReadonlyMap<string, string>
): AstNode | null => {
  const unwrapped = unwrapExpression(node);
  if (!unwrapped) {
    return null;
  }

  if (unwrapped.type === 'LogicalExpression') {
    const left = getNodeLeft(unwrapped);
    const right = getNodeRight(unwrapped);
    return (
      comparisonBranchesOnField(left, inputParamName, fieldName, aliases) ??
      comparisonBranchesOnField(right, inputParamName, fieldName, aliases)
    );
  }

  if (unwrapped.type === 'UnaryExpression') {
    const argument = getNodeArgument(unwrapped);
    return comparisonBranchesOnField(
      argument,
      inputParamName,
      fieldName,
      aliases
    );
  }

  if (unwrapped.type !== 'BinaryExpression') {
    return null;
  }

  const left = getNodeLeft(unwrapped);
  const operator = getNodeOperator(unwrapped);
  const right = getNodeRight(unwrapped);
  if (operator !== '===' && operator !== '!==') {
    return null;
  }

  return branchFieldName(left, inputParamName, aliases) === fieldName ||
    branchFieldName(right, inputParamName, aliases) === fieldName
    ? unwrapped
    : null;
};

const branchesOnField = (
  implementation: AstNode,
  inputParamName: string | null,
  fieldName: string,
  aliases: ReadonlyMap<string, string>
): AstNode | null => {
  let found: AstNode | null = null;
  walkScope(implementation, (node) => {
    if (found) {
      return;
    }

    if (node.type === 'SwitchStatement') {
      const discriminant = getNodeDiscriminant(node);
      if (
        branchFieldName(discriminant, inputParamName, aliases) === fieldName
      ) {
        found = node;
      }
      return;
    }

    if (node.type !== 'IfStatement' && node.type !== 'ConditionalExpression') {
      return;
    }
    const test = getNodeTest(node);
    found = comparisonBranchesOnField(test, inputParamName, fieldName, aliases);
  });
  return found;
};

const diagnosticForField = (
  sourceCode: string,
  filePath: string,
  trailId: string,
  field: ControlField,
  branchNode: AstNode
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, branchNode.start),
  message: `Trail "${trailId}" branches on input.${field.name} (${field.options
    .map((option) => `"${option}"`)
    .join(
      ', '
    )}). This may be a trail fork hidden as a surface accommodation. If branches change semantics (intent, permits, errors, outputs, lifecycle, or side effects) or structure (selected trail identity), split them into distinct trails, a composing trail, or a trailhead that preserves member identity.`,
  rule: RULE_NAME,
  severity: 'warn',
});

export const trailForkCoaching: WardenRule = {
  check(sourceCode, filePath) {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const schemaBindings = collectSchemaBindings(ast);
    const diagnostics: WardenDiagnostic[] = [];
    for (const definition of findTrailDefinitions(ast)) {
      if (definition.kind !== 'trail') {
        continue;
      }

      const fields = findControlFields(definition.config, schemaBindings);
      if (fields.length === 0) {
        continue;
      }
      const fieldNames = new Set(fields.map((field) => field.name));

      for (const implementation of findImplementationBodies(
        definition.config
      )) {
        const inputBindings = collectImplementationInputBindings(
          implementation,
          fieldNames
        );
        if (!inputBindings) {
          continue;
        }

        for (const field of fields) {
          const branchNode = branchesOnField(
            implementation,
            inputBindings.inputParamName,
            field.name,
            inputBindings.aliases
          );
          if (branchNode) {
            diagnostics.push(
              diagnosticForField(
                sourceCode,
                filePath,
                definition.id,
                field,
                branchNode
              )
            );
          }
        }
      }
    }

    return diagnostics;
  },
  description:
    'Coach trails away from hiding several capabilities behind one branching action or operation input.',
  name: RULE_NAME,
  severity: 'warn',
};
