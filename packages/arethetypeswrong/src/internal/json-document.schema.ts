import { Schema } from 'effect'

/** @internal */
export const JsonDocument = Schema.fromJsonString(Schema.Json)

/** @internal */
export type JsonDocument = Schema.Schema.Type<typeof JsonDocument>
