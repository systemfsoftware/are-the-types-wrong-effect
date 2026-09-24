import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Option } from 'effect'

import { detectNamedExports } from './detect-named-exports.workflow.js'
import type { ProblemRun } from './internal/analysis-plan.js'
import type { ObservationQuery } from './internal/entrypoint-observation.js'
import { observeNamedExports } from './internal/observe-named-exports.js'
import type { NamedExportsObservation } from './Observation.schema.js'
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

const namedExportsProblem = (
  found: {
    readonly typesFileName: string
    readonly implementationFileName: string
    readonly isMissingAllNamed: boolean
    readonly missing: ReadonlyArray<string>
  },
): Problem => ({
  kind: 'NamedExports',
  typesFileName: found.typesFileName,
  implementationFileName: found.implementationFileName,
  isMissingAllNamed: found.isMissingAllNamed,
  missing: [...found.missing],
})

const detectionCell = Sandwich.named('detect.named_exports')(
  (observation: NamedExportsObservation) => Effect.succeed({ observation }),
)
  .decide(detectNamedExports)
  .write({
    NamedExportsFound: (found) => Effect.succeed([namedExportsProblem(found)]),
    CommandRejected: () => Effect.succeed(noProblems),
  })

export const detectNamedExportsCell: Cell.Cell<ProblemRun, ReadonlyArray<Problem>> = Cell.id<ProblemRun>()
  .pipe(
    Cell.flatMap((run) =>
      Cell.fromEffect(Effect.map(observeNamedExports(queryOf(run)), (observation) => Option.fromNullishOr(observation)))
    ),
    Cell.gate(detectionCell),
    Cell.map(Option.match({ onNone: () => noProblems, onSome: (nested) => nested.flat() })),
  )
