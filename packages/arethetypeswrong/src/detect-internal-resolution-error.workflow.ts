import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Result } from 'effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { InternalResolutionErrorObservation } from './Observation.schema.js'
import { ResolutionOptionSchema } from './Problem.schema.js'

const InternalResolutionErrorProblemTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong/InternalResolutionErrorProblem',
)
type InternalResolutionErrorProblemTypeId = typeof InternalResolutionErrorProblemTypeId

export class InternalResolutionErrorFound extends S.TaggedClass<InternalResolutionErrorFound>()(
  'InternalResolutionErrorFound',
  {
    resolutionOption: ResolutionOptionSchema,
    fileName: S.String,
    moduleSpecifier: S.String,
    pos: S.Finite,
    end: S.Finite,
    resolutionMode: S.optional(S.Finite),
    trace: S.Array(S.String),
  },
) {
  readonly [InternalResolutionErrorProblemTypeId] = InternalResolutionErrorProblemTypeId
}

export const InternalResolutionErrorProblems = S.Array(InternalResolutionErrorFound)
export type InternalResolutionErrorProblems = typeof InternalResolutionErrorProblems.Type

export class DetectInternalResolutionErrorCommand extends S.Class<DetectInternalResolutionErrorCommand>(
  'DetectInternalResolutionErrorCommand',
)({ observation: InternalResolutionErrorObservation }) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const resolutionModeOf = (observation: InternalResolutionErrorObservation): number | undefined =>
  Option.match(Option.fromNullishOr(observation.resolutionMode), {
    onSome: (mode) => mode,
    onNone: () => undefined,
  })

const internalResolutionErrorProblems = (
  observation: InternalResolutionErrorObservation,
): InternalResolutionErrorProblems => [
  new InternalResolutionErrorFound({
    resolutionOption: observation.resolutionOption,
    fileName: observation.fileName,
    moduleSpecifier: observation.moduleSpecifier,
    pos: observation.pos,
    end: observation.end,
    resolutionMode: resolutionModeOf(observation),
    trace: [...observation.trace],
  }),
]

export const detectInternalResolutionError = Workflow.make({
  command: DetectInternalResolutionErrorCommand,
  decision: InternalResolutionErrorProblems,
  error: S.Never,
  decide: (command): Result.Result<InternalResolutionErrorProblems, never> =>
    Result.succeed(internalResolutionErrorProblems(command.observation)),
})
