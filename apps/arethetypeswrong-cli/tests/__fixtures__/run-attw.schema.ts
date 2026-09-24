import * as S from 'effect/Schema'

export const PackageManifestText = S.fromJsonString(
  S.Struct({
    name: S.String,
    version: S.String,
    main: S.optional(S.String),
    types: S.optional(S.String),
    exports: S.optional(S.Record(S.String, S.Union([S.String, S.Record(S.String, S.String)]))),
  }),
)

export const Waiver = S.fromJsonString(S.Struct({ ignoreRules: S.Array(S.String) }))

export const RegistryManifest = S.fromJsonString(
  S.Struct({
    name: S.String,
    version: S.String,
    dist: S.Struct({ tarball: S.String }),
  }),
)

export const EnvelopeText = S.fromJsonString(
  S.Struct({
    status: S.Literals(['ok', 'untyped']),
    packageName: S.String,
    problems: S.optional(S.Struct({ kind: S.String }).pipe(S.Array)),
  }),
)

export const FailureText = S.fromJsonString(S.Struct({ kind: S.String }))
