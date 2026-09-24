import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { UnexpectedModuleSyntaxObservation } from './Observation.schema.js'
import { ModuleKindSchema, type ModuleKindSyntax, ModuleKindSyntaxSchema } from './Problem.schema.js'

const UnexpectedModuleSyntaxProblemTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong/UnexpectedModuleSyntaxProblem',
)
type UnexpectedModuleSyntaxProblemTypeId = typeof UnexpectedModuleSyntaxProblemTypeId

export class UnexpectedModuleSyntaxFound extends S.TaggedClass<UnexpectedModuleSyntaxFound>()(
  'UnexpectedModuleSyntaxFound',
  {
    fileName: S.String,
    pos: S.Finite,
    end: S.Finite,
    syntax: ModuleKindSyntaxSchema,
    moduleKind: ModuleKindSchema,
  },
) {
  readonly [UnexpectedModuleSyntaxProblemTypeId] = UnexpectedModuleSyntaxProblemTypeId
}

export const UnexpectedModuleSyntaxProblems = S.Array(UnexpectedModuleSyntaxFound)
export type UnexpectedModuleSyntaxProblems = typeof UnexpectedModuleSyntaxProblems.Type

export class DetectUnexpectedModuleSyntaxCommand extends S.Class<DetectUnexpectedModuleSyntaxCommand>(
  'DetectUnexpectedModuleSyntaxCommand',
)({ observation: UnexpectedModuleSyntaxObservation }) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

interface IndicatorRange {
  readonly pos: number
  readonly end: number
}

const impliedSyntaxDisagrees = (observation: UnexpectedModuleSyntaxObservation): Option.Option<ModuleKindSyntax> =>
  Option.filter(
    Option.fromNullishOr(observation.impliedSyntax),
    (implied) =>
      Match.value(implied === observation.expectedModuleKind.detectedKind).pipe(
        Match.when(true, () => false),
        Match.when(false, () => true),
        Match.exhaustive,
      ),
  )

const indicatorRange = (observation: UnexpectedModuleSyntaxObservation): Option.Option<IndicatorRange> =>
  Option.all({
    pos: Option.fromNullishOr(observation.pos),
    end: Option.fromNullishOr(observation.end),
  })

const unexpectedModuleSyntaxProblems = (
  observation: UnexpectedModuleSyntaxObservation,
): UnexpectedModuleSyntaxProblems =>
  Option.match(Option.all({ syntax: impliedSyntaxDisagrees(observation), range: indicatorRange(observation) }), {
    onSome: ({ syntax, range }): UnexpectedModuleSyntaxProblems => [
      new UnexpectedModuleSyntaxFound({
        fileName: observation.fileName,
        pos: range.pos,
        end: range.end,
        syntax,
        moduleKind: observation.expectedModuleKind,
      }),
    ],
    onNone: (): UnexpectedModuleSyntaxProblems => [],
  })

export const detectUnexpectedModuleSyntax = Workflow.make({
  command: DetectUnexpectedModuleSyntaxCommand,
  decision: UnexpectedModuleSyntaxProblems,
  error: S.Never,
  decide: (command): Result.Result<UnexpectedModuleSyntaxProblems, never> =>
    Result.succeed(unexpectedModuleSyntaxProblems(command.observation)),
})
