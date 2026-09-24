import { it } from '@effect/vitest'
import {
  type CheckResult,
  type ModuleKind,
  type Problem,
  type ProblemKind,
  ProblemSchema,
} from '@systemfsoftware/arethetypeswrong'
import { Match, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

import type { MachineEnvelope } from '../decode-envelope-document.workflow.js'
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
import { RefusedRun, RenderedRun } from '../run-outcome.schema.js'
import { type ExitCodeDecision, selectExitCode, SelectExitCodeCommand } from '../select-exit-code.workflow.js'

const allHiddenMask = { entrypoints: false, buildTools: false, programInfo: false, traces: false }

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

const authoredResolutionKinds: readonly string[] = ['node10', 'node16-cjs', 'node16-esm', 'bundler']

const authoredVisible = (
  problem: Problem,
  ignoredRules: readonly string[],
  ignoredResolutions: readonly string[],
): boolean =>
  !ignoredRules.includes(authoredFlagOfKind[problem.kind]) &&
  !('resolutionKind' in problem && ignoredResolutions.includes(problem.resolutionKind))

const authoredExitCode = (result: CheckResult, ignored: IgnoreSet): number =>
  Match.value(result).pipe(
    Match.when({ types: false }, () => 0),
    Match.orElse((analysis) => (analysis.problems.some((problem) =>
        authoredVisible(problem, ignored.rules, ignored.resolutions)
      )
      ? 1
      : 0)
    ),
  )

interface IgnoreSet {
  readonly rules: readonly string[]
  readonly resolutions: readonly string[]
}

const analysisOf = (problems: readonly Problem[]): CheckResult => ({
  packageName: 'demo',
  packageVersion: '1.0.0',
  buildTools: {},
  types: { kind: 'included' },
  entrypoints: {},
  programInfo: { node10: {}, node16: {}, bundler: {} },
  problems,
})

const untypedOf = (): CheckResult => ({ packageName: 'demo', packageVersion: '1.0.0', types: false })

const envelopeOf = (result: CheckResult): MachineEnvelope =>
  Match.value(result).pipe(
    Match.when({ types: false }, (untyped): MachineEnvelope => ({
      status: 'untyped',
      packageName: untyped.packageName,
      packageVersion: untyped.packageVersion,
      types: false,
    })),
    Match.orElse((): MachineEnvelope => ({
      status: 'ok',
      packageName: 'demo',
      packageVersion: '1.0.0',
      types: { kind: 'included' },
      problems: [],
      problemCounts: {},
    })),
  )

const renderedOf = (result: CheckResult, ignored: IgnoreSet): RenderedRun =>
  new RenderedRun({
    result,
    format: 'json',
    quiet: false,
    color: false,
    summary: false,
    emoji: false,
    ignoreRules: [...ignored.rules],
    ignoreResolutions: [...ignored.resolutions],
    include: [],
    mask: allHiddenMask,
    mode: 'envelope',
    document: envelopeOf(result),
  })

const decidedOf = (command: SelectExitCodeCommand): ExitCodeDecision => Result.getOrThrow(selectExitCode(command))

const oneOfValues = <T>(values: readonly T[]): Arbitrary.Arbitrary<T> =>
  Arbitrary.flatMap(
    Arbitrary.schema(Schema.Literals(values.map((_value, index) => index))),
    (index) => Arbitrary.Constant(values[index]),
  )

const intBetween = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum, maximum }))))

const emptyIgnore: IgnoreSet = { rules: [], resolutions: [] }

const moduleKind: ModuleKind = { detectedKind: 1, detectedReason: 'extension', reasonFileName: 'index.d.ts' }

interface ExitCodeRow {
  readonly problems: readonly Problem[]
  readonly ignored: IgnoreSet
  readonly expected: number
}

const exitCodeRows: readonly ExitCodeRow[] = [
  { problems: [], ignored: emptyIgnore, expected: 0 },
  {
    problems: [{ kind: 'NoResolution', entrypoint: '.', resolutionKind: 'node16-cjs' }],
    ignored: emptyIgnore,
    expected: 1,
  },
  {
    problems: [{ kind: 'NoResolution', entrypoint: '.', resolutionKind: 'node16-cjs' }],
    ignored: { rules: ['no-resolution'], resolutions: [] },
    expected: 0,
  },
  {
    problems: [{ kind: 'NoResolution', entrypoint: '.', resolutionKind: 'node16-cjs' }],
    ignored: { rules: [], resolutions: ['node16-cjs'] },
    expected: 0,
  },
  {
    problems: [{ kind: 'NoResolution', entrypoint: '.', resolutionKind: 'node16-cjs' }],
    ignored: { rules: [], resolutions: ['node10'] },
    expected: 1,
  },
  {
    problems: [{ kind: 'UntypedResolution', entrypoint: '.', resolutionKind: 'node16-esm' }],
    ignored: { rules: [], resolutions: ['node16-esm'] },
    expected: 0,
  },
  {
    problems: [
      {
        kind: 'FalseESM',
        typesFileName: 'types.d.ts',
        implementationFileName: 'index.js',
        typesModuleKind: moduleKind,
        implementationModuleKind: moduleKind,
      },
    ],
    ignored: emptyIgnore,
    expected: 1,
  },
  {
    problems: [
      {
        kind: 'FalseESM',
        typesFileName: 'types.d.ts',
        implementationFileName: 'index.js',
        typesModuleKind: moduleKind,
        implementationModuleKind: moduleKind,
      },
    ],
    ignored: { rules: ['false-esm'], resolutions: [] },
    expected: 0,
  },
  {
    problems: [
      {
        kind: 'FalseESM',
        typesFileName: 'types.d.ts',
        implementationFileName: 'index.js',
        typesModuleKind: moduleKind,
        implementationModuleKind: moduleKind,
      },
    ],
    ignored: { rules: [], resolutions: ['node16-esm'] },
    expected: 1,
  },
  {
    problems: [
      {
        kind: 'FalseCJS',
        typesFileName: 'types.d.ts',
        implementationFileName: 'index.js',
        typesModuleKind: moduleKind,
        implementationModuleKind: moduleKind,
      },
    ],
    ignored: { rules: ['false-cjs'], resolutions: [] },
    expected: 0,
  },
  {
    problems: [{ kind: 'CJSResolvesToESM', entrypoint: '.', resolutionKind: 'node10' }],
    ignored: { rules: [], resolutions: ['node10'] },
    expected: 0,
  },
  {
    problems: [{ kind: 'CJSResolvesToESM', entrypoint: '.', resolutionKind: 'node10' }],
    ignored: { rules: ['cjs-resolves-to-esm'], resolutions: [] },
    expected: 0,
  },
  {
    problems: [
      {
        kind: 'NamedExports',
        typesFileName: 'types.d.ts',
        implementationFileName: 'index.js',
        isMissingAllNamed: false,
        missing: ['missing'],
      },
    ],
    ignored: { rules: ['named-exports'], resolutions: [] },
    expected: 0,
  },
  {
    problems: [{ kind: 'FallbackCondition', entrypoint: '.', resolutionKind: 'bundler' }],
    ignored: { rules: [], resolutions: ['bundler'] },
    expected: 0,
  },
  {
    problems: [{ kind: 'FallbackCondition', entrypoint: '.', resolutionKind: 'bundler' }],
    ignored: { rules: ['fallback-condition'], resolutions: [] },
    expected: 0,
  },
  {
    problems: [
      { kind: 'FalseExportDefault', typesFileName: 'types.d.ts', implementationFileName: 'index.js' },
    ],
    ignored: { rules: ['false-export-default'], resolutions: [] },
    expected: 0,
  },
  {
    problems: [
      { kind: 'MissingExportEquals', typesFileName: 'types.d.ts', implementationFileName: 'index.js' },
    ],
    ignored: { rules: ['missing-export-equals'], resolutions: [] },
    expected: 0,
  },
  {
    problems: [
      {
        kind: 'UnexpectedModuleSyntax',
        fileName: 'dist/index.js',
        pos: 0,
        end: 10,
        syntax: 1,
        moduleKind,
      },
    ],
    ignored: { rules: ['unexpected-module-syntax'], resolutions: [] },
    expected: 0,
  },
  {
    problems: [
      { kind: 'CJSOnlyExportsDefault', fileName: 'dist/index.js', pos: 20, end: 40 },
      { kind: 'NoResolution', entrypoint: '.', resolutionKind: 'node16-cjs' },
    ],
    ignored: { rules: ['cjs-only-exports-default'], resolutions: [] },
    expected: 1,
  },
  {
    problems: [{ kind: 'CJSOnlyExportsDefault', fileName: 'dist/index.js', pos: 20, end: 40 }],
    ignored: emptyIgnore,
    expected: 1,
  },
]

const codeOf = (decision: ExitCodeDecision): number | undefined =>
  Match.value(decision).pipe(
    Match.tag('ExitCodeDecided', ({ exitCode }) => exitCode),
    Match.orElse(() => undefined),
  )

it.prop('∀row_SelectExitCode_=authoredTable', [oneOfValues(exitCodeRows)], ([row]) => {
  const decision = decidedOf(
    new SelectExitCodeCommand({ outcome: renderedOf(analysisOf(row.problems), row.ignored) }),
  )
  return codeOf(decision) === row.expected
})

interface ExitScene {
  readonly problems: readonly Problem[]
  readonly ignored: IgnoreSet
  readonly typed: boolean
}

const scene: Arbitrary.Arbitrary<ExitScene> = Arbitrary.all({
  problems: Arbitrary.array(Arbitrary.schema(ProblemSchema), { maxLength: 3 }),
  ignored: Arbitrary.all({
    rules: Arbitrary.array(Arbitrary.schema(Schema.Literals(Object.values(authoredFlagOfKind))), { maxLength: 3 }),
    resolutions: Arbitrary.array(Arbitrary.schema(Schema.Literals(authoredResolutionKinds)), { maxLength: 3 }),
  }),
  typed: Arbitrary.schema(Schema.Boolean),
})

it.prop(
  '∀scene_SelectExitCode_=authoredVisibleModel',
  [scene],
  ([pieces]) => {
    const result = pieces.typed ? analysisOf(pieces.problems) : untypedOf()
    return codeOf(decidedOf(new SelectExitCodeCommand({ outcome: renderedOf(result, pieces.ignored) }))) ===
      authoredExitCode(result, pieces.ignored)
  },
)

it.prop(
  '∀scene,rule_IgnoreGrowth_⊑ExitCode',
  [scene, intBetween(0, Object.values(authoredFlagOfKind).length - 1)],
  ([pieces, grownIndex]) => {
    if (!pieces.typed) return true
    const grown: IgnoreSet = {
      rules: [...pieces.ignored.rules, Object.values(authoredFlagOfKind)[grownIndex] ?? ''],
      resolutions: pieces.ignored.resolutions,
    }
    const base = codeOf(
      decidedOf(new SelectExitCodeCommand({ outcome: renderedOf(analysisOf(pieces.problems), pieces.ignored) })),
    )
    const plus = codeOf(
      decidedOf(new SelectExitCodeCommand({ outcome: renderedOf(analysisOf(pieces.problems), grown) })),
    )
    return base !== undefined && plus !== undefined && plus <= base
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
  '∀failure_RefusedRun_=ExitCodeRefused',
  [oneOfValues(failures)],
  ([failure]) =>
    Match.value(decidedOf(new SelectExitCodeCommand({ outcome: new RefusedRun({ failure }) }))).pipe(
      Match.tag('ExitCodeRefused', () => true),
      Match.tag('ExitCodeDecided', () => false),
      Match.exhaustive,
    ),
)
