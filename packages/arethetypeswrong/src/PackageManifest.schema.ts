import { Schema } from 'effect'

export interface ManifestExportsConditions {
  readonly [condition: string]: ManifestExportsTarget
}
export type ManifestExportsTarget = string | null | readonly ManifestExportsTarget[] | ManifestExportsConditions

export const ManifestExportsTarget: Schema.Codec<ManifestExportsTarget, ManifestExportsTarget> = Schema.Union([
  Schema.String,
  Schema.Null,
  Schema.Array(Schema.suspend((): Schema.Codec<ManifestExportsTarget, ManifestExportsTarget> => ManifestExportsTarget)),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<ManifestExportsTarget, ManifestExportsTarget> => ManifestExportsTarget),
  ),
])

export const PackageManifest = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.Literals(['module', 'commonjs'])),
  main: Schema.optionalKey(Schema.String),
  exports: Schema.optionalKey(ManifestExportsTarget),
  homepage: Schema.optionalKey(Schema.String),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
export type PackageManifest = Schema.Schema.Type<typeof PackageManifest>

export const PackageManifestJson = Schema.fromJsonString(PackageManifest)
