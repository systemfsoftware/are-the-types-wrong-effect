import { Schema } from 'effect'

export class ManifestUnreadable extends Schema.TaggedError<ManifestUnreadable>()('ManifestUnreadable', {
  cause: Schema.optional(Schema.Unknown),
}) {}

export class CompilerFailed extends Schema.TaggedError<CompilerFailed>()('CompilerFailed', {
  cause: Schema.optional(Schema.Unknown),
}) {}

export class LexerUnavailable extends Schema.TaggedError<LexerUnavailable>()('LexerUnavailable', {
  cause: Schema.optional(Schema.Unknown),
}) {}

export type AnalysisError = ManifestUnreadable | CompilerFailed | LexerUnavailable
