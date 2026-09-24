import type { Package } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { dual } from 'effect/Function'
import { type Pipeable, Prototype } from 'effect/Pipeable'

import { analyse } from './analysis.cell.js'
import type { AnalysisError } from './AnalysisError.schema.js'
import type { AnalysisRequest, ExcludedEntrypoint } from './open-package.cell.js'
import type { ResolutionKind } from './Problem.schema.js'
import type { PackageReport } from './Report.schema.js'

const TypeId = '~systemfsoftware/arethetypeswrong/Analysis'
export type TypeId = typeof TypeId

export interface AnalysisSpec extends Pipeable {
  readonly [TypeId]: typeof TypeId
  readonly request: AnalysisRequest
  withEntrypoints(entrypoints: ReadonlyArray<string>): AnalysisSpec
  includeEntrypoints(entrypoints: ReadonlyArray<string>): AnalysisSpec
  excludeEntrypoints(entrypoints: ReadonlyArray<ExcludedEntrypoint>): AnalysisSpec
  withTypesCompanion(companion: Package): AnalysisSpec
  withModes(modes: ReadonlyArray<ResolutionKind>): AnalysisSpec
  readonly run: Effect.Effect<PackageReport, AnalysisError>
}

const allModes: ReadonlyArray<ResolutionKind> = ['node10', 'node16-cjs', 'node16-esm', 'bundler']

const makeProto = (request: AnalysisRequest): AnalysisSpec => {
  const self: AnalysisSpec = {
    [TypeId]: TypeId,
    request,
    ...Prototype,
    withEntrypoints: (entrypoints) => withEntrypoints(self, entrypoints),
    includeEntrypoints: (entrypoints) => includeEntrypoints(self, entrypoints),
    excludeEntrypoints: (entrypoints) => excludeEntrypoints(self, entrypoints),
    withTypesCompanion: (companion) => withTypesCompanion(self, companion),
    withModes: (modes) => withModes(self, modes),
    get run() {
      return analyse.run(request)
    },
  }
  return self
}

export const make = (pkg: Package): AnalysisSpec =>
  makeProto({
    pkg,
    companion: undefined,
    entrypoints: undefined,
    includeEntrypoints: [],
    excludeEntrypoints: [],
    entrypointsLegacy: false,
    modes: allModes,
  })

export const withEntrypoints: {
  (entrypoints: ReadonlyArray<string>): (spec: AnalysisSpec) => AnalysisSpec
  (spec: AnalysisSpec, entrypoints: ReadonlyArray<string>): AnalysisSpec
} = dual(
  2,
  (spec: AnalysisSpec, entrypoints: ReadonlyArray<string>): AnalysisSpec =>
    makeProto({ ...spec.request, entrypoints: [...entrypoints] }),
)

export const includeEntrypoints: {
  (entrypoints: ReadonlyArray<string>): (spec: AnalysisSpec) => AnalysisSpec
  (spec: AnalysisSpec, entrypoints: ReadonlyArray<string>): AnalysisSpec
} = dual(
  2,
  (spec: AnalysisSpec, entrypoints: ReadonlyArray<string>): AnalysisSpec =>
    makeProto({ ...spec.request, includeEntrypoints: [...entrypoints] }),
)

export const excludeEntrypoints: {
  (entrypoints: ReadonlyArray<ExcludedEntrypoint>): (spec: AnalysisSpec) => AnalysisSpec
  (spec: AnalysisSpec, entrypoints: ReadonlyArray<ExcludedEntrypoint>): AnalysisSpec
} = dual(
  2,
  (spec: AnalysisSpec, entrypoints: ReadonlyArray<ExcludedEntrypoint>): AnalysisSpec =>
    makeProto({ ...spec.request, excludeEntrypoints: [...entrypoints] }),
)
export const withLegacyEntrypoints: {
  (spec: AnalysisSpec): AnalysisSpec
} = (spec: AnalysisSpec): AnalysisSpec => makeProto({ ...spec.request, entrypointsLegacy: true })

export const withTypesCompanion: {
  (companion: Package): (spec: AnalysisSpec) => AnalysisSpec
  (spec: AnalysisSpec, companion: Package): AnalysisSpec
} = dual(
  2,
  (spec: AnalysisSpec, companion: Package): AnalysisSpec =>
    makeProto({ ...spec.request, pkg: spec.request.pkg.withOverlay(companion), companion }),
)

export const withModes: {
  (modes: ReadonlyArray<ResolutionKind>): (spec: AnalysisSpec) => AnalysisSpec
  (spec: AnalysisSpec, modes: ReadonlyArray<ResolutionKind>): AnalysisSpec
} = dual(
  2,
  (spec: AnalysisSpec, modes: ReadonlyArray<ResolutionKind>): AnalysisSpec =>
    makeProto({ ...spec.request, modes: [...modes] }),
)
