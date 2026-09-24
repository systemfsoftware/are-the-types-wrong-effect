import type { ResolutionKind } from '@systemfsoftware/arethetypeswrong'
import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Data, Match, Result } from 'effect'

import {
  type AcquiredTarballAnswer,
  type AcquiredTarballSource,
  acquireTarball,
  type AcquireTarballError,
  type AcquireTarballRequest,
} from './acquire-tarball.cell.js'
import { AcquisitionCommandRejected } from './Acquisition.schema.js'
import { AnalyzedPackage, analyzePackage } from './analyze-package.cell.js'
import {
  AnalysisFailed,
  ConfigInvalid,
  InvalidPackageSpec,
  PackFailed,
  RegistryBadResponse,
  RegistryNotFound,
  RegistryUnreachable,
  TargetNotPackable,
} from './Failure.schema.js'
import { Filesystem } from './filesystem.service.js'
import { FilesystemReadRefused } from './FilesystemError.schema.js'
import { type LoadAttwConfigAnswer, loadAttwConfigFile } from './load-attw-config.cell.js'
import { ConfigInvalid as LoadConfigInvalid } from './load-attw-config.workflow.js'
import type { AttwConfig } from './load-attw-config.workflow.js'
import { decodeIncludeMask, type EnvelopeMask } from './Mask.js'
import { offerHintsCell } from './offer-hints.cell.js'
import { PackRunner } from './pack-runner.service.js'
import { applyProfile } from './Profiles.js'
import { ApplyProfileCommand } from './Profiles.schema.js'
import { Registry } from './registry.service.js'
import { RegistryPayloadOverBudget } from './RegistryError.schema.js'
import { decodePayloadSize } from './RegistryUrl.js'
import { renderReportCell } from './render-report.cell.js'
import { AnalyzedRun, RefusedRun, RenderOutcome, RunOutcome } from './run-outcome.schema.js'
import { selectExitCode, SelectExitCodeCommand } from './select-exit-code.workflow.js'
import type { RequestedFormat } from './select-render-mode.workflow.js'
import { Terminal } from './terminal.service.js'
import { TerminalWriteRefused } from './TerminalError.schema.js'

export interface RunAttwFlags {
  readonly pack?: boolean
  readonly fromNpm?: boolean
  readonly definitelyTyped?: string
  readonly format?: RequestedFormat
  readonly quiet?: boolean
  readonly entrypoints?: readonly string[]
  readonly includeEntrypoints?: readonly string[]
  readonly excludeEntrypoints?: readonly string[]
  readonly include?: readonly string[]
  readonly entrypointsLegacy?: boolean
  readonly ignoreRules?: readonly string[]
  readonly profile?: 'strict' | 'node16' | 'esm-only'
  readonly summary?: boolean
  readonly emoji?: boolean
  readonly color?: boolean
  readonly registry?: string
}

export interface RunAttwRequest {
  readonly target: string
  readonly configPath: string
  readonly flags: RunAttwFlags
}
export type RunAttwRejection = Sandwich.CommandRejected

export type RunAttwError = TerminalWriteRefused | AcquisitionCommandRejected | FilesystemReadRefused | RunAttwRejection

export type RunAttwServices = Filesystem | Registry | Terminal | PackRunner

interface EffectiveRunRequest {
  readonly target: string
  readonly fromNpm: boolean
  readonly pack: boolean
  readonly registry: string
  readonly format: RequestedFormat
  readonly quiet: boolean
  readonly summary: boolean
  readonly emoji: boolean
  readonly color: boolean
  readonly entrypoints: readonly string[] | undefined
  readonly includeEntrypoints: readonly string[]
  readonly excludeEntrypoints: readonly string[]
  readonly include: readonly string[]
  readonly entrypointsLegacy: boolean
  readonly ignoreRules: readonly string[]
  readonly ignoreResolutions: readonly ResolutionKind[]
  readonly profile: 'strict' | 'node16' | 'esm-only'
  readonly mask: EnvelopeMask
}

class ResolvedRun extends Data.TaggedClass('ResolvedRun')<{ readonly request: EffectiveRunRequest }> {}

class AcquiredRun extends Data.TaggedClass('AcquiredRun')<{
  readonly request: EffectiveRunRequest
  readonly evidence: AcquiredTarballSource
}> {}

type ResolvedOutcome = ResolvedRun | RefusedRun
type AcquiredOutcome = AcquiredRun | RefusedRun
type AnalyzedOutcome = AnalyzedPackage | RefusedRun

const defaultRegistry = 'https://registry.npmjs.org'

const rejectedAnalysis = (): AnalysisFailed =>
  new AnalysisFailed({
    message: 'The run was rejected before it could answer.',
    recovery: 'Rerun the same command and report the failure if it repeats.',
  })

const carried = <Failure>(
  found: { readonly message: string; readonly recovery: string },
  make: (fields: { readonly message: string; readonly recovery: string }) => Failure,
): Failure => make({ message: found.message, recovery: found.recovery })

type AcquireRefusal = Exclude<AcquiredTarballAnswer, AcquiredTarballSource>

const refusalRunOf = (answer: AcquireRefusal): RefusedRun =>
  Match.value(answer).pipe(
    Match.tag('ConfigInvalid', (refused) =>
      new RefusedRun({ failure: carried(refused, (fields) => new ConfigInvalid(fields)) })),
    Match.tag('InvalidPackageSpec', (refused) =>
      new RefusedRun({
        failure: carried(refused, (fields) =>
          new InvalidPackageSpec(fields)),
      })),
    Match.tag('TargetNotPackable', (refused) =>
      new RefusedRun({
        failure: carried(refused, (fields) => new TargetNotPackable(fields)),
      })),
    Match.tag('RegistryNotFound', (refused) =>
      new RefusedRun({
        failure: carried(refused, (fields) => new RegistryNotFound(fields)),
      })),
    Match.tag('RegistryUnreachable', (refused) =>
      new RefusedRun({
        failure: carried(refused, (fields) => new RegistryUnreachable(fields)),
      })),
    Match.tag('RegistryBadResponse', (refused) =>
      new RefusedRun({
        failure: carried(refused, (fields) => new RegistryBadResponse(fields)),
      })),
    Match.tag('PackFailed', (refused) =>
      new RefusedRun({
        failure: carried(refused, (fields) => new PackFailed(fields)),
      })),
    Match.exhaustive,
  )

const overBudgetRunOf = (overBudget: RegistryPayloadOverBudget): RefusedRun =>
  new RefusedRun({
    failure: Result.match(decodePayloadSize(overBudget.kind ?? 'tarball', overBudget.byteLength), {
      onFailure: (refusal) => new RegistryBadResponse({ message: refusal.message, recovery: refusal.recovery }),
      onSuccess: () =>
        new RegistryBadResponse({
          message:
            `The payload at ${overBudget.url} is larger than the ${overBudget.budgetBytes} bytes this tool will read.`,
          recovery: 'Analyze the package from a local tarball instead: download it and rerun with the .tgz path.',
        }),
    }),
  })

const acquireErrorRunOf = (error: AcquireTarballError): RefusedRun =>
  Match.value(error).pipe(
    Match.tag('RegistryPayloadOverBudget', (overBudget) => overBudgetRunOf(overBudget)),
    Match.tag('AcquisitionCommandRejected', (rejected) =>
      new RefusedRun({
        failure: new AnalysisFailed({ message: rejected.issue, recovery: rejectedAnalysis().recovery }),
      })),
    Match.exhaustive,
  )

const defaulted = <Value>(value: Value | undefined, fallback: Value): Value => value ?? fallback

const effectiveRun = (request: RunAttwRequest, config: AttwConfig, mask: EnvelopeMask): EffectiveRunRequest => {
  const profile = defaulted(request.flags.profile, 'strict')
  return {
    target: request.target,
    fromNpm: defaulted(request.flags.fromNpm, false),
    pack: defaulted(request.flags.pack, false),
    registry: defaulted(request.flags.registry, defaulted(config.registry, defaultRegistry)),
    format: defaulted(request.flags.format, 'auto'),
    quiet: defaulted(request.flags.quiet, false),
    summary: defaulted(request.flags.summary, true),
    emoji: defaulted(request.flags.emoji, true),
    color: defaulted(request.flags.color, true),
    entrypoints: request.flags.entrypoints,
    includeEntrypoints: [...defaulted(request.flags.includeEntrypoints, [])],
    excludeEntrypoints: [...defaulted(request.flags.excludeEntrypoints, [])],
    include: [...defaulted(request.flags.include, [])],
    entrypointsLegacy: defaulted(request.flags.entrypointsLegacy, false),
    ignoreRules: [...defaulted(request.flags.ignoreRules, defaulted(config.ignoreRules, []))],
    ignoreResolutions: [...applyProfile(new ApplyProfileCommand({ profileName: profile })).ignoreResolutions],
    profile,
    mask,
  }
}

const configOf = (decision: LoadAttwConfigAnswer): Result.Result<AttwConfig, LoadConfigInvalid> =>
  Match.value(decision).pipe(
    Match.tag('ConfigInvalid', (invalid): Result.Result<AttwConfig, LoadConfigInvalid> => Result.fail(invalid)),
    Match.tag('AttwConfigLoaded', ({ config }): Result.Result<AttwConfig, LoadConfigInvalid> => Result.succeed(config)),
    Match.tag('AttwConfigAbsent', (): Result.Result<AttwConfig, LoadConfigInvalid> => Result.succeed({})),
    Match.exhaustive,
  )

const resolvedOutcomeOf = (request: RunAttwRequest, decision: LoadAttwConfigAnswer): ResolvedOutcome =>
  Result.match(configOf(decision), {
    onFailure: (invalid) => new RefusedRun({ failure: carried(invalid, (fields) => new ConfigInvalid(fields)) }),
    onSuccess: (config) =>
      Result.match(decodeIncludeMask([...(request.flags.include ?? [])]), {
        onFailure: (refused) => new RefusedRun({ failure: refused }),
        onSuccess: (mask): ResolvedOutcome => new ResolvedRun({ request: effectiveRun(request, config, mask) }),
      }),
  })

const resolvedCell = loadAttwConfigFile.pipe(
  Cell.mapInput((request: RunAttwRequest) => ({ configPath: request.configPath })),
  Cell.flatMap((decision) => Cell.map(Cell.id<RunAttwRequest>(), (request) => resolvedOutcomeOf(request, decision))),
)

const acquireRequestOf = (request: EffectiveRunRequest): AcquireTarballRequest => ({
  target: request.target,
  fromNpm: request.fromNpm,
  pack: request.pack,
  registry: request.registry,
})

const acquiredOutcomeOf = (request: EffectiveRunRequest, answer: AcquiredTarballAnswer): AcquiredOutcome =>
  'bytes' in answer ? new AcquiredRun({ request, evidence: answer }) : refusalRunOf(answer)

const acquiredCell = resolvedCell.pipe(
  Cell.flatMap((resolved) =>
    Match.value(resolved).pipe(
      Match.tag('RefusedRun', (refused) => Cell.succeed<AcquiredOutcome>(refused)),
      Match.tag('ResolvedRun', ({ request }) => acquiredAnswer(request)),
      Match.exhaustive,
    )
  ),
)

const acquiredAnswer = (request: EffectiveRunRequest) =>
  Cell.match(acquireTarball.pipe(Cell.mapInput((_request: RunAttwRequest) => acquireRequestOf(request))), {
    onFailure: (error): AcquiredOutcome => normalizeAcquireError(error).pipe(acquireErrorRunOf),
    onSuccess: (answer): AcquiredOutcome => acquiredOutcomeOf(request, answer),
  })

const normalizeAcquireError = (
  error: AcquireTarballError | Sandwich.CommandRejected,
): AcquireTarballError =>
  Match.value(error).pipe(
    Match.tag('RegistryPayloadOverBudget', (overBudget) => overBudget),
    Match.tag('AcquisitionCommandRejected', (rejected) => rejected),
    Match.orElse(() => unreachableRejection()),
  )

const unreachableRejection = (): AcquisitionCommandRejected =>
  new AcquisitionCommandRejected({ issue: 'The acquisition command was rejected before analysis.' })

const analyzeRequestOf = (request: EffectiveRunRequest, evidence: AcquiredTarballSource) => ({
  bytes: evidence.bytes,
  entrypoints: request.entrypoints,
  includeEntrypoints: request.includeEntrypoints,
  excludeEntrypoints: request.excludeEntrypoints,
  entrypointsLegacy: request.entrypointsLegacy,
})

const analyzedRunOf = (request: EffectiveRunRequest, analysed: AnalyzedOutcome): RunOutcome =>
  Match.value(analysed).pipe(
    Match.tag('RefusedRun', (refused): RunOutcome => refused),
    Match.tag('AnalyzedPackage', (analysed): RunOutcome =>
      new AnalyzedRun({
        result: analysed.result,
        format: request.format,
        quiet: request.quiet,
        color: request.color,
        summary: request.summary,
        emoji: request.emoji,
        ignoreRules: request.ignoreRules,
        ignoreResolutions: request.ignoreResolutions,
        include: request.include,
        mask: request.mask,
      })),
    Match.exhaustive,
  )

const analyzedCell = acquiredCell.pipe(
  Cell.flatMap((acquired) =>
    Match.value(acquired).pipe(
      Match.tag('RefusedRun', (refused) => Cell.succeed<RunOutcome>(refused)),
      Match.tag('AcquiredRun', ({ request, evidence }) =>
        analyzePackage.pipe(
          Cell.mapInput((_request: RunAttwRequest) => analyzeRequestOf(request, evidence)),
          Cell.map((analysed) => analyzedRunOf(request, analysed)),
        )),
      Match.exhaustive,
    )
  ),
)

const exitCellOf = (
  rendered: RenderOutcome,
): Cell.Cell<RunAttwRequest, RenderOutcome, RunAttwError, Terminal> =>
  Match.value(rendered).pipe(
    Match.tag('RefusedRun', (refused) => Cell.succeed<RenderOutcome, RunAttwRequest>(refused)),
    Match.tag('RenderedRun', (renderedRun) =>
      offerHintsCell.pipe(
        Cell.mapInput((_request: RunAttwRequest) => renderedRun),
        Cell.map((): RenderOutcome => renderedRun),
      )),
    Match.exhaustive,
  )

const exitCodeOf = (outcome: RenderOutcome): number => {
  const decision = Result.getOrThrow(selectExitCode(new SelectExitCodeCommand({ outcome })))
  return Match.value(decision).pipe(
    Match.tag('ExitCodeDecided', ({ exitCode }) => exitCode),
    Match.tag('ExitCodeRefused', () => 1),
    Match.exhaustive,
  )
}

export const runAttw = analyzedCell.pipe(
  Cell.andThen(renderReportCell),
  Cell.flatMap(exitCellOf),
  Cell.map(exitCodeOf),
)
