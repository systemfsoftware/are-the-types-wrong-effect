import * as Schema from 'effect/Schema'

export class TerminalWriteRefused extends Schema.TaggedError<TerminalWriteRefused>()('TerminalWriteRefused', {
  stream: Schema.Literals(['stdout', 'stderr']),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class TerminalObservations extends Schema.Class<TerminalObservations>('TerminalObservations')({
  isTty: Schema.Boolean,
  width: Schema.Finite,
}) {}
