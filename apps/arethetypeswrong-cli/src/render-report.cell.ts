import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Function, Result } from 'effect'
import * as S from 'effect/Schema'
import { type AttwFailure, AttwFailureSchema, type FailureDocument, FailureDocumentJson } from './Failure.schema.js'
import { FailureRendered, renderReport, RenderReportCommand, type ReportRendered } from './render-report.workflow.js'
import { renderAnalysisForMode } from './Render.js'
import { RefusedRun, RenderedRun, RunOutcome } from './run-outcome.schema.js'
import { Terminal } from './terminal.service.js'

type RenderedDecision = Pick<(typeof ReportRendered)['Encoded'], 'view' | 'mode' | 'document'>

type EncodedFailure = (typeof FailureRendered)['Encoded']['failure']

export interface FailureOutcome {
  readonly document: string
  readonly exitCode: number
}

const failureDocument = (failure: AttwFailure): FailureDocument => ({
  status: 'error',
  kind: failure._tag,
  message: failure.message,
  recovery: failure.recovery,
})

const proseLine = (failure: AttwFailure): string => `${failure.message} ${failure.recovery}\n`

const encodedFailureDocument = (failure: AttwFailure): string =>
  Function.pipe(failureDocument(failure), S.encodeResult(FailureDocumentJson), Result.getOrThrow)

export const failureOutcome: {
  (options: { readonly isTty: boolean }): (failure: AttwFailure) => FailureOutcome
  (failure: AttwFailure, options: { readonly isTty: boolean }): FailureOutcome
} = Function.dual(2, (failure: AttwFailure, options: { readonly isTty: boolean }): FailureOutcome => {
  if (options.isTty) return { document: proseLine(failure), exitCode: 1 }
  return { document: `${encodedFailureDocument(failure)}\n`, exitCode: 1 }
})

const renderedRunOf = (rendered: RenderedDecision): RenderedRun => {
  const view = rendered.view
  return new RenderedRun({
    result: view.result,
    format: view.format,
    quiet: view.quiet,
    color: view.color,
    summary: view.summary,
    emoji: view.emoji,
    ignoreRules: [...view.ignoreRules],
    ignoreResolutions: [...view.ignoreResolutions],
    include: [...view.include],
    mask: view.mask,
    mode: rendered.mode,
    document: rendered.document,
  })
}

const renderedStdoutOf = (rendered: RenderedDecision): string => {
  const view = rendered.view
  return renderAnalysisForMode(view.result, rendered.mode, {
    color: view.color,
    summary: view.summary,
    ignoreRules: view.ignoreRules,
    useEmoji: view.emoji,
  }, rendered.document)
}
const refusedRunOf = (failure: EncodedFailure): Effect.Effect<RefusedRun> =>
  Result.match(S.decodeResult(AttwFailureSchema)(failure), {
    onFailure: (refusal) => Effect.die(refusal),
    onSuccess: (decoded) => Effect.succeed(new RefusedRun({ failure: decoded })),
  })

const renderedFailureDocument = (refused: RefusedRun, isTty: boolean): string =>
  failureOutcome(refused.failure, { isTty }).document

const readRender = (
  outcome: RunOutcome,
): Effect.Effect<(typeof RenderReportCommand)['Encoded'], never, Terminal> =>
  Effect.flatMap(
    Terminal,
    (terminal) =>
      Effect.map(
        terminal.observations,
        (observations): (typeof RenderReportCommand)['Encoded'] => ({
          _tag: 'RenderReportCommand',
          outcome,
          observations: { isTty: observations.isTty, width: observations.width },
        }),
      ),
  )

export const renderReportCell = Sandwich.named('render.report')(readRender)
  .decide(renderReport)
  .write({
    ReportRendered: (rendered) =>
      Effect.flatMap(
        Terminal,
        (terminal) => Effect.as(terminal.write(renderedStdoutOf(rendered)), renderedRunOf(rendered)),
      ),
    ReportSuppressed: (suppressed) => Effect.succeed(renderedRunOf(suppressed)),
    FailureRendered: (failure) =>
      Effect.flatMap(Terminal, (terminal) =>
        refusedRunOf(failure.failure).pipe(
          Effect.flatMap((refused) =>
            Effect.as(terminal.writeError(renderedFailureDocument(refused, failure.isTty)), refused)
          ),
        )),
    CommandRejected: (rejected) => Effect.fail(rejected),
  })
