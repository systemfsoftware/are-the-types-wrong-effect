import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Match, Option, Result } from 'effect'
import type * as Scope from 'effect/Scope'

import { AcquisitionCommandRejected, ManifestResolved, PackCleaned, TarballFetched } from './Acquisition.schema.js'
import { DirectoryPacked, PackFailed } from './classify-pack-outcome.workflow.js'
import {
  RegistryBadResponseDecided,
  RegistryNotFoundDecided,
  RegistryUnreachableDecided,
} from './classify-registry-failure.workflow.js'
import { TarballRead } from './classify-tarball-read.workflow.js'
import { ConfigInvalid } from './Failure.schema.js'
import { fetchRegistryTarball } from './fetch-registry-tarball.cell.js'
import { Filesystem } from './filesystem.service.js'
import { packDirectory } from './pack-directory.cell.js'
import { PackRunner } from './pack-runner.service.js'
import type { ParsedPackageSpec } from './PackageSpec.schema.js'
import { verdictFor } from './parse-package-spec.cell.js'
import { parsePackageSpec } from './parse-package-spec.workflow.js'
import { readTarballFile } from './read-tarball-file.cell.js'
import { Registry } from './registry.service.js'
import { RegistryPayloadOverBudget } from './RegistryError.schema.js'
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
  readonly pack?: boolean
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

export type AcquiredTarballAnswer =
  | AcquiredTarballSource
  | ConfigInvalid
  | InvalidPackageSpec
  | TargetNotPackable
  | RegistryNotFoundDecided
  | RegistryUnreachableDecided
  | RegistryBadResponseDecided
  | PackFailed

export type AcquireTarballError = AcquisitionCommandRejected | RegistryPayloadOverBudget

export type AcquireTarballServices = Filesystem | Registry | PackRunner | Scope.Scope

const sourceRaw = (
  request: AcquireTarballRequest,
  spec: Option.Option<ParsedPackageSpec>,
): AcquisitionSourceRaw => ({
  target: request.target,
  fromNpm: request.fromNpm,
  pack: request.pack === true,
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

const packOutcomeFailed = (): PackFailed =>
  new PackFailed({
    message: '`npm pack` did not produce a readable tarball in the target directory.',
    recovery:
      'Run `npm pack` in the target directory to see the failure, fix it, then rerun the same command with --pack.',
  })

const packThenRead = packDirectory.pipe(
  Cell.andThen((packed) =>
    Match.value(packed).pipe(
      Match.tag('DirectoryPacked', (directory) =>
        readTarballFile.pipe(Cell.mapInput((_packed: DirectoryPacked | PackFailed) => directory))),
      Match.tag('PackFailed', (failed) =>
        Cell.succeed<PackCleaned | PackFailed>(failed)),
      Match.exhaustive,
    )
  ),
)

const packedAnswerOf = (packed: PackCleaned | PackFailed): AcquiredTarballAnswer =>
  Match.value(packed).pipe(
    Match.tag('PackCleaned', (cleaned): AcquiredTarballAnswer => cleaned),
    Match.tag('PackFailed', (): AcquiredTarballAnswer => packOutcomeFailed()),
    Match.exhaustive,
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
    PackDirectory: (_decision, command) =>
      Effect.matchEffect(packThenRead.run({ directory: command.target }), {
        onFailure: (error): Effect.Effect<AcquiredTarballAnswer, AcquisitionCommandRejected, PackRunner> =>
          Match.value(error).pipe(
            Match.tag('PackRunnerSpawnRefused', () => Effect.succeed(packOutcomeFailed())),
            Match.tag('AcquisitionCommandRejected', (rejected) => Effect.fail(rejected)),
            Match.exhaustive,
          ),
        onSuccess: (packed): Effect.Effect<AcquiredTarballAnswer, never, never> =>
          Effect.succeed(packedAnswerOf(packed)),
      }),
    ExistingTarball: (_decision, command) =>
      Effect.flatMap(Filesystem, (fs) =>
        Effect.match(fs.readBytes(command.target), {
          onFailure: () => targetNotPackable(),
          onSuccess: (bytes) => new TarballRead({ ref: localRef(command.target), bytes }),
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
