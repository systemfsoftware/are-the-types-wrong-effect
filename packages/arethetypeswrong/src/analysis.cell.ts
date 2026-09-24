import { Cell } from '@systemfsoftware/effect-cell-types'
import { Match } from 'effect'

import type { AnalysisError } from './AnalysisError.schema.js'
import type { CompiledTarget } from './compile-package.cell.js'
import { compilePackage } from './compile-package.cell.js'
import { detectProblems } from './detect-problems.cell.js'
import type { AnalysisPlan } from './internal/analysis-plan.js'
import { planOf } from './internal/analysis-plan.js'
import { assembleReport } from './internal/report-assembly.js'
import type { AnalysisRequest, OpenedPackage, PreparedPackage } from './open-package.cell.js'
import { openPackage } from './open-package.cell.js'
import type { PackageReport } from './Report.schema.js'

const observeEntrypoints: Cell.Cell<CompiledTarget, AnalysisPlan> = Cell.id<CompiledTarget>().pipe(
  Cell.flatMap((target) => Cell.fromEffect(planOf(target))),
)

const reportedCell: Cell.Cell<AnalysisPlan, PackageReport> = detectProblems.pipe(
  Cell.zipWith(Cell.id<AnalysisPlan>(), (detected, plan) => assembleReport(plan, detected)),
)

const typedPipeline: Cell.Cell<PreparedPackage, PackageReport, AnalysisError> = compilePackage.pipe(
  Cell.andThen(observeEntrypoints),
  Cell.andThen(reportedCell),
)

export const analyse: Cell.Cell<AnalysisRequest, PackageReport, AnalysisError> = openPackage.pipe(
  Cell.andThen((outcome: OpenedPackage) =>
    Match.value(outcome).pipe(
      Match.tag('Untyped', ({ report }) => Cell.succeed<PackageReport, OpenedPackage>(report)),
      Match.tag('Prepared', ({ prepared }) => typedPipeline.pipe(Cell.mapInput((_outcome: OpenedPackage) => prepared))),
      Match.exhaustive,
    )
  ),
)
