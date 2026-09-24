import { Analysis } from '@systemfsoftware/arethetypeswrong'
import type { Problem, ProblemKind } from '@systemfsoftware/arethetypeswrong'
import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Option, Result } from 'effect'
import * as S from 'effect/Schema'

import {
  type MachineEnvelope,
  MachineEnvelopeSchema,
  type MaskedProblem,
  type OkEnvelope,
} from './decode-envelope-document.workflow.js'
import { AttwFailureSchema } from './Failure.schema.js'
import type { EnvelopeMask } from './Mask.js'
import { AnalyzedRun, RunOutcome } from './run-outcome.schema.js'
import { type RenderMode, RenderModeSchema } from './select-render-mode.workflow.js'
import { TerminalObservations } from './TerminalError.schema.js'

interface RenderPolicyRequest {
  readonly requestedFormat: string
  readonly quiet: boolean
  readonly isTty: boolean
  readonly terminalWidth: number
}

interface RenderPolicyAnswer {
  readonly mode: 'quiet' | 'envelope' | 'table' | 'table-flipped' | 'ascii'
}

const autoWidthPolicy = (terminalWidth: number): RenderPolicyAnswer =>
  Match.value(terminalWidth >= 100).pipe(
    Match.when(true, (): RenderPolicyAnswer => ({ mode: 'table-flipped' })),
    Match.when(false, (): RenderPolicyAnswer => ({ mode: 'ascii' })),
    Match.exhaustive,
  )

const renderPolicyOf = (request: RenderPolicyRequest): Option.Option<RenderPolicyAnswer> =>
  Match.value(request).pipe(
    Match.when({ quiet: true }, (): Option.Option<RenderPolicyAnswer> => Option.some({ mode: 'quiet' })),
    Match.when({ requestedFormat: 'json' }, (): Option.Option<RenderPolicyAnswer> => Option.some({ mode: 'envelope' })),
    Match.when({ requestedFormat: 'table' }, (): Option.Option<RenderPolicyAnswer> => Option.some({ mode: 'table' })),
    Match.when({ requestedFormat: 'table-flipped' }, (): Option.Option<RenderPolicyAnswer> =>
      Option.some({ mode: 'table-flipped' })),
    Match.when({ requestedFormat: 'ascii' }, (): Option.Option<RenderPolicyAnswer> =>
      Option.some({ mode: 'ascii' })),
    Match.when({ requestedFormat: 'auto', isTty: false }, (): Option.Option<RenderPolicyAnswer> =>
      Option.some({ mode: 'envelope' })),
    Match.when({ requestedFormat: 'auto', isTty: true }, (auto): Option.Option<RenderPolicyAnswer> =>
      Option.some(autoWidthPolicy(auto.terminalWidth))),
    Match.orElse((): Option.Option<RenderPolicyAnswer> =>
      Option.none()
    ),
  )

const policyOf = (request: RenderPolicyRequest): RenderPolicyAnswer =>
  Option.match(renderPolicyOf(request), {
    onNone: (): RenderPolicyAnswer => ({ mode: 'envelope' }),
    onSome: (policy): RenderPolicyAnswer => policy,
  })

export class RenderReportCommand extends S.TaggedClass<RenderReportCommand>()('RenderReportCommand', {
  outcome: RunOutcome,
  observations: TerminalObservations,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

const decidedRenderMode = (command: RenderReportCommand, analyzed: AnalyzedRun) =>
  policyOf({
    requestedFormat: analyzed.format,
    quiet: analyzed.quiet,
    isTty: command.observations.isTty,
    terminalWidth: command.observations.width,
  }).mode

const problemFlagOf = (kind: ProblemKind): string =>
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

const presentResolutionKind = (problem: Problem): string =>
  Match.value(problem).pipe(
    Match.when({ kind: 'NoResolution' }, ({ resolutionKind }): string => resolutionKind),
    Match.when({ kind: 'UntypedResolution' }, ({ resolutionKind }): string => resolutionKind),
    Match.when({ kind: 'CJSResolvesToESM' }, ({ resolutionKind }): string => resolutionKind),
    Match.when({ kind: 'FallbackCondition' }, ({ resolutionKind }): string => resolutionKind),
    Match.orElse((): string => ''),
  )

const carriedResolutionKind = (problem: Problem): string | undefined => presentResolutionKind(problem)

const definedResolutionKind = (kind: string | undefined): string =>
  Match.value(kind).pipe(
    Match.when(undefined, (): string => ''),
    Match.orElse((present): string => present),
  )

const resolutionKindOf = (problem: Problem): string => definedResolutionKind(carriedResolutionKind(problem))

const ignoredRuleOf = (problem: Problem, ignoredRules: readonly string[]): boolean =>
  ignoredRules.includes(problemFlagOf(problem.kind))

const ignoredResolutionOf = (problem: Problem, ignoredResolutions: readonly string[]): boolean =>
  ignoredResolutions.includes(resolutionKindOf(problem))

const isIgnoredProblemOf = (
  problem: Problem,
  ignoredRules: readonly string[],
  ignoredResolutions: readonly string[],
): boolean =>
  Match.value({
    rule: ignoredRuleOf(problem, ignoredRules),
    resolution: ignoredResolutionOf(problem, ignoredResolutions),
  }).pipe(
    Match.when({ rule: true }, (): boolean => true),
    Match.when({ resolution: true }, (): boolean => true),
    Match.orElse((): boolean => false),
  )

const visibleProblemOf = (
  problem: Problem,
  ignoredRules: readonly string[],
  ignoredResolutions: readonly string[],
): boolean =>
  Match.value(isIgnoredProblemOf(problem, ignoredRules, ignoredResolutions)).pipe(
    Match.when(true, (): boolean => false),
    Match.when(false, (): boolean => true),
    Match.exhaustive,
  )

const maskTracedProblem = (problem: Problem): MaskedProblem =>
  Match.value(problem).pipe(
    Match.when({ kind: 'InternalResolutionError' }, ({ trace: _trace, ...rest }) => rest),
    Match.orElse((untouched): MaskedProblem => untouched),
  )

const maskProblemOf = (problem: Problem, keepTraces: boolean): MaskedProblem =>
  Match.value(keepTraces).pipe(
    Match.when(true, (): MaskedProblem => problem),
    Match.when(false, (): MaskedProblem => maskTracedProblem(problem)),
    Match.exhaustive,
  )

const visibleProblemsOf = (
  analysis: Analysis.Report,
  ignoredRules: readonly string[],
  ignoredResolutions: readonly string[],
  mask: EnvelopeMask,
): readonly MaskedProblem[] =>
  analysis.problems
    .filter((problem) => visibleProblemOf(problem, ignoredRules, ignoredResolutions))
    .map((problem) => maskProblemOf(problem, mask.traces))

const countedKindOf = (counts: Record<string, number>, kind: string): number | undefined => counts[kind]

const definedCountOf = (count: number | undefined): number =>
  Match.value(count).pipe(
    Match.when(undefined, (): number => 0),
    Match.orElse((present): number => present),
  )

const previousCountOf = (counts: Record<string, number>, problem: MaskedProblem): number =>
  definedCountOf(countedKindOf(counts, problem.kind))

const countedProblem = (
  counts: Record<string, number>,
  problem: MaskedProblem,
): Record<string, number> => ({ ...counts, [problem.kind]: previousCountOf(counts, problem) + 1 })

const problemCountsOf = (problems: readonly MaskedProblem[]): Record<string, number> =>
  problems.reduce<Record<string, number>>(countedProblem, {})

interface EnvelopeFieldEntry {
  readonly keep: boolean
  readonly field: Partial<OkEnvelope>
}

const envelopeFieldOf = (analysis: Analysis.Report, mask: EnvelopeMask): readonly EnvelopeFieldEntry[] => [
  { keep: mask.entrypoints, field: { entrypoints: analysis.entrypoints } },
  { keep: mask.buildTools, field: { buildTools: analysis.buildTools } },
  { keep: mask.programInfo, field: { programInfo: analysis.programInfo } },
]

const keptFieldOf = (entry: EnvelopeFieldEntry): Partial<OkEnvelope> =>
  Match.value(entry.keep).pipe(
    Match.when(true, (): Partial<OkEnvelope> => entry.field),
    Match.when(false, (): Partial<OkEnvelope> => ({})),
    Match.exhaustive,
  )

const expandedFieldsOf = (analysis: Analysis.Report, mask: EnvelopeMask): Partial<OkEnvelope> =>
  envelopeFieldOf(analysis, mask).reduce<Partial<OkEnvelope>>(
    (fields, entry) => ({ ...fields, ...keptFieldOf(entry) }),
    {},
  )

const analysisDocumentOf = (
  analysis: Analysis.Report,
  problems: readonly MaskedProblem[],
  mask: EnvelopeMask,
): MachineEnvelope => ({
  status: 'ok',
  packageName: analysis.packageName,
  packageVersion: analysis.packageVersion,
  types: analysis.types,
  problems,
  problemCounts: problemCountsOf(problems),
  ...expandedFieldsOf(analysis, mask),
})

const untypedDocumentOf = (result: Analysis.UntypedReport): MachineEnvelope => ({
  status: 'untyped',
  packageName: result.packageName,
  packageVersion: result.packageVersion,
  types: false,
})

const analyzedDocumentOf = (result: Analysis.PackageReport, view: AnalyzedRun): MachineEnvelope =>
  Match.value(result).pipe(
    Match.when({ types: false }, (untyped): MachineEnvelope => untypedDocumentOf(untyped)),
    Match.orElse((analysis): MachineEnvelope =>
      analysisDocumentOf(
        analysis,
        visibleProblemsOf(analysis, view.ignoreRules, view.ignoreResolutions, view.mask),
        view.mask,
      )
    ),
  )

const machineDocumentOf = (view: AnalyzedRun): MachineEnvelope => analyzedDocumentOf(view.result, view)

const RenderReportDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/RenderReportDecision',
)
type RenderReportDecisionTypeId = typeof RenderReportDecisionTypeId

export class ReportRendered extends S.TaggedClass<ReportRendered>()('ReportRendered', {
  mode: RenderModeSchema,
  document: MachineEnvelopeSchema,
  view: AnalyzedRun,
}) {
  readonly [RenderReportDecisionTypeId] = RenderReportDecisionTypeId
}

export class ReportSuppressed extends S.TaggedClass<ReportSuppressed>()('ReportSuppressed', {
  mode: RenderModeSchema,
  document: MachineEnvelopeSchema,
  view: AnalyzedRun,
}) {
  readonly [RenderReportDecisionTypeId] = RenderReportDecisionTypeId
}

export class FailureRendered extends S.TaggedClass<FailureRendered>()('FailureRendered', {
  failure: AttwFailureSchema,
  isTty: S.Boolean,
}) {
  readonly [RenderReportDecisionTypeId] = RenderReportDecisionTypeId
}

export type RenderReportDecision = ReportRendered | ReportSuppressed | FailureRendered

const renderedOutcomeOf = (
  mode: RenderMode,
  document: MachineEnvelope,
  view: AnalyzedRun,
): ReportRendered | ReportSuppressed =>
  Match.value(mode).pipe(
    Match.when('quiet', () => new ReportSuppressed({ mode, document, view })),
    Match.orElse(() => new ReportRendered({ mode, document, view })),
  )

export const renderReport = Workflow.make({
  command: RenderReportCommand,
  decision: S.Union([ReportRendered, ReportSuppressed, FailureRendered]),
  error: S.Never,
  decide: (command): Result.Result<RenderReportDecision, never> =>
    Match.value(command.outcome).pipe(
      Match.tag('RefusedRun', ({ failure }): Result.Result<RenderReportDecision, never> =>
        Result.succeed(new FailureRendered({ failure, isTty: command.observations.isTty }))),
      Match.tag('AnalyzedRun', (analyzed): Result.Result<RenderReportDecision, never> =>
        Result.succeed(
          renderedOutcomeOf(decidedRenderMode(command, analyzed), machineDocumentOf(analyzed), analyzed),
        )),
      Match.exhaustive,
    ),
})
