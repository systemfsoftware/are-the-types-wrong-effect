import * as Schema from 'effect/Schema'

export class PackRunnerSpawnRefused extends Schema.TaggedError<PackRunnerSpawnRefused>()('PackRunnerSpawnRefused', {
  directory: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class PackRunnerOutputUnreadable extends Schema.TaggedError<PackRunnerOutputUnreadable>()(
  'PackRunnerOutputUnreadable',
  {
    directory: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
