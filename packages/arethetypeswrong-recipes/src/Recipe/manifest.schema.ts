import { Schema } from 'effect'

const ExportTarget = Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])

export const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  type: Schema.optional(Schema.Literals(['module', 'commonjs'])),
  main: Schema.optional(Schema.String),
  types: Schema.optional(Schema.String),
  exports: Schema.optional(Schema.Record(Schema.String, ExportTarget)),
})

export const ManifestJsonText = Schema.fromJsonString(Manifest)
