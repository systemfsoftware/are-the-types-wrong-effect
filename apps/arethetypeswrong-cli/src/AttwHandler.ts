import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Function from 'effect/Function'
import type * as JsonSchema from 'effect/JsonSchema'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Argument from 'effect/unstable/cli/Argument'
import * as CliError from 'effect/unstable/cli/CliError'
import * as CliOutput from 'effect/unstable/cli/CliOutput'
import * as Command from 'effect/unstable/cli/Command'
import * as Flag from 'effect/unstable/cli/Flag'

import type { CliRequest } from './AttwExecutor.js'
import { runAttw } from './AttwExecutor.js'
import { cliVersion } from './cli-version.js'
import { failureOutcome } from './failure-shaping.js'
import type { AttwFailure } from './Failure.schema.js'
import { CliFilesystem as Filesystem } from './FilesystemAdapter.js'
import { PackRunner } from './PackRunnerAdapter.js'
import { CliFormat, CliProfile } from './ProblemUtils.js'
import { buildSchemaDocument, schemaCommand } from './schema-command.js'
import { Terminal } from './TerminalAdapter.js'

const defaultFormat: typeof CliFormat[number] = 'auto'
const defaultProfile: typeof CliProfile[number] = 'strict'

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
    Flag.withDefault(defaultFormat),
  ),
  'quiet': Flag.Boolean('quiet').pipe(
    Flag.withAlias('q'),
    Flag.withDefault(false),
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
  'entrypoints-legacy': Flag.Boolean('entrypoints-legacy').pipe(Flag.withDefault(false)),
  'ignore-rules': Flag.String('ignore-rules').pipe(
    Flag.withAlias('ignore-rule'),
    Flag.atLeast<string>(1),
    Flag.withFallbackConfig(Config.Array(Schema.String, 'ignoreRules')),
    Flag.optional,
  ),
  'profile': Flag.Literals('profile', CliProfile).pipe(Flag.withDefault(defaultProfile)),
  'summary': Flag.Boolean('summary').pipe(Flag.withDefault(true)),
  'emoji': Flag.Boolean('emoji').pipe(Flag.withDefault(true)),
  'color': Flag.Boolean('color').pipe(Flag.withDefault(true)),
  'registry': Flag.String('registry').pipe(
    Flag.withDescription(
      'URL of the npm registry to read packages from with --from-npm (default: https://registry.npmjs.org)',
    ),
    Flag.withFallbackConfig(
      Config.String('registry').pipe(Config.withDefault('https://registry.npmjs.org')),
    ),
  ),
} as const

const analyzeTarget = Argument.optional(Argument.String('file-directory-or-package-spec'))

const analyzeConfig = { ...analyzeFlags, target: analyzeTarget }

type AnalyzeConfig = Command.Command.Config.Infer<typeof analyzeConfig>

export const implementedFlags: readonly string[] = Object.keys(analyzeFlags)

const isSchemaNode = (variant: unknown): variant is JsonSchema.JsonSchema => variant instanceof Object

const schemaArray = (document: JsonSchema.Document<'draft-2020-12'>): readonly JsonSchema.JsonSchema[] => {
  const variants = document.schema['anyOf']
  return Array.isArray(variants) ? variants.filter(isSchemaNode) : []
}

const propertyNamesOf = (schema: JsonSchema.JsonSchema): readonly string[] => {
  const properties = schema['properties']
  if (properties instanceof Object) return Object.keys(properties)
  return []
}

const documentedPropertyNames = (document: JsonSchema.Document<'draft-2020-12'>): readonly string[] => {
  const variants = [...schemaArray(document), ...Object.values(document.definitions)]
  const names = [
    ...propertyNamesOf(document.schema),
    ...variants.flatMap((variant) => propertyNamesOf(variant)),
  ]
  return names.filter((name, index) => names.indexOf(name) === index)
}

const publishedSchemaDocument = buildSchemaDocument(cliVersion)

export const documentedFlags: readonly string[] = documentedPropertyNames(publishedSchemaDocument.input)

export const documentedEnvelopeKeys: readonly string[] = documentedPropertyNames(publishedSchemaDocument.envelope)

const unwrap = <A>(opt: Option.Option<A>): A | undefined => {
  if (Option.isSome(opt)) return opt.value
  return undefined
}

const analyzeHandler = (
  config: AnalyzeConfig,
): Effect.Effect<number, never, Terminal | Filesystem | PackRunner | Command.Environment> =>
  Effect.gen(function*() {
    const input: CliRequest = {
      fileOrDirectory: unwrap(config.target) ?? '.',
      pack: config['pack'],
      fromNpm: config['from-npm'],
      definitelyTyped: unwrap(config['definitely-typed']),
      format: config['format'],
      quiet: config['quiet'],
      entrypoints: unwrap(config['entrypoints']),
      includeEntrypoints: unwrap(config['include-entrypoints']),
      excludeEntrypoints: unwrap(config['exclude-entrypoints']),
      entrypointsLegacy: config['entrypoints-legacy'],
      include: unwrap(config['include']),
      ignoreRules: unwrap(config['ignore-rules']),
      profile: config['profile'],
      summary: config['summary'],
      emoji: config['emoji'],
      color: config['color'],
      registry: config['registry'],
    }
    const exitCode = yield* runAttw(input).pipe(Effect.catch(renderFailure))
    yield* Effect.sync(() => {
      process.exitCode = exitCode
    })
    return exitCode
  })

const analyzeCommand = Command.make('analyze', analyzeConfig, analyzeHandler)

export const attwCommand = Command.make('attw', analyzeConfig, analyzeHandler).pipe(
  Command.withSubcommands([analyzeCommand, schemaCommand]),
)

export const renderFailure = (failure: AttwFailure): Effect.Effect<number, never, Terminal> =>
  Effect.gen(function*() {
    const terminal = yield* Terminal
    const outcome = failureOutcome(failure, { isTty: terminal.isTty })
    yield* terminal.stderr.write(outcome.document)
    return outcome.exitCode
  })

const usageErrorFormatter = CliOutput.defaultFormatter({ colors: false })

const usageRecovery = 'Run `attw --help` to see the accepted commands and flags.'

export interface UsageErrorCommand {
  readonly kind: string
  readonly message: string
  readonly isTty: boolean
}

export interface UsageErrorOutcome {
  readonly document: string
  readonly exitCode: number
}

export const usageErrorOutcome = (command: UsageErrorCommand): UsageErrorOutcome => {
  if (command.isTty) return { document: `${command.message}. ${usageRecovery}\n`, exitCode: 1 }
  return {
    document: `${
      JSON.stringify({
        status: 'error',
        kind: command.kind,
        message: command.message,
        recovery: usageRecovery,
      })
    }\n`,
    exitCode: 1,
  }
}

const formattedUsageErrorCommand = (error: CliError.CliError, isTty: boolean): UsageErrorCommand => ({
  kind: error._tag,
  message: usageErrorFormatter.formatCliError(error),
  isTty,
})

const emptyShowHelpCommand = (error: CliError.ShowHelp, isTty: boolean): UsageErrorCommand => ({
  kind: error._tag,
  message: error.message,
  isTty,
})

const detailedShowHelpCommand = (error: CliError.ShowHelp, isTty: boolean): UsageErrorCommand => ({
  kind: error.errors[0]._tag,
  message: error.errors.map((one) => usageErrorFormatter.formatCliError(one)).join('; '),
  isTty,
})

const showHelpUsageErrorCommand = (error: CliError.ShowHelp, isTty: boolean): UsageErrorCommand => {
  if (error.errors.length === 0) return emptyShowHelpCommand(error, isTty)
  return detailedShowHelpCommand(error, isTty)
}

const usageErrorCommandOf = (error: CliError.CliError, isTty: boolean): UsageErrorCommand => {
  if (Schema.is(CliError.ShowHelp)(error)) return showHelpUsageErrorCommand(error, isTty)
  return formattedUsageErrorCommand(error, isTty)
}

export const renderCliError = (error: CliError.CliError): Effect.Effect<number, never, Terminal> =>
  Effect.gen(function*() {
    const terminal = yield* Terminal
    const outcome = usageErrorOutcome(usageErrorCommandOf(error, terminal.isTty))
    yield* terminal.stderr.write(outcome.document)
    return outcome.exitCode
  })

const writeCaptured = (
  stream: 'stdout' | 'stderr',
  captured: readonly string[],
): Effect.Effect<void, never, Terminal> =>
  Effect.gen(function*() {
    if (captured.length === 0) return
    const terminal = yield* Terminal
    const sink = { stdout: terminal.stdout, stderr: terminal.stderr }[stream]
    yield* sink.write(captured.map((line) => `${line}\n`).join(''))
  })

const isBareShowHelp = (error: CliError.CliError): boolean =>
  Schema.is(CliError.ShowHelp)(error) && error.errors.length === 0

const handleCliError = (
  error: CliError.CliError,
  captured: readonly string[],
): Effect.Effect<void, never, Terminal> =>
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

export const runCli = Function.dual<
  (
    options: { readonly version: string },
  ) => (
    argv: ReadonlyArray<string>,
  ) => Effect.Effect<void, never, Terminal | Filesystem | PackRunner | Command.Environment>,
  (
    argv: ReadonlyArray<string>,
    options: { readonly version: string },
  ) => Effect.Effect<void, never, Terminal | Filesystem | PackRunner | Command.Environment>
>(2, (argv, options) => {
  const captured: string[] = []
  return Command.runWith(attwCommand, { version: options.version, renderErrors: false })(argv).pipe(
    Effect.tap(() => writeCaptured('stdout', captured)),
    Effect.catchIf(CliError.isCliError, (error) => handleCliError(error, captured)),
    Effect.provideService(Console.Console, captureFrameworkLog(captured)),
  )
})
