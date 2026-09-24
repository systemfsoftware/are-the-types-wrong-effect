import { Console, Effect, Function, Match, Option, Result } from 'effect'
import * as Schema from 'effect/Schema'
import * as Argument from 'effect/unstable/cli/Argument'
import * as CliError from 'effect/unstable/cli/CliError'
import * as CliOutput from 'effect/unstable/cli/CliOutput'
import * as Command from 'effect/unstable/cli/Command'
import * as Flag from 'effect/unstable/cli/Flag'

import { schemaCommand } from './describe-cli-surface.command.js'
import { CliFormat, CliProfile } from './ProblemUtils.js'
import { runAttw, type RunAttwFlags, type RunAttwRequest, type RunAttwServices } from './run-attw.cell.js'
import { selectUsageErrorOutcome, SelectUsageErrorOutcomeCommand } from './select-usage-error-outcome.workflow.js'
import { Terminal, type TerminalService } from './terminal.service.js'

const configFileName = '.attw.json'

export const analyzeFlags = {
  'pack': Flag.Boolean('pack').pipe(
    Flag.withAlias('P'),
    Flag.withDefault(false),
    Flag.withDescription(
      'Run `npm pack` in the specified directory and delete the resulting .tgz file afterwards',
    ),
  ),
  'from-npm': Flag.Boolean('from-npm').pipe(
    Flag.withAlias('p'),
    Flag.withDefault(false),
    Flag.withDescription('Read from the npm registry instead of a local file'),
  ),
  'definitely-typed': Flag.String('definitely-typed').pipe(
    Flag.optional,
    Flag.withDescription('Specify the version range of @types to use. Pass `false` to disable.'),
  ),
  'format': Flag.Literals('format', CliFormat).pipe(
    Flag.withAlias('f'),
    Flag.optional,
  ),
  'quiet': Flag.Boolean('quiet').pipe(
    Flag.withAlias('q'),
    Flag.optional,
    Flag.withDescription("Don't print anything to STDOUT (overrides all other options)"),
  ),
  'entrypoints': Flag.String('entrypoints').pipe(Flag.atLeast<string>(1), Flag.optional),
  'include-entrypoints': Flag.String('include-entrypoints').pipe(Flag.atLeast<string>(1), Flag.optional),
  'exclude-entrypoints': Flag.String('exclude-entrypoints').pipe(Flag.atLeast<string>(1), Flag.optional),
  'include': Flag.String('include').pipe(
    Flag.atLeast<string>(1),
    Flag.withDescription(
      'Comma-separated envelope fields to restore: entrypoints, buildTools, programInfo, traces',
    ),
    Flag.optional,
  ),
  'entrypoints-legacy': Flag.Boolean('entrypoints-legacy').pipe(Flag.optional),
  'ignore-rules': Flag.String('ignore-rules').pipe(
    Flag.withAlias('ignore-rule'),
    Flag.atLeast<string>(1),
    Flag.optional,
  ),
  'profile': Flag.Literals('profile', CliProfile).pipe(Flag.optional),
  'summary': Flag.Boolean('summary').pipe(Flag.optional),
  'emoji': Flag.Boolean('emoji').pipe(Flag.optional),
  'color': Flag.Boolean('color').pipe(Flag.optional),
  'registry': Flag.String('registry').pipe(
    Flag.withDescription(
      'URL of the npm registry to read packages from with --from-npm (default: https://registry.npmjs.org)',
    ),
    Flag.optional,
  ),
} as const

const analyzeTarget = Argument.optional(Argument.String('file-directory-or-package-spec'))

const analyzeConfig = { ...analyzeFlags, target: analyzeTarget }

type AnalyzeConfig = Command.Command.Config.Infer<typeof analyzeConfig>

const configPathOf = (): string => `${process.cwd()}/${configFileName}`

const unwrap = <A>(option: Option.Option<A>): A | undefined => Option.getOrUndefined(option)

export const runAttwRequestOf = (config: AnalyzeConfig): RunAttwRequest => ({
  target: unwrap(config.target) ?? '.',
  configPath: configPathOf(),
  flags: {
    pack: config['pack'],
    fromNpm: config['from-npm'],
    definitelyTyped: unwrap(config['definitely-typed']),
    format: unwrap(config['format']),
    quiet: unwrap(config['quiet']),
    entrypoints: unwrap(config['entrypoints']),
    includeEntrypoints: unwrap(config['include-entrypoints']),
    excludeEntrypoints: unwrap(config['exclude-entrypoints']),
    include: unwrap(config['include']),
    entrypointsLegacy: unwrap(config['entrypoints-legacy']),
    ignoreRules: unwrap(config['ignore-rules']),
    profile: unwrap(config['profile']),
    summary: unwrap(config['summary']),
    emoji: unwrap(config['emoji']),
    color: unwrap(config['color']),
    registry: unwrap(config['registry']),
  } satisfies RunAttwFlags,
})

const runAttwHandler = (
  config: AnalyzeConfig,
): Effect.Effect<number, never, RunAttwServices | Command.Environment> =>
  Effect.gen(function*() {
    const exitCode = yield* Effect.scoped(runAttw.run(runAttwRequestOf(config))).pipe(Effect.orDie)
    yield* Effect.sync(() => {
      process.exitCode = exitCode
    })
    return exitCode
  })

const analyzeCommand = Command.make('analyze', analyzeConfig, runAttwHandler)

export const runAttwCommand = Command.make('attw', analyzeConfig, runAttwHandler).pipe(
  Command.withSubcommands([analyzeCommand, schemaCommand]),
)

const usageErrorFormatter = CliOutput.defaultFormatter({ colors: false })

export interface UsageErrorCommand {
  readonly kind: string
  readonly message: string
  readonly isTty: boolean
}

const usageErrorCommandOf = (error: CliError.CliError, isTty: boolean): SelectUsageErrorOutcomeCommand =>
  Schema.is(CliError.ShowHelp)(error)
    ? showHelpUsageErrorCommand(error, isTty)
    : formattedUsageErrorCommand(error, isTty)

const formattedUsageErrorCommand = (error: CliError.CliError, isTty: boolean): SelectUsageErrorOutcomeCommand =>
  new SelectUsageErrorOutcomeCommand({
    kind: error._tag,
    message: usageErrorFormatter.formatCliError(error),
    isTty,
  })

const emptyShowHelpCommand = (error: CliError.ShowHelp, isTty: boolean): SelectUsageErrorOutcomeCommand =>
  new SelectUsageErrorOutcomeCommand({ kind: error._tag, message: error.message, isTty })

const detailedShowHelpCommand = (error: CliError.ShowHelp, isTty: boolean): SelectUsageErrorOutcomeCommand =>
  new SelectUsageErrorOutcomeCommand({
    kind: error.errors[0]._tag,
    message: error.errors.map((one) => usageErrorFormatter.formatCliError(one)).join('; '),
    isTty,
  })

const showHelpUsageErrorCommand = (error: CliError.ShowHelp, isTty: boolean): SelectUsageErrorOutcomeCommand =>
  error.errors.length === 0 ? emptyShowHelpCommand(error, isTty) : detailedShowHelpCommand(error, isTty)

export const renderCliError = (error: CliError.CliError): Effect.Effect<number, never, Terminal> =>
  Effect.gen(function*() {
    const terminal = yield* Terminal
    const observations = yield* terminal.observations
    const decision = Result.getOrThrow(selectUsageErrorOutcome(usageErrorCommandOf(error, observations.isTty)))
    yield* terminal.writeError(decision.document).pipe(Effect.orDie)
    return decision.exitCode
  })

const writeToSink = (
  stream: 'stdout' | 'stderr',
  terminal: TerminalService,
  text: string,
): Effect.Effect<void, never> =>
  Effect.orDie(
    Match.value(stream).pipe(
      Match.when('stdout', () => terminal.write(text)),
      Match.when('stderr', () => terminal.writeError(text)),
      Match.exhaustive,
    ),
  )

const writeCaptured = (
  stream: 'stdout' | 'stderr',
  captured: readonly string[],
): Effect.Effect<void, never, Terminal> =>
  Effect.gen(function*() {
    if (captured.length === 0) return
    const terminal = yield* Terminal
    yield* writeToSink(stream, terminal, captured.map((line) => `${line}\n`).join(''))
  })

const isBareShowHelp = (error: CliError.CliError): boolean =>
  Schema.is(CliError.ShowHelp)(error) && error.errors.length === 0

const handleCliError = (error: CliError.CliError, captured: readonly string[]): Effect.Effect<void, never, Terminal> =>
  Effect.gen(function*() {
    if (isBareShowHelp(error)) {
      yield* writeCaptured('stdout', captured)
      return
    }
    const exitCode = yield* renderCliError(error)
    yield* writeCaptured('stderr', captured)
    yield* Effect.sync(() => {
      process.exitCode = exitCode
    })
  })

const captureFrameworkLog = (captured: string[]): Console.Console => ({
  ...globalThis.console,
  log: (...args: Parameters<Console.Console['log']>): void => {
    captured.push(args.map(String).join(' '))
  },
})

export const runCli: {
  (
    options: { readonly version: string },
  ): (
    argv: ReadonlyArray<string>,
  ) => Effect.Effect<void, never, RunAttwServices | Command.Environment>
  (
    argv: ReadonlyArray<string>,
    options: { readonly version: string },
  ): Effect.Effect<void, never, RunAttwServices | Command.Environment>
} = Function.dual(2, (argv: ReadonlyArray<string>, options: { readonly version: string }) => {
  const captured: string[] = []
  return Command.runWith(runAttwCommand, { version: options.version, renderErrors: false })(argv).pipe(
    Effect.tap(() => writeCaptured('stdout', captured)),
    Effect.catchIf(CliError.isCliError, (error) => handleCliError(error, captured)),
    Effect.provideService(Console.Console, captureFrameworkLog(captured)),
  )
})
