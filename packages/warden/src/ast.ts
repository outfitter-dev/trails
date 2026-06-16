/**
 * Public Warden AST helper surface.
 *
 * These helpers are the supported parser primitives for repo-local tooling and
 * rule authoring. Broader Trails-aware discovery helpers stay internal to the
 * built-in rule implementation until they have a stable public contract.
 */
export {
  findBlazeBodies,
  findContourDefinitions,
  findStringLiterals,
  findTrailDefinitions,
  applySourceEdits,
  createSourceEdit,
  getStringValue,
  identifierName,
  isBlazeCall,
  isStringLiteral,
  offsetToLineColumn,
  offsetToLine,
  parse,
  parseWithDiagnostics,
  validateSourceEdits,
  walk,
  walkWithParents,
  walkWithScopeContext,
  walkScope,
} from './rules/ast.js';
export type {
  AstParentContext,
  AstNode,
  AstParseDiagnostic,
  AstParseDiagnosticLabel,
  AstParseResult,
  AstScopeContext,
  AstScopeDeclaration,
  ContourDefinition,
  FindContourDefinitionsOptions,
  FrameworkNamespaceContext,
  SourceEdit,
  SourceLocation,
  StringLiteralMatch,
  TrailDefinition,
} from './rules/ast.js';
