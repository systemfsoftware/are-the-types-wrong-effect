import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Option } from 'effect'

import { detectInternalResolutionError } from './detect-internal-resolution-error.workflow.js'
import type { ProblemRun } from './internal/analysis-plan.js'
import type { ObservationQuery } from './internal/entrypoint-observation.js'
import { observeInternalResolutionErrors } from './internal/observe-internal-resolution-errors.js'
import type { InternalResolutionErrorObservation } from './Observation.schema.js'
import type { Problem, ResolutionOption } from './Problem.schema.js'

const noProblems: ReadonlyArray<Problem> = []

const queryOf = (run: ProblemRun): ObservationQuery => ({
  self: run.compiled,
  entrypoint: run.cell.entrypoint,
  resolutionKind: run.cell.resolutionKind,
  resolutionOption: run.cell.resolutionOption,
  fileName: run.fileName,
  node16ModuleKinds: run.cell.node16ModuleKinds,
})

const resolutionProblem = (
  found: {
    readonly resolutionOption: ResolutionOption
    readonly fileName: string
    readonly moduleSpecifier: string
    readonly pos: number
    readonly end: number
    readonly resolutionMode?: number | undefined
    readonly trace: ReadonlyArray<string>
  },
): Problem => ({
  kind: 'InternalResolutionError',
  resolutionOption: found.resolutionOption,
  fileName: found.fileName,
  moduleSpecifier: found.moduleSpecifier,
  pos: found.pos,
  end: found.end,
  ...(found.resolutionMode === undefined ? {} : { resolutionMode: found.resolutionMode }),
  trace: [...found.trace],
})

const detectionCell = Sandwich.named('detect.internal_resolution_error')(
  (observation: InternalResolutionErrorObservation) => Effect.succeed({ observation }),
)
  .decide(detectInternalResolutionError)
  .write({
    InternalResolutionErrorFound: (found) => Effect.succeed([resolutionProblem(found)]),
    CommandRejected: () => Effect.succeed(noProblems),
  })

const observedOf = (
  run: ProblemRun,
): Effect.Effect<Option.Option<InternalResolutionErrorObservation>> =>
  Effect.map(
    observeInternalResolutionErrors(queryOf(run)),
    (observations) => Option.fromNullishOr(observations.find((observation) => observation.fileName === run.fileName)),
  )

export const detectInternalResolutionErrorCell: Cell.Cell<ProblemRun, ReadonlyArray<Problem>> = Cell.id<ProblemRun>()
  .pipe(
    Cell.flatMap((run) => Cell.fromEffect(observedOf(run))),
    Cell.gate(detectionCell),
    Cell.map(Option.match({ onNone: () => noProblems, onSome: (nested) => nested.flat() })),
  )
