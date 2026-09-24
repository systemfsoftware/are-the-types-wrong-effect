import { Analysis } from '@systemfsoftware/arethetypeswrong'
import type { Problem } from '@systemfsoftware/arethetypeswrong'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Result } from 'effect'
import * as S from 'effect/Schema'

import type { CliProblemFlag } from './ProblemUtils.js'
import { RenderOutcome } from './run-outcome.schema.js'

interface SuppressionRequest {
  readonly problem: Problem
  readonly ignoredRules: readonly string[]
  readonly ignoredResolutions: readonly string[]
}

const ruleFlagOf = (kind: Problem['kind']): CliProblemFlag =>
  Match.value(kind).pipe(
    Match.when('NoResolution', (): CliProblemFlag => 'no-resolution'),
    Match.when('UntypedResolution', (): CliProblemFlag => 'untyped-resolution'),
    Match.when('FalseCJS', (): CliProblemFlag => 'false-cjs'),
    Match.when('FalseESM', (): CliProblemFlag => 'false-esm'),
    Match.when('CJSResolvesToESM', (): CliProblemFlag => 'cjs-resolves-to-esm'),
    Match.when('FallbackCondition', (): CliProblemFlag => 'fallback-condition'),
    Match.when('CJSOnlyExportsDefault', (): CliProblemFlag => 'cjs-only-exports-default'),
    Match.when('NamedExports', (): CliProblemFlag => 'named-exports'),
    Match.when('FalseExportDefault', (): CliProblemFlag => 'false-export-default'),
    Match.when('MissingExportEquals', (): CliProblemFlag => 'missing-export-equals'),
    Match.when('UnexpectedModuleSyntax', (): CliProblemFlag => 'unexpected-module-syntax'),
    Match.when('InternalResolutionError', (): CliProblemFlag => 'internal-resolution-error'),
    Match.exhaustive,
  )

const problemResolutionKindOf = (problem: Problem): string =>
  Match.value(problem).pipe(
    Match.when({ kind: 'NoResolution' }, ({ resolutionKind }): string => resolutionKind),
    Match.when({ kind: 'UntypedResolution' }, ({ resolutionKind }): string => resolutionKind),
    Match.when({ kind: 'CJSResolvesToESM' }, ({ resolutionKind }): string => resolutionKind),
    Match.when({ kind: 'FallbackCondition' }, ({ resolutionKind }): string => resolutionKind),
    Match.orElse((): string => ''),
  )

const isVisibleProblem = (request: SuppressionRequest): boolean =>
  Match.value({
    rule: request.ignoredRules.includes(ruleFlagOf(request.problem.kind)),
    resolution: request.ignoredResolutions.includes(problemResolutionKindOf(request.problem)),
  }).pipe(
    Match.when({ rule: true }, (): boolean => false),
    Match.when({ resolution: true }, (): boolean => false),
    Match.orElse((): boolean => true),
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
