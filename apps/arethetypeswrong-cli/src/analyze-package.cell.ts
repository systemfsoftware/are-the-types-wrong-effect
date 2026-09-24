import { Analysis } from '@systemfsoftware/arethetypeswrong'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { createPackageFromTarballData } from '@systemfsoftware/npm-package'
import { Data, Effect, Match, Option } from 'effect'

import { AnalysisFailed } from './Failure.schema.js'
import { RefusedRun } from './run-outcome.schema.js'

export interface AnalyzePackageRequest {
  readonly bytes: Uint8Array
  readonly entrypoints: readonly string[] | undefined
  readonly includeEntrypoints: readonly string[]
  readonly excludeEntrypoints: readonly string[]
  readonly entrypointsLegacy: boolean
}

export class AnalyzedPackage extends Data.TaggedClass('AnalyzedPackage')<{
  readonly result: Analysis.PackageReport
}> {}

export type AnalyzePackageAnswer = AnalyzedPackage | RefusedRun

const analysisFailed = (): AnalysisFailed =>
  new AnalysisFailed({
    message: 'The analysis failed before it produced a result.',
    recovery: 'Rerun the same command with --pack on the package directory to rule out a truncated tarball.',
  })

const specOf = (request: AnalyzePackageRequest) => {
  const base = Analysis.make(createPackageFromTarballData(request.bytes))
  const withIncludes = Analysis.includeEntrypoints(base, request.includeEntrypoints)
  const withExcludes = Analysis.excludeEntrypoints(withIncludes, request.excludeEntrypoints)
  const withExplicit = Option.match(Option.fromNullishOr(request.entrypoints), {
    onNone: () => withExcludes,
    onSome: (entrypoints) => Analysis.withEntrypoints(withExcludes, entrypoints),
  })
  return Match.value(request.entrypointsLegacy).pipe(
    Match.when(true, () => Analysis.withLegacyEntrypoints(withExplicit)),
    Match.when(false, () => withExplicit),
    Match.exhaustive,
  )
}

const analyse = (request: AnalyzePackageRequest): Effect.Effect<Analysis.PackageReport, AnalysisFailed> =>
  Effect.catchDefect(
    Effect.flatMap(
      Effect.sync(() => specOf(request).run),
      (run) =>
        run.pipe(
          Effect.mapError(() => analysisFailed()),
          Effect.catchDefect(() => Effect.fail(analysisFailed())),
        ),
    ),
    () => Effect.fail(analysisFailed()),
  )

const answerOf = (
  analysed: Effect.Effect<Analysis.PackageReport, AnalysisFailed>,
): Effect.Effect<AnalyzePackageAnswer> =>
  Effect.match(analysed, {
    onFailure: (failure) => new RefusedRun({ failure }),
    onSuccess: (result) => new AnalyzedPackage({ result }),
  })

export const analyzePackage: Cell.Cell<AnalyzePackageRequest, AnalyzePackageAnswer> = Cell.id<
  AnalyzePackageRequest
>().pipe(
  Cell.flatMap((request) => Cell.fromEffect(answerOf(analyse(request)))),
)
