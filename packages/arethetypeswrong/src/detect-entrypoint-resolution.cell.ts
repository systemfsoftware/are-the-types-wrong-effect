import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Option } from 'effect'

import { detectEntrypointResolution } from './detect-entrypoint-resolution.workflow.js'
import { detectFallbackCondition } from './detect-fallback-condition.workflow.js'
import type { ProblemRun } from './internal/analysis-plan.js'
import type { ObservationQuery } from './internal/entrypoint-observation.js'
import { observeFallbackTrace } from './internal/observe-fallback-trace.js'
import { observeResolution } from './internal/observe-resolution.js'
import type { ResolutionObservation } from './Observation.schema.js'
import type { Problem, ResolutionKind } from './Problem.schema.js'

const noProblems: ReadonlyArray<Problem> = []

const queryOf = (run: ProblemRun): ObservationQuery => ({
  self: run.compiled,
  entrypoint: run.cell.entrypoint,
  resolutionKind: run.cell.resolutionKind,
  resolutionOption: run.cell.resolutionOption,
  fileName: run.fileName,
  node16ModuleKinds: run.cell.node16ModuleKinds,
})

const entrypointProblem = (
  kind: 'NoResolution' | 'UntypedResolution' | 'CJSResolvesToESM',
  found: { readonly entrypoint: string; readonly resolutionKind: ResolutionKind },
): Problem => ({ kind, entrypoint: found.entrypoint, resolutionKind: found.resolutionKind })

const fallbackProblem = (run: ProblemRun): Problem => ({
  kind: 'FallbackCondition',
  entrypoint: run.cell.entrypoint,
  resolutionKind: run.cell.resolutionKind,
})

const resolutionCell = Sandwich.named('detect.entrypoint_resolution')(
  (observation: ResolutionObservation) => Effect.succeed({ observation }),
)
  .decide(detectEntrypointResolution)
  .write({
    NoResolutionFound: (found) => Effect.succeed([entrypointProblem('NoResolution', found)]),
    UntypedResolutionFound: (found) => Effect.succeed([entrypointProblem('UntypedResolution', found)]),
    CjsResolvesToEsmFound: (found) => Effect.succeed([entrypointProblem('CJSResolvesToESM', found)]),
    CommandRejected: () => Effect.succeed(noProblems),
  })
  .pipe(Cell.map((nested) => nested.flat()))

const observedResolutionOf = (run: ProblemRun): Effect.Effect<Option.Option<ResolutionObservation>> =>
  Effect.map(observeResolution(queryOf(run)), (observation) => Option.fromNullishOr(observation))

const observedResolutionCell = Cell.id<ProblemRun>().pipe(
  Cell.flatMap((run) => Cell.fromEffect(observedResolutionOf(run))),
  Cell.gate(resolutionCell),
  Cell.map(Option.match({ onNone: () => noProblems, onSome: (nested) => nested.flat() })),
)

const fallbackCell = Sandwich.named('detect.fallback_condition')((run: ProblemRun) =>
  Effect.succeed({ observation: observeFallbackTrace(queryOf(run)), run })
)
  .decide(detectFallbackCondition)
  .write({
    FallbackConditionDetected: (_detected, command) => Effect.succeed([fallbackProblem(command.run)]),
    FallbackConditionAbsent: () => Effect.succeed(noProblems),
    ResolutionTraceUnavailable: () => Effect.succeed(noProblems),
    CommandRejected: () => Effect.succeed(noProblems),
  })

export const detectEntrypointResolutionCell: Cell.Cell<ProblemRun, ReadonlyArray<Problem>> = observedResolutionCell
  .pipe(
    Cell.zipWith(fallbackCell, (resolved, fallback) => [...resolved, ...fallback]),
  )
