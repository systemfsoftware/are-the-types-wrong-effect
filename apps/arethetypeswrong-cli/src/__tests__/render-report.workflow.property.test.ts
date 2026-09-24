import { it } from '@effect/vitest'
import {
  type CheckResult,
  type LegacyAnalysis,
  type Problem,
  type ProblemKind,
  ProblemSchema,
} from '@systemfsoftware/arethetypeswrong'
import { Match, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  type MachineEnvelope,
  MachineEnvelopeSchema,
  type MaskedProblem,
} from '../decode-envelope-document.workflow.js'
import {
  AnalysisFailed,
  type AttwFailure,
  ConfigInvalid,
  InvalidPackageSpec,
  PackFailed,
  RegistryBadResponse,
  RegistryNotFound,
  RegistryUnreachable,
  TargetNotPackable,
} from '../Failure.schema.js'
import type { EnvelopeMask } from '../Mask.js'
import { renderReport, RenderReportCommand, type RenderReportDecision } from '../render-report.workflow.js'
import { AnalyzedRun, RefusedRun } from '../run-outcome.schema.js'
import type { RenderMode } from '../select-render-mode.workflow.js'
import { TerminalObservations } from '../TerminalError.schema.js'

const defaultMask: EnvelopeMask = { entrypoints: false, buildTools: false, programInfo: false, traces: false }

const authoredFlagOfKind: Readonly<Record<ProblemKind, string>> = {
  NoResolution: 'no-resolution',
  UntypedResolution: 'untyped-resolution',
  FalseESM: 'false-esm',
  FalseCJS: 'false-cjs',
  CJSResolvesToESM: 'cjs-resolves-to-esm',
  FallbackCondition: 'fallback-condition',
  CJSOnlyExportsDefault: 'cjs-only-exports-default',
  NamedExports: 'named-exports',
  FalseExportDefault: 'false-export-default',
  MissingExportEquals: 'missing-export-equals',
  UnexpectedModuleSyntax: 'unexpected-module-syntax',
  InternalResolutionError: 'internal-resolution-error',
}

const authoredFormats: readonly string[] = ['auto', 'table', 'table-flipped', 'ascii', 'json']
const authoredResolutionKinds: readonly string[] = ['node10', 'node16-cjs', 'node16-esm', 'bundler']

const authoredModeOf = (requestedFormat: string, quiet: boolean, isTty: boolean, width: number): RenderMode => {
  if (quiet) return 'quiet'
  if (requestedFormat === 'json') return 'envelope'
  if (requestedFormat === 'table') return 'table'
  if (requestedFormat === 'table-flipped') return 'table-flipped'
  if (requestedFormat === 'ascii') return 'ascii'
  if (requestedFormat !== 'auto') return 'envelope'
  if (!isTty) return 'envelope'
  return width >= 100 ? 'table-flipped' : 'ascii'
}

const authoredVisible = (
  problem: Problem,
  ignoredRules: readonly string[],
  ignoredResolutions: readonly string[],
): boolean =>
  !ignoredRules.includes(authoredFlagOfKind[problem.kind]) &&
  !('resolutionKind' in problem && ignoredResolutions.includes(problem.resolutionKind))

const authoredMasked = (problem: Problem, keepTraces: boolean): MaskedProblem =>
  Match.value(keepTraces).pipe(
    Match.when(true, (): MaskedProblem => problem),
    Match.when(false, (): MaskedProblem =>
      Match.value(problem).pipe(
        Match.when({ kind: 'InternalResolutionError' }, ({ trace: _trace, ...rest }): MaskedProblem => rest),
        Match.orElse((untouched): MaskedProblem => untouched),
      )),
    Match.exhaustive,
  )

const authoredCounts = (problems: readonly MaskedProblem[]): Record<string, number> =>
  problems.reduce<Record<string, number>>(
    (counts, problem) => ({ ...counts, [problem.kind]: (counts[problem.kind] ?? 0) + 1 }),
    {},
  )

const analysisOf = (problems: readonly Problem[]): LegacyAnalysis => ({
  packageName: 'demo',
  packageVersion: '1.0.0',
  buildTools: {},
  types: { kind: 'included' },
  entrypoints: {},
  programInfo: { node10: {}, node16: {}, bundler: {} },
  problems,
})

const untypedOf = (): CheckResult => ({ packageName: 'demo', packageVersion: '1.0.0', types: false })

interface IgnoreSet {
  readonly rules: readonly string[]
  readonly resolutions: readonly string[]
}

const authoredDocumentOf = (result: CheckResult, ignored: IgnoreSet, mask: EnvelopeMask): MachineEnvelope =>
  Match.value(result).pipe(
    Match.when({ types: false }, (untyped): MachineEnvelope => ({
      status: 'untyped',
      packageName: untyped.packageName,
      packageVersion: untyped.packageVersion,
      types: false,
    })),
    Match.orElse((analysis): MachineEnvelope => {
      const problems = analysis.problems
        .filter((problem) => authoredVisible(problem, ignored.rules, ignored.resolutions))
        .map((problem) => authoredMasked(problem, mask.traces))
      return {
        status: 'ok',
        packageName: analysis.packageName,
        packageVersion: analysis.packageVersion,
        types: analysis.types,
        problems,
        problemCounts: authoredCounts(problems),
        ...(mask.entrypoints ? { entrypoints: analysis.entrypoints } : {}),
        ...(mask.buildTools ? { buildTools: analysis.buildTools } : {}),
        ...(mask.programInfo ? { programInfo: analysis.programInfo } : {}),
      }
    }),
  )

interface RenderScene {
  readonly result: CheckResult
  readonly format: string
  readonly quiet: boolean
  readonly isTty: boolean
  readonly width: number
  readonly ignored: IgnoreSet
  readonly mask: EnvelopeMask
}

const commandOf = (scene: RenderScene): RenderReportCommand =>
  new RenderReportCommand({
    outcome: new AnalyzedRun({
      result: scene.result,
      format: scene.format,
      quiet: scene.quiet,
      color: false,
      summary: false,
      emoji: false,
      ignoreRules: [...scene.ignored.rules],
      ignoreResolutions: [...scene.ignored.resolutions],
      include: [],
      mask: scene.mask,
    }),
    observations: new TerminalObservations({ isTty: scene.isTty, width: scene.width }),
  })

const decidedOf = (command: RenderReportCommand): RenderReportDecision => Result.getOrThrow(renderReport(command))

const documentOrUndefined = (decision: RenderReportDecision): MachineEnvelope | undefined =>
  Match.value(decision).pipe(
    Match.tag('FailureRendered', () => undefined),
    Match.orElse((rendered) => rendered.document),
  )

const envelopeEquals = (left: MachineEnvelope, right: MachineEnvelope): boolean =>
  Schema.toEquivalence<MachineEnvelope>(MachineEnvelopeSchema)(left, right)

interface RenderPolicyRow {
  readonly format: string
  readonly quiet: boolean
  readonly isTty: boolean
  readonly width: number
  readonly expected: RenderMode
}

const renderPolicyRows: readonly RenderPolicyRow[] = [
  { format: 'auto', quiet: false, isTty: true, width: 100, expected: 'table-flipped' },
  { format: 'auto', quiet: false, isTty: true, width: 200, expected: 'table-flipped' },
  { format: 'auto', quiet: false, isTty: true, width: 99, expected: 'ascii' },
  { format: 'auto', quiet: false, isTty: true, width: 0, expected: 'ascii' },
  { format: 'auto', quiet: false, isTty: false, width: 200, expected: 'envelope' },
  { format: 'json', quiet: false, isTty: true, width: 200, expected: 'envelope' },
  { format: 'table', quiet: false, isTty: false, width: 0, expected: 'table' },
  { format: 'table-flipped', quiet: false, isTty: true, width: 40, expected: 'table-flipped' },
  { format: 'ascii', quiet: false, isTty: true, width: 40, expected: 'ascii' },
  { format: 'not-a-format', quiet: false, isTty: true, width: 200, expected: 'envelope' },
  { format: 'json', quiet: true, isTty: false, width: 0, expected: 'quiet' },
  { format: 'not-a-format', quiet: true, isTty: true, width: 200, expected: 'quiet' },
]

const oneOfValues = <T>(values: readonly T[]): Arbitrary.Arbitrary<T> =>
  Arbitrary.flatMap(
    Arbitrary.schema(Schema.Literals(values.map((_value, index) => index))),
    (index) => Arbitrary.Constant(values[index]),
  )

const oneOfArbitraries = <A, B>(
  left: Arbitrary.Arbitrary<A>,
  right: Arbitrary.Arbitrary<B>,
): Arbitrary.Arbitrary<A | B> =>
  Arbitrary.flatMap(
    Arbitrary.schema(Schema.Literals(['left', 'right'])),
    (side): Arbitrary.Arbitrary<A | B> => side === 'left' ? left : right,
  )

const intBetween = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum, maximum }))))

interface ScenePieces {
  readonly problems: readonly Problem[]
  readonly mask: EnvelopeMask
  readonly ignored: IgnoreSet
  readonly format: string
  readonly quiet: boolean
  readonly isTty: boolean
  readonly width: number
  readonly typed: boolean
}

const scenePieces: Arbitrary.Arbitrary<ScenePieces> = Arbitrary.all({
  problems: Arbitrary.array(Arbitrary.schema(ProblemSchema), { maxLength: 3 }),
  mask: Arbitrary.all({
    entrypoints: Arbitrary.schema(Schema.Boolean),
    buildTools: Arbitrary.schema(Schema.Boolean),
    programInfo: Arbitrary.schema(Schema.Boolean),
    traces: Arbitrary.schema(Schema.Boolean),
  }),
  ignored: Arbitrary.all({
    rules: Arbitrary.array(Arbitrary.schema(Schema.Literals(Object.values(authoredFlagOfKind))), { maxLength: 3 }),
    resolutions: Arbitrary.array(Arbitrary.schema(Schema.Literals(authoredResolutionKinds)), { maxLength: 3 }),
  }),
  format: oneOfArbitraries(oneOfValues(authoredFormats), Arbitrary.schema(Schema.String)),
  quiet: Arbitrary.schema(Schema.Boolean),
  isTty: Arbitrary.schema(Schema.Boolean),
  width: oneOfArbitraries(intBetween(0, 300), oneOfValues([99, 100])),
  typed: Arbitrary.schema(Schema.Boolean),
})

const sceneOf = (pieces: ScenePieces): RenderScene => ({
  result: pieces.typed ? analysisOf(pieces.problems) : untypedOf(),
  format: pieces.format,
  quiet: pieces.quiet,
  isTty: pieces.isTty,
  width: pieces.width,
  ignored: pieces.ignored,
  mask: pieces.mask,
})

it.prop('∀row_RenderReportPolicy_=authoredMode', [oneOfValues(renderPolicyRows)], ([row]) => {
  const scene: RenderScene = {
    result: untypedOf(),
    format: row.format,
    quiet: row.quiet,
    isTty: row.isTty,
    width: row.width,
    ignored: { rules: [], resolutions: [] },
    mask: defaultMask,
  }
  return Match.value(decidedOf(commandOf(scene))).pipe(
    Match.tag('ReportSuppressed', ({ mode }) => row.quiet && mode === row.expected),
    Match.tag('ReportRendered', ({ mode }) => !row.quiet && mode === row.expected),
    Match.tag('FailureRendered', () => false),
    Match.exhaustive,
  )
})

it.prop('∀scene_RenderReport_=authoredModeDocumentAndClass', [scenePieces], ([pieces]) => {
  const scene = sceneOf(pieces)
  const document = authoredDocumentOf(scene.result, scene.ignored, scene.mask)
  const expectedMode = authoredModeOf(scene.format, scene.quiet, scene.isTty, scene.width)
  return Match.value(decidedOf(commandOf(scene))).pipe(
    Match.tag(
      'ReportSuppressed',
      ({ mode, document: produced }) =>
        scene.quiet && mode === expectedMode && mode === 'quiet' && envelopeEquals(produced, document),
    ),
    Match.tag(
      'ReportRendered',
      ({ mode, document: produced }) =>
        !scene.quiet && mode === expectedMode && mode !== 'quiet' && envelopeEquals(produced, document),
    ),
    Match.tag('FailureRendered', () => false),
    Match.exhaustive,
  )
})

it.prop(
  '∀scene,format_Envelope_≡AcrossFormats',
  [scenePieces, oneOfValues(authoredFormats)],
  ([pieces, otherFormat]) => {
    const scene = sceneOf(pieces)
    const first = documentOrUndefined(decidedOf(commandOf(scene)))
    const second = documentOrUndefined(decidedOf(commandOf({ ...scene, format: otherFormat })))
    return first !== undefined &&
      second !== undefined &&
      envelopeEquals(first, second)
  },
)

const failures: readonly AttwFailure[] = [
  new InvalidPackageSpec({ message: 'invalid spec', recovery: 'use a package name' }),
  new ConfigInvalid({ message: 'invalid config', recovery: 'fix .attw.json' }),
  new RegistryNotFound({ message: 'not found', recovery: 'check the name' }),
  new RegistryUnreachable({ message: 'unreachable', recovery: 'check the network' }),
  new RegistryBadResponse({ message: 'bad response', recovery: 'retry' }),
  new PackFailed({ message: 'pack failed', recovery: 'fix the package' }),
  new TargetNotPackable({ message: 'not packable', recovery: 'pass -p' }),
  new AnalysisFailed({ message: 'analysis failed', recovery: 'report it' }),
]

it.prop(
  '∀failure,tty_RefusedRun_=FailureRendered',
  [oneOfValues(failures), Arbitrary.schema(Schema.Boolean)],
  ([failure, isTty]) => {
    const command = new RenderReportCommand({
      outcome: new RefusedRun({ failure }),
      observations: new TerminalObservations({ isTty, width: 80 }),
    })
    return Match.value(decidedOf(command)).pipe(
      Match.tag(
        'FailureRendered',
        ({ failure: produced, isTty: producedTty }) => produced === failure && producedTty === isTty,
      ),
      Match.orElse(() => false),
    )
  },
)
