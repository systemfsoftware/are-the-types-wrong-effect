import { Effect, Layer, Match, Predicate } from 'effect'
import * as PlatformFs from 'effect/FileSystem'
import * as PlatformPath from 'effect/Path'
import { type PlatformError } from 'effect/PlatformError'
import * as Scope from 'effect/Scope'
import * as ChildProcess from 'effect/unstable/process/ChildProcess'
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'

import { type PackResult, PackRunner } from '../pack-runner.service.js'
import { PackRunnerOutputUnreadable, PackRunnerSpawnRefused } from '../PackRunnerError.schema.js'

const TARBALL_SUFFIX = '.tgz'
const DEFAULT_WORKSPACE_PREFIX = 'attw-pack-'

export interface NpmPackRunnerOptions {
  readonly workspacePrefix?: string | undefined
}
interface PackWorkspace {
  readonly fs: PlatformFs.FileSystem
  readonly path: PlatformPath.Path
  readonly temporary: string
}

const tarballNameFrom = (output: string): string => output.trim().split('\n').pop() ?? ''

const tempAcquireRefused = (directory: string) => (cause: PlatformError) =>
  new PackRunnerSpawnRefused({ directory, cause })

const makeWorkspace = (
  fs: PlatformFs.FileSystem,
  path: PlatformPath.Path,
  prefix: string,
  directory: string,
): Effect.Effect<PackWorkspace, PackRunnerSpawnRefused, Scope.Scope> =>
  Effect.map(
    Effect.mapError(fs.makeTempDirectoryScoped({ prefix }), tempAcquireRefused(directory)),
    (temporary): PackWorkspace => ({ fs, path, temporary }),
  )

const spawnedPack = (
  spawner: ChildProcessSpawner['Service'],
  workspace: PackWorkspace,
  directory: string,
): Effect.Effect<string, PackRunnerSpawnRefused> =>
  Effect.mapError(
    spawner.string(
      ChildProcess.make('npm', ['pack', '--ignore-scripts', directory]).pipe(
        ChildProcess.setCwd(workspace.temporary),
      ),
    ),
    (cause) => new PackRunnerSpawnRefused({ directory, cause }),
  )

const singleTarball = (
  names: ReadonlyArray<string>,
  directory: string,
): Effect.Effect<string, PackRunnerOutputUnreadable> =>
  Match.value(names.length === 1 ? names[0] : undefined).pipe(
    Match.when(Predicate.isString, (only) => Effect.succeed(only)),
    Match.orElse(() => Effect.fail(new PackRunnerOutputUnreadable({ directory }))),
  )

const discoveredTarball = (
  entries: ReadonlyArray<string>,
  directory: string,
): Effect.Effect<string, PackRunnerOutputUnreadable> =>
  singleTarball(entries.filter((entry) => entry.endsWith(TARBALL_SUFFIX)), directory)

const listTarball = (
  fs: PlatformFs.FileSystem,
  temporary: string,
  directory: string,
): Effect.Effect<string, PackRunnerOutputUnreadable> =>
  Effect.flatMap(
    Effect.mapError(
      fs.readDirectory(temporary),
      (cause) => new PackRunnerOutputUnreadable({ directory, cause }),
    ),
    (entries) => discoveredTarball(entries, directory),
  )

const namedTarball = (output: string, discovered: string): string => {
  const printed = tarballNameFrom(output)
  if (printed === '') return discovered
  return printed
}

const tarballIn = (
  workspace: PackWorkspace,
  directory: string,
  output: string,
): Effect.Effect<PackResult, PackRunnerOutputUnreadable> =>
  Effect.map(
    listTarball(workspace.fs, workspace.temporary, directory),
    (discovered) => {
      const tarballName = namedTarball(output, discovered)
      return { tarballName, tarballPath: workspace.path.join(workspace.temporary, tarballName) }
    },
  )

const packInWorkspace = (
  spawner: ChildProcessSpawner['Service'],
  workspace: PackWorkspace,
  directory: string,
): Effect.Effect<PackResult, PackRunnerSpawnRefused | PackRunnerOutputUnreadable> =>
  Effect.flatMap(
    spawnedPack(spawner, workspace, directory),
    (output) => tarballIn(workspace, directory, output),
  )
const packedScoped = (
  fs: PlatformFs.FileSystem,
  path: PlatformPath.Path,
  spawner: ChildProcessSpawner['Service'],
  prefix: string,
  directory: string,
): Effect.Effect<PackResult, PackRunnerSpawnRefused | PackRunnerOutputUnreadable, Scope.Scope> =>
  Effect.flatMap(
    makeWorkspace(fs, path, prefix, directory),
    (workspace) => packInWorkspace(spawner, workspace, directory),
  )

const serviceFor = (
  fs: PlatformFs.FileSystem,
  path: PlatformPath.Path,
  spawner: ChildProcessSpawner['Service'],
  prefix: string,
): PackRunner['Service'] => {
  const pack = (
    directory: string,
  ): Effect.Effect<PackResult, PackRunnerSpawnRefused | PackRunnerOutputUnreadable, Scope.Scope> =>
    packedScoped(fs, path, spawner, prefix, directory)
  return PackRunner.of({ pack })
}

const workspacePrefix = (prefix: string | undefined): string => prefix ?? DEFAULT_WORKSPACE_PREFIX

const defaultedPrefix = (options: NpmPackRunnerOptions | undefined): string => workspacePrefix(options?.workspacePrefix)

const serviceLayer = (
  prefix: string,
): Layer.Layer<PackRunner, never, PlatformFs.FileSystem | PlatformPath.Path | ChildProcessSpawner> =>
  Layer.effect(
    PackRunner,
    Effect.map(
      Effect.all([PlatformFs.FileSystem, PlatformPath.Path, ChildProcessSpawner] as const),
      ([fs, path, spawner]) => serviceFor(fs, path, spawner, prefix),
    ),
  )

export const layer = (
  options?: NpmPackRunnerOptions,
): Layer.Layer<PackRunner, never, PlatformFs.FileSystem | PlatformPath.Path | ChildProcessSpawner> =>
  serviceLayer(defaultedPrefix(options))
