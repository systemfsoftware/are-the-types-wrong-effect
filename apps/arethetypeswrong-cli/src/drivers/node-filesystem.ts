import { Effect, Layer } from 'effect'
import * as PlatformPath from 'effect/Path'
import * as PlatformError from 'effect/PlatformError'

import * as PlatformFs from 'effect/FileSystem'
import { tempDirectoryAt } from '../filesystem-temp-directory.handle.js'
import { Filesystem } from '../filesystem.service.js'
import { FilesystemReadRefused, FilesystemTempDirectoryRefused } from '../FilesystemError.schema.js'

const readRefused = (path: string) => (cause: PlatformError.PlatformError) => new FilesystemReadRefused({ path, cause })

const tempDirectoryRefused = (cause: PlatformError.PlatformError) => new FilesystemTempDirectoryRefused({ cause })

const isDirectoryEntry = (info: PlatformFs.File.Info): boolean => info.type === 'Directory'

const makeTempDirectory = (fs: PlatformFs.FileSystem, prefix: string) =>
  Effect.map(
    Effect.mapError(fs.makeTempDirectoryScoped({ prefix }), tempDirectoryRefused),
    tempDirectoryAt,
  )

const tempPrefixOrDefault = (tempPrefix: string | undefined): string => tempPrefix === undefined ? 'attw-' : tempPrefix

const tempPrefixOf = (options: NodeFilesystemOptions | undefined): string => tempPrefixOrDefault(options?.tempPrefix)

export interface NodeFilesystemOptions {
  readonly tempPrefix?: string | undefined
}

export const layer = (
  options?: NodeFilesystemOptions,
): Layer.Layer<Filesystem, never, PlatformFs.FileSystem | PlatformPath.Path> =>
  Layer.effect(
    Filesystem,
    Effect.andThen(
      Effect.all([PlatformFs.FileSystem, PlatformPath.Path]),
      ([fs, path]) => {
        const existsAfterIgnore = (filePath: string) => Effect.orElseSucceed(fs.exists(filePath), () => false)
        const directoryAfterIgnore = (filePath: string) =>
          Effect.orElseSucceed(Effect.map(fs.stat(filePath), isDirectoryEntry), () => false)
        const prefix = tempPrefixOf(options)
        return Effect.succeed(
          Filesystem.of({
            readBytes: (filePath) => Effect.mapError(fs.readFile(filePath), readRefused(filePath)),
            readUtf8: (filePath) => Effect.mapError(fs.readFileString(filePath), readRefused(filePath)),
            fileExists: existsAfterIgnore,
            isDirectory: directoryAfterIgnore,
            deleteFile: (filePath) =>
              Effect.orElseSucceed(
                Effect.tapError(fs.remove(filePath), (cause) => Effect.logDebug('delete refused', cause)),
                () => undefined,
              ),
            resolve: (...segments) => path.resolve(...segments),
            join: (...segments) => path.join(...segments),
            makeTempDirectory: makeTempDirectory(fs, prefix),
          }),
        )
      },
    ),
  )
