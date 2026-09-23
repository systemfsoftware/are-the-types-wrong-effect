import { Schema } from 'effect'

export const PackageSpecVersionKindSchema = Schema.Literals(['none', 'exact', 'range', 'tag'])
export type PackageSpecVersionKind = Schema.Schema.Type<typeof PackageSpecVersionKindSchema>

const WellFormedStringSchema = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^(?:[\0-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/, {
      expected: 'a well-formed Unicode string',
    }),
  ),
)

export const ParsedPackageSpecSchema = Schema.Struct({
  name: WellFormedStringSchema,
  versionKind: PackageSpecVersionKindSchema,
  version: WellFormedStringSchema,
})
export type ParsedPackageSpec = Schema.Schema.Type<typeof ParsedPackageSpecSchema>

/**
 * Refusal a specifier parse returns: the specifier named no valid package, or
 * carried a version that was neither an exact version nor a range.
 */
export class PackageSpecParseError extends Schema.TaggedError<PackageSpecParseError>()(
  'PackageSpecParseError',
  { message: Schema.String },
) {}
