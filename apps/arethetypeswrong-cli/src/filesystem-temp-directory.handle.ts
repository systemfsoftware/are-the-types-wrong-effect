import { type Pipeable, Prototype } from 'effect/Pipeable'

export const FilesystemTempDirectoryTypeId = Symbol.for(
  '~systemfsoftware/arethetypeswrong-cli/FilesystemTempDirectory',
)
export type FilesystemTempDirectoryTypeId = typeof FilesystemTempDirectoryTypeId

export interface FilesystemTempDirectory extends Pipeable {
  readonly [FilesystemTempDirectoryTypeId]: typeof FilesystemTempDirectoryTypeId
  readonly path: string
}

export const tempDirectoryAt = (path: string): FilesystemTempDirectory => ({
  [FilesystemTempDirectoryTypeId]: FilesystemTempDirectoryTypeId,
  path,
  ...Prototype,
})
