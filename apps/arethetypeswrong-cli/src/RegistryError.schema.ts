import * as Schema from 'effect/Schema'

export class RegistryUnreachable extends Schema.TaggedError<RegistryUnreachable>()('RegistryUnreachable', {
  url: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class RegistryPayloadOverBudget extends Schema.TaggedError<RegistryPayloadOverBudget>()(
  'RegistryPayloadOverBudget',
  {
    url: Schema.String,
    byteLength: Schema.Finite,
    budgetBytes: Schema.Finite,
  },
) {}
