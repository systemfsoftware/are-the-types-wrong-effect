import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { ResolutionObservation, type ResolvedModule } from './Observation.schema.js'
import { ResolutionKindSchema } from './Problem.schema.js'

const moduleKindSyntax = { esm: 99 } as const

const EntrypointResolutionProblemTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong/EntrypointResolutionProblem',
)
type EntrypointResolutionProblemTypeId = typeof EntrypointResolutionProblemTypeId

export class NoResolutionFound extends S.TaggedClass<NoResolutionFound>()('NoResolutionFound', {
  entrypoint: S.NonEmptyString,
  resolutionKind: ResolutionKindSchema,
}) {
  readonly [EntrypointResolutionProblemTypeId] = EntrypointResolutionProblemTypeId
}

export class UntypedResolutionFound extends S.TaggedClass<UntypedResolutionFound>()('UntypedResolutionFound', {
  entrypoint: S.NonEmptyString,
  resolutionKind: ResolutionKindSchema,
}) {
  readonly [EntrypointResolutionProblemTypeId] = EntrypointResolutionProblemTypeId
}

export class CjsResolvesToEsmFound extends S.TaggedClass<CjsResolvesToEsmFound>()('CjsResolvesToEsmFound', {
  entrypoint: S.NonEmptyString,
  resolutionKind: ResolutionKindSchema,
}) {
  readonly [EntrypointResolutionProblemTypeId] = EntrypointResolutionProblemTypeId
}

export const EntrypointResolutionProblems = S.Array(
  S.Union([NoResolutionFound, UntypedResolutionFound, CjsResolvesToEsmFound]),
)
export type EntrypointResolutionProblems = typeof EntrypointResolutionProblems.Type

export class DetectEntrypointResolutionCommand extends S.Class<DetectEntrypointResolutionCommand>(
  'DetectEntrypointResolutionCommand',
)({ observation: ResolutionObservation }) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const isUntypedModule = (module: ResolvedModule): boolean =>
  Match.value(module.isTypeScript).pipe(
    Match.when(true, () => false),
    Match.when(false, () => !module.isJson),
    Match.exhaustive,
  )

const noResolutionFound = (observation: ResolutionObservation): readonly NoResolutionFound[] =>
  Option.match(Option.fromNullishOr(observation.typesResolution), {
    onSome: () => [],
    onNone: () => [
      new NoResolutionFound({
        entrypoint: observation.entrypoint,
        resolutionKind: observation.resolutionKind,
      }),
    ],
  })

const untypedResolutionFound = (observation: ResolutionObservation): readonly UntypedResolutionFound[] =>
  Option.match(Option.fromNullishOr(observation.typesResolution), {
    onSome: (module) =>
      Match.value(isUntypedModule(module)).pipe(
        Match.when(true, (): readonly UntypedResolutionFound[] => [
          new UntypedResolutionFound({
            entrypoint: observation.entrypoint,
            resolutionKind: observation.resolutionKind,
          }),
        ]),
        Match.when(false, (): readonly UntypedResolutionFound[] => []),
        Match.exhaustive,
      ),
    onNone: () => [],
  })

const resolvedToEsm = (observation: ResolutionObservation): boolean =>
  Option.match(Option.fromNullishOr(observation.node16ModuleKind), {
    onSome: (moduleKind) => moduleKind.detectedKind === moduleKindSyntax.esm,
    onNone: () => false,
  })

const cjsResolvesToEsmFound = (observation: ResolutionObservation): readonly CjsResolvesToEsmFound[] =>
  Match.value({
    commonJs: observation.resolutionKind === 'node16-cjs',
    esm: resolvedToEsm(observation),
  }).pipe(
    Match.when({ commonJs: true, esm: true }, (): readonly CjsResolvesToEsmFound[] => [
      new CjsResolvesToEsmFound({
        entrypoint: observation.entrypoint,
        resolutionKind: observation.resolutionKind,
      }),
    ]),
    Match.orElse((): readonly CjsResolvesToEsmFound[] => []),
  )

const entrypointResolutionProblems = (observation: ResolutionObservation): EntrypointResolutionProblems => [
  ...noResolutionFound(observation),
  ...untypedResolutionFound(observation),
  ...cjsResolvesToEsmFound(observation),
]

export const detectEntrypointResolution = Workflow.make({
  command: DetectEntrypointResolutionCommand,
  decision: EntrypointResolutionProblems,
  error: S.Never,
  decide: (command): Result.Result<EntrypointResolutionProblems, never> =>
    Match.value(command.observation.isWildcard).pipe(
      Match.when(true, (): Result.Result<EntrypointResolutionProblems, never> => Result.succeed([])),
      Match.when(
        false,
        (): Result.Result<EntrypointResolutionProblems, never> =>
          Result.succeed(entrypointResolutionProblems(command.observation)),
      ),
      Match.exhaustive,
    ),
})
