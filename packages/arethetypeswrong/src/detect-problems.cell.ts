import { Cell } from '@systemfsoftware/effect-cell-types'

import { detectCjsOnlyExportsDefaultCell } from './detect-cjs-only-exports-default.cell.js'
import { detectEntrypointResolutionCell } from './detect-entrypoint-resolution.cell.js'
import { detectExportDefaultDisagreementCell } from './detect-export-default-disagreement.cell.js'
import { detectInternalResolutionErrorCell } from './detect-internal-resolution-error.cell.js'
import { detectModuleKindDisagreementCell } from './detect-module-kind-disagreement.cell.js'
import { detectNamedExportsCell } from './detect-named-exports.cell.js'
import { detectUnexpectedModuleSyntaxCell } from './detect-unexpected-module-syntax.cell.js'
import type { AnalysisPlan, ProblemFamily, ProblemRun } from './internal/analysis-plan.js'
import { runListOf } from './internal/analysis-plan.js'
import { detectedOf, type DetectedProblems } from './internal/report-assembly.js'
import type { Problem } from './Problem.schema.js'

type FamilyCell = Cell.Cell<ProblemRun, ReadonlyArray<Problem>>

const familyCells: Record<ProblemFamily, FamilyCell> = {
  entrypointResolution: detectEntrypointResolutionCell,
  moduleKindDisagreement: detectModuleKindDisagreementCell,
  exportDefaultDisagreement: detectExportDefaultDisagreementCell,
  namedExports: detectNamedExportsCell,
  cjsOnlyExportsDefault: detectCjsOnlyExportsDefaultCell,
  unexpectedModuleSyntax: detectUnexpectedModuleSyntaxCell,
  internalResolutionError: detectInternalResolutionErrorCell,
}

const runCell: FamilyCell = Cell.id<ProblemRun>().pipe(
  Cell.flatMap((run) => familyCells[run.family]),
)

export const detectProblems: Cell.Cell<AnalysisPlan, DetectedProblems> = runCell.pipe(
  Cell.collect((responses) => responses),
  Cell.mapInput((plan: AnalysisPlan) => runListOf(plan)),
  Cell.zipWith(Cell.id<AnalysisPlan>(), (responses, plan) => detectedOf(plan, responses)),
)
