import * as Schema from 'effect/Schema'

export class FilesystemReadRefused extends Schema.TaggedError<FilesystemReadRefused>()('FilesystemReadRefused', {
  path: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class FilesystemTempDirectoryRefused extends Schema.TaggedError<FilesystemTempDirectoryRefused>()(
  'FilesystemTempDirectoryRefused',
  {
    cause: Schema.optional(Schema.Unknown),
  },
) {}
