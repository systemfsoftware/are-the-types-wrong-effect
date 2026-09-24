import './typescript-internals.js'
import { Effect, Option } from 'effect'
import ts from 'typescript'
import { boundSourceOf, hostFor, resolveEntrypoint } from '../compiled-package.handle.js'
import type { CompiledPackage, ResolvedEntrypoint } from '../compiled-package.handle.js'
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
      Option.match(filesOf(resolved, query), {
        onNone: () => [],
        onSome: (files) => errorsInFiles(query, files),
      }),
  )
const filesOf = (
  resolved: ResolvedEntrypoint,
  query: ObservationQuery,
): Option.Option<readonly string[]> =>
  Option.map(
    Option.fromNullishOr(resolved.files),
    (files) => enumerationFiles(files, resolved.implementation?.fileName, query.fileName),
  )

const enumerationFiles = (
  programFiles: readonly string[],
  implementationFileName: string | undefined,
  runFileName: string | undefined,
): readonly string[] => scopedCandidates(programFiles, implementationFileName, runFileName)

const scopedCandidates = (
  programFiles: readonly string[],
  implementationFileName: string | undefined,
  runFileName: string | undefined,
): readonly string[] => withFile(withFile(programFiles, runFileName), implementationFileName)

const withFile = (files: readonly string[], fileName: string | undefined): readonly string[] =>
  Option.getOrElse(appendedFileOption(files, fileName), () => files)

const appendedFileOption = (
  files: readonly string[],
  fileName: string | undefined,
): Option.Option<readonly string[]> =>
  Option.flatMap(Option.fromNullishOr(fileName), (name) => appendedFile(files, name))

const appendedFile = (files: readonly string[], fileName: string): Option.Option<readonly string[]> =>
  Option.filter(
    Option.some([...files, fileName]),
    () => !files.includes(fileName) && ts.hasTSFileExtension(fileName),
  )
const errorsInFiles = (query: ObservationQuery, fileNames: readonly string[]): InternalResolutionErrorObservation[] =>
  fileNames.flatMap((fileName) => errorsInFile(query, fileName))

const errorsInFile = (query: ObservationQuery, fileName: string): InternalResolutionErrorObservation[] =>
  Option.match(sourceOf(query, fileName), {
    onNone: () => [],
    onSome: (sources) => importErrorsOf(query, sources.host, sources.sourceFile, fileName),
  })

const sourceOf = (
  query: ObservationQuery,
  fileName: string,
): Option.Option<{ readonly host: CompilerHost; readonly sourceFile: ts.SourceFile }> => {
  const host = hostFor(query.self, query.resolutionOption)
  return Option.map(Option.fromNullishOr(boundSourceOf(query.self, fileName)), (sourceFile) => ({ host, sourceFile }))
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
  const resolution = resolvedReference(host, sourceFile, moduleSpecifier, resolutionMode)
  return unresolvedModuleObservation(query, host, fileName, moduleSpecifier, resolutionMode, resolution)
}
const resolvedReference = (
  host: CompilerHost,
  sourceFile: ts.SourceFile,
  moduleSpecifier: ts.StringLiteralLike,
  resolutionMode: ts.ResolutionMode,
): ts.ResolvedModuleWithFailedLookupLocations =>
  host.resolveSpecifier(sourceFile.fileName, moduleSpecifier.text, resolutionMode)

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
