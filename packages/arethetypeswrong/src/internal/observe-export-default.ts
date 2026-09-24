import './typescript-internals.js'
import { Effect, Option } from 'effect'
import ts from 'typescript'
import { moduleSourcesOf, resolveModulePair } from '../compiled-package.handle.js'
import type { BoundModuleSources } from '../compiled-package.handle.js'
import type {
  ExportDefaultDisagreementObservation,
  ImplementationDefaultFacts,
  TypesDefaultFacts,
} from '../Observation.schema.js'
import type { ModuleKind } from '../Problem.schema.js'
import { type ObservationQuery } from './entrypoint-observation.js'
import { isNonEmptyText, nullOrModuleKind, nullOrText, viewFileName } from './entrypoint-observation.js'
import { getProbableExports } from './probable-exports.js'
import { getSourceFileSymbol, isFunctionBlock, typeHasCallOrConstructSignatures } from './typescript-nodes.js'

/** @internal */
export const observeExportDefault = (query: ObservationQuery): Effect.Effect<ExportDefaultDisagreementObservation> =>
  Effect.map(factsOf(query), (facts) => observationOf(query, facts))

interface DisagreementFacts {
  readonly types: TypesDefaultFacts
  readonly implementation: ImplementationDefaultFacts
}

const noFacts: DisagreementFacts = {
  types: {
    hasDefaultExportSymbol: false,
    hasDefaultSymbol: false,
    hasExportEquals: false,
    hasNonDefaultValueExport: false,
    defaultTypeIsObject: false,
    defaultTypeHasCallOrConstructSignatures: false,
  },
  implementation: {
    hasDefault: false,
    exportEqualsSharesContainer: false,
    exportsAreAnalyzable: false,
    hasExportEquals: false,
    exportEqualsIsExportDefault: false,
    moduleExportsTypeHasCallOrConstructSignatures: false,
    hasNonDefaultExport: false,
  },
}

const observationOf = (
  query: ObservationQuery,
  facts: DisagreementFacts,
): ExportDefaultDisagreementObservation => {
  const pair = resolveModulePair(query.self, query)
  return {
    typesFileName: nullOrText(viewFileName(pair.types)),
    implementationFileName: nullOrText(viewFileName(pair.implementation)),
    resolutionKind: query.resolutionKind,
    typesModuleKind: nullOrModuleKind(kindAt(query.node16ModuleKinds, viewFileName(pair.types))),
    implementationModuleKind: nullOrModuleKind(kindAt(query.node16ModuleKinds, viewFileName(pair.implementation))),
    types: facts.types,
    implementation: facts.implementation,
  }
}

const kindAt = (
  kinds: Record<string, ModuleKind> | undefined,
  fileName: string | undefined,
): ModuleKind | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.all([Option.fromNullishOr(kinds), Option.fromNullishOr(fileName)]), ([table, name]) =>
      Option.fromNullishOr(table[name])),
  )

const factsOf = (query: ObservationQuery): Effect.Effect<DisagreementFacts> =>
  Effect.suspend(() => {
    const pair = resolveModulePair(query.self, query)
    return gatherFacts(query.self, viewFileName(pair.types), viewFileName(pair.implementation))
  })

interface BoundSources {
  readonly typesChecker: ts.TypeChecker
  readonly implementationChecker: ts.TypeChecker
  readonly typesSourceFile: ts.SourceFile
  readonly implementationSourceFile: ts.SourceFile
  readonly typesExports: ts.SymbolTable
  readonly implementationExports: ts.SymbolTable
}

const gatherFacts = (
  self: ObservationQuery['self'],
  typesFileName: string | undefined,
  implementationFileName: string | undefined,
): Effect.Effect<DisagreementFacts> =>
  Effect.suspend(() => gatheredFacts(self, definedGatherPair(typesFileName, implementationFileName)))

const gatheredFacts = (
  self: ObservationQuery['self'],
  pair: readonly [string, string] | undefined,
): Effect.Effect<DisagreementFacts> => {
  if (pair === undefined) {
    return Effect.succeed(noFacts)
  }
  return analyzedFactsOf(self, pair)
}

const analyzedFactsOf = (
  self: ObservationQuery['self'],
  pair: readonly [string, string],
): Effect.Effect<DisagreementFacts> =>
  Effect.flatMap(
    Effect.suspend(() => boundSourcesOf(self, pair[0], pair[1])),
    (sources) => (sources === undefined ? Effect.succeed(noFacts) : analyzedFacts(sources)),
  )

const boundSourcesOf = (
  self: ObservationQuery['self'],
  typesFileName: string,
  implementationFileName: string,
): Effect.Effect<BoundSources | undefined> =>
  Effect.map(
    moduleSourcesOf(self, [typesFileName, implementationFileName] as const),
    (sources) => exportedSources(sources),
  )

const exportedSources = (sources: BoundModuleSources | undefined): BoundSources | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromNullishOr(sources), (present) =>
      Option.map(
        Option.filter(
          Option.fromNullishOr(exportsPairOf(present.typesSourceFile, present.implementationSourceFile)),
          () => present.implementationSourceFile.externalModuleIndicator === undefined,
        ),
        (exportsPair) => pairedSources(present, exportsPair),
      )),
  )

const pairedSources = (
  sources: BoundModuleSources,
  exportsPair: readonly [ts.SymbolTable, ts.SymbolTable],
): BoundSources => ({
  typesChecker: sources.typesChecker,
  implementationChecker: sources.implementationChecker,
  typesSourceFile: sources.typesSourceFile,
  implementationSourceFile: sources.implementationSourceFile,
  typesExports: exportsPair[0],
  implementationExports: exportsPair[1],
})
const definedGatherPair = (
  typesFileName: string | undefined,
  implementationFileName: string | undefined,
): readonly [string, string] | undefined =>
  Option.match(textOrNone(typesFileName), {
    onNone: () => undefined,
    onSome: (types) => withImplementationName(types, implementationFileName),
  })

const withImplementationName = (
  types: string,
  implementationFileName: string | undefined,
): readonly [string, string] | undefined =>
  Option.match(textOrNone(implementationFileName), {
    onNone: () => undefined,
    onSome: (implementation) => tsModulePairOf(types, implementation),
  })

const tsModulePairOf = (types: string, implementation: string): readonly [string, string] | undefined => {
  if (!ts.hasTSFileExtension(types)) {
    return undefined
  }
  return [types, implementation]
}

const textOrNone = (value: string | undefined): Option.Option<string> =>
  Option.filter(Option.fromNullishOr(value), isNonEmptyText)

const exportsPairOf = (
  typesSourceFile: ts.SourceFile,
  implementationSourceFile: ts.SourceFile,
): readonly [ts.SymbolTable, ts.SymbolTable] | undefined =>
  Option.match(exportsTableOf(typesSourceFile), {
    onNone: () => undefined,
    onSome: (typesExports) => withImplementationExports(typesExports, implementationSourceFile),
  })

const withImplementationExports = (
  typesExports: ts.SymbolTable,
  implementationSourceFile: ts.SourceFile,
): readonly [ts.SymbolTable, ts.SymbolTable] | undefined =>
  Option.match(exportsTableOf(implementationSourceFile), {
    onNone: () => undefined,
    onSome: (implementationExports) => [typesExports, implementationExports] as const,
  })

const exportsTableOf = (sourceFile: ts.SourceFile): Option.Option<ts.SymbolTable> =>
  Option.fromNullishOr(getSourceFileSymbol(sourceFile)?.exports)

const analyzedFacts = (sources: BoundSources): Effect.Effect<DisagreementFacts> =>
  Effect.sync(() => {
    const probableExports = getProbableExports(sources.implementationSourceFile)
    return {
      types: typesFactsOf(sources, sources.typesChecker),
      implementation: implementationFactsOf(sources, sources.implementationChecker, probableExports),
    }
  })

const typesFactsOf = (sources: BoundSources, typesChecker: ts.TypeChecker): TypesDefaultFacts => {
  const defaultType = typesDefaultTypeOf(sources, typesChecker)
  return {
    hasDefaultExportSymbol: sources.typesExports.has(ts.InternalSymbolName.Default),
    hasDefaultSymbol: typesDefaultSymbolOf(sources, typesChecker) !== undefined,
    hasExportEquals: sources.typesExports.has(ts.InternalSymbolName.ExportEquals),
    hasNonDefaultValueExport: hasNonDefaultValueExport(sources.typesExports, typesChecker),
    defaultTypeIsObject: isObjectyType(defaultType, typesChecker),
    defaultTypeHasCallOrConstructSignatures: typeHasCallOrConstructSignatures({
      checker: typesChecker,
      type: defaultType,
    }),
  }
}

const typesDefaultSymbolOf = (sources: BoundSources, typesChecker: ts.TypeChecker): ts.Symbol | undefined =>
  sources.typesExports.get(ts.InternalSymbolName.Default) ??
    declaredDefaultSymbolOf(sources.typesSourceFile, typesChecker)

const declaredDefaultSymbolOf = (sourceFile: ts.SourceFile, checker: ts.TypeChecker): ts.Symbol | undefined => {
  const moduleSymbol = getSourceFileSymbol(sourceFile)
  if (moduleSymbol === undefined) {
    return undefined
  }
  return checker.getExportsAndPropertiesOfModule(moduleSymbol).find((symbol) => symbol.escapedName === 'default')
}

const typesDefaultTypeOf = (sources: BoundSources, typesChecker: ts.TypeChecker): ts.Type => {
  const defaultSymbol = typesDefaultSymbolOf(sources, typesChecker)
  if (defaultSymbol === undefined) {
    return typesChecker.getAnyType()
  }
  return typesChecker.getTypeOfSymbol(defaultSymbol)
}

const hasNonDefaultValueExport = (exports: ts.SymbolTable, checker: ts.TypeChecker): boolean =>
  Array.from(exports.values()).some((symbol) => isNonDefaultValueExport(symbol, checker))

const isNonDefaultValueExport = (symbol: ts.Symbol, checker: ts.TypeChecker): boolean => {
  if (symbol.escapedName === 'default') {
    return false
  }
  return isValueSymbol(symbol, checker)
}

const isValueSymbol = (symbol: ts.Symbol, checker: ts.TypeChecker): boolean => {
  if ((symbol.flags & ts.SymbolFlags.Value) !== 0) {
    return true
  }
  return isAliasValueSymbol(symbol, checker)
}

const isAliasValueSymbol = (symbol: ts.Symbol, checker: ts.TypeChecker): boolean => {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) {
    return false
  }
  return isValueSymbol(checker.getAliasedSymbol(symbol), checker)
}

const isObjectyType = (type: ts.Type, checker: ts.TypeChecker): boolean =>
  (type.flags & ts.TypeFlags.Object) !== 0 &&
  !typeHasCallOrConstructSignatures({ checker, type })

const implementationFactsOf = (
  sources: BoundSources,
  implementationChecker: ts.TypeChecker,
  probableExports: readonly { readonly name: string }[],
): ImplementationDefaultFacts => ({
  hasDefault: hasImplementationDefault(sources, implementationChecker, probableExports),
  exportEqualsSharesContainer: sharesExportEqualsContainer(sources.implementationExports),
  exportsAreAnalyzable: exportsAreAnalyzable(sources.implementationExports, probableExports),
  hasExportEquals: sources.implementationExports.has(ts.InternalSymbolName.ExportEquals),
  exportEqualsIsExportDefault: exportEqualsIsExportDefault(sources.implementationExports),
  moduleExportsTypeHasCallOrConstructSignatures: moduleExportsTypeHasSignatures(sources, implementationChecker),
  hasNonDefaultExport: hasNonDefaultImplementationExport(sources.implementationExports, probableExports),
})

const hasImplementationDefault = (
  sources: BoundSources,
  implementationChecker: ts.TypeChecker,
  probableExports: readonly { readonly name: string }[],
): boolean => {
  if (sources.implementationExports.has(ts.InternalSymbolName.Default)) {
    return true
  }
  return probableOrCheckerDefault(sources, implementationChecker, probableExports)
}

const probableOrCheckerDefault = (
  sources: BoundSources,
  implementationChecker: ts.TypeChecker,
  probableExports: readonly { readonly name: string }[],
): boolean => {
  if (probableExports.some((exported) => exported.name === 'default')) {
    return true
  }
  return checkerExportsIncludeDefault(sources, implementationChecker)
}

const checkerExportsIncludeDefault = (sources: BoundSources, implementationChecker: ts.TypeChecker): boolean => {
  if (sources.implementationExports.size === 0) {
    return false
  }
  return declaredModuleHasDefault(sources, implementationChecker)
}

const declaredModuleHasDefault = (sources: BoundSources, implementationChecker: ts.TypeChecker): boolean => {
  const moduleSymbol = getSourceFileSymbol(sources.implementationSourceFile)
  if (moduleSymbol === undefined) {
    return false
  }
  return implementationChecker
    .getExportsAndPropertiesOfModule(moduleSymbol)
    .some((symbol) => symbol.name === 'default')
}

const sharesExportEqualsContainer = (implementationExports: ts.SymbolTable): boolean => {
  const declarations = exportEqualsDeclarationsOf(implementationExports)
  if (declarations === undefined) {
    return true
  }
  return sharesContainer(declarations)
}

const sharesContainer = (declarations: readonly ts.Declaration[]): boolean => {
  const containers = declarations.map(declarationContainerOf)
  const firstDefined = containers.findIndex((container) => container !== undefined)
  if (firstDefined === -1) {
    return true
  }
  return sameContainerAfter(containers, firstDefined)
}

const sameContainerAfter = (containers: readonly (ts.Node | undefined)[], firstDefined: number): boolean => {
  const container = containers[firstDefined]
  return containers.every((other, index) => index <= firstDefined || other === container)
}

const declarationContainerOf = (declaration: ts.Declaration): ts.Node | undefined =>
  ts.findAncestor(declaration, (node) => isFunctionBlock(node) || ts.isSourceFile(node))

const exportsAreAnalyzable = (
  implementationExports: ts.SymbolTable,
  probableExports: readonly { readonly name: string }[],
): boolean => implementationExports.size > 0 || probableExports.length > 0

const exportEqualsDeclarationsOf = (implementationExports: ts.SymbolTable): readonly ts.Declaration[] | undefined =>
  implementationExports.get(ts.InternalSymbolName.ExportEquals)?.declarations

const exportEqualsIsExportDefault = (implementationExports: ts.SymbolTable): boolean => {
  const declaration = firstExportEqualsDeclaration(implementationExports)
  if (declaration === undefined) {
    return false
  }
  return exportAssignmentIsExportDefault(declaration)
}

const firstExportEqualsDeclaration = (implementationExports: ts.SymbolTable): ts.Declaration | undefined =>
  exportEqualsDeclarationsOf(implementationExports)?.[0]

const exportAssignmentIsExportDefault = (declaration: ts.Declaration): boolean => {
  if (!ts.isExportAssignment(declaration)) {
    return false
  }
  return exportAssignmentTargetIsExportDefault(declaration)
}

const exportAssignmentTargetIsExportDefault = (declaration: ts.ExportAssignment): boolean =>
  assignmentTargetIsExportDefault(declaration.expression)

const assignmentTargetIsExportDefault = (target: ts.Expression): boolean => {
  if (isModuleExportsOrDefaultAccess(target)) {
    return true
  }
  return assignmentChainIsExportDefault(target)
}

const isModuleExportsOrDefaultAccess = (target: ts.Expression): boolean =>
  isModuleExportsAccess(target) || isExportsDefaultAccess(target)

const isModuleExportsAccess = (target: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(target) && isModuleExportsPropertyAccess(target)

const isModuleExportsPropertyAccess = (access: ts.PropertyAccessExpression): boolean =>
  access.name.text === 'exports' && isModuleIdentifier(access.expression)

const isModuleIdentifier = (expression: ts.Expression): boolean =>
  ts.isIdentifier(expression) && expression.text === 'module'

const isExportsDefaultAccess = (target: ts.Expression): boolean =>
  isExportsDefaultPropertyAccess(target) || isExportsDefaultElementAccess(target)

const isExportsDefaultPropertyAccess = (target: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(target) && isDefaultExportsProperty(target)

const isDefaultExportsProperty = (access: ts.PropertyAccessExpression): boolean =>
  access.name.text === 'default' && isExportsIdentifier(access.expression)

const isExportsIdentifier = (expression: ts.Expression): boolean =>
  ts.isIdentifier(expression) && expression.text === 'exports'

const isExportsDefaultElementAccess = (target: ts.Expression): boolean =>
  ts.isElementAccessExpression(target) && isDefaultExportsElement(target)

const isDefaultExportsElement = (access: ts.ElementAccessExpression): boolean =>
  isDefaultElementArgument(access.argumentExpression) && isExportsIdentifier(access.expression)

const isDefaultElementArgument = (argument: ts.Expression): boolean =>
  ts.isStringLiteralLike(argument) && argument.text === 'default'

const assignmentChainIsExportDefault = (target: ts.Expression): boolean => {
  if (!ts.isBinaryExpression(target)) {
    return false
  }
  return forEachAssignmentTarget(target)
}

const forEachAssignmentTarget = (assignment: ts.BinaryExpression): boolean => {
  if (!isEqualsAssignment(assignment)) {
    return false
  }
  return targetOrNestedAssignmentDefault(assignment)
}

const targetOrNestedAssignmentDefault = (assignment: ts.BinaryExpression): boolean =>
  targetOrDefaultAccess(assignment.left) || forEachNestedAssignmentTarget(assignment)

const forEachNestedAssignmentTarget = (assignment: ts.BinaryExpression): boolean => {
  if (isEqualsAssignment(assignment.right)) {
    return forEachAssignmentTarget(assignment.right)
  }
  return false
}

const isEqualsAssignment = (expression: ts.Expression): expression is ts.BinaryExpression =>
  ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken

const targetOrDefaultAccess = (target: ts.Expression): boolean => isModuleExportsOrDefaultAccess(target)

const moduleExportsTypeHasSignatures = (sources: BoundSources, implementationChecker: ts.TypeChecker): boolean =>
  typeHasCallOrConstructSignatures({
    checker: implementationChecker,
    type: implementationModuleExportsTypeOf(sources, implementationChecker),
  })

const implementationModuleExportsTypeOf = (
  sources: BoundSources,
  implementationChecker: ts.TypeChecker,
): ts.Type => {
  const moduleSymbol = getSourceFileSymbol(sources.implementationSourceFile)
  if (moduleSymbol === undefined) {
    return implementationChecker.getAnyType()
  }
  return moduleExportsTypeVia(sources, implementationChecker, moduleSymbol)
}

const moduleExportsTypeVia = (
  sources: BoundSources,
  implementationChecker: ts.TypeChecker,
  moduleSymbol: ts.Symbol,
): ts.Type => {
  const type = implementationChecker.getTypeOfSymbol(
    implementationChecker.resolveExternalModuleSymbol(moduleSymbol),
  )
  return nonAnyModuleExportsType(sources, implementationChecker, type)
}

const nonAnyModuleExportsType = (
  sources: BoundSources,
  implementationChecker: ts.TypeChecker,
  type: ts.Type,
): ts.Type => {
  if ((type.flags & ts.TypeFlags.Any) === 0) {
    return type
  }
  return defaultedModuleExportsType(sources, implementationChecker, type)
}

const defaultedModuleExportsType = (
  sources: BoundSources,
  implementationChecker: ts.TypeChecker,
  type: ts.Type,
): ts.Type => {
  if (!exportEqualsIsExportDefault(sources.implementationExports)) {
    return type
  }
  return declaredDefaultTypeOf(sources, implementationChecker, type)
}

const declaredDefaultTypeOf = (
  sources: BoundSources,
  implementationChecker: ts.TypeChecker,
  fallback: ts.Type,
): ts.Type => {
  const defaultSymbol = sources.implementationExports.get(ts.InternalSymbolName.Default)
  if (defaultSymbol === undefined) {
    return fallback
  }
  return nonAnyDeclaredDefaultType(implementationChecker, defaultSymbol, fallback)
}

const nonAnyDeclaredDefaultType = (
  implementationChecker: ts.TypeChecker,
  defaultSymbol: ts.Symbol,
  fallback: ts.Type,
): ts.Type => {
  const defaultType = implementationChecker.getTypeOfSymbol(defaultSymbol)
  if ((defaultType.flags & ts.TypeFlags.Any) !== 0) {
    return fallback
  }
  return defaultType
}

const hasNonDefaultImplementationExport = (
  implementationExports: ts.SymbolTable,
  probableExports: readonly { readonly name: string }[],
): boolean => {
  if (exportsHaveNonDefault(implementationExports)) {
    return true
  }
  return probableHasNonDefault(probableExports)
}

const exportsHaveNonDefault = (implementationExports: ts.SymbolTable): boolean =>
  Array.from(implementationExports.keys()).some((name) => isNotDefaultOrEsModule(ts.unescapeLeadingUnderscores(name)))

const probableHasNonDefault = (
  probableExports: readonly { readonly name: string }[],
): boolean => probableExports.some((exported) => isNotDefaultOrEsModule(exported.name))

const isNotDefaultOrEsModule = (name: string): boolean => name !== 'default' && name !== '__esModule'
