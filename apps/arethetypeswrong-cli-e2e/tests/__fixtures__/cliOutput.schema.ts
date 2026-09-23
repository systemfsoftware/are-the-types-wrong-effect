import { Schema } from 'effect'

export const EnvelopeIdentity = Schema.Struct({
  status: Schema.Literals(['ok', 'untyped']),
  packageName: Schema.String,
  packageVersion: Schema.String,
})

export const FailureDocument = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal('error'),
    kind: Schema.String,
    recovery: Schema.String,
  }),
)

export const JsonDocument = Schema.fromJsonString(Schema.Json)

export class ContainerCommandRefused extends Schema.TaggedError<ContainerCommandRefused>()(
  'ContainerCommandRefused',
  { cause: Schema.optional(Schema.Unknown) },
) {}

export class ContainerStartRefused extends Schema.TaggedError<ContainerStartRefused>()(
  'ContainerStartRefused',
  { cause: Schema.optional(Schema.Unknown) },
) {}

export class ContainerStopRefused extends Schema.TaggedError<ContainerStopRefused>()(
  'ContainerStopRefused',
  { cause: Schema.optional(Schema.Unknown) },
) {}

export class CommandExited extends Schema.TaggedError<CommandExited>()('CommandExited', {
  command: Schema.String,
  exitCode: Schema.Finite,
  output: Schema.String,
}) {}
