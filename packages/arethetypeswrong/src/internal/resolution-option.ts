import { Match } from 'effect'
import type { ResolutionKind, ResolutionOption } from '../Problem.schema.js'

/** @internal */
export const resolutionOptionOf = (resolutionKind: ResolutionKind): ResolutionOption =>
  Match.value(resolutionKind).pipe(
    Match.when('node16-cjs', () => 'node16' as const),
    Match.when('node16-esm', () => 'node16' as const),
    Match.orElse((kind) => kind),
  )
