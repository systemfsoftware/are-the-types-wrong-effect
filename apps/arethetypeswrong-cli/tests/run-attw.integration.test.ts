import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodeHttpClient,
  NodeHttpServer,
  NodePath,
} from '@effect/platform-node'
import { layer as nodeStdioLayer } from '@effect/platform-node-shared/NodeStdio'
import { layer as nodeTerminalLayer } from '@effect/platform-node-shared/NodeTerminal'
import { it } from '@effect/vitest'
import { Recipe } from '@systemfsoftware/arethetypeswrong-recipes'
import { packPackage, packTree } from '@systemfsoftware/npm-package'
import { Effect, Layer, Result, Schema as S } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as Command from 'effect/unstable/cli/Command'
import * as HttpRouter from 'effect/unstable/http/HttpRouter'
import * as HttpServer from 'effect/unstable/http/HttpServer'
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse'
import { afterAll, beforeAll, describe, expect } from 'vitest'

import { cliVersion } from '../src/cli-version.js'
import * as HttpRegistry from '../src/drivers/http-registry.js'
import * as NodeFilesystem from '../src/drivers/node-filesystem.js'
import * as NpmPackRunner from '../src/drivers/npm-pack-runner.js'
import { CompactJson } from '../src/RenderJson.schema.js'
import { runAttw } from '../src/run-attw.cell.js'
import type { RunAttwFlags, RunAttwRequest } from '../src/run-attw.cell.js'
import { analyzeFlags, runAttwCommand, runCli } from '../src/run-attw.command.js'
import { Terminal } from '../src/terminal.service.js'
import { TerminalObservations } from '../src/TerminalError.schema.js'
import {
  EnvelopeText,
  FailureText,
  PackageManifestText,
  RegistryManifest,
  Waiver,
} from './__fixtures__/run-attw.schema.js'

interface Capture {
  readonly stdout: string[]
  readonly stderr: string[]
}

const capture = (): Capture => ({ stdout: [], stderr: [] })

const neverExit = (): Effect.Effect<never> => Effect.die(new Error('the captured run never exits in a test'))

const terminalOf = (captured: Capture) =>
  Terminal.of({
    write: (text: string) =>
      Effect.sync(() => {
        captured.stdout.push(text)
      }),
    writeError: (text: string) =>
      Effect.sync(() => {
        captured.stderr.push(text)
      }),
    observations: Effect.succeed(new TerminalObservations({ isTty: false, width: 120 })),
    environment: Effect.succeed({}),
    exit: neverExit,
  })

const platformBase = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const spawnerLayer = NodeChildProcessSpawner.layer.pipe(Layer.provide(platformBase))

const nodeFilesystemLayer = NodeFilesystem.layer().pipe(Layer.provide(platformBase))

const npmPackRunnerLayer = NpmPackRunner.layer().pipe(
  Layer.provide(Layer.mergeAll(platformBase, spawnerLayer)),
)

const httpRegistryLayer = HttpRegistry.layer({ maxPayloadBytes: 8 * 1024 * 1024 }).pipe(
  Layer.provide(NodeHttpClient.layerFetch),
)

const cellLayer = (captured: Capture) =>
  Layer.mergeAll(
    Layer.succeed(Terminal, terminalOf(captured)),
    nodeFilesystemLayer,
    npmPackRunnerLayer,
    httpRegistryLayer,
  )

const commandEnvironmentLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  nodeTerminalLayer,
  nodeStdioLayer,
  spawnerLayer,
)

const commandLayer = (captured: Capture) => Layer.mergeAll(cellLayer(captured), commandEnvironmentLayer)

const runCellPath = (captured: Capture, request: RunAttwRequest) =>
  runAttw.run(request).pipe(Effect.orDie, Effect.provide(cellLayer(captured)))

const cellRequestOf = (target: string, flags: RunAttwFlags, configPath: string): RunAttwRequest => ({
  target,
  configPath,
  flags,
})

const manifestText = (manifest: S.Schema.Type<typeof PackageManifestText>): string =>
  Result.getOrThrow(S.encodeResult(PackageManifestText)(manifest))

interface FixtureTree {
  readonly name: string
  readonly files: Record<string, string>
}

const wellFormedManifest = (name: string): string =>
  manifestText({
    name,
    version: '1.0.0',
    main: './dist/index.cjs',
    types: './dist/index.d.cts',
    exports: { '.': { import: './dist/index.mjs', require: './dist/index.cjs' } },
  })

const wellFormedFiles = (name: string): Record<string, string> => ({
  'package.json': wellFormedManifest(name),
  'dist/index.d.mts': 'export declare const value: number;\n',
  'dist/index.mjs': 'export const value = 1;\n',
  'dist/index.d.cts': 'export declare const value: number;\n',
  'dist/index.cjs': 'module.exports = { value: 1 };\n',
})

const wellFormedTree: FixtureTree = { name: 'well-formed', files: wellFormedFiles('well-formed') }

const falseCjsTree: FixtureTree = {
  name: 'false-cjs',
  files: {
    'package.json': manifestText({
      name: 'false-cjs',
      version: '1.0.0',
      main: './dist/index.cjs',
      types: './dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs', require: './dist/index.cjs' } },
    }),
    'dist/index.d.ts': 'export declare const foo: string;\n',
    'dist/index.cjs': 'module.exports = { foo: "bar" };\nmodule.exports.foo = "bar";\n',
    'dist/index.mjs': 'export const foo = "bar";\nexport default {};\n',
  },
}

const untypedTree: FixtureTree = {
  name: 'types-companion',
  files: {
    'package.json': manifestText({ name: 'types-companion', version: '1.0.0', main: './dist/index.js' }),
    'dist/index.js': 'module.exports = { foo: "bar" };\n',
  },
}

const noExportsTree: FixtureTree = {
  name: 'no-exports-typed',
  files: {
    'package.json': manifestText({
      name: 'no-exports-typed',
      version: '1.0.0',
      main: './index.js',
      types: './index.d.ts',
    }),
    'index.js': 'module.exports = { value: 1 };\n',
    'index.d.ts': 'export declare const value: number;\n',
  },
}

const NODE10_ONLY_MANIFEST =
  '{"name":"node10-only","version":"1.0.0","type":"module","exports":{".":{"import":{"types":"./dist/index.d.mts","default":"./dist/index.mjs"},"require":{"types":"./dist/index.d.cts","default":"./dist/index.cjs"}}}}'

const node10OnlyTree: FixtureTree = {
  name: 'node10-only',
  files: {
    'package.json': NODE10_ONLY_MANIFEST,
    'dist/index.d.mts': 'export declare const foo: string;\n',
    'dist/index.mjs': 'export const foo = "bar";\n',
    'dist/index.d.cts': 'export declare const foo: string;\n',
    'dist/index.cjs': '"use strict";\nmodule.exports = { foo: "bar" };\n',
  },
}

const fixtureTrees: readonly FixtureTree[] = [
  wellFormedTree,
  falseCjsTree,
  untypedTree,
  noExportsTree,
  node10OnlyTree,
]

const waiverText = Result.getOrThrow(S.encodeResult(Waiver)({ ignoreRules: ['false-cjs'] }))

const REGISTRY_PACKAGE = 'attw-served'
const REGISTRY_VERSION = '1.0.0'
const MISSING_VERSION = '9.9.9'
const OVERBUDGET_VERSION = '8.8.8'

const registryTree: FixtureTree = { name: REGISTRY_PACKAGE, files: wellFormedFiles(REGISTRY_PACKAGE) }

let fixtureDir = ''
let registryTarball: Uint8Array<ArrayBufferLike> = new Uint8Array()

const prepareFixtures = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = yield* fs.makeTempDirectory({ prefix: 'attw-run-cell-' })
  for (const tree of fixtureTrees) {
    yield* fs.writeFile(path.join(dir, `${tree.name}.tgz`), packTree(tree.files, tree.name))
  }
  for (const recipe of [Recipe.MultiEntrypoint, Recipe.UntypedResolution]) {
    const pkg = recipe()
    yield* fs.writeFile(path.join(dir, `${pkg.packageName}.tgz`), packPackage(pkg))
  }
  yield* fs.writeFileString(path.join(dir, 'corrupt.tgz'), 'not a tarball')
  yield* fs.writeFileString(path.join(dir, 'waiver.attw.json'), waiverText)
  registryTarball = packTree(registryTree.files, registryTree.name)
  const packDir = path.join(dir, 'packable')
  yield* fs.makeDirectory(packDir)
  yield* fs.writeFileString(
    path.join(packDir, 'package.json'),
    manifestText({ name: 'attw-packable', version: '1.0.0', main: './index.js', types: './index.d.ts' }),
  )
  yield* fs.writeFileString(path.join(packDir, 'index.js'), 'module.exports = { value: 1 };\n')
  yield* fs.writeFileString(path.join(packDir, 'index.d.ts'), 'export declare const value: number;\n')
  return dir
})

beforeAll(() =>
  Effect.runPromise(
    prepareFixtures.pipe(
      Effect.provide(platformBase),
      Effect.tap((dir) =>
        Effect.sync(() => {
          fixtureDir = dir
        })
      ),
    ),
  )
)

afterAll(() =>
  Effect.runPromise(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      if (fixtureDir === '') return
      yield* fs.remove(fixtureDir, { recursive: true, force: true })
    }).pipe(Effect.provide(platformBase)),
  )
)

const tarball = (packageName: string): string => `${fixtureDir}/${packageName}.tgz`

const absentConfigPath = (): string => `${fixtureDir}/absent.attw.json`
const waiverConfigPath = (): string => `${fixtureDir}/waiver.attw.json`

const RESOLUTION_COLUMNS = ['node10', 'node16-cjs', 'node16-esm', 'bundler'] as const
const TABLE_HEADER = ['Entrypoint', ...RESOLUTION_COLUMNS]
const FLIPPED_HEADER = ['Entrypoint', '.']
const emojiProblemCells = /^[✘◌⚠]+$/
const okCells = /^(?:✔|OK)$/
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text: string): string => text.replace(ANSI_SGR, '')

const HINT_FIELDS = ['--include', 'entrypoints', 'buildTools', 'programInfo', 'traces'] as const

const asciiProblemCells = /^[X!-]+$/
const untypedCells = /^◌+$/

interface EnvelopeRowExpectation {
  readonly form: 'envelope'
  readonly exitCode: number
  readonly status: 'ok' | 'untyped'
  readonly packageName: string
  readonly problemKinds: readonly string[]
  readonly stderrIncludes: readonly string[]
  readonly stderrEmpty?: boolean
  readonly hintLineCount?: number
  readonly restoredKeys?: readonly string[]
  readonly compactStdout?: boolean
}

type RowExpectation =
  | {
    readonly form: 'table'
    readonly exitCode: number
    readonly header: readonly string[]
    readonly labels: readonly string[]
    readonly cell: RegExp
  }
  | { readonly form: 'untyped-prose'; readonly exitCode: number; readonly packageName: string }
  | EnvelopeRowExpectation
  | { readonly form: 'failure'; readonly exitCode: number; readonly failureKind: string }

interface Scenario {
  readonly name: string
  readonly target: () => string
  readonly flags: RunAttwFlags
  readonly configPath: () => string
  readonly expectation: RowExpectation
}

const scenario = (
  name: string,
  target: () => string,
  flags: RunAttwFlags,
  expectation: RowExpectation,
  configPath: () => string = absentConfigPath,
): Scenario => ({ name, target, flags, configPath, expectation })

const tableExpectation = (exitCode: number, cell: RegExp, flipped: boolean): RowExpectation => ({
  form: 'table',
  exitCode,
  header: flipped ? FLIPPED_HEADER : TABLE_HEADER,
  labels: flipped ? RESOLUTION_COLUMNS : ['.'],
  cell,
})

const envelopeExpectation = (
  exitCode: number,
  status: 'ok' | 'untyped',
  packageName: string,
  problemKinds: readonly string[],
  stderrIncludes: readonly string[],
): RowExpectation => ({ form: 'envelope', exitCode, status, packageName, problemKinds, stderrIncludes })

const untypedProseExpectation: RowExpectation = { form: 'untyped-prose', exitCode: 0, packageName: 'types-companion' }

const formats = ['table', 'table-flipped', 'ascii', 'json'] as const

interface FormatFixture {
  readonly noun: string
  readonly target: () => string
  readonly exitCode: number
  readonly cell: RegExp
  readonly json: RowExpectation
  readonly untyped: boolean
}

const formatFixtures: readonly FormatFixture[] = [
  {
    noun: 'clean package',
    target: () => tarball('well-formed'),
    exitCode: 0,
    cell: okCells,
    json: envelopeExpectation(0, 'ok', 'well-formed', [], HINT_FIELDS),
    untyped: false,
  },
  {
    noun: 'package with problems',
    target: () => tarball('false-cjs'),
    exitCode: 1,
    cell: emojiProblemCells,
    json: envelopeExpectation(1, 'ok', 'false-cjs', ['FalseCJS'], HINT_FIELDS),
    untyped: false,
  },
  {
    noun: 'untyped package',
    target: () => tarball('types-companion'),
    exitCode: 0,
    cell: okCells,
    json: envelopeExpectation(0, 'untyped', 'types-companion', [], ['untyped']),
    untyped: true,
  },
]

const formatScenarios: readonly Scenario[] = formats.flatMap((format) =>
  formatFixtures.map((fixture) => {
    const expectation = format === 'json'
      ? fixture.json
      : fixture.untyped
      ? untypedProseExpectation
      : tableExpectation(fixture.exitCode, fixture.cell, format === 'table-flipped')
    return scenario(`${format} on a ${fixture.noun}`, fixture.target, { format }, expectation)
  })
)

const localScenarios: readonly Scenario[] = [
  ...formatScenarios,
  scenario(
    'strict profile on a package with problems',
    () => tarball('false-cjs'),
    { profile: 'strict', format: 'json' },
    envelopeExpectation(1, 'ok', 'false-cjs', ['FalseCJS'], ['--include']),
  ),
  scenario(
    'node16 profile on a package with problems',
    () => tarball('false-cjs'),
    { profile: 'node16', format: 'json' },
    envelopeExpectation(1, 'ok', 'false-cjs', ['FalseCJS'], ['--include']),
  ),
  scenario(
    'esm-only profile on a package with problems',
    () => tarball('false-cjs'),
    { profile: 'esm-only', format: 'json' },
    envelopeExpectation(1, 'ok', 'false-cjs', ['FalseCJS'], ['--include']),
  ),
  scenario(
    'ignore-rules silences the named rule',
    () => tarball('false-cjs'),
    { ignoreRules: ['false-cjs'], format: 'json' },
    envelopeExpectation(0, 'ok', 'false-cjs', [], ['--include']),
  ),
  scenario(
    'an .attw.json waiver suppresses the waived rule',
    () => tarball('false-cjs'),
    { format: 'table' },
    tableExpectation(0, okCells, false),
    waiverConfigPath,
  ),
  scenario(
    'entrypoints-legacy on a no-exports package',
    () => tarball('no-exports-typed'),
    { entrypointsLegacy: true, format: 'json' },
    envelopeExpectation(1, 'ok', 'no-exports-typed', ['NamedExports'], ['--include']),
  ),
  scenario('a missing tarball path', () => `${fixtureDir}/missing.tgz`, {}, {
    form: 'failure',
    exitCode: 1,
    failureKind: 'TargetNotPackable',
  }),
  scenario(
    'pack analyzes a packable directory',
    () => `${fixtureDir}/packable`,
    { pack: true, format: 'json' },
    envelopeExpectation(1, 'ok', 'attw-packable', ['NamedExports'], ['--include']),
  ),
  scenario(
    'pack reports an unresolvable directory',
    () => `${fixtureDir}/not-a-directory`,
    { pack: true, format: 'json' },
    { form: 'failure', exitCode: 1, failureKind: 'PackFailed' },
  ),
]

const authoredScenarios: readonly Scenario[] = [
  scenario(
    'table on an untyped-resolution package',
    () => tarball('untyped-resolution'),
    { format: 'table' },
    tableExpectation(1, untypedCells, false),
  ),
  scenario(
    'json on an untyped-resolution package',
    () => tarball('untyped-resolution'),
    { format: 'json' },
    envelopeExpectation(1, 'ok', 'untyped-resolution', [
      'UntypedResolution',
      'UntypedResolution',
      'UntypedResolution',
      'UntypedResolution',
    ], HINT_FIELDS),
  ),
  scenario(
    'table on a multi-entrypoint package',
    () => tarball('multi-entrypoint'),
    { format: 'table' },
    { form: 'table', exitCode: 1, header: TABLE_HEADER, labels: ['.', './macros', './utils'], cell: emojiProblemCells },
  ),
  scenario(
    'entrypoints restricts the analysis to the selected entrypoints',
    () => tarball('multi-entrypoint'),
    { entrypoints: ['.'], format: 'table' },
    { form: 'table', exitCode: 1, header: TABLE_HEADER, labels: ['.'], cell: emojiProblemCells },
  ),
  scenario(
    'exclude-entrypoints drops the excluded entrypoint from the analysis',
    () => tarball('multi-entrypoint'),
    { excludeEntrypoints: ['macros'], format: 'table' },
    { form: 'table', exitCode: 1, header: TABLE_HEADER, labels: ['.', './utils'], cell: emojiProblemCells },
  ),
  scenario(
    'ascii without emoji on a package with problems',
    () => tarball('false-cjs'),
    { format: 'ascii', emoji: false },
    { form: 'table', exitCode: 1, header: TABLE_HEADER, labels: ['.'], cell: asciiProblemCells },
  ),
  scenario(
    'the default format on a package with problems',
    () => tarball('false-cjs'),
    {},
    {
      form: 'envelope',
      exitCode: 1,
      status: 'ok',
      packageName: 'false-cjs',
      problemKinds: ['FalseCJS'],
      stderrIncludes: HINT_FIELDS,
      compactStdout: true,
      hintLineCount: 1,
    },
  ),
  scenario(
    'include restores a requested field and silences the hint',
    () => tarball('false-cjs'),
    { include: ['entrypoints'] },
    {
      form: 'envelope',
      exitCode: 1,
      status: 'ok',
      packageName: 'false-cjs',
      problemKinds: ['FalseCJS'],
      stderrIncludes: [],
      stderrEmpty: true,
      restoredKeys: ['entrypoints'],
    },
  ),
  scenario(
    'a node16 profile silences every problem',
    () => tarball('node10-only'),
    { profile: 'node16' },
    {
      form: 'envelope',
      exitCode: 0,
      status: 'ok',
      packageName: 'node10-only',
      problemKinds: [],
      stderrIncludes: [],
    },
  ),
  scenario('a corrupt tarball', () => `${fixtureDir}/corrupt.tgz`, {}, {
    form: 'failure',
    exitCode: 1,
    failureKind: 'AnalysisFailed',
  }),
  scenario(
    'an unreachable registry',
    () => 'attw-never-resolves',
    { fromNpm: true, registry: 'http://127.0.0.1:9' },
    { form: 'failure', exitCode: 1, failureKind: 'RegistryUnreachable' },
  ),
]

const isJsonObject = (value: S.Json | undefined): value is S.JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const jsonOf = (text: string, whenUnparseable: string): S.Json => {
  const decoded = S.decodeResult(CompactJson)(text)
  if (Result.isFailure(decoded)) throw new Error(whenUnparseable)
  return decoded.success
}

interface DecodedEnvelope {
  readonly status: 'ok' | 'untyped'
  readonly packageName: string
  readonly problemKinds: readonly string[]
}

const decodedEnvelopeOf = (stdout: string): DecodedEnvelope => {
  const decoded = S.decodeResult(EnvelopeText)(stdout)
  if (Result.isFailure(decoded)) throw new Error(`attw printed no envelope object: ${stdout}`)
  const envelope = decoded.success
  return {
    status: envelope.status,
    packageName: envelope.packageName,
    problemKinds: (envelope.problems ?? []).map((problem) => problem.kind),
  }
}

const envelopeKeysOf = (stdout: string): readonly string[] => {
  const parsed = jsonOf(stdout, `attw printed no envelope object: ${stdout}`)
  return isJsonObject(parsed) ? Object.keys(parsed) : []
}

interface HumanTable {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

const humanTable = (stdout: string): HumanTable => {
  const lines = stripAnsi(stdout).split('\n').filter((line) => line.trim() !== '')
  const headerIndex = lines.findIndex((line) => line.trim().startsWith('Entrypoint'))
  if (headerIndex === -1) throw new Error(`attw printed no human table: ${stdout}`)
  const headerLine = lines[headerIndex]
  const header = headerLine.trim().split(/\s{2,}/)
  const rows = lines.slice(headerIndex + 1).map((line) => line.trim().split(/\s{2,}/))
  return { header, rows }
}

const failureKindOf = (stderr: string): string => {
  const decoded = S.decodeResult(FailureText)(stderr)
  if (Result.isFailure(decoded)) throw new Error(`attw printed no failure document: ${stderr}`)
  return decoded.success.kind
}

const expectRow = (tested: Scenario, captured: Capture, exitCode: number, leg: string): void => {
  const stdout = captured.stdout.join('')
  const stderr = captured.stderr.join('')
  const expectation = tested.expectation
  expect(exitCode, `${tested.name} (${leg}): exit code`).toBe(expectation.exitCode)
  if (expectation.form === 'failure') {
    expect(stdout, `${tested.name} (${leg}): failure stdout is empty`).toBe('')
    expect(failureKindOf(stderr), `${tested.name} (${leg}): failure kind`).toBe(expectation.failureKind)
    return
  }
  if (expectation.form === 'untyped-prose') {
    expect(stdout, `${tested.name} (${leg}): untyped prose`).toContain(
      `Package ${expectation.packageName}@1.0.0 has no types.`,
    )
    return
  }
  if (expectation.form === 'table') {
    const table = humanTable(stdout)
    expect(table.header, `${tested.name} (${leg}): table header`).toEqual([...expectation.header])
    expect(table.rows.map((row) => row[0]), `${tested.name} (${leg}): table labels`).toEqual([...expectation.labels])
    for (const row of table.rows) {
      for (const value of row.slice(1)) expect(value, `${tested.name} (${leg}): table cell`).toMatch(expectation.cell)
    }
    return
  }
  const envelope = decodedEnvelopeOf(stdout)
  expect(envelope.status, `${tested.name} (${leg}): envelope status`).toBe(expectation.status)
  expect(envelope.packageName, `${tested.name} (${leg}): envelope package name`).toBe(expectation.packageName)
  expect(envelope.problemKinds, `${tested.name} (${leg}): envelope problem kinds`).toEqual([
    ...expectation.problemKinds,
  ])
  for (const fragment of expectation.stderrIncludes) {
    expect(stderr, `${tested.name} (${leg}): stderr hint`).toContain(fragment)
  }
  if (expectation.stderrEmpty === true) {
    expect(stderr, `${tested.name} (${leg}): stderr is silent`).toBe('')
  }
  if (expectation.hintLineCount !== undefined) {
    expect(
      stderr.split('\n').filter((line) => line !== ''),
      `${tested.name} (${leg}): stderr hint lines`,
    ).toHaveLength(expectation.hintLineCount)
  }
  if (expectation.restoredKeys !== undefined) {
    const keys = envelopeKeysOf(stdout)
    for (const key of expectation.restoredKeys) {
      expect(keys, `${tested.name} (${leg}): restored envelope key`).toContain(key)
    }
  }
  if (expectation.compactStdout === true) {
    expect(stdout.endsWith('\n'), `${tested.name} (${leg}): stdout ends with a newline`).toBe(true)
    expect(stdout.trimEnd().includes('\n'), `${tested.name} (${leg}): stdout is one line`).toBe(false)
    expect(stdout.includes(String.fromCharCode(27)), `${tested.name} (${leg}): stdout carries no ANSI`).toBe(false)
  }
}

const runRow = (tested: Scenario) =>
  Effect.gen(function*() {
    const cellCaptured = capture()
    const cellExit = yield* runCellPath(cellCaptured, cellRequestOf(tested.target(), tested.flags, tested.configPath()))
    expectRow(tested, cellCaptured, cellExit, 'run')
  })

const firstLine = (text: string): string => text.split('\n')[0] ?? ''

interface CommandRun {
  readonly captured: Capture
  readonly exitCode: number
}

const runCommandPath = (argv: readonly string[]): Effect.Effect<CommandRun> =>
  Effect.gen(function*() {
    const captured = capture()
    yield* Effect.sync(() => {
      process.exitCode = 0
    })
    yield* runCli({ version: cliVersion })([...argv]).pipe(Effect.orDie, Effect.provide(commandLayer(captured)))
    const exitCode = yield* Effect.sync(() => {
      const code = process.exitCode
      return typeof code === 'number' ? code : 0
    })
    yield* Effect.sync(() => {
      process.exitCode = 0
    })
    return { captured, exitCode }
  })

const registryManifest = (base: string): string =>
  Result.getOrThrow(
    S.encodeResult(RegistryManifest)({
      name: REGISTRY_PACKAGE,
      version: REGISTRY_VERSION,
      dist: { tarball: `${base}/${REGISTRY_PACKAGE}-${REGISTRY_VERSION}.tgz` },
    }),
  )

const registryRoutes = Layer.mergeAll(
  HttpRouter.add(
    'GET',
    `/${REGISTRY_PACKAGE}/${REGISTRY_VERSION}`,
    (request) =>
      Effect.succeed(
        HttpServerResponse.text(registryManifest(`http://${request.headers['host'] ?? '127.0.0.1'}`)),
      ),
  ),
  HttpRouter.add(
    'GET',
    `/${REGISTRY_PACKAGE}/${OVERBUDGET_VERSION}`,
    HttpServerResponse.text(`{"padding":"${'x'.repeat(9 * 1024 * 1024)}"}`),
  ),
  HttpRouter.add(
    'GET',
    `/${REGISTRY_PACKAGE}/${MISSING_VERSION}`,
    HttpServerResponse.text('{"status":"unclaimed"}', { status: 404 }),
  ),
  HttpRouter.add(
    'GET',
    `/${REGISTRY_PACKAGE}-${REGISTRY_VERSION}.tgz`,
    () => Effect.succeed(HttpServerResponse.uint8Array(registryTarball)),
  ),
)

const listening = HttpRouter.serve(registryRoutes, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.orDie,
)

const registryBase = () =>
  HttpServer.addressFormattedWith((address) => Effect.succeed(address.replace('[::]', '[::1]')))

const publishedEnvelopeKeys: readonly string[] = [
  'status',
  'packageName',
  'packageVersion',
  'types',
  'problems',
  'problemCounts',
  'entrypoints',
  'buildTools',
  'programInfo',
] as const

const propertyNamesOf = (value: S.JsonObject): readonly string[] => {
  const properties = value['properties']
  if (!isJsonObject(properties)) return []
  return Object.keys(properties)
}

const propertyNamesIn = (value: S.Json | undefined): readonly string[] => {
  if (Array.isArray(value)) return value.filter(isJsonObject).flatMap((each) => propertyNamesOf(each))
  if (isJsonObject(value)) return Object.values(value).filter(isJsonObject).flatMap((each) => propertyNamesOf(each))
  return []
}

const sectionNamesOf = (section: S.Json | undefined, name: string): readonly string[] => {
  const whenInvalid = `attw schema printed the ${name} section with no draft-2020-12 document`
  if (!isJsonObject(section)) throw new Error(whenInvalid)
  if (section['dialect'] !== 'draft-2020-12') throw new Error(whenInvalid)
  const schema = section['schema']
  if (!isJsonObject(schema)) throw new Error(whenInvalid)
  const names = [
    ...propertyNamesOf(schema),
    ...propertyNamesIn(schema['anyOf']),
    ...propertyNamesIn(schema['definitions']),
  ]
  return names.filter((each, index) => names.indexOf(each) === index)
}

const expectSchemaRow = (captured: Capture): void => {
  const stdout = captured.stdout.join('')
  expect(captured.stderr.join(''), 'schema: stderr is empty').toBe('')
  const parsed = jsonOf(stdout, `attw schema printed no document object: ${stdout}`)
  if (!isJsonObject(parsed)) throw new Error(`attw schema printed no document object: ${stdout}`)
  expect(parsed['version'], 'schema: version').toBe(cliVersion)
  const inputNames = sectionNamesOf(parsed['input'], 'input')
  const envelopeNames = sectionNamesOf(parsed['envelope'], 'envelope')
  expect(
    Object.keys(analyzeFlags).every((flag) => inputNames.includes(flag)),
    'schema: input documents every flag',
  ).toBe(true)
  expect(
    publishedEnvelopeKeys.every((key) => envelopeNames.includes(key)),
    'schema: envelope documents the published keys',
  ).toBe(true)
}

const runSchemaRow = Effect.gen(function*() {
  const captured = capture()
  const result = yield* Effect.result(
    Command.runWith(runAttwCommand, { version: cliVersion, renderErrors: false })(['schema']).pipe(
      Effect.provide(commandLayer(captured)),
    ),
  )
  expect(Result.isSuccess(result), 'schema: command succeeds').toBe(true)
  expectSchemaRow(captured)
})

describe('run-attw: the composed run cell over the published CLI surface', () => {
  for (const tested of localScenarios) {
    it.effect(`agrees with the authored contract on ${tested.name}`, () => runRow(tested))
  }

  for (const tested of authoredScenarios) {
    it.effect(`agrees with the authored contract on ${tested.name}`, () => runRow(tested))
  }

  it.effect('agrees on a pack target addressed by a relative path', () =>
    Effect.gen(function*() {
      const path = yield* Path.Path
      const relative = path.relative(process.cwd(), path.join(fixtureDir, 'packable'))
      const expectation = envelopeExpectation(1, 'ok', 'attw-packable', ['NamedExports'], ['--include'])
      const captured = capture()
      const exitCode = yield* runCellPath(
        captured,
        cellRequestOf(relative, { pack: true, format: 'json' }, absentConfigPath()),
      )
      expectRow(
        scenario('a relative pack target', () => relative, { pack: true, format: 'json' }, expectation),
        captured,
        exitCode,
        'run',
      )
    }).pipe(Effect.provide(platformBase)))

  it.effect('agrees on a malformed package spec', () =>
    runRow(scenario('a malformed spec', () => 'pkg?fields=name', { fromNpm: true }, {
      form: 'failure',
      exitCode: 1,
      failureKind: 'InvalidPackageSpec',
    })))

  it.effect('agrees on a registry 404 from the loopback registry', () =>
    Effect.gen(function*() {
      const base = yield* registryBase()
      yield* runRow(
        scenario('a registry 404', () => `${REGISTRY_PACKAGE}@${MISSING_VERSION}`, { fromNpm: true, registry: base }, {
          form: 'failure',
          exitCode: 1,
          failureKind: 'RegistryNotFound',
        }),
      )
    }).pipe(Effect.provide(listening)))

  it.effect('agrees on a successful registry fetch from the loopback registry', () =>
    Effect.gen(function*() {
      const base = yield* registryBase()
      yield* runRow(
        scenario('a successful registry fetch', () => `${REGISTRY_PACKAGE}@${REGISTRY_VERSION}`, {
          fromNpm: true,
          registry: base,
        }, envelopeExpectation(0, 'ok', REGISTRY_PACKAGE, [], ['--include'])),
      )
    }).pipe(Effect.provide(listening)))

  it.effect('agrees on an over-budget registry document from the loopback registry', () =>
    Effect.gen(function*() {
      const base = yield* registryBase()
      yield* runRow(
        scenario('an over-budget registry document', () => `${REGISTRY_PACKAGE}@${OVERBUDGET_VERSION}`, {
          fromNpm: true,
          registry: base,
        }, {
          form: 'failure',
          exitCode: 1,
          failureKind: 'RegistryBadResponse',
        }),
      )
    }).pipe(Effect.provide(listening)))

  it.effect('prints schema documents that decode with the published envelope schema', () => runSchemaRow)

  it.effect('prints the version of the CLI package it was built from', () =>
    Effect.gen(function*() {
      const { captured, exitCode } = yield* runCommandPath(['--version'])
      expect(exitCode).toBe(0)
      expect(stripAnsi(captured.stdout.join('')).trim()).toBe(`attw v${cliVersion}`)
    }))

  it.effect('analyzes the same package through the analyze subcommand as through the bare alias', () =>
    Effect.gen(function*() {
      const bare = yield* runCommandPath([tarball('false-cjs')])
      const explicit = yield* runCommandPath(['analyze', tarball('false-cjs')])
      expect(explicit.exitCode).toBe(bare.exitCode)
      expect(explicit.captured.stdout.join('')).toBe(bare.captured.stdout.join(''))
      expect(explicit.captured.stderr.join('')).toBe(bare.captured.stderr.join(''))
    }))

  it.effect('keeps an unknown flag out of stdout with a typed stderr document', () =>
    Effect.gen(function*() {
      const { captured, exitCode } = yield* runCommandPath(['--definitely-not-a-flag', tarball('false-cjs')])
      expect(exitCode).toBe(1)
      expect(captured.stdout.join('')).toBe('')
      const [document = '', ...usageText] = captured.stderr.join('').split('\n')
      expect(failureKindOf(document)).toBe('UnrecognizedOption')
      expect(usageText.every((line) => line.trim() === '')).toBe(false)
    }))

  it.effect('refuses extra arguments to the schema subcommand instead of analyzing them', () =>
    Effect.gen(function*() {
      const bare = yield* runCommandPath(['schema', 'extra-arg'])
      expect(bare.exitCode).toBe(1)
      expect(bare.captured.stdout.join('')).toBe('')
      expect(failureKindOf(firstLine(bare.captured.stderr.join('')))).toBe('UnexpectedArgument')
      const pathLike = yield* runCommandPath(['schema', tarball('false-cjs')])
      expect(pathLike.exitCode).toBe(1)
      expect(pathLike.captured.stdout.join('')).toBe('')
      expect(failureKindOf(firstLine(pathLike.captured.stderr.join('')))).toBe('UnexpectedArgument')
    }))
})
