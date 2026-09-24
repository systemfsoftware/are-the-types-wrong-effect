import { Context, Effect } from 'effect'
import type * as Scope from 'effect/Scope'

import type { FilesystemTempDirectory } from './filesystem-temp-directory.handle.js'
import type { FilesystemReadRefused, FilesystemTempDirectoryRefused } from './FilesystemError.schema.js'

export interface FilesystemService {
  readonly readBytes: (path: string) => Effect.Effect<Uint8Array, FilesystemReadRefused>
  readonly readUtf8: (path: string) => Effect.Effect<string, FilesystemReadRefused>
  readonly fileExists: (path: string) => Effect.Effect<boolean>
  readonly isDirectory: (path: string) => Effect.Effect<boolean>
  readonly deleteFile: (path: string) => Effect.Effect<void>
  readonly resolve: (...segments: ReadonlyArray<string>) => string
  readonly join: (...segments: ReadonlyArray<string>) => string
  readonly makeTempDirectory: Effect.Effect<FilesystemTempDirectory, FilesystemTempDirectoryRefused, Scope.Scope>
}

export class Filesystem extends Context.Service<Filesystem, FilesystemService>()(
  '@systemfsoftware/arethetypeswrong-cli/filesystem.service/Filesystem',
) {}
