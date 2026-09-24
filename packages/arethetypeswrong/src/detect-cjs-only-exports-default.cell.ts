import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Option } from 'effect'

import { detectCjsOnlyExportsDefault } from './detect-cjs-only-exports-default.workflow.js'
import type { ProblemRun } from './internal/analysis-plan.js'
import type { ObservationQuery } from './internal/entrypoint-observation.js'
import { observeCjsOnlyExportsDefault } from './internal/observe-cjs-only-exports-default.js'
import type { CJSOnlyExportsDefaultObservation } from './Observation.schema.js'
import type { Problem } from './Problem.schema.js'

const noProblems: ReadonlyArray<Problem> = []

const queryOf = (run: ProblemRun): ObservationQuery => ({
  self: run.compiled,
  entrypoint: run.cell.entrypoint,
  resolutionKind: run.cell.resolutionKind,
  resolutionOption: run.cell.resolutionOption,
  fileName: run.fileName,
  node16ModuleKinds: run.cell.node16ModuleKinds,
})

const fileRangeProblem = (
  found: { readonly fileName: string; readonly pos: number; readonly end: number },
): Problem => ({
  kind: 'CJSOnlyExportsDefault',
  fileName: found.fileName,
  pos: found.pos,
  end: found.end,
})

const detectionCell = Sandwich.named('detect.cjs_only_exports_default')(
  (observation: CJSOnlyExportsDefaultObservation) => Effect.succeed({ observation }),
)
  .decide(detectCjsOnlyExportsDefault)
  .write({
    CjsOnlyExportsDefaultFound: (found) => Effect.succeed([fileRangeProblem(found)]),
    CommandRejected: () => Effect.succeed(noProblems),
  })

const observedOf = (
  run: ProblemRun,
): Effect.Effect<Option.Option<CJSOnlyExportsDefaultObservation>> =>
  Effect.map(observeCjsOnlyExportsDefault(queryOf(run)), (observation) => Option.fromNullishOr(observation))

export const detectCjsOnlyExportsDefaultCell: Cell.Cell<ProblemRun, ReadonlyArray<Problem>> = Cell.id<ProblemRun>()
  .pipe(
    Cell.flatMap((run) => Cell.fromEffect(observedOf(run))),
    Cell.gate(detectionCell),
    Cell.map(Option.match({ onNone: () => noProblems, onSome: (nested) => nested.flat() })),
  )
