import { Option } from 'effect'
import { dual } from 'effect/Function'

import type { EntrypointResolutionAnalysis, Problem, ResolutionKind } from '../Problem.schema.js'
import type { PackageReport } from '../Report.schema.js'
import type { EntrypointInfo } from '../Resolution.schema.js'
import type { AnalysisPlan, ProblemRun } from './analysis-plan.js'
import { runListOf } from './analysis-plan.js'
import { dedupeKeyOf } from './problem-keys.js'

/** @internal */
export interface DetectedProblems {
  readonly problems: ReadonlyArray<Problem>
  readonly visible: ReadonlyArray<ReadonlyArray<number> | undefined>
}

interface FoldState {
  readonly problems: ReadonlyArray<Problem>
  readonly recorded: Record<string, ReadonlyArray<number>>
  readonly visible: ReadonlyArray<ReadonlyArray<number>>
}

const noProblems: ReadonlyArray<Problem> = []

const recordedIndices = (state: FoldState, run: ProblemRun): Option.Option<ReadonlyArray<number>> =>
  Option.fromNullishOr(state.recorded[dedupeKeyOf(run.cell, run.family, run.fileName)])

const visibleWith = (
  state: FoldState,
  cellIndex: number,
  indices: ReadonlyArray<number>,
): ReadonlyArray<ReadonlyArray<number>> =>
  state.visible.map((slot, index) => (index === cellIndex ? [...slot, ...indices] : slot))

const freshFold = (state: FoldState, run: ProblemRun, found: ReadonlyArray<Problem>): FoldState => {
  const offset = state.problems.length
  const indices = found.map((_, position) => offset + position)
  const key = dedupeKeyOf(run.cell, run.family, run.fileName)
  return {
    problems: [...state.problems, ...found],
    recorded: { ...state.recorded, [key]: indices },
    visible: visibleWith(state, run.cellIndex, indices),
  }
}

const fold = (state: FoldState, run: ProblemRun, found: ReadonlyArray<Problem>): FoldState =>
  Option.match(recordedIndices(state, run), {
    onSome: (indices) => ({ ...state, visible: visibleWith(state, run.cellIndex, indices) }),
    onNone: () => freshFold(state, run, found),
  })

/** @internal */
export const detectedOf: {
  (plan: AnalysisPlan, responses: ReadonlyArray<ReadonlyArray<Problem>>): DetectedProblems
  (responses: ReadonlyArray<ReadonlyArray<Problem>>): (plan: AnalysisPlan) => DetectedProblems
} = dual(2, (plan: AnalysisPlan, responses: ReadonlyArray<ReadonlyArray<Problem>>): DetectedProblems => {
  const initial: FoldState = { problems: [], recorded: {}, visible: plan.cells.map(() => []) }
  const state = runListOf(plan).reduce(
    (folded, run, index) => fold(folded, run, responses[index] ?? noProblems),
    initial,
  )
  return { problems: state.problems, visible: state.visible }
})

const withVisible = (
  resolution: EntrypointResolutionAnalysis,
  visible: ReadonlyArray<number> | undefined,
): EntrypointResolutionAnalysis => visible === undefined ? resolution : { ...resolution, visibleProblems: visible }

const slotVisible = (
  plan: AnalysisPlan,
  detected: DetectedProblems,
  subpath: string,
  kind: ResolutionKind,
): ReadonlyArray<number> | undefined => {
  const index = plan.cells.findIndex((cell) => cell.entrypoint === subpath && cell.resolutionKind === kind)
  return index === -1 ? undefined : detected.visible[index]
}

const entrypointsWithVisible = (
  plan: AnalysisPlan,
  detected: DetectedProblems,
): Record<string, EntrypointInfo> =>
  Object.fromEntries(
    Object.entries(plan.entrypoints).map(([subpath, info]) => [
      subpath,
      infoWithVisible(plan, detected, subpath, info),
    ]),
  )

const infoWithVisible = (
  plan: AnalysisPlan,
  detected: DetectedProblems,
  subpath: string,
  info: EntrypointInfo,
): EntrypointInfo => ({
  ...info,
  resolutions: {
    node10: withVisible(info.resolutions.node10, slotVisible(plan, detected, subpath, 'node10')),
    'node16-cjs': withVisible(
      info.resolutions['node16-cjs'],
      slotVisible(plan, detected, subpath, 'node16-cjs'),
    ),
    'node16-esm': withVisible(
      info.resolutions['node16-esm'],
      slotVisible(plan, detected, subpath, 'node16-esm'),
    ),
    bundler: withVisible(info.resolutions.bundler, slotVisible(plan, detected, subpath, 'bundler')),
  },
})

/** @internal */
export const assembleReport: {
  (plan: AnalysisPlan, detected: DetectedProblems): PackageReport
  (detected: DetectedProblems): (plan: AnalysisPlan) => PackageReport
} = dual(2, (plan: AnalysisPlan, detected: DetectedProblems): PackageReport => ({
  packageName: plan.packageName,
  packageVersion: plan.packageVersion,
  buildTools: plan.buildTools,
  types: plan.types,
  entrypoints: entrypointsWithVisible(plan, detected),
  programInfo: plan.programInfo,
  problems: [...detected.problems],
}))
