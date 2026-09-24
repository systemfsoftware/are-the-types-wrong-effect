import { Analysis } from '@systemfsoftware/arethetypeswrong'
import type { Problem } from '@systemfsoftware/arethetypeswrong'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Result } from 'effect'
import * as S from 'effect/Schema'

import { RenderOutcome } from './run-outcome.schema.js'

interface SuppressionRequest {
  readonly problem: Problem
  readonly ignoredRules: readonly string[]
  readonly ignoredResolutions: readonly string[]
}

const ruleFlagOf = (kind: Problem['kind']): string =>
  Match.value(kind).pipe(
    Match.when('NoResolution', (): string => 'no-resolution'),
    Match.when('UntypedResolution', (): string => 'untyped-resolution'),
    Match.when('FalseCJS', (): string => 'false-cjs'),
    Match.when('FalseESM', (): string => 'false-esm'),
    Match.when('CJSResolvesToESM', (): string => 'cjs-resolves-to-esm'),
    Match.when('FallbackCondition', (): string => 'fallback-condition'),
    Match.when('CJSOnlyExportsDefault', (): string => 'cjs-only-exports-default'),
    Match.when('NamedExports', (): string => 'named-exports'),
    Match.when('FalseExportDefault', (): string => 'false-export-default'),
    Match.when('MissingExportEquals', (): string => 'missing-export-equals'),
    Match.when('UnexpectedModuleSyntax', (): string => 'unexpected-module-syntax'),
    Match.when('InternalResolutionError', (): string => 'internal-resolution-error'),
    Match.exhaustive,
  )

const ignoredByResolution = (request: SuppressionRequest): boolean =>
  Match.value(request.problem).pipe(
    Match.when({ kind: 'NoResolution' }, ({ resolutionKind }) => request.ignoredResolutions.includes(resolutionKind)),
    Match.when({ kind: 'UntypedResolution' }, ({ resolutionKind }) =>
      request.ignoredResolutions.includes(resolutionKind)),
    Match.when({ kind: 'CJSResolvesToESM' }, ({ resolutionKind }) =>
      request.ignoredResolutions.includes(resolutionKind)),
    Match.when({ kind: 'FallbackCondition' }, ({ resolutionKind }) =>
      request.ignoredResolutions.includes(resolutionKind)),
    Match.orElse(() =>
      false
    ),
  )

const isVisibleProblem = (request: SuppressionRequest): boolean =>
  Match.value(request.ignoredRules.includes(ruleFlagOf(request.problem.kind))).pipe(
    Match.when(true, () => false),
    Match.when(false, () => !ignoredByResolution(request)),
    Match.exhaustive,
  )

interface VisibilityRequest {
  readonly problems: readonly Problem[]
  readonly ignoredRules: readonly string[]
  readonly ignoredResolutions: readonly string[]
}

const visibleProblemCount = (request: VisibilityRequest): number =>
  request.problems.filter((problem) =>
    isVisibleProblem({ problem, ignoredRules: request.ignoredRules, ignoredResolutions: request.ignoredResolutions })
  ).length

const hasVisibleProblem = (
  result: Analysis.PackageReport,
  ignoredRules: readonly string[],
  ignoredResolutions: readonly string[],
): boolean =>
  Match.value(result).pipe(
    Match.when({ types: false }, () => false),
    Match.orElse((analysis): boolean =>
      visibleProblemCount({ problems: analysis.problems, ignoredRules, ignoredResolutions }) > 0
    ),
  )

const ExitCodeDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/ExitCodeDecision',
)

type ExitCodeDecisionTypeId = typeof ExitCodeDecisionTypeId

export class SelectExitCodeCommand extends S.TaggedClass<SelectExitCodeCommand>()('SelectExitCodeCommand', {
  outcome: RenderOutcome,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class ExitCodeDecided extends S.TaggedClass<ExitCodeDecided>()('ExitCodeDecided', {
  exitCode: S.Finite,
}) {
  readonly [ExitCodeDecisionTypeId] = ExitCodeDecisionTypeId
}

export class ExitCodeRefused extends S.TaggedClass<ExitCodeRefused>()('ExitCodeRefused', {}) {
  readonly [ExitCodeDecisionTypeId] = ExitCodeDecisionTypeId
}

export type ExitCodeDecision = ExitCodeDecided | ExitCodeRefused

const exitCodeForVisibleProblems = (visible: boolean): number =>
  Match.value(visible).pipe(
    Match.when(true, (): number => 1),
    Match.when(false, (): number => 0),
    Match.exhaustive,
  )

const exitCodeOf = (
  result: Analysis.PackageReport,
  ignoreRules: readonly string[],
  ignoreResolutions: readonly string[],
): number => exitCodeForVisibleProblems(hasVisibleProblem(result, ignoreRules, ignoreResolutions))

export const selectExitCode = Workflow.make({
  command: SelectExitCodeCommand,
  decision: S.Union([ExitCodeDecided, ExitCodeRefused]),
  error: S.Never,
  decide: (command): Result.Result<ExitCodeDecision, never> =>
    Match.value(command.outcome).pipe(
      Match.tag('RefusedRun', () => Result.succeed(new ExitCodeRefused())),
      Match.tag('RenderedRun', (rendered) =>
        Result.succeed(
          new ExitCodeDecided({
            exitCode: exitCodeOf(rendered.result, rendered.ignoreRules, rendered.ignoreResolutions),
          }),
        )),
      Match.exhaustive,
    ),
})
