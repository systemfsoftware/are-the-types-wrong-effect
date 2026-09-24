import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import { NamedExportsObservation, ResolvedFileName } from './Observation.schema.js'
import { type ModuleKind } from './Problem.schema.js'

const moduleKindSyntax = { commonJs: 1 } as const

const NamedExportsProblemTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong/NamedExportsProblem',
)
type NamedExportsProblemTypeId = typeof NamedExportsProblemTypeId

export class NamedExportsFound extends S.TaggedClass<NamedExportsFound>()('NamedExportsFound', {
  typesFileName: ResolvedFileName,
  implementationFileName: ResolvedFileName,
  isMissingAllNamed: S.Boolean,
  missing: S.Array(S.String),
}) {
  readonly [NamedExportsProblemTypeId] = NamedExportsProblemTypeId
}

export const NamedExportsProblems = S.Array(NamedExportsFound)
export type NamedExportsProblems = typeof NamedExportsProblems.Type

export class DetectNamedExportsCommand extends S.Class<DetectNamedExportsCommand>(
  'DetectNamedExportsCommand',
)({ observation: NamedExportsObservation }) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

interface ComparableNames {
  readonly typesFileName: ResolvedFileName
  readonly implementationFileName: ResolvedFileName
  readonly expected: readonly string[]
  readonly implementation: readonly string[]
}

const node16EsmCommonJsPair = (
  observation: NamedExportsObservation,
  typesModuleKind: ModuleKind,
  implementationModuleKind: ModuleKind,
): boolean =>
  Match.value({
    node16Esm: observation.resolutionKind === 'node16-esm',
    typesCommonJs: typesModuleKind.detectedKind === moduleKindSyntax.commonJs,
    implementationCommonJs: implementationModuleKind.detectedKind === moduleKindSyntax.commonJs,
    notArrayLikeModule: observation.typesIsArrayLikeModule === false,
  }).pipe(
    Match.when(
      { node16Esm: true, typesCommonJs: true, implementationCommonJs: true, notArrayLikeModule: true },
      () => true,
    ),
    Match.orElse(() => false),
  )

const comparableNames = (observation: NamedExportsObservation): Option.Option<ComparableNames> =>
  Option.filter(
    Option.all({
      typesFileName: Option.fromNullishOr(observation.typesFileName),
      implementationFileName: Option.fromNullishOr(observation.implementationFileName),
      typesModuleKind: Option.fromNullishOr(observation.typesModuleKind),
      implementationModuleKind: Option.fromNullishOr(observation.implementationModuleKind),
      expected: Option.fromNullishOr(observation.typesValueExportNames),
      implementation: Option.fromNullishOr(observation.implementationExportNames),
    }),
    ({ typesModuleKind, implementationModuleKind }) =>
      node16EsmCommonJsPair(observation, typesModuleKind, implementationModuleKind),
  )

const missingExports = (expected: readonly string[], implementation: readonly string[]): readonly string[] =>
  expected.filter((name) => !implementation.includes(name))

const countWithoutDefault = (names: readonly string[]): number =>
  Match.value(names.includes('default')).pipe(
    Match.when(true, () => names.length - 1),
    Match.when(false, () => names.length),
    Match.exhaustive,
  )

const namedExportsProblems = (observation: NamedExportsObservation): NamedExportsProblems =>
  Option.match(comparableNames(observation), {
    onSome: ({ typesFileName, implementationFileName, expected, implementation }): NamedExportsProblems => {
      const missing = missingExports(expected, implementation)
      return Match.value(missing.length === 0).pipe(
        Match.when(true, (): NamedExportsProblems => []),
        Match.when(
          false,
          (): NamedExportsProblems => [
            new NamedExportsFound({
              typesFileName,
              implementationFileName,
              isMissingAllNamed: countWithoutDefault(missing) === countWithoutDefault(expected),
              missing: [...missing],
            }),
          ],
        ),
        Match.exhaustive,
      )
    },
    onNone: (): NamedExportsProblems => [],
  })

export const detectNamedExports = Workflow.make({
  command: DetectNamedExportsCommand,
  decision: NamedExportsProblems,
  error: S.Never,
  decide: (command): Result.Result<NamedExportsProblems, never> =>
    Result.succeed(namedExportsProblems(command.observation)),
})
