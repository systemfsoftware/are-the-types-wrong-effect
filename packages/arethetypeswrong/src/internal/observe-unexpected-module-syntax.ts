import { Effect } from 'effect'
import ts from 'typescript'
import { boundSourceOf, moduleKindOf, resolveEntrypoint } from '../compiled-package.handle.js'
import type { CompiledPackage, ResolvedEntrypoint } from '../compiled-package.handle.js'
import type { UnexpectedModuleSyntaxObservation } from '../Observation.schema.js'
import type { ModuleKind } from '../Problem.schema.js'
import type { ObservationQuery } from './entrypoint-observation.js'
import { resolutionOptionOf } from './resolution-option.js'

/** @internal */
export const observeUnexpectedModuleSyntax = (
  query: ObservationQuery,
): Effect.Effect<readonly UnexpectedModuleSyntaxObservation[]> =>
  Effect.map(
    Effect.suspend(() => resolveEntrypoint(query.self, query)),
    (resolved) => observationsForResolved(query, resolved),
  )

const observationsForResolved = (
  query: ObservationQuery,
  resolved: ResolvedEntrypoint,
): UnexpectedModuleSyntaxObservation[] => {
  if (resolutionOptionOf(query.resolutionKind) !== 'node16') {
    return []
  }
  return observationsInFiles(query, enumeratedFiles(resolved))
}

const enumeratedFiles = (resolved: ResolvedEntrypoint): readonly string[] =>
  [...programCandidates(resolved), ...implementationCandidates(resolved)].filter((fileName) =>
    ts.hasJSFileExtension(fileName)
  )

const programCandidates = (resolved: ResolvedEntrypoint): readonly string[] => resolved.files ?? []

const implementationCandidates = (resolved: ResolvedEntrypoint): readonly string[] =>
  candidateList(implementationFileName(resolved))

const implementationFileName = (resolved: ResolvedEntrypoint): string | undefined => resolved.implementation?.fileName

const candidateList = (fileName: string | undefined): readonly string[] => fileName === undefined ? [] : [fileName]
const observationsInFiles = (
  query: ObservationQuery,
  fileNames: readonly string[],
): UnexpectedModuleSyntaxObservation[] =>
  fileNames.flatMap((fileName) => {
    const observation = observationInFile(query, fileName)
    return observation === undefined ? [] : [observation]
  })

const observationInFile = (
  query: ObservationQuery,
  fileName: string,
): UnexpectedModuleSyntaxObservation | undefined => {
  const expectedModuleKind = moduleKindOf(query.self, {
    fileName,
    resolutionOption: resolutionOptionOf(query.resolutionKind),
  })
  if (expectedModuleKind === undefined) {
    return undefined
  }
  return syntaxObservation(query.self, fileName, expectedModuleKind)
}

const syntaxObservation = (
  self: CompiledPackage,
  fileName: string,
  expectedModuleKind: ModuleKind,
): UnexpectedModuleSyntaxObservation => {
  const sourceFile = boundSourceOf(self, fileName)
  if (sourceFile === undefined) {
    return missingSourceObservation(fileName, expectedModuleKind)
  }
  return impliedSyntaxObservation(sourceFile, fileName, expectedModuleKind)
}

const missingSourceObservation = (
  fileName: string,
  expectedModuleKind: ModuleKind,
): UnexpectedModuleSyntaxObservation => ({
  fileName,
  expectedModuleKind,
  impliedSyntax: null,
  pos: null,
  end: null,
})

const impliedSyntaxObservation = (
  sourceFile: ts.SourceFile,
  fileName: string,
  expectedModuleKind: ModuleKind,
): UnexpectedModuleSyntaxObservation => {
  const implied = impliedSyntaxOf(sourceFile)
  if (implied === undefined) {
    return missingSourceObservation(fileName, expectedModuleKind)
  }
  return indicatorObservation(sourceFile, fileName, expectedModuleKind, implied)
}

interface ImpliedSyntax {
  readonly kind: 1 | 99
  readonly node: ts.Node | undefined
}

const impliedSyntaxOf = (sourceFile: ts.SourceFile): ImpliedSyntax | undefined => {
  const external = sourceFile.externalModuleIndicator
  if (external === undefined) {
    return commonJsImpliedSyntax(sourceFile.commonJsModuleIndicator)
  }
  return { kind: 99, node: externalIndicatorNode(sourceFile, external) }
}

const commonJsImpliedSyntax = (indicator: ts.Node | undefined): ImpliedSyntax | undefined => {
  if (indicator === undefined) {
    return undefined
  }
  return { kind: 1, node: indicator }
}

const externalIndicatorNode = (sourceFile: ts.SourceFile, external: ts.Node | true): ts.Node | undefined => {
  if (external === true) {
    return sourceFile.commonJsModuleIndicator
  }
  return external
}

const indicatorObservation = (
  sourceFile: ts.SourceFile,
  fileName: string,
  expectedModuleKind: ModuleKind,
  implied: ImpliedSyntax,
): UnexpectedModuleSyntaxObservation => {
  if (implied.node === undefined) {
    return {
      fileName,
      expectedModuleKind,
      impliedSyntax: implied.kind,
      pos: null,
      end: null,
    }
  }
  return {
    fileName,
    expectedModuleKind,
    impliedSyntax: implied.kind,
    pos: implied.node.getStart(sourceFile),
    end: implied.node.end,
  }
}
