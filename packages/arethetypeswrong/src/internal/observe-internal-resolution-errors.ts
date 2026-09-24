import { Effect, Option } from 'effect'
import ts from 'typescript'
import { boundSourceOf, hostFor, resolveEntrypoint } from '../compiled-package.handle.js'
import type { CompiledPackage } from '../compiled-package.handle.js'
import type { InternalResolutionErrorObservation } from '../Observation.schema.js'
import type { CompilerHost } from './compiled-package-hosts.js'
import type { ObservationQuery } from './entrypoint-observation.js'
import { resolutionOptionOf } from './resolution-option.js'

/** @internal */
export const observeInternalResolutionErrors = (
  query: ObservationQuery,
): Effect.Effect<readonly InternalResolutionErrorObservation[]> =>
  Effect.map(
    Effect.suspend(() => resolveEntrypoint(query.self, query)),
    (resolved) =>
      Option.match(Option.fromNullishOr(resolved.files), {
        onNone: () => [],
        onSome: (files) => errorsInFiles(query, enumerationFiles(files, resolved.implementation?.fileName)),
      }),
  )

const enumerationFiles = (
  programFiles: readonly string[],
  implementationFileName: string | undefined,
): readonly string[] => {
  const candidates = implementationFileName === undefined ? programFiles : [...programFiles, implementationFileName]
  return candidates.filter((fileName) => ts.hasTSFileExtension(fileName))
}

const errorsInFiles = (query: ObservationQuery, fileNames: readonly string[]): InternalResolutionErrorObservation[] =>
  fileNames.flatMap((fileName) => errorsInFile(query, fileName))

const errorsInFile = (query: ObservationQuery, fileName: string): InternalResolutionErrorObservation[] => {
  const host = hostFor(query.self, resolutionOptionOf(query.resolutionKind))
  const sourceFile = boundSourceOf(query.self, fileName)
  return errorsForFileSources(query, host, fileName, sourceFile)
}

const errorsForFileSources = (
  query: ObservationQuery,
  host: CompilerHost,
  fileName: string,
  sourceFile: ts.SourceFile | undefined,
): InternalResolutionErrorObservation[] => {
  if (sourceFile === undefined) {
    return []
  }
  return importErrorsOf(query, host, sourceFile, fileName)
}

const importErrorsOf = (
  query: ObservationQuery,
  host: CompilerHost,
  sourceFile: ts.SourceFile,
  fileName: string,
): InternalResolutionErrorObservation[] => {
  const imports = sourceFile.imports ?? []
  return imports.flatMap((moduleSpecifier) => errorsForSpecifier(query, host, sourceFile, fileName, moduleSpecifier))
}

const errorsForSpecifier = (
  query: ObservationQuery,
  host: CompilerHost,
  sourceFile: ts.SourceFile,
  fileName: string,
  moduleSpecifier: ts.StringLiteralLike,
): InternalResolutionErrorObservation[] =>
  Option.match(errorForSpecifier(query, host, sourceFile, fileName, moduleSpecifier), {
    onNone: () => [],
    onSome: (observation) => [observation],
  })

const errorForSpecifier = (
  query: ObservationQuery,
  host: CompilerHost,
  sourceFile: ts.SourceFile,
  fileName: string,
  moduleSpecifier: ts.StringLiteralLike,
): Option.Option<InternalResolutionErrorObservation> => {
  if (!isAnalyzedReference(moduleSpecifier.text, packageNameOf(query.self))) {
    return Option.none()
  }
  return unresolvedReferenceObservation(query, host, sourceFile, fileName, moduleSpecifier)
}

const packageNameOf = (self: CompiledPackage): string => self.packageName

const isAnalyzedReference = (reference: string, packageName: string): boolean =>
  isPackageReference(reference, packageName) || isLocalReference(reference)

const isPackageReference = (reference: string, packageName: string): boolean =>
  reference === packageName || reference.startsWith(`${packageName}/`)

const isLocalReference = (reference: string): boolean =>
  firstCharacterOf(reference) === '#' || ts.pathIsRelative(reference)

const firstCharacterOf = (reference: string): string | undefined => reference[0]

const unresolvedReferenceObservation = (
  query: ObservationQuery,
  host: CompilerHost,
  sourceFile: ts.SourceFile,
  fileName: string,
  moduleSpecifier: ts.StringLiteralLike,
): Option.Option<InternalResolutionErrorObservation> => {
  const resolutionMode = ts.getModeForUsageLocation(sourceFile, moduleSpecifier, host.getCompilerOptions())
  return Option.flatMap(
    resolutionOf(host, sourceFile, moduleSpecifier, resolutionMode),
    (resolution) => unresolvedModuleObservation(query, host, fileName, moduleSpecifier, resolutionMode, resolution),
  )
}

const resolutionOf = (
  host: CompilerHost,
  sourceFile: ts.SourceFile,
  moduleSpecifier: ts.StringLiteralLike,
  resolutionMode: ts.ResolutionMode,
): Option.Option<ts.ResolvedModuleWithFailedLookupLocations> =>
  Option.fromNullishOr(host.getResolvedModule(sourceFile, moduleSpecifier.text, resolutionMode))

const unresolvedModuleObservation = (
  query: ObservationQuery,
  host: CompilerHost,
  fileName: string,
  moduleSpecifier: ts.StringLiteralLike,
  resolutionMode: ts.ResolutionMode,
  resolution: ts.ResolvedModuleWithFailedLookupLocations,
): Option.Option<InternalResolutionErrorObservation> => {
  if (resolution.resolvedModule !== undefined) {
    return Option.none()
  }
  return Option.some(unresolvedObservationOf(query, host, fileName, moduleSpecifier, resolutionMode))
}

const unresolvedObservationOf = (
  query: ObservationQuery,
  host: CompilerHost,
  fileName: string,
  moduleSpecifier: ts.StringLiteralLike,
  resolutionMode: ts.ResolutionMode,
): InternalResolutionErrorObservation => ({
  resolutionOption: resolutionOptionOf(query.resolutionKind),
  fileName,
  moduleSpecifier: moduleSpecifier.text,
  pos: moduleSpecifier.pos,
  end: moduleSpecifier.end,
  resolutionMode: modeOrNull(resolutionMode),
  trace: traceOrEmpty(host, fileName, moduleSpecifier.text, resolutionMode),
})

const traceOrEmpty = (
  host: CompilerHost,
  fileName: string,
  moduleSpecifier: string,
  resolutionMode: ts.ResolutionMode,
): readonly string[] => host.getTrace(fileName, moduleSpecifier, resolutionMode) ?? []

const modeOrNull = (resolutionMode: ts.ResolutionMode): number | null => {
  if (resolutionMode === undefined) {
    return null
  }
  return resolutionMode
}
