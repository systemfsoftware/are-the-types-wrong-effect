import './typescript-internals.js'
import { Option } from 'effect'
import ts from 'typescript'

/** @internal */
export const isAccessExpression = (node: ts.Node): node is ts.AccessExpression =>
  ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)

/** @internal */
export const accessExpressionNameNode = (node: ts.AccessExpression): ts.MemberName | ts.Expression => {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name
  }
  return node.argumentExpression
}

/** @internal */
export const skipParentheses = (node: ts.Expression): ts.Expression => {
  let current = node
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

/** @internal */
export const isStringOrNumericLiteralLike = (node: ts.Node): node is ts.StringLiteralLike | ts.NumericLiteral =>
  ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)

/** @internal */
export const isFunctionExpressionOrArrowFunction = (
  node: ts.Node,
): node is ts.FunctionExpression | ts.ArrowFunction => ts.isFunctionExpression(node) || ts.isArrowFunction(node)

/** @internal */
export const isFunctionBlock = (node: ts.Node): node is ts.Block => ts.isBlock(node) && ts.isFunctionLike(node.parent)

interface ModifierQuery {
  readonly node: ts.Node
  readonly kind: ts.SyntaxKind.ExportKeyword | ts.SyntaxKind.DefaultKeyword
}

const modifiersOf = (node: ts.Node): readonly ts.Modifier[] | undefined =>
  ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined

const modifierOfKind = (query: ModifierQuery): boolean =>
  Option.match(Option.fromNullishOr(modifiersOf(query.node)), {
    onNone: () => false,
    onSome: (modifiers) => modifiers.some((modifier) => modifier.kind === query.kind),
  })

/** @internal */
export const hasExportModifier = (node: ts.Node): boolean => modifierOfKind({ node, kind: ts.SyntaxKind.ExportKeyword })

/** @internal */
export const hasDefaultModifier = (node: ts.Node): boolean =>
  modifierOfKind({ node, kind: ts.SyntaxKind.DefaultKeyword })

/** @internal */
export const getSourceFileSymbol = (sourceFile: ts.SourceFile): ts.Symbol | undefined => sourceFile.symbol

interface SignatureQuery {
  readonly checker: ts.TypeChecker
  readonly type: ts.Type
}

/** @internal */
export const typeHasCallOrConstructSignatures = (query: SignatureQuery): boolean =>
  query.checker.getSignaturesOfType(query.type, ts.SignatureKind.Call).length > 0 ||
  query.checker.getSignaturesOfType(query.type, ts.SignatureKind.Construct).length > 0
