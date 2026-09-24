import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Match, Option } from 'effect'
import type * as Scope from 'effect/Scope'

import { AcquisitionCommandRejected } from './Acquisition.schema.js'
import {
  classifyPackOutcome,
  ClassifyPackOutcomeCommand,
  DirectoryPacked,
  PackFailed,
} from './classify-pack-outcome.workflow.js'
import { PackRunner } from './pack-runner.service.js'
import { PackRunnerOutputUnreadable, PackRunnerSpawnRefused } from './PackRunnerError.schema.js'

export interface PackDirectoryRequest {
  readonly directory: string
}

type PackOutcomeCommand = (typeof ClassifyPackOutcomeCommand)['Encoded']

interface PackResultPaths {
  readonly tarballName: Option.Option<string>
  readonly tarballPath: Option.Option<string>
}

interface PackOutcomeSnapshot {
  readonly command: PackOutcomeCommand
}

const snapshotFor = (directory: string, packed: PackResultPaths): PackOutcomeSnapshot => ({
  command: {
    _tag: 'ClassifyPackOutcomeCommand',
    directory,
    tarballName: packed.tarballName,
    tarballPath: packed.tarballPath,
  },
})

const pathsOf = (
  refusal: PackRunnerSpawnRefused | PackRunnerOutputUnreadable,
): Effect.Effect<PackResultPaths, PackRunnerSpawnRefused> =>
  Match.value(refusal).pipe(
    Match.tag('PackRunnerOutputUnreadable', () =>
      Effect.succeed({ tarballName: Option.none<string>(), tarballPath: Option.none<string>() })),
    Match.tag('PackRunnerSpawnRefused', (refused) =>
      Effect.fail(refused)),
    Match.exhaustive,
  )

const packPathsIn = (
  directory: string,
): Effect.Effect<PackResultPaths, PackRunnerSpawnRefused, PackRunner | Scope.Scope> =>
  Effect.flatMap(PackRunner, (packRunner) =>
    Effect.map(
      Effect.matchEffect(packRunner.pack(directory), {
        onFailure: (refusal) => pathsOf(refusal),
        onSuccess: (packed) =>
          Effect.succeed({
            tarballName: Option.some(packed.tarballName),
            tarballPath: Option.some(packed.tarballPath),
          }),
      }),
      (found) => found,
    ))

export const packDirectory = Sandwich.named('acquire.pack_directory')((request: PackDirectoryRequest) =>
  Effect.map(
    packPathsIn(request.directory),
    (found): PackOutcomeCommand => snapshotFor(request.directory, found).command,
  )
)
  .decide(classifyPackOutcome)
  .write({
    DirectoryPacked: (packed) => Effect.succeed(new DirectoryPacked(packed)),
    PackFailed: (failed) => Effect.succeed(new PackFailed(failed)),
    CommandRejected: (rejected) => Effect.fail(new AcquisitionCommandRejected({ issue: rejected.issue })),
  })
