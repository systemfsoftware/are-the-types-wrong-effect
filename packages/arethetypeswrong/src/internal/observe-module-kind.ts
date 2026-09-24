import { Match } from 'effect'
import { moduleKindOf, resolveModulePair } from '../compiled-package.handle.js'
import type { CompiledPackage } from '../compiled-package.handle.js'
import type { ModuleKindObservation } from '../detect-module-kind-disagreement.workflow.js'
import {
  ModuleKindObservationComplete,
  ModuleKindObservationMissing,
} from '../detect-module-kind-disagreement.workflow.js'
import type { ModuleKind } from '../Problem.schema.js'
import type { ObservationQuery } from './entrypoint-observation.js'
import { viewFileName } from './entrypoint-observation.js'
import { resolutionOptionOf } from './resolution-option.js'

/** @internal */
export const observeModuleKind = (query: ObservationQuery): ModuleKindObservation =>
  observationOf(rawObservationOf(query.self, query.entrypoint, query.resolutionKind))

interface RawModuleKindObservation {
  readonly typesFileName: string | undefined
  readonly implementationFileName: string | undefined
  readonly typesModuleKind: ModuleKind | undefined
  readonly implementationModuleKind: ModuleKind | undefined
}

const observationOf = (raw: RawModuleKindObservation): ModuleKindObservation =>
  Match.value(raw).pipe(
    Match.when(
      {
        typesFileName: Match.nonEmptyString,
        implementationFileName: Match.nonEmptyString,
        typesModuleKind: Match.defined,
        implementationModuleKind: Match.defined,
      },
      (complete) => new ModuleKindObservationComplete(complete),
    ),
    Match.orElse(() => new ModuleKindObservationMissing()),
  )

const rawObservationOf = (
  self: CompiledPackage,
  entrypoint: string,
  resolutionKind: ObservationQuery['resolutionKind'],
): RawModuleKindObservation => {
  const pair = resolveModulePair(self, { entrypoint, resolutionKind })
  const resolutionOption = resolutionOptionOf(resolutionKind)
  return {
    typesFileName: viewFileName(pair.types),
    implementationFileName: viewFileName(pair.implementation),
    typesModuleKind: moduleKindOf(self, { fileName: viewFileName(pair.types), resolutionOption }),
    implementationModuleKind: moduleKindOf(self, { fileName: viewFileName(pair.implementation), resolutionOption }),
  }
}
