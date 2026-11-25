/** Explicit resource/client witnesses, shared by the two Result rules. */
import {
  collectPatternBindingNames,
  collectScopeFrameBindings,
  getNodeArgument,
  getNodeArguments,
  getNodeParams,
  getNodeBodyNode,
  getNodeBodyStatements,
  getNodeCallee,
  getNodeComputed,
  getNodeExpression,
  getNodeId,
  getNodeImported,
  getNodeInit,
  getNodeKey,
  getNodeKind,
  getNodeLeft,
  getNodeLocal,
  getNodeObject,
  getNodeOptional,
  getNodeProperty,
  getNodeReturnType,
  getNodeRight,
  getNodeSource,
  getNodeSpecifiers,
  getNodeStatic,
  getNodeTypeAnnotation,
  getNodeTypeArguments,
  getNodeTypeName,
  getNodeTypeParameterNames,
  getNodeValue,
  getNodeValueNode,
  identifierName,
  isMemberAccessNonComputed,
  walkWithScopes,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import {
  collectModuleDeclarations,
  createDirectBindingResolver,
  imports,
} from './result-provenance-imports.js';
import type { ModuleSource } from './result-provenance-imports.js';

type ResultKind = 'sync' | 'async';
export type ResultMethodExpressions = ReadonlyMap<AstNode, ResultKind>;
type Methods = ReadonlyMap<string, ResultKind>;

const sourceOf = (node: AstNode): unknown => getNodeValue(getNodeSource(node));
const isCoreName = (
  module: ModuleSource,
  name: string,
  exported: string
): boolean =>
  imports(module).some(
    (declaration) =>
      sourceOf(declaration) === '@ontrails/core' &&
      getNodeSpecifiers(declaration).some(
        (specifier) =>
          specifier.type === 'ImportSpecifier' &&
          identifierName(getNodeLocal(specifier)) === name &&
          identifierName(getNodeImported(specifier)) === exported
      )
  );

const isCoreNamespace = (module: ModuleSource, name: string | null): boolean =>
  imports(module).some(
    (declaration) =>
      sourceOf(declaration) === '@ontrails/core' &&
      getNodeSpecifiers(declaration).some(
        (specifier) =>
          specifier.type === 'ImportNamespaceSpecifier' &&
          identifierName(getNodeLocal(specifier)) === name
      )
  );

const isCoreReference = (
  module: ModuleSource,
  node: AstNode | undefined,
  exported: string
): boolean => {
  const name = identifierName(node);
  if (name) {
    return isCoreName(module, name, exported);
  }
  if (node?.type === 'TSQualifiedName') {
    return (
      identifierName(getNodeRight(node)) === exported &&
      isCoreNamespace(module, identifierName(getNodeLeft(node)))
    );
  }
  return Boolean(
    node &&
    isMemberAccessNonComputed(node) &&
    identifierName(getNodeProperty(node)) === exported &&
    isCoreNamespace(module, identifierName(getNodeObject(node)))
  );
};

/** Require an exact authored Result or Promise<Result> signature, not a type-name substring. */
const returnKind = (
  module: ModuleSource,
  method: AstNode,
  classTypeParameters: readonly string[]
): ResultKind | null => {
  const shadowed = new Set([
    ...classTypeParameters,
    ...getNodeTypeParameterNames(method),
  ]);
  const isResultType = (type: AstNode | undefined): boolean => {
    const name = getNodeTypeName(type);
    const local = identifierName(name);
    return (
      (local === null || !shadowed.has(local)) &&
      isCoreReference(module, name, 'Result')
    );
  };
  const annotation = getNodeTypeAnnotation(getNodeReturnType(method));
  if (isResultType(annotation)) {
    return 'sync';
  }
  if (
    identifierName(getNodeTypeName(annotation)) !== 'Promise' ||
    shadowed.has('Promise') ||
    collectModuleDeclarations(module.ast).has('Promise') ||
    imports(module).some((declaration) =>
      getNodeSpecifiers(declaration).some(
        (specifier) => identifierName(getNodeLocal(specifier)) === 'Promise'
      )
    )
  ) {
    return null;
  }
  const args = getNodeTypeArguments(annotation);
  return args.length === 1 && isResultType(args[0]) ? 'async' : null;
};

const writtenTarget = (node: AstNode): AstNode | undefined => {
  switch (node.type) {
    case 'AssignmentExpression':
    case 'ForInStatement':
    case 'ForOfStatement': {
      return getNodeLeft(node);
    }
    case 'UpdateExpression': {
      return getNodeArgument(node);
    }
    default: {
      return undefined;
    }
  }
};

const member = (
  node: AstNode | undefined
): { object: string; name: string } | null => {
  if (!node || getNodeOptional(node) || !isMemberAccessNonComputed(node)) {
    return null;
  }
  const object = identifierName(getNodeObject(node));
  const name = identifierName(getNodeProperty(node));
  return object && name ? { name, object } : null;
};

/** Build per-function witnesses. File loads are bounded to direct resource and class imports. */
export const createResultMethodProvenance = (ast: AstNode, path: string) => {
  const entry = { ast, path };
  const binding = createDirectBindingResolver('const-only');
  const resourceMethods = (name: string): Methods | null => {
    const resource = binding(entry, name);
    if (
      !resource ||
      !isCoreReference(
        resource.module,
        getNodeCallee(resource.node),
        'resource'
      )
    ) {
      return null;
    }
    const args = getNodeTypeArguments(resource.node);
    if (args.length !== 1) {
      return null;
    }
    const typeName = identifierName(getNodeTypeName(args[0]));
    const client = typeName ? binding(resource.module, typeName) : null;
    if (client?.node.type !== 'ClassDeclaration') {
      return null;
    }
    const methods = new Map<string, ResultKind>();
    const seen = new Set<string>();
    const classTypeParameters = getNodeTypeParameterNames(client.node);
    for (const method of getNodeBodyStatements(getNodeBodyNode(client.node))) {
      if (
        method.type !== 'MethodDefinition' ||
        getNodeComputed(method) ||
        getNodeOptional(method) ||
        getNodeStatic(method) ||
        getNodeKind(method) !== 'method'
      ) {
        continue;
      }
      const methodName = identifierName(getNodeKey(method));
      if (methodName && seen.has(methodName)) {
        methods.delete(methodName);
        continue;
      }
      if (methodName) {
        seen.add(methodName);
      }
      const value = getNodeValueNode(method);
      const kind = value
        ? returnKind(client.module, value, classTypeParameters)
        : null;
      if (methodName && kind) {
        methods.set(methodName, kind);
      }
    }
    return methods;
  };
  return (owner: AstNode): ResultMethodExpressions => {
    const expressions = new Map<AstNode, ResultKind>();
    const contextScope = collectScopeFrameBindings(owner);
    const [, parameter] = getNodeParams(owner);
    const contextName = identifierName(
      parameter?.type === 'AssignmentPattern'
        ? getNodeLeft(parameter)
        : parameter
    );
    let contextValid = true;
    const receivers = new Map<ReadonlySet<string>, Map<string, Methods>>();
    const body = getNodeBodyNode(owner);
    if (!body) {
      return expressions;
    }
    const lookup = (
      name: string,
      scopes: readonly ReadonlySet<string>[]
    ): Methods | undefined => {
      const scope = scopes.find((frame) => frame.has(name));
      return scope ? receivers.get(scope)?.get(name) : undefined;
    };
    const trackReceiver = (
      node: AstNode,
      scopes: readonly ReadonlySet<string>[]
    ): void => {
      const name = identifierName(getNodeId(node));
      const scope = name ? scopes.find((frame) => frame.has(name)) : undefined;
      if (!name || !scope) {
        return;
      }
      const init = getNodeInit(node);
      const access = member(getNodeCallee(init));
      let methods: Methods | undefined;
      if (
        access?.name === 'from' &&
        contextValid &&
        contextName !== null &&
        getNodeArguments(init).length === 1 &&
        identifierName(getNodeArguments(init)[0]) === contextName &&
        scopes.find((frame) => frame.has(contextName)) === contextScope &&
        !scopes.some((frame) => frame.has(access.object))
      ) {
        methods = resourceMethods(access.object) ?? undefined;
      } else {
        const alias = identifierName(init);
        methods = alias ? lookup(alias, scopes) : undefined;
      }
      if (methods) {
        let frame = receivers.get(scope);
        if (!frame) {
          frame = new Map();
          receivers.set(scope, frame);
        }
        frame.set(name, methods);
      }
    };
    walkWithScopes(
      body,
      (node, scopes) => {
        if (node.type === 'VariableDeclarator') {
          trackReceiver(node, scopes);
        }
        const target = writtenTarget(node);
        if (target) {
          for (const name of collectPatternBindingNames(target)) {
            const scope = scopes.find((frame) => frame.has(name));
            if (name === contextName && scope === contextScope) {
              contextValid = false;
            }
            if (scope) {
              receivers.get(scope)?.delete(name);
            }
          }
        }
        if (node.type === 'CallExpression' && !getNodeOptional(node)) {
          const access = member(getNodeCallee(node));
          const kind = access
            ? lookup(access.object, scopes)?.get(access.name)
            : undefined;
          if (kind) {
            expressions.set(node, kind);
          }
        }
      },
      {
        initialScopes: [contextScope],
        stopAtNestedFunctions: true,
      }
    );
    return expressions;
  };
};

/** A Promise-producing method is a Result witness only after explicit await. */
export const isResultMethodExpression = (
  node: AstNode,
  expressions: ResultMethodExpressions
): boolean => {
  let current = node;
  let awaited = false;
  while (
    current.type === 'AwaitExpression' ||
    current.type === 'ParenthesizedExpression'
  ) {
    if (current.type === 'AwaitExpression') {
      awaited = true;
    }
    const inner =
      current.type === 'AwaitExpression'
        ? getNodeArgument(current)
        : getNodeExpression(current);
    if (!inner) {
      return false;
    }
    current = inner;
  }
  const kind = expressions.get(current);
  return kind === 'sync' || (kind === 'async' && awaited);
};
