import * as S from 'effect/Schema'

import { RegistryDocument } from './Registry.schema.js'

const AcquisitionEvidenceTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/AcquisitionEvidence',
)
type AcquisitionEvidenceTypeId = typeof AcquisitionEvidenceTypeId

export const TarballRefSchema = S.Struct({
  packageName: S.String,
  packageVersion: S.String,
  tarballUrl: S.String,
})
export type TarballRef = S.Schema.Type<typeof TarballRefSchema>

export class ManifestResolved extends S.TaggedClass<ManifestResolved>()('ManifestResolved', {
  registryBase: S.String,
  manifest: RegistryDocument,
}) {
  readonly [AcquisitionEvidenceTypeId] = AcquisitionEvidenceTypeId
}

export class TarballFetched extends S.TaggedClass<TarballFetched>()('TarballFetched', {
  ref: TarballRefSchema,
  bytes: S.Uint8Array,
}) {
  readonly [AcquisitionEvidenceTypeId] = AcquisitionEvidenceTypeId
}

export class PackCleaned extends S.TaggedClass<PackCleaned>()('PackCleaned', {
  ref: TarballRefSchema,
  bytes: S.Uint8Array,
}) {
  readonly [AcquisitionEvidenceTypeId] = AcquisitionEvidenceTypeId
}

export class AcquisitionCommandRejected extends S.TaggedError<AcquisitionCommandRejected>()(
  'AcquisitionCommandRejected',
  {
    issue: S.String,
    cause: S.optional(S.Unknown),
  },
) {}
