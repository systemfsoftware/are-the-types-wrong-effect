import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Match, Result } from 'effect'
import * as S from 'effect/Schema'

import { TarballRefSchema } from './Acquisition.schema.js'

const ReadEvidenceTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/arethetypeswrong-cli/classify-tarball-read/ReadEvidence',
)
type ReadEvidenceTypeId = typeof ReadEvidenceTypeId

export class TarballRead extends S.TaggedClass<TarballRead>()('TarballRead', {
  ref: TarballRefSchema,
  bytes: S.Uint8Array,
}) {
  readonly [ReadEvidenceTypeId] = ReadEvidenceTypeId
}

export type ReadEvidence = TarballRead

export class PackFailed extends S.TaggedError<PackFailed>()('PackFailed', {
  message: S.String,
  recovery: S.String,
}) {}

export class ClassifyTarballReadCommand extends S.TaggedClass<ClassifyTarballReadCommand>()(
  'ClassifyTarballReadCommand',
  {
    directory: S.String,
    tarballPath: S.String,
    bytes: S.Option(S.Uint8Array),
  },
) {
  static readonly [Workflow.InstrumentationBrand] = { tarballPath: 'app.attw.tarball.path' } as const
}

const packedRef = (directory: string, tarballPath: string) => ({
  packageName: directory,
  packageVersion: 'local',
  tarballUrl: `file://${tarballPath}`,
})

const packFailed = (): PackFailed =>
  new PackFailed({
    message: 'The packed tarball could not be read back from disk.',
    recovery: 'Rerun the same command with --pack to repack that directory.',
  })

export const classifyTarballRead = Workflow.make({
  command: ClassifyTarballReadCommand,
  decision: TarballRead,
  error: PackFailed,
  decide: (command): Result.Result<TarballRead, PackFailed> =>
    Match.value(command.bytes).pipe(
      Match.tag('Some', ({ value: bytes }) =>
        Result.succeed(new TarballRead({ ref: packedRef(command.directory, command.tarballPath), bytes }))),
      Match.tag('None', () =>
        Result.fail(packFailed())),
      Match.exhaustive,
    ),
})
