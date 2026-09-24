import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Match, Option, Result } from 'effect'

import { AcquisitionCommandRejected, ManifestResolved, PackCleaned, TarballFetched } from './Acquisition.schema.js'
import {
  RegistryBadResponseDecided,
  RegistryNotFoundDecided,
  RegistryUnreachableDecided,
} from './classify-registry-failure.workflow.js'
import { TarballRead } from './classify-tarball-read.workflow.js'
import { ConfigInvalid } from './Failure.schema.js'
import { fetchRegistryTarball } from './fetch-registry-tarball.cell.js'
import { Filesystem } from './filesystem.service.js'
import type { ParsedPackageSpec } from './PackageSpec.schema.js'
import { verdictFor } from './parse-package-spec.cell.js'
import { parsePackageSpec } from './parse-package-spec.workflow.js'
import { decodeRegistryUrl } from './RegistryUrl.js'
import {
  InvalidPackageSpec,
  resolveAcquisitionSource,
  ResolveAcquisitionSourceCommand,
  TargetNotPackable,
} from './resolve-acquisition-source.workflow.js'
import { resolveRegistryManifest } from './resolve-registry-manifest.cell.js'

export interface AcquireTarballRequest {
  readonly target: string
  readonly fromNpm: boolean
  readonly registry: string
}

type AcquisitionSourceCommand = (typeof ResolveAcquisitionSourceCommand)['Encoded']

interface AcquisitionSourceRaw extends AcquisitionSourceCommand {
  readonly registry: string
}

export type RegistryAcquisitionAnswer =
  | TarballFetched
  | RegistryNotFoundDecided
  | RegistryUnreachableDecided
  | RegistryBadResponseDecided

export type RegistryManifestAnswer = ManifestResolved | Exclude<RegistryAcquisitionAnswer, TarballFetched>

export type AcquiredTarballSource = TarballFetched | TarballRead | PackCleaned

export type AcquiredTarballAnswer = AcquiredTarballSource | ConfigInvalid | InvalidPackageSpec | TargetNotPackable

const sourceRaw = (
  request: AcquireTarballRequest,
  spec: Option.Option<ParsedPackageSpec>,
): AcquisitionSourceRaw => ({
  target: request.target,
  fromNpm: request.fromNpm,
  parsed: spec,
  registry: request.registry,
})

const localRef = (target: string) => ({
  packageName: target,
  packageVersion: 'local',
  tarballUrl: `file://${target}`,
})

const targetNotPackable = (): TargetNotPackable =>
  new TargetNotPackable({
    message: 'The target is not a package tarball this tool can read.',
    recovery:
      'Pass --pack with a directory, an existing .tgz path, or a package name with --from-npm, then rerun the same command.',
  })

const registryAcquisition = resolveRegistryManifest.pipe(
  Cell.andThen((answer: RegistryManifestAnswer) =>
    Match.value(answer).pipe(
      Match.tag('ManifestResolved', (manifest) =>
        fetchRegistryTarball.pipe(Cell.mapInput((_sourced: RegistryManifestAnswer) => manifest))),
      Match.orElse((refusal) =>
        Cell.succeed(refusal)
      ),
    )
  ),
)

export const acquireTarball = Sandwich.named('acquire.tarball')(
  (request: AcquireTarballRequest) => {
    const parsed = Result.match(parsePackageSpec(verdictFor(request.target)), {
      onFailure: () => Option.none<ParsedPackageSpec>(),
      onSuccess: (decision) => Option.some(decision.spec),
    })
    return Effect.succeed(sourceRaw(request, parsed))
  },
)
  .decide(resolveAcquisitionSource)
  .write({
    ExistingTarball: (_decision, command) =>
      Effect.flatMap(Filesystem, (fs) =>
        Effect.match(fs.readBytes(command.target), {
          onFailure: () => Effect.succeed(targetNotPackable()),
          onSuccess: (bytes) => Effect.succeed(new TarballRead({ ref: localRef(command.target), bytes })),
        })),
    RegistryPackage: (decision, command) =>
      Effect.matchEffect(Effect.fromResult(decodeRegistryUrl(command.registry)), {
        onFailure: (refusal) => Effect.succeed(new ConfigInvalid(refusal)),
        onSuccess: (registryBase) => registryAcquisition.run({ registryBase, spec: decision.spec }),
      }),
    InvalidPackageSpec: (refused) => Effect.succeed(new InvalidPackageSpec(refused)),
    TargetNotPackable: (refused) => Effect.succeed(new TargetNotPackable(refused)),
    CommandRejected: (rejected) => Effect.fail(new AcquisitionCommandRejected({ issue: rejected.issue })),
  })
