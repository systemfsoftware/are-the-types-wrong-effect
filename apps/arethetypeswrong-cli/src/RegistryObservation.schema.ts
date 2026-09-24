import * as Schema from 'effect/Schema'

export class RegistryDocumentRead extends Schema.TaggedClass<RegistryDocumentRead>()('RegistryDocumentRead', {
  status: Schema.Finite,
  bytes: Schema.Uint8Array,
}) {}

export class RegistryStatusRead extends Schema.TaggedClass<RegistryStatusRead>()('RegistryStatusRead', {
  status: Schema.Finite,
}) {}
