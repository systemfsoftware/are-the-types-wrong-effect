import * as S from 'effect/Schema'

export const PackageSpecVersionKindSchema = S.Literals(['none', 'exact', 'range', 'tag'])
export type PackageSpecVersionKind = S.Schema.Type<typeof PackageSpecVersionKindSchema>

const WellFormedStringSchema = S.String.pipe(
  S.check(
    S.isPattern(/^(?:[\0-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/, {
      expected: 'a well-formed Unicode string',
    }),
  ),
)

export const ParsedPackageSpecSchema = S.Struct({
  name: WellFormedStringSchema,
  versionKind: PackageSpecVersionKindSchema,
  version: WellFormedStringSchema,
})
export type ParsedPackageSpec = S.Schema.Type<typeof ParsedPackageSpecSchema>
