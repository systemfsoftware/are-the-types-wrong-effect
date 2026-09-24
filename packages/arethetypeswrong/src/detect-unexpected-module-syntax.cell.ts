import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Option } from 'effect'

import { detectUnexpectedModuleSyntax } from './detect-unexpected-module-syntax.workflow.js'
import type { ProblemRun } from './internal/analysis-plan.js'
import type { ObservationQuery } from './internal/entrypoint-observation.js'
import { observeUnexpectedModuleSyntax } from './internal/observe-unexpected-module-syntax.js'
import type { UnexpectedModuleSyntaxObservation } from './Observation.schema.js'
import type { ModuleKind, ModuleKindSyntax, Problem } from './Problem.schema.js'

const noProblems: ReadonlyArray<Problem> = []

const queryOf = (run: ProblemRun): ObservationQuery => ({
  self: run.compiled,
  entrypoint: run.cell.entrypoint,
  resolutionKind: run.cell.resolutionKind,
  resolutionOption: run.cell.resolutionOption,
  fileName: run.fileName,
  node16ModuleKinds: run.cell.node16ModuleKinds,
})

const syntaxProblem = (
  found: {
    readonly fileName: string
    readonly pos: number
    readonly end: number
    readonly syntax: ModuleKindSyntax
    readonly moduleKind: ModuleKind
  },
): Problem => ({
  kind: 'UnexpectedModuleSyntax',
  fileName: found.fileName,
  pos: found.pos,
  end: found.end,
  syntax: found.syntax,
  moduleKind: found.moduleKind,
})

const detectionCell = Sandwich.named('detect.unexpected_module_syntax')(
  (observation: UnexpectedModuleSyntaxObservation) => Effect.succeed({ observation }),
)
  .decide(detectUnexpectedModuleSyntax)
  .write({
    UnexpectedModuleSyntaxFound: (found) => Effect.succeed([syntaxProblem(found)]),
    CommandRejected: () => Effect.succeed(noProblems),
  })

const observedOf = (
  run: ProblemRun,
): Effect.Effect<Option.Option<UnexpectedModuleSyntaxObservation>> =>
  Effect.map(
    observeUnexpectedModuleSyntax(queryOf(run)),
    (observations) => Option.fromNullishOr(observations.find((observation) => observation.fileName === run.fileName)),
  )

export const detectUnexpectedModuleSyntaxCell: Cell.Cell<ProblemRun, ReadonlyArray<Problem>> = Cell.id<ProblemRun>()
  .pipe(
    Cell.flatMap((run) => Cell.fromEffect(observedOf(run))),
    Cell.gate(detectionCell),
    Cell.map(Option.match({ onNone: () => noProblems, onSome: (nested) => nested.flat() })),
  )
