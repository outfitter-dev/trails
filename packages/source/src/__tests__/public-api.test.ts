import { describe, expect, test } from 'bun:test';

import * as source from '@ontrails/source';
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
} from '@ontrails/source';

const expectedRuntimeExportKeys = [
  'SCOPE_FRAME_COLLECTORS',
  'applySourceEdits',
  'buildFrameworkNamespaceContext',
  'collectScopeFrameBindings',
  'createSourceEdit',
  'deriveConstString',
  'extractBindingName',
  'extractEntityDefinition',
  'extractFirstStringArg',
  'extractPlainTemplateLiteral',
  'extractStringLiteral',
  'extractStringOrTemplateLiteral',
  'extractTrailDefinition',
  'findConfigProperty',
  'findEntityDefinitions',
  'findImplementationBodies',
  'findStringLiterals',
  'findTrailDefinitions',
  'forEachAstChild',
  'getImportSourceValue',
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
  'getPropertyName',
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
  'isFrameworkNamespaceSource',
  'isFunctionLike',
  'isIdentifier',
  'isImplementationCall',
  'isImportDeclaration',
  'isImportSpecifier',
  'isMemberAccessNonComputed',
  'isMemberExpression',
  'isObjectExpression',
  'isProgram',
  'isProperty',
  'isRestElement',
  'isReturnStatement',
  'isScopeFrameNode',
  'isShadowed',
  'isStringLiteral',
  'isUnaryExpression',
  'isVariableDeclaration',
  'isVariableDeclarator',
  'offsetToLine',
  'offsetToLineColumn',
  'parse',
  'parseWithDiagnostics',
  'propertyKeyName',
  'staticPropertyKeyName',
  'validateSourceEdits',
  'walk',
  'walkChildren',
  'walkScope',
  'walkWithOxcFacade',
  'walkWithParents',
  'walkWithScopeContext',
  'walkWithScopes',
] as const satisfies readonly (keyof typeof source)[];

interface SourceTypeExportContract {
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

const assertSourceTypeExportContract = <T extends SourceTypeExportContract>() =>
  undefined as T | undefined;

describe('@ontrails/source public API', () => {
  test('keeps the exact sorted runtime export keys', () => {
    expect(Object.keys(source).toSorted()).toEqual(expectedRuntimeExportKeys);
    expect(expectedRuntimeExportKeys).toHaveLength(110);
  });

  test('keeps every public type export resolvable at compile time', () => {
    expect(
      assertSourceTypeExportContract<SourceTypeExportContract>()
    ).toBeUndefined();
  });

  test('parses, walks, discovers trails, and recognizes implementation calls', () => {
    const ast = source.parse(
      'example.ts',
      `
        import { trail } from '@ontrails/core';

        export const showUser = trail('user.show', {
          implementation: async (input, ctx) => {
            return userShow.implementation(input, ctx);
          },
        });
      `
    );

    expect(ast).not.toBeNull();
    if (!ast) {
      return;
    }

    expect(source.findTrailDefinitions(ast).map((def) => def.id)).toEqual([
      'user.show',
    ]);

    let sawImplementationCall = false;
    source.walk(ast, (node) => {
      sawImplementationCall ||= source.isImplementationCall(node);
    });
    expect(sawImplementationCall).toBe(true);
  });
});
