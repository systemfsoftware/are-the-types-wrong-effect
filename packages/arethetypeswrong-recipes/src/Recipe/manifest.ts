import { Result, Schema } from 'effect'
import { Manifest, ManifestJsonText } from './manifest.schema.js'

export const manifestText = (manifest: typeof Manifest.Type): string =>
  Result.getOrThrow(Schema.encodeResult(ManifestJsonText)(manifest))
