import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect } from 'effect'

import { Option } from 'effect'
import { detectModuleKindDisagreement, type ModuleKindObservation } from './detect-module-kind-disagreement.workflow.js'
import type { ProblemRun } from './internal/analysis-plan.js'
import type { ObservationQuery } from './internal/entrypoint-observation.js'
import { observeModuleKind } from './internal/observe-module-kind.js'
import type { ModuleKind, Problem } from './Problem.schema.js'

const noProblems: ReadonlyArray<Problem> = []

const queryOf = (run: ProblemRun): ObservationQuery => ({
  self: run.compiled,
  entrypoint: run.cell.entrypoint,
  resolutionKind: run.cell.resolutionKind,
  resolutionOption: run.cell.resolutionOption,
  fileName: run.fileName,
  node16ModuleKinds: run.cell.node16ModuleKinds,
})

const masqueradeProblem = (
  kind: 'FalseESM' | 'FalseCJS',
  declared: {
    readonly typesFileName: string
    readonly implementationFileName: string
    readonly typesModuleKind: ModuleKind
    readonly implementationModuleKind: ModuleKind
  },
): Problem => ({
  kind,
  typesFileName: declared.typesFileName,
  implementationFileName: declared.implementationFileName,
  typesModuleKind: declared.typesModuleKind,
  implementationModuleKind: declared.implementationModuleKind,
})

const detectionCell = Sandwich.named('detect.module_kind_disagreement')(
  (observation: ModuleKindObservation) => Effect.succeed({ observation }),
)
  .decide(detectModuleKindDisagreement)
  .write({
    FalseEsmDeclared: (declared) => Effect.succeed([masqueradeProblem('FalseESM', declared)]),
    FalseCjsDeclared: (declared) => Effect.succeed([masqueradeProblem('FalseCJS', declared)]),
    ModuleKindsAgree: () => Effect.succeed(noProblems),
    ModuleKindObservationUnavailable: () => Effect.succeed(noProblems),
    CommandRejected: () => Effect.succeed(noProblems),
  })

export const detectModuleKindDisagreementCell: Cell.Cell<ProblemRun, ReadonlyArray<Problem>> = Cell.id<ProblemRun>()
  .pipe(
    Cell.flatMap((run) => Cell.fromEffect(Effect.succeedSome(observeModuleKind(queryOf(run))))),
    Cell.gate(detectionCell),
    Cell.map(Option.match({ onNone: () => noProblems, onSome: (nested) => nested.flat() })),
  )
