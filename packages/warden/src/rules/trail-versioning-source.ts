import {
  findBlazeBodies,
  findConfigProperty,
  findTrailDefinitions,
  isMemberAccessNonComputed,
  offsetToLine,
  parse,
  walk,
  walkScope,
} from './ast.js';
import type { AstNode } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const VERSION_PINNED_COMPOSE = 'version-pinned-compose';
const FORK_WITHOUT_PRESERVED_BLAZE = 'fork-without-preserved-blaze';
const MARKER_SCHEMA_UNSUPPORTED = 'marker-schema-unsupported';

const unsupportedSchemaCalls = new Set([
  'any',
  'custom',
  'preprocess',
  'transform',
  'unknown',
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
    return (node as unknown as { name?: string }).name ?? null;
  }
  if (
    node?.type === 'Literal' ||
    node?.type === 'StringLiteral' ||
    node?.type === 'NumericLiteral'
  ) {
    const { value } = node as unknown as { value?: unknown };
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : null;
  }
  return null;
};

const objectProperties = (node: AstNode | undefined): readonly AstNode[] =>
  node?.type === 'ObjectExpression'
    ? ((node as unknown as { properties?: readonly AstNode[] }).properties ??
      [])
    : [];

const propertyName = (node: AstNode): string | null =>
  node.type === 'Property'
    ? staticPropertyKeyName((node as unknown as { key?: AstNode }).key)
    : null;

const hasProperty = (node: AstNode, name: string): boolean =>
  objectProperties(node).some((property) => propertyName(property) === name);

const propertyValue = (property: AstNode | null): AstNode | undefined =>
  property?.type === 'Property'
    ? ((property as unknown as { value?: AstNode }).value ?? undefined)
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

const isMemberCallNamed = (
  node: AstNode,
  names: ReadonlySet<string>
): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const { callee } = node as unknown as { callee?: AstNode };
  if (!callee) {
    return false;
  }
  if (callee.type === 'Identifier') {
    const { name } = callee as unknown as { name?: string };
    return name !== undefined && names.has(name);
  }
  if (!isMemberAccessNonComputed(callee)) {
    return false;
  }
  const { property } = callee as unknown as { property?: AstNode };
  return (
    property?.type === 'Identifier' &&
    names.has((property as unknown as { name?: string }).name ?? '')
  );
};

const hasVersionOption = (node: AstNode | undefined): boolean =>
  node?.type === 'ObjectExpression' && hasProperty(node, 'version');

const composeCallHasVersionPin = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const { arguments: args, callee } = node as unknown as {
    arguments?: readonly AstNode[];
    callee?: AstNode;
  };
  if (!callee || !args) {
    return false;
  }

  const isComposeIdentifier =
    callee.type === 'Identifier' &&
    (callee as unknown as { name?: string }).name === 'compose';
  const { property } = callee as unknown as { property?: AstNode };
  const isComposeMember =
    isMemberAccessNonComputed(callee) &&
    property?.type === 'Identifier' &&
    (property as unknown as { name?: string }).name === 'compose';

  return (isComposeIdentifier || isComposeMember) && hasVersionOption(args[2]);
};

export const versionPinnedCompose: WardenRule = {
  check(sourceCode, filePath) {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    for (const blaze of findBlazeBodies(ast)) {
      walk(blaze, (node) => {
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

export const forkWithoutPreservedBlaze: WardenRule = {
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
        if (hasProperty(entry, 'transpose') || hasProperty(entry, 'blaze')) {
          continue;
        }
        diagnostics.push(
          diagnostic(
            FORK_WITHOUT_PRESERVED_BLAZE,
            'error',
            filePath,
            sourceCode,
            entry,
            `Trail "${definition.id}" has a historical version entry without transpose or blaze. Add transpose for a revision entry, or preserve the historical blaze for a fork entry.`
          )
        );
      }
    }
    return diagnostics;
  },
  description:
    'Require historical fork version entries to preserve a blaze, while revision entries declare transpose.',
  name: FORK_WITHOUT_PRESERVED_BLAZE,
  severity: 'error',
};

const schemaNodesForTrail = (config: AstNode): readonly AstNode[] => {
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

export const markerSchemaUnsupported: WardenRule = {
  check(sourceCode, filePath) {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    for (const definition of findTrailDefinitions(ast)) {
      if (definition.kind !== 'trail' || !trailIsVersioned(definition.config)) {
        continue;
      }
      for (const schema of schemaNodesForTrail(definition.config)) {
        walkScope(schema, (node) => {
          if (!isMemberCallNamed(node, unsupportedSchemaCalls)) {
            return;
          }
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
