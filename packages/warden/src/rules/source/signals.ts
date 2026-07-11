/** Warden-private signal declaration and on-target helpers. */

import type { AstNode } from '../../source/nodes.js';
import {
  deriveConstString,
  extractBindingName,
  extractPlainTemplateLiteral,
  extractStringLiteral,
  findConfigProperty,
  getStringValue,
  getPropertyName,
  identifierName,
  isStringLiteral,
} from '../../source/literals.js';
import {
  collectScopeFrameBindings,
  isScopeFrameNode,
} from '../../source/scopes.js';
import {
  buildFrameworkNamespaceContext,
  extractTrailDefinition,
  findTrailDefinitions,
} from '../../source/trails.js';
import type { FrameworkNamespaceContext } from '../../source/trails.js';
import { walk } from '../../source/walk.js';
import {
  collectNamedStoreTableIds,
  deriveStoreTableId,
  getMemberExpression,
} from './stores.js';

export const collectSignalDefinitionIds = (
  ast: AstNode
): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const def of findTrailDefinitions(ast)) {
    if (def.kind === 'signal') {
      ids.add(def.id);
    }
  }
  return ids;
};

const unwrapTopLevelDeclaration = (stmt: AstNode): AstNode => {
  if (
    stmt.type === 'ExportNamedDeclaration' ||
    stmt.type === 'ExportDefaultDeclaration'
  ) {
    return (stmt as unknown as { declaration?: AstNode }).declaration ?? stmt;
  }
  return stmt;
};

const collectSignalIdsFromDeclaration = (
  declaration: AstNode,
  context: FrameworkNamespaceContext,
  ids: Map<string, string>
): void => {
  const declarations =
    (
      unwrapTopLevelDeclaration(declaration) as unknown as {
        declarations?: readonly AstNode[];
      }
    ).declarations ?? [];

  for (const node of declarations) {
    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    if (!init) {
      continue;
    }

    const def = extractTrailDefinition(init, context);
    const name = extractBindingName(id);
    if (def?.kind === 'signal' && name && !ids.has(name)) {
      ids.set(name, def.id);
    }
  }
};

const collectStringIdsFromDeclaration = (
  declaration: AstNode,
  ids: Map<string, string>
): void => {
  const declarations =
    (
      unwrapTopLevelDeclaration(declaration) as unknown as {
        declarations?: readonly AstNode[];
      }
    ).declarations ?? [];

  for (const node of declarations) {
    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    if (!init) {
      continue;
    }

    const name = extractBindingName(id);
    const value =
      extractStringLiteral(init) ?? extractPlainTemplateLiteral(init);
    if (name && value !== null && !ids.has(name)) {
      ids.set(name, value);
    }
  }
};

export type SignalIdentifierResolution =
  | {
      readonly id: string;
      readonly kind: 'signal' | 'string';
    }
  | {
      readonly kind: 'shadowed' | 'unbound';
    };

export interface SignalIdentifierResolver {
  readonly resolve: (reference: AstNode) => SignalIdentifierResolution;
}

interface SignalScopeFrame {
  readonly bindings: ReadonlySet<string>;
  readonly end: number;
  readonly signals: ReadonlyMap<string, string>;
  readonly start: number;
  readonly strings: ReadonlyMap<string, string>;
}

const collectSignalFrameValues = (
  node: AstNode,
  context: FrameworkNamespaceContext
): {
  readonly signals: ReadonlyMap<string, string>;
  readonly strings: ReadonlyMap<string, string>;
} => {
  const signals = new Map<string, string>();
  const strings = new Map<string, string>();

  const collectDeclaration = (statement: AstNode): void => {
    const declaration = unwrapTopLevelDeclaration(statement);
    if (declaration.type !== 'VariableDeclaration') {
      return;
    }
    collectSignalIdsFromDeclaration(declaration, context, signals);
    collectStringIdsFromDeclaration(declaration, strings);
  };

  if (
    node.type === 'Program' ||
    node.type === 'BlockStatement' ||
    node.type === 'FunctionBody'
  ) {
    const body = (node as unknown as { body?: readonly AstNode[] }).body ?? [];
    for (const statement of body) {
      collectDeclaration(statement);
    }
  }

  if (node.type === 'ForStatement') {
    const { init } = node as unknown as { init?: AstNode };
    if (init) {
      collectDeclaration(init);
    }
  }

  if (node.type === 'SwitchStatement') {
    const cases =
      (node as unknown as { cases?: readonly AstNode[] }).cases ?? [];
    for (const item of cases) {
      const consequent =
        (item as unknown as { consequent?: readonly AstNode[] }).consequent ??
        [];
      for (const statement of consequent) {
        collectDeclaration(statement);
      }
    }
  }

  return { signals, strings };
};

const collectSignalScopeFrames = (
  ast: AstNode,
  context: FrameworkNamespaceContext
): readonly SignalScopeFrame[] => {
  const frames: SignalScopeFrame[] = [];

  walk(ast, (node) => {
    if (!isScopeFrameNode(node)) {
      return;
    }
    const values = collectSignalFrameValues(node, context);
    frames.push({
      bindings: collectScopeFrameBindings(node),
      end: node.end,
      signals: values.signals,
      start: node.start,
      strings: values.strings,
    });
  });

  return frames;
};

const isInsideFrame = (reference: AstNode, frame: SignalScopeFrame): boolean =>
  frame.start <= reference.start && reference.end <= frame.end;

const compareInnermostFrame = (
  a: SignalScopeFrame,
  b: SignalScopeFrame
): number => {
  const aSize = a.end - a.start;
  const bSize = b.end - b.start;
  return aSize - bSize || b.start - a.start;
};

export const buildSignalIdentifierResolver = (
  ast: AstNode
): SignalIdentifierResolver => {
  const context = buildFrameworkNamespaceContext(ast);
  const frames = collectSignalScopeFrames(ast, context);

  return {
    resolve(reference: AstNode): SignalIdentifierResolution {
      const name = identifierName(reference);
      if (!name) {
        return { kind: 'unbound' };
      }

      const containingFrames = frames
        .filter((frame) => isInsideFrame(reference, frame))
        .toSorted(compareInnermostFrame);

      for (const frame of containingFrames) {
        if (!frame.bindings.has(name)) {
          continue;
        }
        const signalId = frame.signals.get(name);
        if (signalId) {
          return { id: signalId, kind: 'signal' };
        }
        const stringId = frame.strings.get(name);
        if (stringId) {
          return { id: stringId, kind: 'string' };
        }
        return { kind: 'shadowed' };
      }

      return { kind: 'unbound' };
    },
  };
};

const STORE_SIGNAL_OPERATIONS = new Set(['created', 'removed', 'updated']);

const extractStoreSignalIdFromMember = (
  node: AstNode | undefined,
  namedStoreTableIds: ReadonlyMap<string, string>
): string | null => {
  const member = getMemberExpression(node);
  const operation = member ? getPropertyName(member.property) : null;
  if (!operation || !STORE_SIGNAL_OPERATIONS.has(operation)) {
    return null;
  }

  const signalsMember = member ? getMemberExpression(member.object) : null;
  if (!signalsMember || getPropertyName(signalsMember.property) !== 'signals') {
    return null;
  }

  const tableId = deriveStoreTableId(signalsMember.object, namedStoreTableIds);
  return tableId ? `${tableId}.${operation}` : null;
};

const collectNamedStoreSignalIds = (
  ast: AstNode,
  namedStoreTableIds: ReadonlyMap<string, string>
): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>();

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    const name = extractBindingName(id);
    const signalId = extractStoreSignalIdFromMember(init, namedStoreTableIds);
    if (name && signalId) {
      ids.set(name, signalId);
    }
  });

  return ids;
};

const getOnElements = (config: AstNode): readonly AstNode[] => {
  const onProp = findConfigProperty(config, 'on');
  if (!onProp) {
    return [];
  }

  const arrayNode = onProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

const resolveNamedOnSignalId = (
  element: AstNode,
  sourceCode: string,
  namedStoreSignalIds: ReadonlyMap<string, string>
): string | null => {
  if (element.type !== 'Identifier') {
    return null;
  }

  const name = identifierName(element);
  return name
    ? (namedStoreSignalIds.get(name) ?? deriveConstString(name, sourceCode))
    : null;
};

const resolveInlineOnSignalId = (element: AstNode): string | null => {
  const definition = extractTrailDefinition(element);
  return definition?.kind === 'signal' ? definition.id : null;
};

const resolveOnElementSignalId = (
  element: AstNode,
  sourceCode: string,
  namedStoreSignalIds: ReadonlyMap<string, string>,
  namedStoreTableIds: ReadonlyMap<string, string>
): string | null => {
  if (isStringLiteral(element)) {
    return getStringValue(element);
  }

  return (
    extractStoreSignalIdFromMember(element, namedStoreTableIds) ??
    resolveNamedOnSignalId(element, sourceCode, namedStoreSignalIds) ??
    resolveInlineOnSignalId(element)
  );
};

const addOnTargetSignalIds = (
  config: AstNode,
  ids: Set<string>,
  sourceCode: string,
  namedStoreSignalIds: ReadonlyMap<string, string>,
  namedStoreTableIds: ReadonlyMap<string, string>
): void => {
  for (const element of getOnElements(config)) {
    const signalId = resolveOnElementSignalId(
      element,
      sourceCode,
      namedStoreSignalIds,
      namedStoreTableIds
    );
    if (signalId) {
      ids.add(signalId);
    }
  }
};

export const collectOnTargetSignalIds = (
  ast: AstNode,
  sourceCode: string
): ReadonlySet<string> => {
  const ids = new Set<string>();
  const namedStoreTableIds = collectNamedStoreTableIds(ast);
  const namedStoreSignalIds = collectNamedStoreSignalIds(
    ast,
    namedStoreTableIds
  );

  for (const definition of findTrailDefinitions(ast)) {
    if (definition.kind === 'trail') {
      addOnTargetSignalIds(
        definition.config,
        ids,
        sourceCode,
        namedStoreSignalIds,
        namedStoreTableIds
      );
    }
  }

  return ids;
};
