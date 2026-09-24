import './typescript-internals.js'
import { Effect } from 'effect'
import ts from 'typescript'
import { boundSourceOf, resolveModulePair } from '../compiled-package.handle.js'
import type { CJSOnlyExportsDefaultObservation } from '../Observation.schema.js'
import { type ObservationQuery, viewFileName } from './entrypoint-observation.js'
import { getSourceFileSymbol } from './typescript-nodes.js'

/** @internal */
export const observeCjsOnlyExportsDefault = (
  query: ObservationQuery,
): Effect.Effect<CJSOnlyExportsDefaultObservation | undefined> => Effect.sync(() => boundObservation(query))

const boundObservation = (query: ObservationQuery): CJSOnlyExportsDefaultObservation | undefined => {
  const implementationFileName = viewFileName(resolveModulePair(query.self, query).implementation)
  if (implementationFileName === undefined) {
    return undefined
  }
  return cjsOnlyObservation(query, implementationFileName)
}

const cjsOnlyObservation = (
  query: ObservationQuery,
  implementationFileName: string,
): CJSOnlyExportsDefaultObservation | undefined => {
  if (isCjsOnlyResolutionKind(query.resolutionKind)) {
    return undefined
  }
  return markerObservation(query, implementationFileName)
}

const isCjsOnlyResolutionKind = (resolutionKind: ObservationQuery['resolutionKind']): boolean =>
  resolutionKind === 'node10' || resolutionKind === 'node16-cjs'

const markerObservation = (
  query: ObservationQuery,
  implementationFileName: string,
): CJSOnlyExportsDefaultObservation => {
  const sourceFile = boundSourceOf(query.self, implementationFileName)
  if (sourceFile === undefined) {
    return emptyObservation(query, implementationFileName)
  }
  return exportObservation(query, implementationFileName, sourceFile)
}

const emptyObservation = (
  query: ObservationQuery,
  implementationFileName: string,
): CJSOnlyExportsDefaultObservation => ({
  resolutionKind: query.resolutionKind,
  implementationFileName,
  isCommonJsOnlyFile: false,
  hasDefaultAndEsModuleMarkers: false,
  hasExportEquals: false,
  defaultDeclarationStart: null,
  defaultDeclarationEnd: null,
})

const exportObservation = (
  query: ObservationQuery,
  implementationFileName: string,
  sourceFile: ts.SourceFile,
): CJSOnlyExportsDefaultObservation => {
  const symbolExports = sourceExportsOf(sourceFile)
  if (symbolExports === undefined) {
    return emptyObservation(query, implementationFileName)
  }
  return markerFactsObservation(query, implementationFileName, sourceFile, symbolExports)
}

const sourceExportsOf = (sourceFile: ts.SourceFile): ts.SymbolTable | undefined =>
  getSourceFileSymbol(sourceFile)?.exports

const markerFactsObservation = (
  query: ObservationQuery,
  implementationFileName: string,
  sourceFile: ts.SourceFile,
  symbolExports: ts.SymbolTable,
): CJSOnlyExportsDefaultObservation => {
  const declaration = defaultDeclarationOf(symbolExports)
  return markerFactsOf(query, implementationFileName, sourceFile, symbolExports, declaration)
}

const markerFactsOf = (
  query: ObservationQuery,
  implementationFileName: string,
  sourceFile: ts.SourceFile,
  symbolExports: ts.SymbolTable,
  declaration: ts.Declaration | undefined,
): CJSOnlyExportsDefaultObservation => ({
  resolutionKind: query.resolutionKind,
  implementationFileName,
  isCommonJsOnlyFile: isCommonJsOnlyFile(sourceFile),
  hasDefaultAndEsModuleMarkers: hasDefaultAndEsModuleMarkers(symbolExports),
  hasExportEquals: symbolExports.has(ts.InternalSymbolName.ExportEquals),
  defaultDeclarationStart: declarationPositions(sourceFile, declaration)[0],
  defaultDeclarationEnd: declarationPositions(sourceFile, declaration)[1],
})

const declarationPositions = (
  sourceFile: ts.SourceFile,
  declaration: ts.Declaration | undefined,
): readonly [number | null, number | null] => {
  if (declaration === undefined) {
    return [null, null]
  }
  return [declaration.getStart(sourceFile), declaration.end]
}

const defaultDeclarationOf = (symbolExports: ts.SymbolTable): ts.Declaration | undefined =>
  firstDeclarationOf(symbolExports.get(ts.InternalSymbolName.Default))

const firstDeclarationOf = (symbol: ts.Symbol | undefined): ts.Declaration | undefined =>
  declarationsHead(symbol?.declarations)

const declarationsHead = (declarations: readonly ts.Declaration[] | undefined): ts.Declaration | undefined =>
  declarations?.[0]

const isCommonJsOnlyFile = (sourceFile: ts.SourceFile): boolean =>
  sourceFile.externalModuleIndicator === undefined && sourceFile.commonJsModuleIndicator !== undefined

const hasDefaultAndEsModuleMarkers = (symbolExports: ts.SymbolTable): boolean =>
  symbolExports.has(ts.InternalSymbolName.Default) && symbolExports.has(ts.escapeLeadingUnderscores('__esModule'))
