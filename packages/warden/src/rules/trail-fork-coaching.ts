import {
  extractStringOrTemplateLiteral,
  findBlazeBodies,
  findConfigProperty,
  findTrailDefinitions,
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

interface BlazeInputBindings {
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
    current =
      (current as unknown as { expression?: AstNode }).expression ??
      (current as unknown as { argument?: AstNode }).argument;
  }
  return current;
};

const callArguments = (node: AstNode): readonly AstNode[] =>
  (node as unknown as { arguments?: readonly AstNode[] }).arguments ?? [];

const callName = (node: AstNode | undefined): string | null => {
  const unwrapped = unwrapExpression(node);
  if (unwrapped?.type !== 'CallExpression') {
    return null;
  }
  const { callee } = unwrapped as unknown as { callee?: AstNode };
  if (callee?.type !== 'MemberExpression') {
    return identifierName(callee);
  }
  return getPropertyName(
    (callee as unknown as { property?: AstNode }).property
  );
};

const callObject = (node: AstNode): AstNode | undefined => {
  const { callee } = node as unknown as { callee?: AstNode };
  if (callee?.type !== 'MemberExpression') {
    return undefined;
  }
  return (callee as unknown as { object?: AstNode }).object;
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
    ? ((node as unknown as { properties?: readonly AstNode[] }).properties ??
      [])
    : [];

const propertyValue = (property: AstNode): AstNode | undefined =>
  property.type === 'Property'
    ? (property as unknown as { value?: AstNode }).value
    : undefined;

const arrayElements = (node: AstNode | undefined): readonly AstNode[] => {
  const unwrapped = unwrapExpression(node);
  if (unwrapped?.type !== 'ArrayExpression') {
    return [];
  }
  return (
    (unwrapped as unknown as { elements?: readonly (AstNode | null)[] })
      .elements ?? []
  ).filter((element): element is AstNode => element !== null);
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
  const { id } = node as unknown as { id?: AstNode };
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
        initializer: (node as unknown as { init?: AstNode }).init ?? undefined,
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
    const name = getPropertyName(
      (property as unknown as { key?: AstNode }).key
    );
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

const blazeParams = (blaze: AstNode): readonly AstNode[] =>
  (blaze as unknown as { params?: readonly AstNode[] }).params ?? [];

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
  const { object } = unwrapped as unknown as { object?: AstNode };
  if (identifierName(object) !== inputParamName) {
    return null;
  }
  return getPropertyName(
    (unwrapped as unknown as { property?: AstNode }).property
  );
};

const patternAliasName = (node: AstNode | undefined): string | null => {
  const unwrapped = unwrapExpression(node);
  if (unwrapped?.type === 'AssignmentPattern') {
    return identifierName((unwrapped as unknown as { left?: AstNode }).left);
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
    const fieldName = getPropertyName(
      (property as unknown as { key?: AstNode }).key
    );
    if (!fieldName || !fields.has(fieldName)) {
      continue;
    }
    const alias = patternAliasName(propertyValue(property)) ?? fieldName;
    aliases.set(alias, fieldName);
  }
  return aliases;
};

const collectDestructuredFieldAliases = (
  blaze: AstNode,
  inputParamName: string,
  fields: ReadonlySet<string>
): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();

  walkScope(blaze, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }
    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
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

const collectBlazeInputBindings = (
  blaze: AstNode,
  fields: ReadonlySet<string>
): BlazeInputBindings | null => {
  const [inputParam] = blazeParams(blaze);
  const inputParamName = identifierName(inputParam);
  if (inputParamName) {
    return {
      aliases: collectDestructuredFieldAliases(blaze, inputParamName, fields),
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
    const { left, right } = unwrapped as unknown as {
      readonly left?: AstNode;
      readonly right?: AstNode;
    };
    return (
      comparisonBranchesOnField(left, inputParamName, fieldName, aliases) ??
      comparisonBranchesOnField(right, inputParamName, fieldName, aliases)
    );
  }

  if (unwrapped.type === 'UnaryExpression') {
    const { argument } = unwrapped as unknown as {
      readonly argument?: AstNode;
    };
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

  const { left, operator, right } = unwrapped as unknown as {
    readonly left?: AstNode;
    readonly operator?: string;
    readonly right?: AstNode;
  };
  if (operator !== '===' && operator !== '!==') {
    return null;
  }

  return branchFieldName(left, inputParamName, aliases) === fieldName ||
    branchFieldName(right, inputParamName, aliases) === fieldName
    ? unwrapped
    : null;
};

const branchesOnField = (
  blaze: AstNode,
  inputParamName: string | null,
  fieldName: string,
  aliases: ReadonlyMap<string, string>
): AstNode | null => {
  let found: AstNode | null = null;
  walkScope(blaze, (node) => {
    if (found) {
      return;
    }

    if (node.type === 'SwitchStatement') {
      const { discriminant } = node as unknown as { discriminant?: AstNode };
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
    const { test } = node as unknown as { readonly test?: AstNode };
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
    )}). This may be a trail fork hidden as a surface accommodation. If branches change intent, permits, errors, outputs, lifecycle, side effects, or selected trail identity, split them into distinct trails, a composing trail, or an honest facet.`,
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

      for (const blaze of findBlazeBodies(definition.config)) {
        const inputBindings = collectBlazeInputBindings(blaze, fieldNames);
        if (!inputBindings) {
          continue;
        }

        for (const field of fields) {
          const branchNode = branchesOnField(
            blaze,
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
