import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Match, Option } from 'effect'

import {
  AcquisitionCommandRejected,
  type ManifestResolved,
  TarballFetched,
  type TarballRef,
} from './Acquisition.schema.js'
import {
  classifyRegistryFailure,
  ClassifyRegistryFailureCommand,
  RegistryBadResponseDecided,
  RegistryNotFoundDecided,
  RegistryUnreachableDecided,
} from './classify-registry-failure.workflow.js'
import { Registry } from './registry.service.js'
import { RegistryDocumentRead, RegistryStatusRead } from './RegistryObservation.schema.js'

type RegistryFailureCommand = (typeof ClassifyRegistryFailureCommand)['Encoded']

interface RegistryTarballRaw extends RegistryFailureCommand {
  readonly ref: TarballRef
  readonly tarball: Option.Option<Uint8Array>
}

const noResponseRaw = (ref: TarballRef): RegistryTarballRaw => ({
  observation: { _tag: 'RegistryNoResponseObserved' },
  ref,
  tarball: Option.none<Uint8Array>(),
})

const statusRaw = (ref: TarballRef, status: number): RegistryTarballRaw => ({
  observation: { _tag: 'RegistryStatusObserved', status },
  ref,
  tarball: Option.none(),
})

const documentRaw = (ref: TarballRef, status: number, bytes: Uint8Array): RegistryTarballRaw => ({
  observation: { _tag: 'RegistryStatusObserved', status },
  ref,
  tarball: Option.some(bytes),
})

const observationRaw = (ref: TarballRef, observation: RegistryDocumentRead | RegistryStatusRead): RegistryTarballRaw =>
  Match.value(observation).pipe(
    Match.tag('RegistryStatusRead', ({ status }) => statusRaw(ref, status)),
    Match.tag('RegistryDocumentRead', ({ status, bytes }) => documentRaw(ref, status, bytes)),
    Match.exhaustive,
  )

const registryUnreadable = (): RegistryBadResponseDecided =>
  new RegistryBadResponseDecided({
    message: 'The registry answered with a document this tool cannot read.',
    recovery: 'Check network access and the --registry URL, then rerun the same command.',
  })

export const fetchRegistryTarball = Sandwich.named('acquire.fetch_registry_tarball')(
  (manifest: ManifestResolved) => {
    const ref: TarballRef = {
      packageName: manifest.manifest.name,
      packageVersion: manifest.manifest.version,
      tarballUrl: manifest.manifest.dist.tarball,
    }
    return Effect.flatMap(
      Registry,
      (registry) =>
        Effect.matchEffect(registry.fetchDocument(manifest.manifest.dist.tarball), {
          onFailure: (refusal) =>
            Match.value(refusal).pipe(
              Match.tag('RegistryUnreachable', () => Effect.succeed(noResponseRaw(ref))),
              Match.tag('RegistryPayloadOverBudget', (overBudget) => Effect.fail(overBudget)),
              Match.exhaustive,
            ),
          onSuccess: (observation) => Effect.succeed(observationRaw(ref, observation)),
        }),
    )
  },
)
  .decide(classifyRegistryFailure)
  .write({
    RegistryNotFound: (refused) => Effect.succeed(new RegistryNotFoundDecided(refused)),
    RegistryUnreachable: (refused) => Effect.succeed(new RegistryUnreachableDecided(refused)),
    RegistryBadResponse: (refused) => Effect.succeed(new RegistryBadResponseDecided(refused)),
    RegistryAnsweredSuccessfully: (_answered, command) =>
      Effect.succeed(
        Match.value(command.tarball).pipe(
          Match.tag('Some', ({ value }) => new TarballFetched({ ref: command.ref, bytes: value })),
          Match.tag('None', () => registryUnreadable()),
          Match.exhaustive,
        ),
      ),
    CommandRejected: (rejected) => Effect.fail(new AcquisitionCommandRejected({ issue: rejected.issue })),
  })
