import { Effect, Match, Option } from 'effect'

import type { CompiledTarget } from '../compile-package.cell.js'
import type { CompiledPackage, ResolvedModuleView } from '../compiled-package.handle.js'
import { moduleKindOf, resolveEntrypoint } from '../compiled-package.handle.js'
import type {
  EntrypointResolutionAnalysis,
  ModuleKind,
  Resolution,
  ResolutionKind,
  ResolutionOption,
} from '../Problem.schema.js'
import type { PackageTypes } from '../Report.schema.js'
import type { EntrypointInfo, ProgramInfo } from '../Resolution.schema.js'
import { resolutionOptionOf } from './resolution-option.js'

/** @internal */
export interface CellPlan {
  readonly entrypoint: string
  readonly resolutionKind: ResolutionKind
  readonly resolutionOption: ResolutionOption
  readonly resolution: Resolution | undefined
  readonly implementationResolution: Resolution | undefined
  readonly files: ReadonlyArray<string> | undefined
  readonly moduleKinds: Record<string, ModuleKind> | undefined
  readonly node16ModuleKinds: Record<string, ModuleKind> | undefined
}

/** @internal */
export interface AnalysisPlan {
  readonly compiled: CompiledPackage
  readonly packageName: string
  readonly packageVersion: string
  readonly types: PackageTypes
  readonly buildTools: Record<string, string>
  readonly modes: ReadonlyArray<ResolutionKind>
  readonly entrypoints: Record<string, EntrypointInfo>
  readonly programInfo: Record<ResolutionOption, ProgramInfo>
  readonly cells: ReadonlyArray<CellPlan>
}

/** @internal */
export type ProblemFamily =
  | 'entrypointResolution'
  | 'moduleKindDisagreement'
  | 'exportDefaultDisagreement'
  | 'namedExports'
  | 'cjsOnlyExportsDefault'
  | 'unexpectedModuleSyntax'
  | 'internalResolutionError'

/** @internal */
export interface ProblemRun {
  readonly family: ProblemFamily
  readonly compiled: CompiledPackage
  readonly cell: CellPlan
  readonly cellIndex: number
  readonly fileName: string | undefined
}

const allResolutionKinds: ReadonlyArray<ResolutionKind> = ['node10', 'node16-cjs', 'node16-esm', 'bundler']

const emptyEntrypoints = (): Record<string, EntrypointInfo> => ({})

const resolutionOf = (view: ResolvedModuleView): Resolution => ({
  fileName: view.fileName,
  isTypeScript: view.isTypeScript,
  isJson: view.isJson,
  trace: [...view.trace],
})

const analysisOf = (
  entrypoint: string,
  kind: ResolutionKind,
  pair: {
    readonly isWildcard: boolean
    readonly types: ResolvedModuleView | undefined
    readonly implementation: ResolvedModuleView | undefined
  },
  files: ReadonlyArray<string> | undefined,
): EntrypointResolutionAnalysis =>
  Match.value(pair.isWildcard).pipe(
    Match.when(true, () => wildcardAnalysisOf(entrypoint, kind)),
    Match.when(false, () => namedAnalysisOf(entrypoint, kind, pair, files)),
    Match.exhaustive,
  )

const wildcardAnalysisOf = (entrypoint: string, kind: ResolutionKind): EntrypointResolutionAnalysis => ({
  name: entrypoint,
  resolutionKind: kind,
  isWildcard: true,
})

const namedAnalysisOf = (
  entrypoint: string,
  kind: ResolutionKind,
  pair: { readonly types: ResolvedModuleView | undefined; readonly implementation: ResolvedModuleView | undefined },
  files: ReadonlyArray<string> | undefined,
): EntrypointResolutionAnalysis =>
  withFiles(
    withImplementation(withTypes({ name: entrypoint, resolutionKind: kind }, pair.types), pair.implementation),
    files,
  )

const withTypes = (
  analysis: EntrypointResolutionAnalysis,
  types: ResolvedModuleView | undefined,
): EntrypointResolutionAnalysis =>
  Option.match(Option.fromNullishOr(types), {
    onNone: () => analysis,
    onSome: (view) => ({ ...analysis, resolution: resolutionOf(view) }),
  })

const withImplementation = (
  analysis: EntrypointResolutionAnalysis,
  implementation: ResolvedModuleView | undefined,
): EntrypointResolutionAnalysis =>
  Option.match(Option.fromNullishOr(implementation), {
    onNone: () => analysis,
    onSome: (view) => ({ ...analysis, implementationResolution: resolutionOf(view) }),
  })

const withFiles = (
  analysis: EntrypointResolutionAnalysis,
  files: ReadonlyArray<string> | undefined,
): EntrypointResolutionAnalysis =>
  Option.match(Option.fromNullishOr(files), {
    onNone: () => analysis,
    onSome: (names) => ({ ...analysis, files: [...names] }),
  })

const resolutionFor = (
  target: CompiledTarget,
  entrypoint: string,
  kind: ResolutionKind,
): Effect.Effect<EntrypointResolutionAnalysis> =>
  Effect.map(
    resolveEntrypoint(target.compiled, { entrypoint, resolutionKind: kind }),
    (resolved) => analysisOf(entrypoint, kind, resolved, resolved.files),
  )

const hasTypesOf = (resolutions: Record<ResolutionKind, EntrypointResolutionAnalysis>): boolean =>
  allResolutionKinds.some((kind) => resolutions[kind].resolution?.isTypeScript === true)

const infoOf = (
  entrypoint: string,
  analyses: ReadonlyArray<EntrypointResolutionAnalysis>,
): EntrypointInfo => {
  const resolutions = {
    node10: analyses[0],
    'node16-cjs': analyses[1],
    'node16-esm': analyses[2],
    bundler: analyses[3],
  }
  return {
    subpath: entrypoint,
    resolutions,
    hasTypes: hasTypesOf(resolutions),
    isWildcard: resolutions.bundler.isWildcard === true,
  }
}

const entrypointInfoFor = (target: CompiledTarget, entrypoint: string): Effect.Effect<EntrypointInfo> =>
  Effect.map(
    Effect.forEach(allResolutionKinds, (kind) => resolutionFor(target, entrypoint, kind)),
    (analyses) => infoOf(entrypoint, analyses),
  )

const entrypointMapOf = (target: CompiledTarget): Effect.Effect<Record<string, EntrypointInfo>> =>
  Effect.reduce(
    target.entrypoints,
    emptyEntrypoints,
    (entrypoints, entrypoint) =>
      Effect.map(entrypointInfoFor(target, entrypoint), (info) => ({ ...entrypoints, [entrypoint]: info })),
  )

const declaredFileNames = (info: EntrypointInfo, kind: ResolutionKind): ReadonlyArray<string> => [
  ...(info.resolutions[kind].files ?? []),
  ...implementationFileNames(info, kind),
]

const implementationFileNames = (info: EntrypointInfo, kind: ResolutionKind): ReadonlyArray<string> =>
  Option.match(Option.fromNullishOr(info.resolutions[kind].implementationResolution), {
    onNone: () => [],
    onSome: (resolution) => [resolution.fileName],
  })

const node16FileNames = (entrypoints: Record<string, EntrypointInfo>): ReadonlyArray<string> => [
  ...Object.values(entrypoints).flatMap((info) => declaredFileNames(info, 'node16-cjs')),
  ...Object.values(entrypoints).flatMap((info) => declaredFileNames(info, 'node16-esm')),
]

const recordedModuleKind = (
  compiled: CompiledPackage,
  moduleKinds: Record<string, ModuleKind>,
  fileName: string,
): Record<string, ModuleKind> =>
  Match.value(moduleKindOf(compiled, { fileName, resolutionOption: 'node16' })).pipe(
    Match.when(undefined, () => moduleKinds),
    Match.orElse((moduleKind) => recordedKind(moduleKinds, fileName, moduleKind)),
  )

const recordedKind = (
  moduleKinds: Record<string, ModuleKind>,
  fileName: string,
  moduleKind: ModuleKind,
): Record<string, ModuleKind> =>
  Match.value(Object.hasOwn(moduleKinds, fileName)).pipe(
    Match.when(true, () => moduleKinds),
    Match.when(false, () => ({ ...moduleKinds, [fileName]: moduleKind })),
    Match.exhaustive,
  )

const node16ModuleKindsOf = (
  compiled: CompiledPackage,
  entrypoints: Record<string, EntrypointInfo>,
): Record<string, ModuleKind> =>
  node16FileNames(entrypoints).reduce(
    (moduleKinds, fileName) => recordedModuleKind(compiled, moduleKinds, fileName),
    {},
  )

const programInfoOf = (
  compiled: CompiledPackage,
  entrypoints: Record<string, EntrypointInfo>,
): Record<ResolutionOption, ProgramInfo> => ({
  node10: {},
  node16: { moduleKinds: node16ModuleKindsOf(compiled, entrypoints) },
  bundler: {},
})

const cellOf = (
  info: EntrypointInfo,
  kind: ResolutionKind,
  programInfo: Record<ResolutionOption, ProgramInfo>,
): CellPlan => {
  const node16ModuleKinds = programInfo.node16.moduleKinds
  return {
    entrypoint: info.subpath,
    resolutionKind: kind,
    resolutionOption: resolutionOptionOf(kind),
    resolution: info.resolutions[kind].resolution,
    implementationResolution: info.resolutions[kind].implementationResolution,
    files: info.resolutions[kind].files,
    moduleKinds: programInfo[resolutionOptionOf(kind)].moduleKinds,
    node16ModuleKinds,
  }
}

const cellsOf = (
  entrypoints: Record<string, EntrypointInfo>,
  programInfo: Record<ResolutionOption, ProgramInfo>,
): ReadonlyArray<CellPlan> =>
  Object.values(entrypoints).flatMap((info) => allResolutionKinds.map((kind) => cellOf(info, kind, programInfo)))

/** @internal */
export const planOf = (target: CompiledTarget): Effect.Effect<AnalysisPlan> =>
  Effect.map(entrypointMapOf(target), (entrypoints) => {
    const programInfo = programInfoOf(target.compiled, entrypoints)
    return {
      compiled: target.compiled,
      packageName: target.packageName,
      packageVersion: target.packageVersion,
      types: target.types,
      buildTools: target.buildTools,
      modes: target.modes,
      entrypoints,
      programInfo,
      cells: cellsOf(entrypoints, programInfo),
    }
  })

const runOf = (family: ProblemFamily, plan: AnalysisPlan, cell: CellPlan, cellIndex: number): ProblemRun => ({
  family,
  compiled: plan.compiled,
  cell,
  cellIndex,
  fileName: undefined,
})

const fileRuns = (
  family: ProblemFamily,
  plan: AnalysisPlan,
  cell: CellPlan,
  cellIndex: number,
): ReadonlyArray<ProblemRun> =>
  [...enumeratedFiles(cell), ...implementationFile(cell)].map((fileName) => ({
    family,
    compiled: plan.compiled,
    cell,
    cellIndex,
    fileName,
  }))

const enumeratedFiles = (cell: CellPlan): ReadonlyArray<string> =>
  Option.match(Option.fromNullishOr(cell.files), {
    onNone: () => [],
    onSome: (files) => [...files],
  })

const implementationFile = (cell: CellPlan): ReadonlyArray<string> =>
  Option.match(Option.fromNullishOr(cell.implementationResolution), {
    onNone: () => [],
    onSome: (resolution) => [resolution.fileName],
  })

const runsForCell = (plan: AnalysisPlan, cell: CellPlan, cellIndex: number): ReadonlyArray<ProblemRun> =>
  Match.value(plan.modes.includes(cell.resolutionKind)).pipe(
    Match.when(false, (): ReadonlyArray<ProblemRun> => []),
    Match.when(true, () => [
      runOf('entrypointResolution', plan, cell, cellIndex),
      runOf('moduleKindDisagreement', plan, cell, cellIndex),
      runOf('exportDefaultDisagreement', plan, cell, cellIndex),
      runOf('namedExports', plan, cell, cellIndex),
      runOf('cjsOnlyExportsDefault', plan, cell, cellIndex),
      ...fileRuns('unexpectedModuleSyntax', plan, cell, cellIndex),
      ...fileRuns('internalResolutionError', plan, cell, cellIndex),
    ]),
    Match.exhaustive,
  )

/** @internal */
export const runListOf = (plan: AnalysisPlan): ReadonlyArray<ProblemRun> =>
  plan.cells.flatMap((cell, cellIndex) => runsForCell(plan, cell, cellIndex))
