import { Schema } from 'effect'

import { ProblemSchema, ResolutionOptionSchema } from './Problem.schema.js'
import { EntrypointInfoSchema, ProgramInfoSchema } from './Resolution.schema.js'

export const TypesIncluded = Schema.Struct({ kind: Schema.Literal('included') })
export type TypesIncluded = Schema.Schema.Type<typeof TypesIncluded>

export const TypesFromCompanion = Schema.Struct({
  kind: Schema.Literal('@types'),
  packageName: Schema.String,
  packageVersion: Schema.String,
  definitelyTypedUrl: Schema.optional(Schema.String),
})
export type TypesFromCompanion = Schema.Schema.Type<typeof TypesFromCompanion>

export const PackageTypes = Schema.Union([TypesIncluded, TypesFromCompanion])
export type PackageTypes = Schema.Schema.Type<typeof PackageTypes>

export const Report = Schema.Struct({
  packageName: Schema.String,
  packageVersion: Schema.String,
  buildTools: Schema.Record(Schema.String, Schema.String),
  types: PackageTypes,
  entrypoints: Schema.Record(Schema.String, EntrypointInfoSchema),
  programInfo: Schema.Record(ResolutionOptionSchema, ProgramInfoSchema),
  problems: Schema.Array(ProblemSchema),
})
export type Report = Schema.Schema.Type<typeof Report>

export const UntypedReport = Schema.Struct({
  packageName: Schema.String,
  packageVersion: Schema.String,
  types: Schema.Literal(false),
})
export type UntypedReport = Schema.Schema.Type<typeof UntypedReport>

export const PackageReport = Schema.Union([Report, UntypedReport])
export type PackageReport = Schema.Schema.Type<typeof PackageReport>
