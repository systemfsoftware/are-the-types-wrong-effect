import { Effect } from 'effect'
import ts from 'typescript'
import { esmNamespaceOf, moduleKindOf, resolveModulePair, typesProgramOf } from '../compiled-package.handle.js'
import type { BoundTypesProgram, CompiledPackage, ResolvedModulePair } from '../compiled-package.handle.js'
import type { NamedExportsObservation } from '../Observation.schema.js'
import type { ModuleKind, ResolutionOption } from '../Problem.schema.js'
import type { ObservationQuery } from './entrypoint-observation.js'
import { isNonEmptyText, nullOrModuleKind, nullOrText, viewFileName } from './entrypoint-observation.js'
import { resolutionOptionOf } from './resolution-option.js'
import { getSourceFileSymbol } from './typescript-nodes.js'
/** @internal */
export const observeNamedExports = (query: ObservationQuery): Effect.Effect<NamedExportsObservation> =>
  Effect.map(
    gatherNamedExports(query),
    (gathered) => gathered === undefined ? unanalyzableObservation(query) : analyzedObservation(query, gathered),
  )

interface NameFields {
  readonly typesFileName: string | undefined
  readonly implementationFileName: string | undefined
  readonly typesModuleKind: ModuleKind | undefined
  readonly implementationModuleKind: ModuleKind | undefined
}

interface GatheredNamedExports {
  readonly isArrayLikeModule: boolean
  readonly expectedNames: readonly string[]
  readonly implementationNames: readonly string[] | undefined
}

const nameFieldsOf = (query: ObservationQuery): NameFields => {
  const pair = resolveModulePair(query.self, query)
  const resolutionOption = resolutionOptionOf(query.resolutionKind)
  return kindedNameFields(query, pair, resolutionOption)
}

const kindedNameFields = (
  query: ObservationQuery,
  pair: ResolvedModulePair,
  resolutionOption: ResolutionOption,
): NameFields => {
  const typesFileName = typesFileNameForNamedExports(pair)
  const implementationFileName = viewFileName(pair.implementation)
  return kindedNamesOf(query, typesFileName, implementationFileName, resolutionOption)
}

const kindedNamesOf = (
  query: ObservationQuery,
  typesFileName: string | undefined,
  implementationFileName: string | undefined,
  resolutionOption: ResolutionOption,
): NameFields => ({
  typesFileName,
  implementationFileName,
  typesModuleKind: typesModuleKindFor(query, typesFileName, resolutionOption),
  implementationModuleKind: implementationModuleKindFor(query, implementationFileName, resolutionOption),
})

const typesModuleKindFor = (
  query: ObservationQuery,
  typesFileName: string | undefined,
  resolutionOption: ResolutionOption,
): ModuleKind | undefined =>
  moduleKindOf(query.self, { fileName: typesFileName, resolutionOption: typesResolutionOption(resolutionOption) })

const typesResolutionOption = (resolutionOption: ResolutionOption): ResolutionOption => {
  if (resolutionOption === 'bundler') {
    return 'node16'
  }
  return resolutionOption
}

const implementationModuleKindFor = (
  query: ObservationQuery,
  implementationFileName: string | undefined,
  resolutionOption: ResolutionOption,
): ModuleKind | undefined =>
  moduleKindOf(query.self, {
    fileName: implementationFileName,
    resolutionOption: implementationResolutionOption(resolutionOption),
  })

const implementationResolutionOption = (resolutionOption: ResolutionOption): ResolutionOption => {
  if (resolutionOption === 'node10') {
    return 'bundler'
  }
  return resolutionOption
}
const typesFileNameForNamedExports = (pair: ResolvedModulePair): string | undefined => scriptFileNameOf(pair.types)

const scriptFileNameOf = (view: ResolvedModulePair['types']): string | undefined => {
  if (view === undefined) {
    return undefined
  }
  return scriptFileNameOfTypes(view)
}

const scriptFileNameOfTypes = (view: NonNullable<ResolvedModulePair['types']>): string | undefined => {
  if (!view.isTypeScript) {
    return undefined
  }
  return view.fileName
}

const unanalyzableObservation = (query: ObservationQuery): NamedExportsObservation => {
  const fields = nameFieldsOf(query)
  return {
    resolutionKind: query.resolutionKind,
    typesFileName: nullOrText(fields.typesFileName),
    implementationFileName: nullOrText(fields.implementationFileName),
    typesModuleKind: nullOrModuleKind(fields.typesModuleKind),
    implementationModuleKind: nullOrModuleKind(fields.implementationModuleKind),
    typesIsArrayLikeModule: null,
    typesValueExportNames: null,
    implementationExportNames: null,
  }
}

const analyzedObservation = (query: ObservationQuery, gathered: GatheredNamedExports): NamedExportsObservation => {
  const fields = nameFieldsOf(query)
  return {
    resolutionKind: query.resolutionKind,
    typesFileName: nullOrText(fields.typesFileName),
    implementationFileName: nullOrText(fields.implementationFileName),
    typesModuleKind: nullOrModuleKind(fields.typesModuleKind),
    implementationModuleKind: nullOrModuleKind(fields.implementationModuleKind),
    typesIsArrayLikeModule: gathered.isArrayLikeModule,
    typesValueExportNames: [...gathered.expectedNames],
    implementationExportNames: nullOrNames(gathered.implementationNames),
  }
}

const nullOrNames = (names: readonly string[] | undefined): readonly string[] | null =>
  names === undefined ? null : [...names]
const gatherNamedExports = (
  query: ObservationQuery,
): Effect.Effect<GatheredNamedExports | undefined> =>
  gatherableOrUndefined(nameFieldsOf(query), query.resolutionKind, query.self)

interface GatheredNameFields extends NameFields {
  readonly typesFileName: string
  readonly implementationFileName: string
  readonly typesModuleKind: ModuleKind
  readonly implementationModuleKind: ModuleKind
}

const gatherableOrUndefined = (
  fields: NameFields,
  resolutionKind: ObservationQuery['resolutionKind'],
  self: CompiledPackage,
): Effect.Effect<GatheredNamedExports | undefined> =>
  Effect.suspend(() => gatheredFromFields(self, gatherableFields(fields, resolutionKind)))

const gatheredFromFields = (
  self: CompiledPackage,
  gatherable: GatheredNameFields | undefined,
): Effect.Effect<GatheredNamedExports | undefined> => {
  if (gatherable === undefined) {
    return missingGathered()
  }
  return gatheredFromHost(self, gatherable)
}

const missingValue: undefined = undefined

const missingGathered = (): Effect.Effect<undefined, never, never> => Effect.succeed(missingValue)

const gatherableFields = (
  fields: NameFields,
  resolutionKind: ObservationQuery['resolutionKind'],
): GatheredNameFields | undefined => {
  if (!isGatherableNamedExports(resolutionKind, fields)) {
    return undefined
  }
  return fields
}

const isGatherableNamedExports = (
  resolutionKind: ObservationQuery['resolutionKind'],
  fields: NameFields,
): fields is GatheredNameFields => hasGatherableFileNames(fields) && isNode16EsmCommonJsPair(resolutionKind, fields)

const hasGatherableFileNames = (fields: NameFields): boolean =>
  isNonEmptyText(fields.implementationFileName) && isNonEmptyText(fields.typesFileName)

const isNode16EsmCommonJsPair = (
  resolutionKind: ObservationQuery['resolutionKind'],
  fields: NameFields,
): boolean => {
  if (resolutionKind !== 'node16-esm') {
    return false
  }
  return detectsCommonJsPair(fields.typesModuleKind, fields.implementationModuleKind)
}

const detectsCommonJsPair = (
  typesModuleKind: ModuleKind | undefined,
  implementationModuleKind: ModuleKind | undefined,
): boolean => detectsCommonJs(typesModuleKind) && detectsCommonJs(implementationModuleKind)

const detectsCommonJs = (moduleKind: ModuleKind | undefined): boolean => {
  if (moduleKind === undefined) {
    return false
  }
  return moduleKind.detectedKind === ts.ModuleKind.CommonJS
}

const gatheredFromHost = (
  self: CompiledPackage,
  fields: GatheredNameFields,
): Effect.Effect<GatheredNamedExports | undefined> =>
  Effect.map(typesProgramOf(self, fields.typesFileName), (bound) => gatheredFromBound(self, bound))

const gatheredFromBound = (
  self: CompiledPackage,
  bound: BoundTypesProgram | undefined,
): GatheredNamedExports | undefined => {
  if (bound === undefined) {
    return undefined
  }
  return namedExportsGathered(self, bound)
}

const namedExportsGathered = (
  self: CompiledPackage,
  bound: BoundTypesProgram,
): GatheredNamedExports => ({
  isArrayLikeModule: isArrayLikeModule(bound.checker, bound.typesSourceFile),
  expectedNames: expectedExportNames(bound.checker, bound.typesSourceFile),
  implementationNames: esmNamespaceOf(self, packageSpecifierOf(self)),
})

const packageSpecifierOf = (self: CompiledPackage): string => self.packageName
const isArrayLikeModule = (checker: ts.TypeChecker, typesSourceFile: ts.SourceFile): boolean => {
  const moduleType = checker.getTypeOfSymbol(checker.resolveExternalModuleSymbol(typesSourceFile.symbol))
  return checker.isArrayLikeType(moduleType) || checker.getPropertyOfType(moduleType, '0') !== undefined
}

const expectedExportNames = (checker: ts.TypeChecker, typesSourceFile: ts.SourceFile): readonly string[] => {
  const moduleSymbol = getSourceFileSymbol(typesSourceFile)
  if (moduleSymbol === undefined) {
    return []
  }
  return [
    ...new Set(
      checker
        .getExportsAndPropertiesOfModule(moduleSymbol)
        .filter((symbol) => isValueNameExport(symbol, checker))
        .map((symbol) => symbol.name),
    ),
  ]
}

const isValueNameExport = (symbol: ts.Symbol, checker: ts.TypeChecker): boolean =>
  symbol.name !== 'prototype' && (checker.getSymbolFlags(symbol, true) & ts.SymbolFlags.Value) !== 0
