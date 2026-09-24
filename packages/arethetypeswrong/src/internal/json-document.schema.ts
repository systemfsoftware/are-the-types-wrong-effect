import { Schema } from 'effect'

/** @internal */
export const JsonDocument = Schema.fromJsonString(Schema.Json)

/** @internal */
export const PackageJsonDocument = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))

/** @internal */
export type PackageJsonDocument = Schema.Schema.Type<typeof PackageJsonDocument>

/** @internal */
export type JsonDocument = Schema.Schema.Type<typeof JsonDocument>
