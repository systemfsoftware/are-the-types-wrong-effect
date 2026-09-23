import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from '@effect/platform-node'
import { it } from '@effect/vitest'
import { Recipe } from '@systemfsoftware/arethetypeswrong-recipes'
import { packPackage } from '@systemfsoftware/npm-package'
import { Effect, Inspectable, Layer, Result, Schema } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect } from 'vitest'

import {
  CommandExited,
  ContainerCommandRefused,
  ContainerStartRefused,
  ContainerStopRefused,
  EnvelopeIdentity,
  FailureDocument,
  JsonDocument,
} from './__fixtures__/cliOutput.schema.js'
import { REGISTRY_FIXTURE_FILES, REGISTRY_FIXTURE_NAME, REGISTRY_FIXTURE_VERSION } from './registry.js'

const CLI_MANIFEST_URL = new URL('../../arethetypeswrong-cli/package.json', import.meta.url)
const BASE_IMAGE = 'alpine:3.20@sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e'
const VERDACCIO_VERSION = '6.10.3'
const REGISTRY_URL = 'http://127.0.0.1:4873'
const WORKDIR = '/work'
const FIXTURES_DIR = `${WORKDIR}/fixtures`
const EVAL_FIXTURES_DIR = `${WORKDIR}/eval-fixtures`
const CLOSURE_TAR = `${WORKDIR}/closure.tar`
const RECIPE_FIXTURES = [Recipe.UntypedResolution, Recipe.FalseCJS, Recipe.MultiEntrypoint]

interface DecodedEnvelope {
  readonly status: 'ok' | 'untyped'
  readonly packageName: string
  readonly packageVersion: string
  readonly problems: readonly Schema.Json[]
  readonly keys: readonly string[]
}

const isJsonObject = (value: Schema.Json | undefined): value is Schema.JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const jsonObjectIn = (value: Schema.Json | undefined, whenNotAnObject: string): Schema.JsonObject => {
  if (!isJsonObject(value)) throw new Error(whenNotAnObject)
  return value
}

const jsonDocument = (text: string, whenUnparseable: string): Schema.Json => {
  const decoded = Schema.decodeResult(JsonDocument)(text)
  if (Result.isFailure(decoded)) throw new Error(whenUnparseable)
  return decoded.success
}

const analyzeJson = (stdout: string): DecodedEnvelope => {
  const whenUnparseable = `attw printed no envelope object: ${stdout}`
  const parsed = jsonObjectIn(jsonDocument(stdout, whenUnparseable), whenUnparseable)
  const status = parsed['status']
  const packageName = parsed['packageName']
  const packageVersion = parsed['packageVersion']
  const problems = parsed['problems']
  if (status !== 'ok' && status !== 'untyped') {
    throw new Error(`attw printed an envelope without a status discriminant: ${stdout}`)
  }
  if (typeof packageName !== 'string' || typeof packageVersion !== 'string') {
    throw new Error(`attw printed an envelope without a package name and version: ${stdout}`)
  }
  if (problems !== undefined && !Array.isArray(problems)) {
    throw new Error(`attw printed problems that are not an array: ${stdout}`)
  }
  return {
    status,
    packageName,
    packageVersion,
    problems: Array.isArray(problems) ? problems : [],
    keys: Object.keys(parsed),
  }
}

const problemKinds = (problems: readonly Schema.Json[]): readonly string[] =>
  problems.map((problem) => {
    const printed = Inspectable.toStringUnknown(problem)
    const kind = isJsonObject(problem) ? problem['kind'] : undefined
    if (kind === undefined) {
      throw new Error(`attw printed a problem without a kind: ${printed}`)
    }
    if (typeof kind !== 'string') {
      throw new Error(`attw printed a problem whose kind is not a string: ${printed}`)
    }
    return kind
  })

interface PrintedSchemaSection {
  readonly dialect: string
  readonly schema: Schema.JsonObject
  readonly definitions: Schema.Json | undefined
}

const schemaSection = (section: Schema.Json | undefined, name: string): PrintedSchemaSection => {
  const document = jsonObjectIn(section, `attw schema printed no ${name} section`)
  const dialect = document['dialect']
  if (typeof dialect !== 'string') {
    throw new Error(`attw schema printed the ${name} section with no dialect`)
  }
  return {
    dialect,
    schema: jsonObjectIn(
      document['schema'],
      `attw schema printed the ${name} section that is not a JSON Schema document`,
    ),
    definitions: document['definitions'],
  }
}

const errorDocument = (text: string): { readonly kind: string; readonly recovery: string } => {
  const decoded = Schema.decodeResult(FailureDocument)(text)
  if (Result.isFailure(decoded)) throw new Error(`attw printed no failure document: ${text}`)
  return { kind: decoded.success.kind, recovery: decoded.success.recovery }
}

const usageErrorDocument = (stderr: string): { readonly kind: string; readonly recovery: string } => {
  const [document = '', ...usageText] = stderr.split('\n')
  if (usageText.every((line) => line.trim() === '')) {
    throw new Error(`attw printed a usage failure without the usage text that follows it: ${stderr}`)
  }
  return errorDocument(document)
}

const schemaDocument = (
  stdout: string,
): { readonly version: string; readonly input: PrintedSchemaSection; readonly envelope: PrintedSchemaSection } => {
  const whenUnparseable = `attw schema printed no document: ${stdout}`
  const parsed = jsonObjectIn(jsonDocument(stdout, whenUnparseable), whenUnparseable)
  const version = parsed['version']
  if (typeof version !== 'string') {
    throw new Error(`attw schema printed no version: ${stdout}`)
  }
  const input = parsed['input']
  const envelope = parsed['envelope']
  if (input === undefined || envelope === undefined) {
    throw new Error(`attw schema printed no input and envelope sections: ${stdout}`)
  }
  return {
    version,
    input: schemaSection(input, 'input'),
    envelope: schemaSection(envelope, 'envelope'),
  }
}

const asJsonDocument = (value: object): Schema.Json => {
  const decoded = Schema.decodeUnknownResult(Schema.Json)(value)
  if (Result.isFailure(decoded)) {
    throw new Error(`the authored envelope schema is not a JSON document: ${Inspectable.toStringUnknown(value)}`)
  }
  return decoded.success
}

const propertyNamesOf = (schema: Schema.JsonObject): readonly string[] => {
  const properties = schema['properties']
  if (!isJsonObject(properties)) return []
  return Object.keys(properties)
}

const jsonObjectsIn = (value: Schema.Json | undefined): readonly Schema.JsonObject[] => {
  if (Array.isArray(value)) return value.filter(isJsonObject)
  if (isJsonObject(value)) return Object.values(value).filter(isJsonObject)
  return []
}

const documentedPropertyNames = (section: PrintedSchemaSection): readonly string[] => {
  const variants = [
    ...jsonObjectsIn(section.schema['anyOf']),
    ...jsonObjectsIn(section.definitions),
  ]
  const names = [...propertyNamesOf(section.schema), ...variants.flatMap((variant) => propertyNamesOf(variant))]
  return names.filter((name, index) => names.indexOf(name) === index)
}

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text: string): string => text.replace(ANSI_SGR, '')

const isJson = (text: string): boolean => Result.isSuccess(Schema.decodeResult(JsonDocument)(text))

const RESOLUTION_COLUMNS = ['node10', 'node16-cjs', 'node16-esm', 'bundler'] as const

const TABLE_HEADER = ['Entrypoint', ...RESOLUTION_COLUMNS]

const emojiProblemCells = /^[✘◌⚠]+$/
const asciiProblemCells = /^[X!-]+$/
const okCells = /^(?:✔|OK)$/

interface HumanTable {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

const humanTable = (stdout: string): HumanTable => {
  const lines = stripAnsi(stdout).split('\n').filter((line) => line.trim() !== '')
  const headerIndex = lines.findIndex((line) => line.trim().startsWith('Entrypoint'))
  if (headerIndex === -1) throw new Error(`attw printed no human table: ${stdout}`)
  const headerLine = lines[headerIndex]
  if (headerLine === undefined) throw new Error(`attw printed no human table: ${stdout}`)
  const header = headerLine.trim().split(/\s{2,}/)
  const rows = lines.slice(headerIndex + 1).map((line) => line.trim().split(/\s{2,}/))
  return { header, rows }
}

const entrypointLabels = (table: HumanTable): readonly string[] =>
  table.rows.map((row) => row[0]).filter((label): label is string => label !== undefined)

const expectHumanTable = (
  stdout: string,
  expected: { readonly header: readonly string[]; readonly labels: readonly string[] },
  cell: RegExp,
): void => {
  expect(isJson(stdout)).toBe(false)
  const table = humanTable(stdout)
  expect(table.header).toEqual([...expected.header])
  expect(table.rows.map((row) => row[0])).toEqual([...expected.labels])
  for (const row of table.rows) {
    expect(row.length).toBe(table.header.length)
    for (const value of row.slice(1)) expect(value).toMatch(cell)
  }
}

const assertEnvelopeProvenance = (envelope: DecodedEnvelope, expectedProblemKind: string | undefined): void => {
  if (expectedProblemKind === undefined) {
    expect(envelope.keys).not.toContain('problems')
    return
  }
  const authored = Recipe.FalseCJS()
  expect(envelope.packageName).toBe(authored.packageName)
  expect(envelope.packageVersion).toBe(authored.packageVersion)
  expect(problemKinds(envelope.problems)).toContain(expectedProblemKind)
}

const decodeEnvelopeOrThrow = (stdout: string) => {
  const document = jsonDocument(stdout, `attw printed no analyze envelope: ${stdout}`)
  const decoded = Schema.decodeUnknownResult(EnvelopeIdentity)(document)
  if (Result.isFailure(decoded)) {
    throw new Error(
      `attw printed an analyze envelope the documented contract does not accept: ${
        Inspectable.toStringUnknown(decoded)
      }`,
    )
  }
  return decoded.success
}

type PlatformServices = FileSystem.FileSystem | Path.Path | ChildProcessSpawner

const platformLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
)

const withPlatform = <A, E>(effect: Effect.Effect<A, E, PlatformServices>) => effect.pipe(Effect.provide(platformLayer))

const spawnedOutput = (command: string, args: readonly string[], cwd: string) =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const handle = yield* spawner.spawn(ChildProcess.make(command, [...args], { cwd }))
      const output = yield* handle.stdout.pipe(Stream.decodeText, Stream.mkString)
      const exitCode = yield* handle.exitCode
      if (exitCode !== 0) {
        return yield* new CommandExited({ command, exitCode, output })
      }
      return output
    }),
  )

const nixBuild = (repoRoot: string, installable: string, extraArgs: readonly string[] = []) =>
  spawnedOutput('nix', ['build', ...extraArgs, installable, '--no-link', '--print-out-paths'], repoRoot).pipe(
    Effect.map((stdout) => stdout.trim()),
  )

const namedIn = (closure: readonly string[], pattern: RegExp): string => {
  const match = closure.find((path) => pattern.test(path))
  if (match === undefined) throw new Error(`${pattern} missing from closure`)
  return match
}

const writeRecipeFixtures = (dir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(dir, { recursive: true })
    for (const recipe of RECIPE_FIXTURES) {
      const pkg = recipe()
      yield* fs.writeFile(path.join(dir, `${pkg.packageName}.tgz`), packPackage(pkg))
    }
  })

const writeRegistryFixture = (dir: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(dir, { recursive: true })
    for (const [name, content] of Object.entries(REGISTRY_FIXTURE_FILES)) {
      yield* fs.writeFileString(path.join(dir, name), content)
    }
  })

const cliManifest = (url: URL) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const manifestPath = yield* path.fromFileUrl(url)
    const text = yield* fs.readFileString(manifestPath)
    const whenInvalid = `${url.pathname} declares no string version and bin entry`
    const manifest = jsonObjectIn(jsonDocument(text, whenInvalid), whenInvalid)
    const version = manifest['version']
    const bin = manifest['bin']
    if (typeof version !== 'string' || !isJsonObject(bin)) throw new Error(whenInvalid)
    const commands = Object.keys(bin)
    const [command] = commands
    if (command === undefined || commands.length !== 1) {
      throw new Error(`${url.pathname} declares ${commands.length} bin entries; the printed name needs exactly one`)
    }
    return { command, version }
  })

let container: StartedTestContainer | undefined
let scratch: string | undefined
let cliBin: string
let npmBin: string

const runningContainer = (): StartedTestContainer => {
  if (container === undefined) throw new Error('the attw container harness never started')
  return container
}

const containerExec = (args: readonly string[], cwd: string) =>
  Effect.tryPromise({
    try: () => runningContainer().exec([...args], { workingDir: cwd }),
    catch: (cause) => new ContainerCommandRefused({ cause }),
  })

const runCli = (args: readonly string[], cwd: string = WORKDIR) =>
  containerExec([cliBin, ...args], cwd).pipe(
    Effect.map((result) => ({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr })),
  )

const runShell = (script: string) => containerExec(['sh', '-c', script], WORKDIR)

const requireStep = (name: string, result: { readonly exitCode: number }): void => {
  if (result.exitCode !== 0) throw new Error(`${name} exited ${result.exitCode}`)
}

const bootstrap = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const packageDir = yield* path.fromFileUrl(new URL('..', import.meta.url))
  const repoRoot = yield* path.fromFileUrl(new URL('../../..', import.meta.url))

  scratch = yield* fs.makeTempDirectory({ prefix: 'attw-e2e-' })

  const [attwStore, processComposeStore] = yield* Effect.all(
    [
      nixBuild(repoRoot, '.#attw'),
      nixBuild(repoRoot, 'nixpkgs#process-compose', ['--inputs-from', '.']),
    ],
    { concurrency: 'unbounded' },
  )
  const closureOutput = yield* spawnedOutput('nix', ['path-info', '-r', attwStore, processComposeStore], repoRoot)
  const closure = closureOutput.trim().split('\n')
  const nodeStore = namedIn(closure, /[-]nodejs-\d/)
  const bashStore = namedIn(closure, /[-]bash-\d/)
  cliBin = `${attwStore}/bin/attw`
  npmBin = `${nodeStore}/bin/npm`

  const verdaccioDir = path.join(scratch, 'verdaccio')
  const fixturesDir = path.join(scratch, 'fixtures')
  const registryFixtureDir = path.join(scratch, 'registry-fixture')
  const closureTarPath = path.join(scratch, 'closure.tar')

  yield* Effect.all(
    [
      spawnedOutput(
        'tar',
        ['-cf', closureTarPath, '-C', '/', ...closure.map((entry) => entry.slice(1))],
        repoRoot,
      ),
      spawnedOutput(
        npmBin,
        [
          'install',
          '--prefix',
          verdaccioDir,
          `verdaccio@${VERDACCIO_VERSION}`,
          '--omit=dev',
          '--no-fund',
          '--no-audit',
        ],
        repoRoot,
      ),
      writeRecipeFixtures(fixturesDir),
      writeRegistryFixture(registryFixtureDir),
    ],
    { concurrency: 'unbounded' },
  )

  const started = yield* Effect.tryPromise({
    try: () =>
      new GenericContainer(BASE_IMAGE)
        .withCopyFilesToContainer([
          { source: closureTarPath, target: CLOSURE_TAR },
          { source: path.join(packageDir, 'process-compose.yaml'), target: `${WORKDIR}/process-compose.yaml` },
          { source: path.join(packageDir, 'verdaccio.yaml'), target: `${WORKDIR}/verdaccio.yaml` },
        ])
        .withCopyDirectoriesToContainer([
          { source: fixturesDir, target: FIXTURES_DIR },
          { source: path.join(packageDir, 'evals', 'fixtures'), target: EVAL_FIXTURES_DIR },
          { source: verdaccioDir, target: '/opt/verdaccio' },
          { source: registryFixtureDir, target: `${WORKDIR}/registry-fixture` },
        ])
        .withEnvironment({
          PATH: [
            `${nodeStore}/bin`,
            `${bashStore}/bin`,
            '/opt/verdaccio/node_modules/.bin',
            `${processComposeStore}/bin`,
            '/usr/local/sbin',
            '/usr/local/bin',
            '/usr/sbin',
            '/usr/bin',
            '/sbin',
            '/bin',
          ].join(':'),
        })
        .withWorkingDir(WORKDIR)
        .withLogConsumer((stream) => {
          stream.pipe(process.stderr, { end: false })
        })
        .withCommand(['sleep', 'infinity'])
        .start(),
    catch: (cause) => new ContainerStartRefused({ cause }),
  })
  container = started

  requireStep('extract nix closure', yield* containerExec(['tar', '-xf', CLOSURE_TAR, '-C', '/'], WORKDIR))

  const processCompose = `${processComposeStore}/bin/process-compose`
  requireStep(
    'process-compose up verdaccio',
    yield* containerExec([
      processCompose,
      '--log-file',
      '/proc/1/fd/1',
      'up',
      '--detached',
      '--tui=false',
      '-f',
      `${WORKDIR}/process-compose.yaml`,
    ], WORKDIR),
  )
  requireStep(
    'write npmrc token',
    yield* containerExec(['sh', '-c', "printf '%s\\n' '//127.0.0.1:4873/:_authToken=e2e' > /root/.npmrc"], WORKDIR),
  )
  requireStep(
    'verdaccio readiness',
    yield* containerExec([
      `${nodeStore}/bin/node`,
      '-e',
      'let attempts = 0; (async function tick(){attempts++; try{if((await fetch("http://127.0.0.1:4873/-/ping")).ok)process.exit(0)}catch{} if(attempts>=30)process.exit(1); setTimeout(tick, 200)})()',
    ], WORKDIR),
  )

  requireStep(
    'npm publish fixture to verdaccio',
    yield* containerExec([
      npmBin,
      'publish',
      `${WORKDIR}/registry-fixture`,
      '--registry',
      REGISTRY_URL,
      '--loglevel=error',
    ], WORKDIR),
  )
})

const teardown = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const running = container
  if (running !== undefined) {
    yield* Effect.tryPromise({
      try: () => running.stop(),
      catch: (cause) => new ContainerStopRefused({ cause }),
    })
  }
  if (scratch !== undefined) {
    yield* fs.remove(scratch, { recursive: true, force: true })
  }
})

beforeAll(() => Effect.runPromise(withPlatform(bootstrap)))

afterAll(() => Effect.runPromise(withPlatform(teardown)))

describe('attw, built by nix, run in a container', () => {
  it.effect('prints the version of the CLI package it was built from', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli(['--version'])
        const { command, version } = yield* cliManifest(CLI_MANIFEST_URL)

        expect(result.exitCode).toBe(0)
        expect(stripAnsi(result.stdout).trim()).toBe(`${command} v${version}`)
      }),
    ))

  it.effect('reports resolution problems for an untyped package', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([`${FIXTURES_DIR}/untyped-resolution.tgz`, '-f', 'table'], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        expectHumanTable(result.stdout, { header: TABLE_HEADER, labels: ['.'] }, /^◌+$/)
      }),
    ))

  it.effect('names the problem for a package with false CommonJS declarations', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'table'], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        expectHumanTable(result.stdout, { header: TABLE_HEADER, labels: ['.'] }, /^✘+$/)
      }),
    ))

  it.effect('renders table-flipped output as a human table', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'table-flipped'], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        expectHumanTable(result.stdout, { header: ['Entrypoint', '.'], labels: RESOLUTION_COLUMNS }, /^✘+$/)
      }),
    ))

  it.effect('renders ascii output as a human table', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'ascii', '--no-emoji'], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        expectHumanTable(result.stdout, { header: TABLE_HEADER, labels: ['.'] }, asciiProblemCells)
      }),
    ))

  it.effect('renders the human table when the format is explicit on a non-TTY stream', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([`${FIXTURES_DIR}/multi-entrypoint.tgz`, '-f', 'table'], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        expectHumanTable(
          result.stdout,
          { header: TABLE_HEADER, labels: ['.', './macros', './utils'] },
          emojiProblemCells,
        )
      }),
    ))

  it.effect('writes one compact JSON document on a non-TTY stream with no format flag', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([`${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        expect(result.stdout.endsWith('\n')).toBe(true)
        expect(result.stdout.trimEnd().includes('\n')).toBe(false)
        expect(result.stdout).not.toContain(String.fromCharCode(27))
        expect(analyzeJson(result.stdout).status).toBe('ok')
      }),
    ))

  const envelopeCases = [
    {
      case: 'a typed package carrying a problem',
      fixture: `${FIXTURES_DIR}/false-cjs.tgz`,
      fixtureDir: FIXTURES_DIR,
      expectedStatus: 'ok',
      expectedExitCode: 1,
      expectedProblemKind: 'FalseCJS',
    },
    {
      case: 'an untyped package',
      fixture: `${EVAL_FIXTURES_DIR}/untyped.tgz`,
      fixtureDir: EVAL_FIXTURES_DIR,
      expectedStatus: 'untyped',
      expectedExitCode: 0,
      expectedProblemKind: undefined,
    },
  ] as const

  it.effect.each(envelopeCases)(
    'names the analyzed package in the default envelope for $case',
    ({ fixture, fixtureDir, expectedStatus, expectedExitCode, expectedProblemKind }) =>
      withPlatform(
        Effect.gen(function*() {
          const result = yield* runCli([fixture], fixtureDir)

          expect(result.exitCode).toBe(expectedExitCode)
          const envelope = analyzeJson(result.stdout)
          expect(envelope.status).toBe(expectedStatus)
          assertEnvelopeProvenance(envelope, expectedProblemKind)
        }),
      ),
  )

  it.effect('agrees the envelope with the exit code under a profile that silences every problem', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli(
          ['--profile', 'node16', `${EVAL_FIXTURES_DIR}/typed-node10.tgz`],
          EVAL_FIXTURES_DIR,
        )

        expect(result.exitCode).toBe(0)
        const envelope = analyzeJson(result.stdout)
        expect(envelope.status).toBe('ok')
        expect(envelope.problems).toEqual([])
      }),
    ))

  it.effect('hints the expansion flag on a non-TTY run with the default mask', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([`${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        const hints = result.stderr.split('\n').filter((line) => line !== '')
        expect(hints).toHaveLength(1)
        expect(hints[0]).toContain('--include')
        for (const field of ['entrypoints', 'buildTools', 'programInfo', 'traces']) {
          expect(hints[0]).toContain(field)
        }
      }),
    ))

  it.effect('restores a requested field with --include and stays silent', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '--include', 'entrypoints'], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toBe('')
        expect(analyzeJson(result.stdout).keys).toContain('entrypoints')
      }),
    ))

  it.effect('emits the status-tagged envelope naming the analyzed package for an untyped fixture', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([`${FIXTURES_DIR}/untyped-resolution.tgz`, '-f', 'json'], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        const parsed = analyzeJson(result.stdout)
        expect(parsed.packageName).toBe('untyped-resolution')
        expect(parsed.problems.length).toBeGreaterThan(0)
      }),
    ))

  it.effect('restricts the analysis to the selected entrypoints', () =>
    withPlatform(
      Effect.gen(function*() {
        const full = yield* runCli([`${FIXTURES_DIR}/multi-entrypoint.tgz`, '-f', 'table'], FIXTURES_DIR)
        const restricted = yield* runCli(
          [`${FIXTURES_DIR}/multi-entrypoint.tgz`, '--entrypoints', '.', '-f', 'table'],
          FIXTURES_DIR,
        )

        expect(humanTable(restricted.stdout).rows.length).toBeLessThan(humanTable(full.stdout).rows.length)
      }),
    ))

  it.effect('drops excluded entrypoints from the analysis', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli(
          [`${FIXTURES_DIR}/multi-entrypoint.tgz`, '--exclude-entrypoints', 'macros', '-f', 'table'],
          FIXTURES_DIR,
        )

        expect(entrypointLabels(humanTable(result.stdout)).some((label) => label.includes('macros'))).toBe(false)
      }),
    ))

  it.effect('analyzes a package acquired from the verdaccio registry', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([
          '--from-npm',
          `${REGISTRY_FIXTURE_NAME}@${REGISTRY_FIXTURE_VERSION}`,
          '--registry',
          REGISTRY_URL,
        ])
        expect(analyzeJson(result.stdout).packageName).toBe(REGISTRY_FIXTURE_NAME)
      }),
    ))

  it.effect('packs a directory and analyzes the packed package', () =>
    withPlatform(
      Effect.gen(function*() {
        const packDir = `${WORKDIR}/pack-test`
        const prepared = yield* runShell(
          `mkdir -p ${packDir} && cd ${packDir} && ` +
            `printf '%s' '{"name":"attw-pack-test","version":"1.0.0","type":"module","main":"index.js"}' > package.json && ` +
            `printf '%s' 'export const v = 1' > index.js`,
        )
        requireStep('prepare pack directory', prepared)

        const result = yield* runCli(['--pack', '.'], packDir)

        expect(result.exitCode).toBe(0)
        expect(analyzeJson(result.stdout).packageName).toBe('attw-pack-test')
      }),
    ))

  it.effect('applies a .attw.json waiver found in the working directory', () =>
    withPlatform(
      Effect.gen(function*() {
        const waiver = `${FIXTURES_DIR}/.attw.json`
        yield* runShell(`rm -f ${waiver}`)
        const before = yield* runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'table'], FIXTURES_DIR)
        yield* runShell(`printf '%s' '{"ignoreRules":["false-cjs"]}' > ${waiver}`)
        const after = yield* runCli([`${FIXTURES_DIR}/false-cjs.tgz`, '-f', 'table'], FIXTURES_DIR)
        yield* runShell(`rm -f ${waiver}`)

        expect(before.exitCode).toBe(1)
        expectHumanTable(before.stdout, { header: TABLE_HEADER, labels: ['.'] }, /^✘+$/)
        expect(after.exitCode).toBe(0)
        expectHumanTable(after.stdout, { header: TABLE_HEADER, labels: ['.'] }, okCells)
      }),
    ))

  it.effect('fails an unreadable tarball with a typed document and an empty stdout', () =>
    withPlatform(
      Effect.gen(function*() {
        yield* runShell(`printf '%s' 'not a tarball' > ${FIXTURES_DIR}/corrupt.tgz`)
        const result = yield* runCli([`${FIXTURES_DIR}/corrupt.tgz`], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBe('')
        const failure = errorDocument(result.stderr)
        expect(failure.kind).toBe('AnalysisFailed')
        expect(failure.recovery.length).toBeGreaterThan(0)
      }),
    ))

  it.effect('reports an unreachable registry with a typed document and an empty stdout', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli(['--from-npm', 'attw-never-resolves', '--registry', 'http://127.0.0.1:9'])

        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBe('')
        expect(errorDocument(result.stderr).kind).toBe('RegistryUnreachable')
      }),
    ))

  it.effect('reports a missing registry version as RegistryNotFound with a typed document', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli([
          '--from-npm',
          `${REGISTRY_FIXTURE_NAME}@999.999.999`,
          '--registry',
          REGISTRY_URL,
        ])

        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBe('')
        expect(errorDocument(result.stderr).kind).toBe('RegistryNotFound')
      }),
    ))

  it.effect('refuses a package spec welded to URL syntax before any registry call', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli(['--from-npm', 'pkg?fields=name', '--registry', 'http://127.0.0.1:9'])

        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBe('')
        expect(errorDocument(result.stderr).kind).toBe('InvalidPackageSpec')
      }),
    ))

  it.effect('publishes its input surface and envelope as JSON Schema documents a consumer can rely on', () =>
    withPlatform(
      Effect.gen(function*() {
        const { version } = yield* cliManifest(CLI_MANIFEST_URL)
        const result = yield* runCli(['schema'])

        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
        const document = schemaDocument(result.stdout)
        expect(document.version).toBe(version)
        expect(document.input.dialect).toBe('draft-2020-12')
        expect(document.envelope.dialect).toBe('draft-2020-12')

        const authoredNames = documentedPropertyNames(
          schemaSection(asJsonDocument(Schema.toJsonSchemaDocument(EnvelopeIdentity)), 'authored envelope'),
        )
        const documentedNames = documentedPropertyNames(document.envelope)
        expect(authoredNames.length).toBeGreaterThan(0)
        for (const name of authoredNames) {
          expect(documentedNames).toContain(name)
        }

        const analyzed = yield* runCli([`${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)
        expect(analyzed.exitCode).toBe(1)
        const decoded = decodeEnvelopeOrThrow(analyzed.stdout)
        expect(decoded.status).toBe('ok')
        expect(decoded.packageName).toBe(Recipe.FalseCJS().packageName)
        expect(
          Result.isSuccess(
            Schema.decodeUnknownResult(EnvelopeIdentity)({ ...decoded, status: 'attw-prints-no-such-status' }),
          ),
        ).toBe(false)
      }),
    ))

  it.effect('analyzes the same package through the analyze subcommand as through the bare alias', () =>
    withPlatform(
      Effect.gen(function*() {
        const bare = yield* runCli([`${FIXTURES_DIR}/multi-entrypoint.tgz`], FIXTURES_DIR)
        const explicit = yield* runCli(['analyze', `${FIXTURES_DIR}/multi-entrypoint.tgz`], FIXTURES_DIR)

        expect(explicit.exitCode).toBe(bare.exitCode)
        expect(explicit.stdout).toBe(bare.stdout)
        expect(explicit.stderr).toBe(bare.stderr)
      }),
    ))

  it.effect('keeps an unknown flag out of stdout with a typed stderr document', () =>
    withPlatform(
      Effect.gen(function*() {
        const result = yield* runCli(['--definitely-not-a-flag', `${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)

        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBe('')
        const failure = usageErrorDocument(result.stderr)
        expect(failure.kind).toBe('UnrecognizedOption')
        expect(failure.recovery.length).toBeGreaterThan(0)
      }),
    ))

  it.effect('refuses extra arguments to the schema subcommand instead of analyzing them', () =>
    withPlatform(
      Effect.gen(function*() {
        const bare = yield* runCli(['schema', 'extra-arg'])
        const pathLike = yield* runCli(['schema', `${FIXTURES_DIR}/false-cjs.tgz`], FIXTURES_DIR)

        expect(bare.exitCode).toBe(1)
        expect(bare.stdout).toBe('')
        expect(usageErrorDocument(bare.stderr).kind).toBe('UnexpectedArgument')
        expect(pathLike.exitCode).toBe(1)
        expect(pathLike.stdout).toBe('')
        expect(usageErrorDocument(pathLike.stderr).kind).toBe('UnexpectedArgument')
      }),
    ))
})
