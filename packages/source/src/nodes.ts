/** Shared curated AST node types, guards, and field accessors. */

export interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly parent?: AstNode | null;
  readonly key?: unknown;
  readonly value?: unknown;
  readonly body?: AstNode | readonly AstNode[];
  readonly [key: string]: unknown;
}

export interface ProgramNode extends AstNode {
  readonly type: 'Program';
  readonly body?: readonly AstNode[];
}

export interface IdentifierNode extends AstNode {
  readonly type: 'Identifier';
  readonly name?: string;
}

export interface StringLiteralNode extends AstNode {
  readonly type: 'Literal' | 'StringLiteral';
  readonly value?: unknown;
}

export interface CallExpressionNode extends AstNode {
  readonly type: 'CallExpression' | 'NewExpression';
  readonly arguments?: readonly AstNode[];
  readonly callee?: AstNode;
}

export interface MemberExpressionNode extends AstNode {
  readonly type: 'MemberExpression' | 'StaticMemberExpression';
  readonly computed?: boolean;
  readonly object?: AstNode;
  readonly property?: AstNode;
}

export interface ImportDeclarationNode extends AstNode {
  readonly importKind?: string;
  readonly type: 'ImportDeclaration';
  readonly source?: AstNode;
  readonly specifiers?: readonly AstNode[];
}

export interface ImportSpecifierNode extends AstNode {
  readonly importKind?: string;
  readonly type:
    | 'ImportDefaultSpecifier'
    | 'ImportNamespaceSpecifier'
    | 'ImportSpecifier';
  readonly imported?: AstNode;
  readonly local?: AstNode;
}

export interface ExportDeclarationNode extends AstNode {
  readonly type:
    | 'ExportAllDeclaration'
    | 'ExportDefaultDeclaration'
    | 'ExportNamedDeclaration';
  readonly declaration?: AstNode;
  readonly source?: AstNode;
  readonly specifiers?: readonly AstNode[];
}

export interface ExportSpecifierNode extends AstNode {
  readonly type: 'ExportSpecifier';
  readonly exportKind?: string;
  readonly exported?: AstNode;
  readonly local?: AstNode;
}

export interface VariableDeclarationNode extends AstNode {
  readonly type: 'VariableDeclaration';
  readonly declarations?: readonly AstNode[];
  readonly kind?: string;
}

export interface VariableDeclaratorNode extends AstNode {
  readonly type: 'VariableDeclarator';
  readonly id?: AstNode;
  readonly init?: AstNode;
}

export interface DeclarationWithIdNode extends AstNode {
  readonly type:
    | 'ClassDeclaration'
    | 'EnumDeclaration'
    | 'FunctionDeclaration'
    | 'InterfaceDeclaration'
    | 'TSInterfaceDeclaration'
    | 'TSEnumDeclaration'
    | 'TSTypeAliasDeclaration';
  readonly id?: AstNode;
}

export interface ClassMemberNode extends AstNode {
  readonly type: 'MethodDefinition' | 'PropertyDefinition';
  readonly computed?: boolean;
  readonly key?: AstNode;
  readonly value?: AstNode;
}

export interface ArrayExpressionNode extends AstNode {
  readonly type: 'ArrayExpression';
  readonly elements?: readonly (AstNode | null)[];
}

export interface ObjectExpressionNode extends AstNode {
  readonly type: 'ObjectExpression' | 'ObjectPattern';
  readonly properties?: readonly AstNode[];
}

export interface PropertyNode extends AstNode {
  readonly type: 'Property';
  readonly computed?: boolean;
  readonly key?: AstNode;
  readonly value?: AstNode;
}

export interface RestElementNode extends AstNode {
  readonly type: 'RestElement';
  readonly argument?: AstNode;
}

export interface AssignmentPatternNode extends AstNode {
  readonly type: 'AssignmentPattern';
  readonly left?: AstNode;
  readonly right?: AstNode;
}

export interface ExpressionStatementNode extends AstNode {
  readonly type: 'ExpressionStatement';
  readonly expression?: AstNode;
}

export interface UnaryExpressionNode extends AstNode {
  readonly type: 'AwaitExpression' | 'ChainExpression' | 'UnaryExpression';
  readonly argument?: AstNode;
}

export interface BinaryExpressionNode extends AstNode {
  readonly type:
    | 'AssignmentExpression'
    | 'BinaryExpression'
    | 'ConditionalExpression'
    | 'LogicalExpression';
  readonly alternate?: AstNode;
  readonly consequent?: AstNode;
  readonly left?: AstNode;
  readonly operator?: string;
  readonly right?: AstNode;
  readonly test?: AstNode;
}

export interface FunctionLikeNode extends AstNode {
  readonly type:
    | 'ArrowFunctionExpression'
    | 'FunctionDeclaration'
    | 'FunctionExpression';
  readonly body?: AstNode;
  readonly params?: readonly AstNode[];
}

export interface BlockStatementNode extends AstNode {
  readonly type: 'BlockStatement' | 'StaticBlock';
  readonly body?: readonly AstNode[];
}

export interface ReturnStatementNode extends AstNode {
  readonly type: 'ReturnStatement';
  readonly argument?: AstNode;
}

export type CuratedAstNode =
  | ArrayExpressionNode
  | AssignmentPatternNode
  | BinaryExpressionNode
  | BlockStatementNode
  | CallExpressionNode
  | ClassMemberNode
  | DeclarationWithIdNode
  | ExportDeclarationNode
  | ExportSpecifierNode
  | ExpressionStatementNode
  | FunctionLikeNode
  | IdentifierNode
  | ImportDeclarationNode
  | ImportSpecifierNode
  | MemberExpressionNode
  | ObjectExpressionNode
  | ProgramNode
  | PropertyNode
  | RestElementNode
  | ReturnStatementNode
  | StringLiteralNode
  | UnaryExpressionNode
  | VariableDeclarationNode
  | VariableDeclaratorNode;

export interface AstParentContext {
  readonly index: number | null;
  readonly key: string | number | symbol | null | undefined;
  readonly parent: AstNode | null;
}

export interface AstScopeDeclaration {
  readonly end: number;
  readonly node: AstNode;
  readonly start: number;
  readonly type: string;
}

export interface AstScopeContext extends AstParentContext {
  readonly currentScope: string;
  readonly getDeclaration: (name: string) => AstScopeDeclaration | null;
  readonly isDeclared: (name: string) => boolean;
  readonly isCurrentScopeUnder: (scope: string) => boolean;
}

export interface SourceEdit {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
}

export interface SourceLocation {
  readonly column: number;
  readonly line: number;
}

export interface AstParseDiagnosticLabel {
  readonly end: number;
  readonly message: string | null;
  readonly start: number;
}

export interface AstParseDiagnostic {
  readonly helpMessage: string | null;
  readonly labels: readonly AstParseDiagnosticLabel[];
  readonly message: string;
  readonly severity: string;
}

export interface AstParseResult {
  readonly ast: AstNode | null;
  readonly diagnostics: readonly AstParseDiagnostic[];
}

export interface AstFieldView {
  readonly alternate?: AstNode;
  readonly argument?: AstNode;
  readonly arguments?: readonly AstNode[];
  readonly body?: AstNode | readonly AstNode[];
  readonly callee?: AstNode;
  readonly cases?: readonly AstNode[];
  readonly computed?: boolean;
  readonly consequent?: AstNode;
  readonly declaration?: AstNode;
  readonly declarations?: readonly AstNode[];
  readonly discriminant?: AstNode;
  readonly elements?: readonly (AstNode | null)[];
  readonly exportKind?: string;
  readonly exported?: AstNode;
  readonly expression?: AstNode;
  readonly id?: AstNode;
  readonly imported?: AstNode;
  readonly importKind?: string;
  readonly init?: AstNode;
  readonly key?: AstNode;
  readonly kind?: string;
  readonly left?: AstNode;
  readonly local?: AstNode;
  readonly name?: string;
  readonly object?: AstNode;
  readonly operator?: string;
  readonly param?: AstNode;
  readonly params?: readonly AstNode[];
  readonly properties?: readonly AstNode[];
  readonly property?: AstNode;
  readonly returnType?: AstNode;
  readonly right?: AstNode;
  readonly source?: AstNode;
  readonly specifiers?: readonly AstNode[];
  readonly superClass?: AstNode;
  readonly test?: AstNode;
  readonly typeAnnotation?: AstNode;
  readonly value?: unknown;
}

export const isAstNode = (value: unknown): value is AstNode =>
  Boolean(value && typeof value === 'object' && (value as AstNode).type);

const isNodeType = <TNode extends CuratedAstNode>(
  node: AstNode | null | undefined,
  types: readonly string[]
): node is TNode =>
  node !== null && node !== undefined && types.includes(node.type);

export const isProgram = (
  node: AstNode | null | undefined
): node is ProgramNode => isNodeType<ProgramNode>(node, ['Program']);

export const isIdentifier = (
  node: AstNode | null | undefined
): node is IdentifierNode => isNodeType<IdentifierNode>(node, ['Identifier']);

export const isCallExpression = (
  node: AstNode | null | undefined
): node is CallExpressionNode =>
  isNodeType<CallExpressionNode>(node, ['CallExpression', 'NewExpression']);

export const isMemberExpression = (
  node: AstNode | null | undefined
): node is MemberExpressionNode =>
  isNodeType<MemberExpressionNode>(node, [
    'MemberExpression',
    'StaticMemberExpression',
  ]);

export const isImportDeclaration = (
  node: AstNode | null | undefined
): node is ImportDeclarationNode =>
  isNodeType<ImportDeclarationNode>(node, ['ImportDeclaration']);

export const isImportSpecifier = (
  node: AstNode | null | undefined
): node is ImportSpecifierNode =>
  isNodeType<ImportSpecifierNode>(node, [
    'ImportDefaultSpecifier',
    'ImportNamespaceSpecifier',
    'ImportSpecifier',
  ]);

export const isExportDeclaration = (
  node: AstNode | null | undefined
): node is ExportDeclarationNode =>
  isNodeType<ExportDeclarationNode>(node, [
    'ExportAllDeclaration',
    'ExportDefaultDeclaration',
    'ExportNamedDeclaration',
  ]);

export const isExportNamedDeclaration = (
  node: AstNode | null | undefined
): node is ExportDeclarationNode & {
  readonly type: 'ExportNamedDeclaration';
} =>
  isNodeType<
    ExportDeclarationNode & { readonly type: 'ExportNamedDeclaration' }
  >(node, ['ExportNamedDeclaration']);

export const isExportDefaultDeclaration = (
  node: AstNode | null | undefined
): node is ExportDeclarationNode & {
  readonly type: 'ExportDefaultDeclaration';
} =>
  isNodeType<
    ExportDeclarationNode & { readonly type: 'ExportDefaultDeclaration' }
  >(node, ['ExportDefaultDeclaration']);

export const isExportAllDeclaration = (
  node: AstNode | null | undefined
): node is ExportDeclarationNode & { readonly type: 'ExportAllDeclaration' } =>
  isNodeType<ExportDeclarationNode & { readonly type: 'ExportAllDeclaration' }>(
    node,
    ['ExportAllDeclaration']
  );

export const isExportSpecifier = (
  node: AstNode | null | undefined
): node is ExportSpecifierNode =>
  isNodeType<ExportSpecifierNode>(node, ['ExportSpecifier']);

export const isVariableDeclaration = (
  node: AstNode | null | undefined
): node is VariableDeclarationNode =>
  isNodeType<VariableDeclarationNode>(node, ['VariableDeclaration']);

export const isVariableDeclarator = (
  node: AstNode | null | undefined
): node is VariableDeclaratorNode =>
  isNodeType<VariableDeclaratorNode>(node, ['VariableDeclarator']);

export const isDeclarationWithId = (
  node: AstNode | null | undefined
): node is DeclarationWithIdNode =>
  isNodeType<DeclarationWithIdNode>(node, [
    'ClassDeclaration',
    'EnumDeclaration',
    'FunctionDeclaration',
    'InterfaceDeclaration',
    'TSInterfaceDeclaration',
    'TSEnumDeclaration',
    'TSTypeAliasDeclaration',
  ]);

export const isClassMember = (
  node: AstNode | null | undefined
): node is ClassMemberNode =>
  isNodeType<ClassMemberNode>(node, ['MethodDefinition', 'PropertyDefinition']);

export const isArrayExpression = (
  node: AstNode | null | undefined
): node is ArrayExpressionNode =>
  isNodeType<ArrayExpressionNode>(node, ['ArrayExpression']);

export const isObjectExpression = (
  node: AstNode | null | undefined
): node is ObjectExpressionNode =>
  isNodeType<ObjectExpressionNode>(node, ['ObjectExpression', 'ObjectPattern']);

export const isProperty = (
  node: AstNode | null | undefined
): node is PropertyNode => isNodeType<PropertyNode>(node, ['Property']);

export const isRestElement = (
  node: AstNode | null | undefined
): node is RestElementNode =>
  isNodeType<RestElementNode>(node, ['RestElement']);

export const isAssignmentPattern = (
  node: AstNode | null | undefined
): node is AssignmentPatternNode =>
  isNodeType<AssignmentPatternNode>(node, ['AssignmentPattern']);

export const isExpressionStatement = (
  node: AstNode | null | undefined
): node is ExpressionStatementNode =>
  isNodeType<ExpressionStatementNode>(node, ['ExpressionStatement']);

export const isUnaryExpression = (
  node: AstNode | null | undefined
): node is UnaryExpressionNode =>
  isNodeType<UnaryExpressionNode>(node, [
    'AwaitExpression',
    'ChainExpression',
    'UnaryExpression',
  ]);

export const isBinaryExpression = (
  node: AstNode | null | undefined
): node is BinaryExpressionNode =>
  isNodeType<BinaryExpressionNode>(node, [
    'AssignmentExpression',
    'BinaryExpression',
    'ConditionalExpression',
    'LogicalExpression',
  ]);

export const isFunctionLike = (
  node: AstNode | null | undefined
): node is FunctionLikeNode =>
  isNodeType<FunctionLikeNode>(node, [
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'FunctionExpression',
  ]);

export const isBlockStatement = (
  node: AstNode | null | undefined
): node is BlockStatementNode =>
  isNodeType<BlockStatementNode>(node, ['BlockStatement', 'StaticBlock']);

export const isReturnStatement = (
  node: AstNode | null | undefined
): node is ReturnStatementNode =>
  isNodeType<ReturnStatementNode>(node, ['ReturnStatement']);

const deriveAstFieldView = (
  node: AstNode | null | undefined
): AstFieldView | null => (node ? (node as AstFieldView) : null);

export const getNodeAlternate = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.alternate;

export const getNodeArgument = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.argument;

export const getNodeArguments = (
  node: AstNode | null | undefined
): readonly AstNode[] => (isCallExpression(node) ? (node.arguments ?? []) : []);

export const getNodeBody = (
  node: AstNode | null | undefined
): AstNode | readonly AstNode[] | undefined => deriveAstFieldView(node)?.body;

export const getNodeBodyNode = (
  node: AstNode | null | undefined
): AstNode | undefined => {
  const body = getNodeBody(node);
  return isAstNode(body) ? body : undefined;
};

export const getNodeBodyStatements = (
  node: AstNode | null | undefined
): readonly AstNode[] => {
  const body = getNodeBody(node);
  return Array.isArray(body) ? body : [];
};

export const getNodeCallee = (
  node: AstNode | null | undefined
): AstNode | undefined => (isCallExpression(node) ? node.callee : undefined);

export const getNodeCases = (
  node: AstNode | null | undefined
): readonly AstNode[] => deriveAstFieldView(node)?.cases ?? [];

export const getNodeComputed = (
  node: AstNode | null | undefined
): boolean | undefined => deriveAstFieldView(node)?.computed;

export const getNodeConsequent = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.consequent;

export const getNodeDeclaration = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.declaration;

export const getNodeDeclarations = (
  node: AstNode | null | undefined
): readonly AstNode[] =>
  isVariableDeclaration(node) ? (node.declarations ?? []) : [];

export const getNodeDiscriminant = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.discriminant;

export const getNodeElements = (
  node: AstNode | null | undefined
): readonly (AstNode | null)[] => deriveAstFieldView(node)?.elements ?? [];

export const getNodeExported = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.exported;

export const getNodeExportKind = (
  node: AstNode | null | undefined
): string | undefined => deriveAstFieldView(node)?.exportKind;

export const getNodeExpression = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.expression;

export const getNodeId = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.id;

export const getNodeImported = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.imported;

export const getNodeImportKind = (
  node: AstNode | null | undefined
): string | undefined => deriveAstFieldView(node)?.importKind;

export const getNodeInit = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.init;

export const getNodeKey = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.key;

export const getNodeKind = (
  node: AstNode | null | undefined
): string | undefined => deriveAstFieldView(node)?.kind;

export const getNodeLeft = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.left;

export const getNodeLocal = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.local;

export const getNodeName = (
  node: AstNode | null | undefined
): string | undefined => deriveAstFieldView(node)?.name;

export const getNodeObject = (
  node: AstNode | null | undefined
): AstNode | undefined => (isMemberExpression(node) ? node.object : undefined);

export const getNodeOperator = (
  node: AstNode | null | undefined
): string | undefined => deriveAstFieldView(node)?.operator;

export const getNodeParam = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.param;

export const getNodeParams = (
  node: AstNode | null | undefined
): readonly AstNode[] => (isFunctionLike(node) ? (node.params ?? []) : []);

export const getNodeProperties = (
  node: AstNode | null | undefined
): readonly AstNode[] =>
  isObjectExpression(node) ? (node.properties ?? []) : [];

export const getNodeProperty = (
  node: AstNode | null | undefined
): AstNode | undefined =>
  isMemberExpression(node) ? node.property : undefined;

export const getNodeReturnType = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.returnType;

export const getNodeRight = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.right;

export const getNodeSource = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.source;

export const getNodeSpecifiers = (
  node: AstNode | null | undefined
): readonly AstNode[] => deriveAstFieldView(node)?.specifiers ?? [];

export const getNodeSuperClass = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.superClass;

export const getNodeTest = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.test;

export const getNodeTypeAnnotation = (
  node: AstNode | null | undefined
): AstNode | undefined => deriveAstFieldView(node)?.typeAnnotation;

export const getNodeValue = (node: AstNode | null | undefined): unknown =>
  deriveAstFieldView(node)?.value;

export const getNodeValueNode = (
  node: AstNode | null | undefined
): AstNode | undefined => {
  const value = getNodeValue(node);
  return isAstNode(value) ? value : undefined;
};
