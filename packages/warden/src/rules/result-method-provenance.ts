/** Explicit resource/client witnesses, shared by the two Result rules. */
import {
  collectPatternBindingNames,
  getNodeArgument,
  getNodeArguments,
  getNodeBodyNode,
  getNodeBodyStatements,
  getNodeCallee,
  getNodeComputed,
  getNodeDeclarations,
  getNodeId,
  getNodeImported,
  getNodeInit,
  getNodeKey,
  getNodeKind,
  getNodeLeft,
  getNodeLocal,
  getNodeObject,
  getNodeOptional,
  getNodeParams,
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
  isFunctionLike,
  isMemberAccessNonComputed,
  staticPropertyKeyName,
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

type ScopeFrame = ReadonlySet<string>;
interface MethodSite {
  node: AstNode;
  scopes: readonly ScopeFrame[];
}
interface FunctionSites {
  frame: ScopeFrame;
  sites: MethodSite[];
}

const bindingFrame = (
  scopes: readonly ScopeFrame[],
  name: string
): ScopeFrame | undefined => scopes.find((frame) => frame.has(name));

// A lexical witness must hold across branches, loops, and captured writes;
// source order cannot prove when an assignment runs.
const collectMethodSites = (ast: AstNode) => {
  const functions = new WeakMap<AstNode, FunctionSites>();
  const owners = new Map<ScopeFrame, FunctionSites>();
  const writes = new Map<ScopeFrame, Set<string>>();
  let moduleFrame: ScopeFrame | undefined;

  walkWithScopes(ast, (node, scopes) => {
    const [frame] = scopes;
    if (node === ast) {
      moduleFrame = frame;
    }
    if (frame && isFunctionLike(node)) {
      const owner = { frame, sites: [] };
      functions.set(node, owner);
      owners.set(frame, owner);
    }
    const target = writtenTarget(node);
    if (target) {
      for (const name of collectPatternBindingNames(target)) {
        const scope = bindingFrame(scopes, name);
        if (scope) {
          const names = writes.get(scope) ?? new Set<string>();
          names.add(name);
          writes.set(scope, names);
        }
      }
    }
    const declarations =
      node.type === 'VariableDeclaration' && getNodeKind(node) !== 'var'
        ? getNodeDeclarations(node)
        : [];
    if (node.type !== 'CallExpression' && declarations.length === 0) {
      return;
    }
    const ownerFrame = scopes.find((scope) => owners.has(scope));
    const owner = ownerFrame ? owners.get(ownerFrame) : undefined;
    if (owner) {
      const snapshot = [...scopes];
      for (const site of node.type === 'CallExpression'
        ? [node]
        : declarations) {
        owner.sites.push({ node: site, scopes: snapshot });
      }
    }
  });

  return { functions, moduleFrame, writes };
};

/** Build per-function witnesses. File loads are bounded to direct resource and class imports. */
export const createResultMethodProvenance = (ast: AstNode, path: string) => {
  const entry = { ast, path };
  const binding = createDirectBindingResolver('const-only');
  let indexed: ReturnType<typeof collectMethodSites> | undefined;
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
    if (args.length < 1 || args.length > 2) {
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
      const key = getNodeKey(method);
      const methodName = key ? staticPropertyKeyName(key) : null;
      if (!methodName) {
        continue;
      }
      if (seen.has(methodName)) {
        methods.delete(methodName);
        continue;
      }
      seen.add(methodName);
      const value = getNodeValueNode(method);
      const kind = value
        ? returnKind(client.module, value, classTypeParameters)
        : null;
      if (kind) {
        methods.set(methodName, kind);
      }
    }
    return methods;
  };
  return (owner: AstNode): ResultMethodExpressions => {
    const expressions = new Map<AstNode, ResultKind>();
    const [, parameter] = getNodeParams(owner);
    const contextName = identifierName(
      parameter?.type === 'AssignmentPattern'
        ? getNodeLeft(parameter)
        : parameter
    );
    if (!contextName) {
      return expressions;
    }
    const { functions, moduleFrame, writes } = (indexed ??=
      collectMethodSites(ast));
    const facts = functions.get(owner);
    if (!facts || writes.get(facts.frame)?.has(contextName)) {
      return expressions;
    }
    const receivers = new Map<ScopeFrame, Map<string, Methods>>();
    const lookup = (
      name: string,
      scopes: readonly ScopeFrame[]
    ): Methods | undefined => {
      const scope = bindingFrame(scopes, name);
      return scope ? receivers.get(scope)?.get(name) : undefined;
    };
    const trackReceiver = (
      node: AstNode,
      scopes: readonly ScopeFrame[]
    ): void => {
      const name = identifierName(getNodeId(node));
      const scope = name ? bindingFrame(scopes, name) : undefined;
      if (!name || !scope || writes.get(scope)?.has(name)) {
        return;
      }
      const init = getNodeInit(node);
      const access = member(getNodeCallee(init));
      let methods: Methods | undefined;
      if (
        access?.name === 'from' &&
        getNodeArguments(init).length === 1 &&
        identifierName(getNodeArguments(init)[0]) === contextName &&
        bindingFrame(scopes, contextName) === facts.frame &&
        !scopes.some(
          (frame) => frame !== moduleFrame && frame.has(access.object)
        )
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
    for (const { node, scopes } of facts.sites) {
      if (node.type === 'VariableDeclarator') {
        trackReceiver(node, scopes);
      } else if (!getNodeOptional(node)) {
        const access = member(getNodeCallee(node));
        const kind = access
          ? lookup(access.object, scopes)?.get(access.name)
          : undefined;
        if (kind) {
          expressions.set(node, kind);
        }
      }
    }
    return expressions;
  };
};

/** A Promise-producing method is a Result witness only after explicit await. */
export const isResultMethodExpression = (
  node: AstNode,
  expressions: ResultMethodExpressions,
  awaited: boolean
): boolean => {
  const kind = expressions.get(node);
  return kind === 'sync' || (kind === 'async' && awaited);
};
