import { describe, expect, test } from 'bun:test';

import * as ast from '@ontrails/warden/ast';
import type {
  ArrayExpressionNode,
  AssignmentPatternNode,
  AstFieldProjection,
  AstNode,
  AstParentContext,
  AstParseDiagnostic,
  AstParseDiagnosticLabel,
  AstParseResult,
  AstScopeContext,
  AstScopeDeclaration,
  BinaryExpressionNode,
  BlockStatementNode,
  CallExpressionNode,
  ClassMemberNode,
  CuratedAstNode,
  DeclarationWithIdNode,
  EntityDefinition,
  ExportDeclarationNode,
  ExportSpecifierNode,
  ExpressionStatementNode,
  FindEntityDefinitionsOptions,
  FrameworkNamespaceContext,
  FunctionLikeNode,
  IdentifierNode,
  ImportDeclarationNode,
  ImportSpecifierNode,
  MemberExpressionNode,
  ObjectExpressionNode,
  ProgramNode,
  PropertyNode,
  RestElementNode,
  ReturnStatementNode,
  SourceEdit,
  SourceLocation,
  StringLiteralMatch,
  StringLiteralNode,
  TrailDefinition,
  UnaryExpressionNode,
  VariableDeclarationNode,
  VariableDeclaratorNode,
} from '@ontrails/warden/ast';

const expectedRuntimeExportKeys = [
  'applySourceEdits',
  'createSourceEdit',
  'findEntityDefinitions',
  'findImplementationBodies',
  'findStringLiterals',
  'findTrailDefinitions',
  'getNodeAlternate',
  'getNodeArgument',
  'getNodeArguments',
  'getNodeBody',
  'getNodeBodyNode',
  'getNodeBodyStatements',
  'getNodeCallee',
  'getNodeCases',
  'getNodeComputed',
  'getNodeConsequent',
  'getNodeDeclaration',
  'getNodeDeclarations',
  'getNodeDiscriminant',
  'getNodeElements',
  'getNodeExportKind',
  'getNodeExported',
  'getNodeExpression',
  'getNodeId',
  'getNodeImported',
  'getNodeInit',
  'getNodeKey',
  'getNodeKind',
  'getNodeLeft',
  'getNodeLocal',
  'getNodeName',
  'getNodeObject',
  'getNodeOperator',
  'getNodeParam',
  'getNodeParams',
  'getNodeProperties',
  'getNodeProperty',
  'getNodeReturnType',
  'getNodeRight',
  'getNodeSource',
  'getNodeSpecifiers',
  'getNodeSuperClass',
  'getNodeTest',
  'getNodeTypeAnnotation',
  'getNodeValue',
  'getNodeValueNode',
  'getStringValue',
  'identifierName',
  'isArrayExpression',
  'isAssignmentPattern',
  'isAstNode',
  'isBinaryExpression',
  'isBlockStatement',
  'isCallExpression',
  'isClassMember',
  'isDeclarationWithId',
  'isExportAllDeclaration',
  'isExportDeclaration',
  'isExportDefaultDeclaration',
  'isExportNamedDeclaration',
  'isExportSpecifier',
  'isExpressionStatement',
  'isFunctionLike',
  'isIdentifier',
  'isImplementationCall',
  'isImportDeclaration',
  'isImportSpecifier',
  'isMemberExpression',
  'isObjectExpression',
  'isProgram',
  'isProperty',
  'isRestElement',
  'isReturnStatement',
  'isStringLiteral',
  'isUnaryExpression',
  'isVariableDeclaration',
  'isVariableDeclarator',
  'offsetToLine',
  'offsetToLineColumn',
  'parse',
  'parseWithDiagnostics',
  'validateSourceEdits',
  'walk',
  'walkScope',
  'walkWithParents',
  'walkWithScopeContext',
] as const satisfies readonly (keyof typeof ast)[];

interface AstTypeExportContract {
  readonly ArrayExpressionNode: ArrayExpressionNode;
  readonly AssignmentPatternNode: AssignmentPatternNode;
  readonly AstFieldProjection: AstFieldProjection;
  readonly AstNode: AstNode;
  readonly AstParentContext: AstParentContext;
  readonly AstParseDiagnostic: AstParseDiagnostic;
  readonly AstParseDiagnosticLabel: AstParseDiagnosticLabel;
  readonly AstParseResult: AstParseResult;
  readonly AstScopeContext: AstScopeContext;
  readonly AstScopeDeclaration: AstScopeDeclaration;
  readonly BinaryExpressionNode: BinaryExpressionNode;
  readonly BlockStatementNode: BlockStatementNode;
  readonly CallExpressionNode: CallExpressionNode;
  readonly ClassMemberNode: ClassMemberNode;
  readonly CuratedAstNode: CuratedAstNode;
  readonly DeclarationWithIdNode: DeclarationWithIdNode;
  readonly EntityDefinition: EntityDefinition;
  readonly ExportDeclarationNode: ExportDeclarationNode;
  readonly ExportSpecifierNode: ExportSpecifierNode;
  readonly ExpressionStatementNode: ExpressionStatementNode;
  readonly FindEntityDefinitionsOptions: FindEntityDefinitionsOptions;
  readonly FrameworkNamespaceContext: FrameworkNamespaceContext;
  readonly FunctionLikeNode: FunctionLikeNode;
  readonly IdentifierNode: IdentifierNode;
  readonly ImportDeclarationNode: ImportDeclarationNode;
  readonly ImportSpecifierNode: ImportSpecifierNode;
  readonly MemberExpressionNode: MemberExpressionNode;
  readonly ObjectExpressionNode: ObjectExpressionNode;
  readonly ProgramNode: ProgramNode;
  readonly PropertyNode: PropertyNode;
  readonly RestElementNode: RestElementNode;
  readonly ReturnStatementNode: ReturnStatementNode;
  readonly SourceEdit: SourceEdit;
  readonly SourceLocation: SourceLocation;
  readonly StringLiteralMatch: StringLiteralMatch;
  readonly StringLiteralNode: StringLiteralNode;
  readonly TrailDefinition: TrailDefinition;
  readonly UnaryExpressionNode: UnaryExpressionNode;
  readonly VariableDeclarationNode: VariableDeclarationNode;
  readonly VariableDeclaratorNode: VariableDeclaratorNode;
}

const assertAstTypeExportContract = <T extends AstTypeExportContract>() =>
  undefined as T | undefined;

describe('@ontrails/warden/ast export contract', () => {
  test('keeps the exact sorted runtime export keys', () => {
    expect(Object.keys(ast).toSorted()).toEqual(expectedRuntimeExportKeys);
  });

  test('keeps every public type export resolvable at compile time', () => {
    expect(
      assertAstTypeExportContract<AstTypeExportContract>()
    ).toBeUndefined();
  });
});
