import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'

import {
  ExportDefaultDisagreementObservation,
  type ImplementationDefaultFacts,
  ResolvedFileName,
} from './Observation.schema.js'
import { type ModuleKind } from './Problem.schema.js'

const moduleKindSyntax = { esm: 99 } as const

const ExportDefaultDisagreementProblemTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong/ExportDefaultDisagreementProblem',
)
type ExportDefaultDisagreementProblemTypeId = typeof ExportDefaultDisagreementProblemTypeId

export class FalseExportDefaultFound extends S.TaggedClass<FalseExportDefaultFound>()(
  'FalseExportDefaultFound',
  {
    typesFileName: ResolvedFileName,
    implementationFileName: ResolvedFileName,
  },
) {
  readonly [ExportDefaultDisagreementProblemTypeId] = ExportDefaultDisagreementProblemTypeId
}

export class MissingExportEqualsFound extends S.TaggedClass<MissingExportEqualsFound>()(
  'MissingExportEqualsFound',
  {
    typesFileName: ResolvedFileName,
    implementationFileName: ResolvedFileName,
  },
) {
  readonly [ExportDefaultDisagreementProblemTypeId] = ExportDefaultDisagreementProblemTypeId
}

export const ExportDefaultDisagreementProblems = S.Array(
  S.Union([FalseExportDefaultFound, MissingExportEqualsFound]),
)
export type ExportDefaultDisagreementProblems = typeof ExportDefaultDisagreementProblems.Type

export type ExportDefaultDisagreementProblem = FalseExportDefaultFound | MissingExportEqualsFound

export class DetectExportDefaultDisagreementCommand extends S.Class<DetectExportDefaultDisagreementCommand>(
  'DetectExportDefaultDisagreementCommand',
)({ observation: ExportDefaultDisagreementObservation }) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

interface ResolutionFileNames {
  readonly typesFileName: ResolvedFileName
  readonly implementationFileName: ResolvedFileName
}

const moduleKindDetectsEsm = (moduleKind: ModuleKind | null): boolean =>
  Option.match(Option.fromNullishOr(moduleKind), {
    onSome: (kind) => kind.detectedKind === moduleKindSyntax.esm,
    onNone: () => false,
  })

const resolutionDetectsEsm = (observation: ExportDefaultDisagreementObservation): boolean =>
  Match.value({
    types: moduleKindDetectsEsm(observation.typesModuleKind),
    implementation: moduleKindDetectsEsm(observation.implementationModuleKind),
  }).pipe(
    Match.when({ types: false, implementation: false }, () => false),
    Match.orElse(() => true),
  )

const gatheredFileNames = (observation: ExportDefaultDisagreementObservation): Option.Option<ResolutionFileNames> =>
  Option.all({
    typesFileName: Option.fromNullishOr(observation.typesFileName),
    implementationFileName: Option.fromNullishOr(observation.implementationFileName),
  })

const implIsAnalyzable = (implementation: ImplementationDefaultFacts): boolean =>
  Match.value({
    sharesContainer: implementation.exportEqualsSharesContainer,
    analyzableExports: implementation.exportsAreAnalyzable,
  }).pipe(
    Match.when({ sharesContainer: true, analyzableExports: true }, () => true),
    Match.orElse(() => false),
  )

const signaturesMismatch = (observation: ExportDefaultDisagreementObservation): boolean =>
  Match.value({
    exportEqualsIsDefault: observation.implementation.exportEqualsIsExportDefault,
    defaultTypeHasSignatures: observation.types.defaultTypeHasCallOrConstructSignatures,
    moduleExportsTypeHasSignatures: observation.implementation.moduleExportsTypeHasCallOrConstructSignatures,
  }).pipe(
    Match.when({ exportEqualsIsDefault: true, defaultTypeHasSignatures: true }, () => true),
    Match.when({ moduleExportsTypeHasSignatures: true }, () => true),
    Match.orElse(() => false),
  )

const exportEqualsRoute = (observation: ExportDefaultDisagreementObservation): boolean =>
  Match.value({
    typesHasExportEquals: observation.types.hasExportEquals,
    implementationHasExportEquals: observation.implementation.hasExportEquals,
    mismatchedSignatures: signaturesMismatch(observation),
  }).pipe(
    Match.when(
      { typesHasExportEquals: false, implementationHasExportEquals: true, mismatchedSignatures: true },
      () => true,
    ),
    Match.orElse(() => false),
  )

const objectyRoute = (observation: ExportDefaultDisagreementObservation): boolean =>
  Match.value({
    hasNonDefaultValueExport: observation.types.hasNonDefaultValueExport,
    defaultTypeIsObject: observation.types.defaultTypeIsObject,
    implementationHasNonDefaultExport: observation.implementation.hasNonDefaultExport,
  }).pipe(
    Match.when(
      { hasNonDefaultValueExport: false, defaultTypeIsObject: true, implementationHasNonDefaultExport: true },
      () => true,
    ),
    Match.orElse(() => false),
  )

const missingExportEqualsFound = (names: ResolutionFileNames): MissingExportEqualsFound =>
  new MissingExportEqualsFound({
    typesFileName: names.typesFileName,
    implementationFileName: names.implementationFileName,
  })

const detectedProblem = (
  observation: ExportDefaultDisagreementObservation,
  names: ResolutionFileNames,
): Option.Option<ExportDefaultDisagreementProblem> =>
  Match.value({
    implAnalyzable: implIsAnalyzable(observation.implementation),
    implHasDefault: observation.implementation.hasDefault,
    typesHasDefaultExportSymbol: observation.types.hasDefaultExportSymbol,
    typesHasDefaultSymbol: observation.types.hasDefaultSymbol,
    exportEqualsRoute: exportEqualsRoute(observation),
    objectyRoute: objectyRoute(observation),
  }).pipe(
    Match.when(
      { implAnalyzable: true, implHasDefault: false, typesHasDefaultExportSymbol: true },
      (): Option.Option<ExportDefaultDisagreementProblem> =>
        Option.some(
          new FalseExportDefaultFound({
            typesFileName: names.typesFileName,
            implementationFileName: names.implementationFileName,
          }),
        ),
    ),
    Match.when(
      { implAnalyzable: true, implHasDefault: true, typesHasDefaultSymbol: true, exportEqualsRoute: true },
      (): Option.Option<ExportDefaultDisagreementProblem> => Option.some(missingExportEqualsFound(names)),
    ),
    Match.when(
      { implAnalyzable: true, implHasDefault: true, typesHasDefaultSymbol: true, objectyRoute: true },
      (): Option.Option<ExportDefaultDisagreementProblem> => Option.some(missingExportEqualsFound(names)),
    ),
    Match.orElse((): Option.Option<ExportDefaultDisagreementProblem> => Option.none()),
  )

const exportDefaultDisagreementProblems = (
  observation: ExportDefaultDisagreementObservation,
): ExportDefaultDisagreementProblems =>
  Match.value(resolutionDetectsEsm(observation)).pipe(
    Match.when(true, (): ExportDefaultDisagreementProblems => []),
    Match.when(
      false,
      (): ExportDefaultDisagreementProblems =>
        Option.match(Option.flatMap(gatheredFileNames(observation), (names) => detectedProblem(observation, names)), {
          onSome: (problem): ExportDefaultDisagreementProblems => [problem],
          onNone: (): ExportDefaultDisagreementProblems => [],
        }),
    ),
    Match.exhaustive,
  )

export const detectExportDefaultDisagreement = Workflow.make({
  command: DetectExportDefaultDisagreementCommand,
  decision: ExportDefaultDisagreementProblems,
  error: S.Never,
  decide: (command): Result.Result<ExportDefaultDisagreementProblems, never> =>
    Result.succeed(exportDefaultDisagreementProblems(command.observation)),
})
