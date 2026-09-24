import { Effect, Option } from 'effect'
import { moduleKindOf, resolveModulePair } from '../compiled-package.handle.js'
import type { ResolvedModulePair, ResolvedModuleView } from '../compiled-package.handle.js'
import type { ResolutionObservation } from '../Observation.schema.js'
import type { ModuleKind } from '../Problem.schema.js'
import type { ObservationQuery } from './entrypoint-observation.js'
import { nullOrModuleKind, viewFileName } from './entrypoint-observation.js'

/** @internal */
export const observeResolution = (query: ObservationQuery): Effect.Effect<ResolutionObservation> =>
  Effect.sync(() => resolutionObservation(query, resolveModulePair(query.self, query)))

const resolutionObservation = (query: ObservationQuery, pair: ResolvedModulePair): ResolutionObservation => ({
  entrypoint: query.entrypoint,
  resolutionKind: query.resolutionKind,
  isWildcard: pair.isWildcard,
  typesResolution: resolvedModuleObservation(pair.types),
  implementationResolution: resolvedModuleObservation(pair.implementation),
  node16ModuleKind: node16ModuleKindOf(query, pair),
})

const resolvedModuleObservation = (view: ResolvedModuleView | undefined): ResolutionObservation['typesResolution'] =>
  Option.match(Option.fromNullishOr(view), {
    onNone: () => null,
    onSome: (resolved) => ({
      fileName: resolved.fileName,
      isTypeScript: resolved.isTypeScript,
      isJson: resolved.isJson,
    }),
  })

const node16ModuleKindOf = (query: ObservationQuery, pair: ResolvedModulePair): ModuleKind | null =>
  nullOrModuleKind(
    moduleKindOf(query.self, {
      fileName: implementationOrTypesFileName(pair),
      resolutionOption: 'node16',
    }),
  )

const implementationOrTypesFileName = (pair: ResolvedModulePair): string | undefined =>
  viewFileName(pair.implementation) ?? viewFileName(pair.types)
