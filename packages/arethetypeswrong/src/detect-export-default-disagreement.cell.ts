import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Option } from 'effect'

import { detectExportDefaultDisagreement } from './detect-export-default-disagreement.workflow.js'
import type { ProblemRun } from './internal/analysis-plan.js'
import type { ObservationQuery } from './internal/entrypoint-observation.js'
import { observeExportDefault } from './internal/observe-export-default.js'
import type { ExportDefaultDisagreementObservation } from './Observation.schema.js'
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

const filePairProblem = (
  kind: 'FalseExportDefault' | 'MissingExportEquals',
  found: { readonly typesFileName: string; readonly implementationFileName: string },
): Problem => ({
  kind,
  typesFileName: found.typesFileName,
  implementationFileName: found.implementationFileName,
})
const detectionCell = Sandwich.named('detect.export_default_disagreement')(
  (observation: ExportDefaultDisagreementObservation) => Effect.succeed({ observation }),
)
  .decide(detectExportDefaultDisagreement)
  .write({
    FalseExportDefaultFound: (found) => Effect.succeed([filePairProblem('FalseExportDefault', found)]),
    MissingExportEqualsFound: (found) => Effect.succeed([filePairProblem('MissingExportEquals', found)]),
    CommandRejected: () => Effect.succeed(noProblems),
  })

export const detectExportDefaultDisagreementCell: Cell.Cell<ProblemRun, ReadonlyArray<Problem>> = Cell.id<ProblemRun>()
  .pipe(
    Cell.flatMap((run) =>
      Cell.fromEffect(
        Effect.map(observeExportDefault(queryOf(run)), (observation) => Option.fromNullishOr(observation)),
      )
    ),
    Cell.gate(detectionCell),
    Cell.map(Option.match({ onNone: () => noProblems, onSome: (nested) => nested.flat() })),
  )
