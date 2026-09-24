import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Option } from 'effect'

import { AcquisitionCommandRejected, PackCleaned } from './Acquisition.schema.js'
import { DirectoryPacked } from './classify-pack-outcome.workflow.js'
import { classifyTarballRead, ClassifyTarballReadCommand, PackFailed } from './classify-tarball-read.workflow.js'
import { Filesystem } from './filesystem.service.js'

type TarballReadCommand = (typeof ClassifyTarballReadCommand)['Encoded']

const snapshotFor = (packed: DirectoryPacked, text: Option.Option<Uint8Array>) => ({
  packed,
  command: {
    _tag: 'ClassifyTarballReadCommand',
    directory: packed.directory,
    tarballPath: packed.tarballPath,
    bytes: text,
  } satisfies TarballReadCommand,
})

export const readTarballFile = Sandwich.named('acquire.read_tarball_file')((packed: DirectoryPacked) =>
  Effect.map(
    Effect.flatMap(Filesystem, (fs) =>
      Effect.match(fs.readBytes(packed.tarballPath), {
        onFailure: () => Option.none<Uint8Array>(),
        onSuccess: (bytes) => Option.some(bytes),
      })),
    (text) => snapshotFor(packed, text),
  ).pipe(
    Effect.map((snapshot): TarballReadCommand => snapshot.command),
  )
)
  .decide(classifyTarballRead)
  .write({
    TarballRead: (read, command) =>
      Effect.flatMap(
        Filesystem,
        (fs) => Effect.as(fs.deleteFile(command.tarballPath), new PackCleaned({ ref: read.ref, bytes: read.bytes })),
      ),
    PackFailed: (failed) => Effect.succeed(new PackFailed(failed)),
    CommandRejected: (rejected) => Effect.fail(new AcquisitionCommandRejected({ issue: rejected.issue })),
  })
