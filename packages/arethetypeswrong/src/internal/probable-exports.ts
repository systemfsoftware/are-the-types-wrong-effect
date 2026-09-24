import './typescript-internals.js'
import { Option } from 'effect'
import ts from 'typescript'
import {
  accessExpressionNameNode,
  isAccessExpression,
  isFunctionExpressionOrArrowFunction,
  isStringOrNumericLiteralLike,
  skipParentheses,
} from './typescript-nodes.js'

/** @internal */
export interface ProbableExport {
  readonly name: string
  readonly node: ts.Node
}

const minifiedVariableAssignmentPattern = /[^\s];(?:var|let|const) [a-zA-Z0-9_]=[^\s]/

interface ReturnWithExpression extends ts.ReturnStatement {
  readonly expression: ts.Expression
}

/** @internal */
export const getProbableExports = (sourceFile: ts.SourceFile): readonly ProbableExport[] =>
  Option.match(Option.fromNullishOr(transpilerBootstrapExports(sourceFile)), {
    onSome: (transpiled) => transpiled,
    onNone: () => bundlerRuntimeExports(sourceFile) ?? [],
  })

const andThen = <A, B>(value: A | undefined, next: (value: A) => B | undefined): B | undefined => {
  if (value === undefined) {
    return undefined
  }
  return next(value)
}

const firstDefinedOf = <A>(thunks: readonly (() => A | undefined)[]): A | undefined => {
  let found: A | undefined
  thunks.some((thunk) => {
    found = thunk()
    return found !== undefined
  })
  return found
}

const isProbablyMinified = (text: string): boolean => minifiedVariableAssignmentPattern.test(text)

const transpilerMarkerIndex = (text: string): number => {
  const doubleUnderscore = text.indexOf('\n__export(')
  return doubleUnderscore === -1 ? text.indexOf('\n_export(') : doubleUnderscore
}

const isTranspilerLike = (text: string, markerIndex: number): boolean => markerIndex !== -1 || isProbablyMinified(text)

const statementContains = (statement: ts.Statement, index: number): boolean =>
  statement.pos <= index && index <= statement.end

const inTranspilerWindow = (statement: ts.Statement, markerIndex: number): boolean =>
  markerIndex === -1 || statementContains(statement, markerIndex)

const transpilerBootstrapExports = (sourceFile: ts.SourceFile): readonly ProbableExport[] | undefined => {
  const markerIndex = transpilerMarkerIndex(sourceFile.text)
  if (!isTranspilerLike(sourceFile.text, markerIndex)) {
    return undefined
  }
  return transpilerExportsInWindow(sourceFile, markerIndex)
}

const transpilerExportsInWindow = (
  sourceFile: ts.SourceFile,
  markerIndex: number,
): readonly ProbableExport[] | undefined => {
  const candidates = sourceFile.statements.filter((statement) => inTranspilerWindow(statement, markerIndex))
  return firstDefinedOf(candidates.map((statement) => () => transpilerStatementExports(statement, sourceFile)))
}

const transpilerStatementExports = (
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): readonly ProbableExport[] | undefined => {
  if (!ts.isExpressionStatement(statement)) {
    return undefined
  }
  return transpilerExpressionExports(statement.expression, sourceFile)
}

const transpilerExpressionExports = (
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): readonly ProbableExport[] | undefined => {
  if (!isTranspilerExportCall(expression)) {
    return undefined
  }
  return transpilerCallExports(expression, sourceFile)
}

const isTranspilerExportCall = (expression: ts.Expression): expression is ts.CallExpression =>
  ts.isCallExpression(expression) && hasTranspilerCallShape(expression)

const hasTranspilerCallShape = (call: ts.CallExpression): boolean =>
  ts.isIdentifier(call.expression) && hasTranspilerArgumentPair(call.arguments)

const hasTranspilerArgumentPair = (argumentList: ts.NodeArray<ts.Expression>): boolean => {
  if (argumentList.length !== 2) {
    return false
  }
  return isIdentifierAndObjectLiteral(argumentList)
}

const isIdentifierAndObjectLiteral = (argumentList: ts.NodeArray<ts.Expression>): boolean =>
  ts.isIdentifier(argumentList[0]) && ts.isObjectLiteralExpression(argumentList[1])

const transpilerCallExports = (
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): readonly ProbableExport[] | undefined => {
  if (!isTranspilerHelperIdentifier(call.expression, sourceFile)) {
    return undefined
  }
  return objectLiteralExports(call.arguments[1])
}

const isTranspilerHelperIdentifier = (callTarget: ts.Expression, sourceFile: ts.SourceFile): boolean =>
  ts.isIdentifier(callTarget) && isTranspilerHelper(callTarget, sourceFile)

const isNamedExportHelper = (identifier: ts.Identifier): boolean =>
  ts.unescapeLeadingUnderscores(identifier.escapedText) === '__export' || identifier.escapedText === '_export'

const isTranspilerHelper = (identifier: ts.Identifier, sourceFile: ts.SourceFile): boolean => {
  if (isNamedExportHelper(identifier)) {
    return true
  }
  return isDeclaredExportHelper(identifier, sourceFile)
}

const isDeclaredExportHelper = (identifier: ts.Identifier, sourceFile: ts.SourceFile): boolean =>
  isExportHelperDeclaration(getLocalDeclaration(identifier, sourceFile))

const getLocalDeclaration = (identifier: ts.Identifier, sourceFile: ts.SourceFile): ts.Declaration | undefined =>
  andThen(getLocalSymbol(identifier, sourceFile), (symbol) => symbol.valueDeclaration)

const getLocalSymbol = (identifier: ts.Identifier, sourceFile: ts.SourceFile): ts.Symbol | undefined => {
  const locals = sourceFile.locals
  if (locals === undefined) {
    return undefined
  }
  return locals.get(identifier.escapedText)
}

const objectLiteralExports = (argument: ts.Expression): readonly ProbableExport[] => {
  if (ts.isObjectLiteralExpression(argument)) {
    return argument.properties.flatMap(getPropertyExports)
  }
  return []
}

const getPropertyExports = (property: ts.ObjectLiteralElementLike): readonly ProbableExport[] => {
  if (ts.isPropertyAssignment(property)) {
    return namedExportsOf(property.name, property)
  }
  return shorthandExportsOf(property)
}

const namedExportsOf = (name: ts.PropertyName, node: ts.Node): readonly ProbableExport[] => {
  if (isExportNameNode(name)) {
    return [makeExport(name.text, node)]
  }
  return []
}

const isExportNameNode = (name: ts.Node): name is ts.Identifier | ts.StringLiteralLike | ts.NumericLiteral =>
  ts.isIdentifier(name) || isStringOrNumericLiteralLike(name)

const shorthandExportsOf = (property: ts.ObjectLiteralElementLike): readonly ProbableExport[] => {
  if (ts.isShorthandPropertyAssignment(property)) {
    return [makeExport(property.name.text, property)]
  }
  return []
}

const makeExport = (name: string, node: ts.Node): ProbableExport => ({ name, node })

const isExportHelperDeclaration = (declaration: ts.Declaration | undefined): boolean => {
  if (declaration === undefined) {
    return false
  }
  return isVariableDeclarationWithHelperInitializer(declaration)
}

const isVariableDeclarationWithHelperInitializer = (declaration: ts.Declaration): boolean => {
  if (!ts.isVariableDeclaration(declaration)) {
    return false
  }
  return hasExportHelperInitializer(declaration.initializer)
}

const hasExportHelperInitializer = (initializer: ts.Expression | undefined): boolean => {
  if (initializer === undefined) {
    return false
  }
  return isExportHelperFunction(initializer)
}

const isExportHelperFunction = (expression: ts.Expression): boolean =>
  isFunctionExpressionOrArrowFunction(expression) && hasForInBody(expression.body)

const hasForInBody = (body: ts.ConciseBody): boolean => ts.isBlock(body) && hasSingleForInStatement(body)

const hasSingleForInStatement = (body: ts.Block): boolean =>
  body.statements.length === 1 && body.statements.some((statement) => ts.isForInStatement(statement))

const bundlerRuntimeExports = (sourceFile: ts.SourceFile): readonly ProbableExport[] | undefined =>
  firstDefinedOf(sourceFile.statements.map((statement) => () => bootstrapStatementExports(statement)))

const bootstrapStatementExports = (statement: ts.Statement): readonly ProbableExport[] | undefined => {
  if (!ts.isExpressionStatement(statement)) {
    return undefined
  }
  return moduleExportsAssignmentExports(statement.expression)
}

const moduleExportsAssignmentExports = (
  expression: ts.Expression,
): readonly ProbableExport[] | undefined => {
  if (!isModuleExportsAssignment(expression)) {
    return undefined
  }
  return bootstrapCallExports(expression)
}

const isModuleExportsAssignment = (expression: ts.Expression): expression is ts.BinaryExpression =>
  isEqualsAssignment(expression) && isModuleExports(expression.left)

const bootstrapCallExports = (assignment: ts.BinaryExpression): readonly ProbableExport[] | undefined => {
  const call = skipParentheses(assignment.right)
  if (!ts.isCallExpression(call)) {
    return undefined
  }
  return bootstrapExports(call)
}

const bootstrapExports = (call: ts.CallExpression): readonly ProbableExport[] | undefined => {
  const bootstrap = skipParentheses(call.expression)
  const entryModules = singleArrayArgumentElements(call)
  if (!isBlockBodyFunction(bootstrap)) {
    return undefined
  }
  return andThen(entryModules, (modules) => entryModuleExports(bootstrap.body, modules))
}

const isBlockBodyFunction = (node: ts.Expression): node is ts.FunctionExpression =>
  ts.isFunctionExpression(node) && ts.isBlock(node.body)

const singleArrayArgumentElements = (call: ts.CallExpression): ts.NodeArray<ts.Expression> | undefined => {
  const argument = singleArgumentOf(call)
  if (argument === undefined) {
    return undefined
  }
  return arrayLiteralElements(argument)
}

const singleArgumentOf = (call: ts.CallExpression): ts.Expression | undefined => {
  if (call.arguments.length !== 1) {
    return undefined
  }
  return call.arguments[0]
}

const arrayLiteralElements = (argument: ts.Expression): ts.NodeArray<ts.Expression> | undefined => {
  if (!ts.isArrayLiteralExpression(argument)) {
    return undefined
  }
  return argument.elements
}

const entryModuleExports = (
  body: ts.Block,
  entryModules: ts.NodeArray<ts.Expression>,
): readonly ProbableExport[] | undefined =>
  andThen(
    entryModuleIdOf(body),
    (entryModuleId) =>
      andThen(entryModuleOf(entryModules, entryModuleId), (entryModule) =>
        andThen(exportsParameterNameOf(entryModule), (exportsParameterName) =>
          collectModuleExports(entryModule, exportsParameterName))),
  )

const entryModuleOf = (
  entryModules: ts.NodeArray<ts.Expression>,
  entryModuleId: number,
): ts.FunctionExpression | undefined => {
  const entryModule = entryModules.at(entryModuleId)
  if (entryModule === undefined) {
    return undefined
  }
  return functionExpressionOf(entryModule)
}

const functionExpressionOf = (node: ts.Node | undefined): ts.FunctionExpression | undefined =>
  Option.match(Option.fromNullishOr(node), {
    onNone: () => undefined,
    onSome: (candidate) => (ts.isFunctionExpression(candidate) ? candidate : undefined),
  })

const exportsParameterNameOf = (entryModule: ts.FunctionExpression): string | undefined => {
  const parameter = entryModule.parameters.at(1)
  if (parameter === undefined) {
    return undefined
  }
  return identifierTextOf(parameter.name)
}

const identifierTextOf = (node: ts.Node): string | undefined => {
  if (ts.isIdentifier(node)) {
    return node.text
  }
  return undefined
}

const collectModuleExports = (
  entryModule: ts.FunctionExpression,
  exportsParameterName: string,
): readonly ProbableExport[] => {
  const exports: ProbableExport[] = []
  collectModuleExportsFrom(entryModule.body, exportsParameterName, exports)
  return exports
}

const collectModuleExportsFrom = (node: ts.Node, exportsParameterName: string, exports: ProbableExport[]): void => {
  const moduleExport = moduleExportAt(node, exportsParameterName)
  if (moduleExport !== undefined) {
    exports.push(moduleExport)
  }
  ts.forEachChild(node, (child) => collectModuleExportsFrom(child, exportsParameterName, exports))
}

const moduleExportAt = (node: ts.Node, exportsParameterName: string): ProbableExport | undefined => {
  if (!isExportsParameterAssignment(node, exportsParameterName)) {
    return undefined
  }
  return assignmentExport(node)
}

const assignmentExport = (assignment: ts.BinaryExpression): ProbableExport | undefined => {
  if (!isAccessExpression(assignment.left)) {
    return undefined
  }
  return accessExport(assignment)
}

const accessExport = (assignment: ts.BinaryExpression): ProbableExport | undefined =>
  andThen(accessNameOf(assignment.left), (name) => makeExport(name, assignment))

const isExportsParameterAssignment = (node: ts.Node, exportsParameterName: string): node is ts.BinaryExpression =>
  isEqualsAssignment(node) && isAccessOnIdentifier(node.left, exportsParameterName)

const isEqualsAssignment = (node: ts.Node): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken

const isAccessOnIdentifier = (expression: ts.Expression, identifierText: string): boolean =>
  isAccessExpression(expression) && hasIdentifierTarget(expression, identifierText)

const hasIdentifierTarget = (accessExpression: ts.AccessExpression, identifierText: string): boolean =>
  ts.isIdentifier(accessExpression.expression) && accessExpression.expression.text === identifierText

const entryModuleIdOf = (body: ts.Block): number | undefined =>
  andThen(returnWithExpressionOf(body), (statement) => entryModuleIdFromExpression(statement.expression))

const returnWithExpressionOf = (body: ts.Block): ReturnWithExpression | undefined =>
  body.statements.find((statement): statement is ReturnWithExpression => isReturnWithExpression(statement))

const isReturnWithExpression = (statement: ts.Statement): statement is ReturnWithExpression =>
  ts.isReturnStatement(statement) && statement.expression !== undefined

const entryModuleIdFromExpression = (expression: ts.Expression): number | undefined => {
  const unparenthesized = skipParentheses(expression)
  const fromCall = callEntryModuleId(unparenthesized)
  if (fromCall !== undefined) {
    return fromCall
  }
  return commaExpressionEntryModuleId(unparenthesized)
}

const callEntryModuleId = (expression: ts.Expression): number | undefined => {
  if (!isSingleArgumentCall(expression)) {
    return undefined
  }
  return numericValueOf(expression.arguments[0])
}

const isSingleArgumentCall = (expression: ts.Expression): expression is ts.CallExpression =>
  ts.isCallExpression(expression) && expression.arguments.length === 1

const commaExpressionEntryModuleId = (expression: ts.Expression): number | undefined => {
  if (!isCommaExpression(expression)) {
    return undefined
  }
  return entryModuleIdFromExpression(expression.right)
}

const isCommaExpression = (expression: ts.Expression): expression is ts.BinaryExpression =>
  ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken

const numericValueOf = (node: ts.Expression): number | undefined => {
  const unparenthesized = skipParentheses(node)
  const literal = numericLiteralValueOf(unparenthesized)
  if (literal !== undefined) {
    return literal
  }
  return assignedNumericValueOf(unparenthesized)
}

const numericLiteralValueOf = (node: ts.Expression): number | undefined => {
  if (ts.isNumericLiteral(node)) {
    return Number(node.text)
  }
  return undefined
}

const assignedNumericValueOf = (node: ts.Expression): number | undefined => {
  if (!isEqualsAssignment(node)) {
    return undefined
  }
  return numericValueOf(node.right)
}

const isModuleExports = (expression: ts.Expression): boolean =>
  isAccessOnIdentifier(expression, 'module') && isExportsAccess(expression)

const isExportsAccess = (expression: ts.Expression): boolean =>
  isAccessExpression(expression) && accessNameOf(expression) === 'exports'

const accessNameNodeOf = (node: ts.Node): ts.MemberName | ts.Expression | undefined =>
  isAccessExpression(node) ? accessExpressionNameNode(node) : undefined

const accessNameOf = (node: ts.Node): string | undefined =>
  andThen(accessNameNodeOf(node), (nameNode) => (isAccessNameNode(nameNode) ? nameNode.text : undefined))

const isAccessNameNode = (node: ts.Node): node is ts.Identifier | ts.StringLiteralLike =>
  ts.isIdentifier(node) || ts.isStringLiteralLike(node)
