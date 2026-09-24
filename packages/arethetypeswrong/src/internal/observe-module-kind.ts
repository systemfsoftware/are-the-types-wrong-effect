import { Option } from 'effect'
import { resolveModulePair } from '../compiled-package.handle.js'
import type { ModuleKindObservation } from '../detect-module-kind-disagreement.workflow.js'
import {
  ModuleKindObservationComplete,
  ModuleKindObservationMissing,
} from '../detect-module-kind-disagreement.workflow.js'
import type { ModuleKind } from '../Problem.schema.js'
import type { ObservationQuery } from './entrypoint-observation.js'
import { viewFileName } from './entrypoint-observation.js'

/** @internal */
export const observeModuleKind = (query: ObservationQuery): ModuleKindObservation =>
  Option.match(completeObservationOf(query), {
    onNone: () => new ModuleKindObservationMissing(),
    onSome: (observation) => observation,
  })

const completeObservationOf = (query: ObservationQuery): Option.Option<ModuleKindObservationComplete> => {
  if (query.resolutionOption !== 'node16') {
    return Option.none()
  }
  const planModuleKinds = query.node16ModuleKinds
  const pair = resolveModulePair(query.self, { entrypoint: query.entrypoint, resolutionKind: query.resolutionKind })
  return Option.flatMap(
    Option.all({
      kinds: Option.fromNullishOr(planModuleKinds),
      typesFileName: Option.fromNullishOr(viewFileName(pair.types)),
      implementationFileName: Option.fromNullishOr(viewFileName(pair.implementation)),
    }),
    completeOf,
  )
}

const completeOf = (table: {
  readonly kinds: Record<string, ModuleKind>
  readonly typesFileName: string
  readonly implementationFileName: string
}): Option.Option<ModuleKindObservationComplete> =>
  Option.map(
    Option.all({
      typesModuleKind: Option.fromNullishOr(table.kinds[table.typesFileName]),
      implementationModuleKind: Option.fromNullishOr(table.kinds[table.implementationFileName]),
    }),
    ({ typesModuleKind, implementationModuleKind }) =>
      new ModuleKindObservationComplete({
        typesFileName: table.typesFileName,
        implementationFileName: table.implementationFileName,
        typesModuleKind,
        implementationModuleKind,
      }),
  )
