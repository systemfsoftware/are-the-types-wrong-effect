import { Option } from 'effect'
import { resolveModulePair } from '../compiled-package.handle.js'
import type { FallbackTraceObservation } from '../detect-fallback-condition.workflow.js'
import { ResolutionTracesCollected, ResolutionTracesUnavailable } from '../detect-fallback-condition.workflow.js'
import type { ObservationQuery } from './entrypoint-observation.js'

/** @internal */
export const observeFallbackTrace = (query: ObservationQuery): FallbackTraceObservation =>
  Option.match(Option.fromNullishOr(resolveModulePair(query.self, query).types), {
    onNone: () => new ResolutionTracesUnavailable(),
    onSome: (types) => new ResolutionTracesCollected({ lines: [...types.trace] }),
  })
