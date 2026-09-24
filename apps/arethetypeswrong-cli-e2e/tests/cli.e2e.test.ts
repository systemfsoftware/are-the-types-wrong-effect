import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from '@effect/platform-node'
import { it } from '@effect/vitest'
import { Recipe } from '@systemfsoftware/arethetypeswrong-recipes'
import { packPackage } from '@systemfsoftware/npm-package'
import { Context, Effect, Layer, Result, Schema } from 'effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as Stream from 'effect/Stream'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { describe, expect } from 'vitest'

import {
  CommandExited,
  ContainerCommandRefused,
  ContainerStartRefused,
  ContainerStopRefused,
  FailureDocument,
  JsonDocument,
} from './__fixtures__/cliOutput.schema.js'

const BASE_IMAGE = 'alpine:3.20@sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e'
const VERDACCIO_VERSION = '6.10.3'
const REGISTRY_URL = 'http://127.0.0.1:4873'
const WORKDIR = '/work'
const FIXTURES_DIR = `${WORKDIR}/fixtures`
const CLOSURE_TAR = `${WORKDIR}/closure.tar`
const REGISTRY_RECIPE = Recipe.FalseCJS
const REGISTRY_PACKAGE = REGISTRY_RECIPE()
const MISSING_VERSION = '999.999.999'

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

interface DecodedEnvelope {
  readonly status: 'ok' | 'untyped'
  readonly packageName: string
  readonly problems: readonly Schema.Json[]
}

const analyzeJson = (stdout: string): DecodedEnvelope => {
  const whenUnparseable = `attw printed no envelope object: ${stdout}`
  const parsed = jsonObjectIn(jsonDocument(stdout, whenUnparseable), whenUnparseable)
  const status = parsed['status']
  const packageName = parsed['packageName']
  const problems = parsed['problems']
  if (status !== 'ok' && status !== 'untyped') {
    throw new Error(`attw printed an envelope without a status discriminant: ${stdout}`)
  }
  if (typeof packageName !== 'string') {
    throw new Error(`attw printed an envelope without a package name: ${stdout}`)
  }
  if (problems !== undefined && !Array.isArray(problems)) {
    throw new Error(`attw printed problems that are not an array: ${stdout}`)
  }
  return { status, packageName, problems: Array.isArray(problems) ? problems : [] }
}

const problemKinds = (problems: readonly Schema.Json[]): readonly string[] =>
  problems.map((problem) => {
    const kind = isJsonObject(problem) ? problem['kind'] : undefined
    if (typeof kind !== 'string') throw new Error('attw printed a problem whose kind is not a string')
    return kind
  })

const errorDocument = (text: string): { readonly kind: string; readonly recovery: string } => {
  const decoded = Schema.decodeResult(FailureDocument)(text)
  if (Result.isFailure(decoded)) throw new Error(`attw printed no failure document: ${text}`)
  return { kind: decoded.success.kind, recovery: decoded.success.recovery }
}

const platformLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  NodeChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
)

const spawnedOutput = (command: string, args: readonly string[], cwd: string) =>
  Effect.scoped(
    Effect.gen(function*() {
      const spawner = yield* ChildProcessSpawner
      const handle = yield* spawner.spawn(ChildProcess.make(command, [...args], { cwd }))
      const output = yield* handle.stdout.pipe(Stream.decodeText, Stream.mkString)
      const exitCode = yield* handle.exitCode
      if (exitCode !== 0) return yield* new CommandExited({ command, exitCode, output })
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

interface ContainerCommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

interface AttwHarnessShape {
  readonly container: StartedTestContainer
  readonly scratch: string
  readonly runCli: (
    args: readonly string[],
    cwd?: string,
  ) => Effect.Effect<ContainerCommandResult, ContainerCommandRefused>
  readonly runShell: (script: string) => Effect.Effect<ContainerCommandResult, ContainerCommandRefused>
}

class AttwHarness extends Context.Service<AttwHarness, AttwHarnessShape>()(
  '@systemfsoftware/arethetypeswrong-cli-e2e/AttwHarness',
) {}

const containerExec = (
  container: StartedTestContainer,
  args: readonly string[],
  cwd: string,
): Effect.Effect<ContainerCommandResult, ContainerCommandRefused> =>
  Effect.tryPromise({
    try: () => container.exec([...args], { workingDir: cwd }),
    catch: (cause) => new ContainerCommandRefused({ cause }),
  }).pipe(Effect.map((result) => ({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr })))

const harnessOf = (container: StartedTestContainer, scratch: string, cliBin: string): AttwHarnessShape => ({
  container,
  scratch,
  runCli: (args, cwd = WORKDIR) => containerExec(container, [cliBin, ...args], cwd),
  runShell: (script) => containerExec(container, ['sh', '-c', script], WORKDIR),
})

const requireStep = (name: string, result: ContainerCommandResult): void => {
  if (result.exitCode !== 0) throw new Error(`${name} exited ${result.exitCode}: ${result.stderr}`)
}

const verdaccioCommand = (processCompose: string): readonly string[] => [
  processCompose,
  '--log-file',
  '/proc/1/fd/1',
  'up',
  '--detached',
  '--tui=false',
  '-f',
  `${WORKDIR}/process-compose.yaml`,
]

const verdaccioReadinessPollInsideContainer =
  'let attempts = 0; (async function tick(){attempts++; try{if((await fetch("http://127.0.0.1:4873/-/ping")).ok)process.exit(0)}catch{} if(attempts>=30)process.exit(1); setTimeout(tick, 200)})()'

const bootstrap = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const packageDir = yield* path.fromFileUrl(new URL('..', import.meta.url))
  const repoRoot = yield* path.fromFileUrl(new URL('../../..', import.meta.url))

  const scratch = yield* fs.makeTempDirectory({ prefix: 'attw-e2e-' })

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
  const cliBin = `${attwStore}/bin/attw`
  const npmBin = `${nodeStore}/bin/npm`

  const verdaccioDir = path.join(scratch, 'verdaccio')
  const fixturesDir = path.join(scratch, 'fixtures')
  const closureTarPath = path.join(scratch, 'closure.tar')

  yield* fs.makeDirectory(fixturesDir, { recursive: true })
  yield* fs.writeFile(path.join(fixturesDir, `${REGISTRY_PACKAGE.packageName}.tgz`), packPackage(REGISTRY_PACKAGE))

  yield* Effect.all(
    [
      spawnedOutput('tar', ['-cf', closureTarPath, '-C', '/', ...closure.map((entry) => entry.slice(1))], repoRoot),
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
          { source: verdaccioDir, target: '/opt/verdaccio' },
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

  requireStep('extract nix closure', yield* containerExec(started, ['tar', '-xf', CLOSURE_TAR, '-C', '/'], WORKDIR))
  requireStep(
    'process-compose up verdaccio',
    yield* containerExec(started, verdaccioCommand(`${processComposeStore}/bin/process-compose`), WORKDIR),
  )
  requireStep(
    'write npmrc token',
    yield* containerExec(
      started,
      ['sh', '-c', "printf '%s\\n' '//127.0.0.1:4873/:_authToken=e2e' > /root/.npmrc"],
      WORKDIR,
    ),
  )
  requireStep(
    'verdaccio readiness',
    yield* containerExec(started, [`${nodeStore}/bin/node`, '-e', verdaccioReadinessPollInsideContainer], WORKDIR),
  )
  requireStep(
    'npm publish recipe to verdaccio',
    yield* containerExec(
      started,
      [
        npmBin,
        'publish',
        `${FIXTURES_DIR}/${REGISTRY_PACKAGE.packageName}.tgz`,
        '--registry',
        REGISTRY_URL,
        '--loglevel=error',
      ],
      WORKDIR,
    ),
  )

  return harnessOf(started, scratch, cliBin)
})

const teardown = (harness: AttwHarnessShape) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* Effect.tryPromise({
      try: () => harness.container.stop(),
      catch: (cause) => new ContainerStopRefused({ cause }),
    }).pipe(Effect.orDie)
    yield* fs.remove(harness.scratch, { recursive: true, force: true }).pipe(Effect.orDie)
  })

const harnessLayer = Layer.effect(AttwHarness)(Effect.acquireRelease(bootstrap, teardown)).pipe(
  Layer.provide(platformLayer),
)

describe('attw, built by nix, run in a container', () => {
  it.layer(harnessLayer)('the process seam alone', (inner) => {
    inner.effect('packs a real package directory and deletes the tarball afterwards', () =>
      Effect.gen(function*() {
        const harness = yield* AttwHarness
        const packDir = `${WORKDIR}/attw-pack-dir`
        const prepared = yield* harness.runShell(
          `rm -rf ${packDir} && mkdir -p ${packDir} && ` +
            `printf '%s' '{"name":"attw-pack-test","version":"1.0.0","type":"module","main":"index.js"}' > ${packDir}/package.json && ` +
            `printf '%s' 'export const v = 1' > ${packDir}/index.js`,
        )
        requireStep('prepare pack directory', prepared)

        const packed = yield* harness.runCli(['--pack', '.'], packDir)
        expect(packed.exitCode, `pack run: ${packed.stderr}${packed.stdout}`).toBe(0)
        expect(analyzeJson(packed.stdout).packageName).toBe('attw-pack-test')

        const leftovers = yield* harness.runShell(`find ${packDir} -name '*.tgz'`)
        expect(leftovers.stdout.trim()).toBe('')
      }))

    inner.effect('fetches a recipe published to verdaccio and reports its problems', () =>
      Effect.gen(function*() {
        const harness = yield* AttwHarness
        const result = yield* harness.runCli([
          '--from-npm',
          `${REGISTRY_PACKAGE.packageName}@${REGISTRY_PACKAGE.packageVersion}`,
          '--registry',
          REGISTRY_URL,
        ])

        expect(result.exitCode).toBe(1)
        const envelope = analyzeJson(result.stdout)
        expect(envelope.packageName).toBe(REGISTRY_PACKAGE.packageName)
        expect(problemKinds(envelope.problems)).toContain('FalseCJS')
      }))

    inner.effect('crosses the process boundary as a not-found envelope and exit code', () =>
      Effect.gen(function*() {
        const harness = yield* AttwHarness
        const result = yield* harness.runCli([
          '--from-npm',
          `${REGISTRY_PACKAGE.packageName}@${MISSING_VERSION}`,
          '--registry',
          REGISTRY_URL,
        ])

        expect(result.exitCode).toBe(1)
        expect(result.stdout).toBe('')
        expect(errorDocument(result.stderr).kind).toBe('RegistryNotFound')
      }))
  })
})
