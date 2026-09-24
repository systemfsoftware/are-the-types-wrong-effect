import { Sandwich } from '@systemfsoftware/effect-cell-types'
import { Effect, Match, Option, Result } from 'effect'
import * as S from 'effect/Schema'

import { AcquisitionCommandRejected, ManifestResolved } from './Acquisition.schema.js'
import {
  classifyRegistryFailure,
  ClassifyRegistryFailureCommand,
  RegistryBadResponseDecided,
  RegistryNotFoundDecided,
  RegistryUnreachableDecided,
} from './classify-registry-failure.workflow.js'
import type { ParsedPackageSpec } from './PackageSpec.schema.js'
import { RegistryDocument } from './Registry.schema.js'
import { Registry } from './registry.service.js'
import { RegistryDocumentRead, RegistryStatusRead } from './RegistryObservation.schema.js'
import { buildManifestUrl } from './RegistryUrl.js'

export interface RegistryManifestRequest {
  readonly registryBase: string
  readonly spec: ParsedPackageSpec
}

type RegistryFailureCommand = (typeof ClassifyRegistryFailureCommand)['Encoded']
type RegistryManifest = S.Schema.Type<typeof RegistryDocument>

interface RegistryManifestRaw extends RegistryFailureCommand {
  readonly registryBase: string
  readonly manifest: Option.Option<RegistryManifest>
}

const manifestOf = (bytes: Uint8Array): Option.Option<RegistryManifest> =>
  Result.match(S.decodeResult(S.fromJsonString(RegistryDocument))(new TextDecoder().decode(bytes)), {
    onFailure: () => Option.none(),
    onSuccess: (document) => Option.some(document),
  })

const refusedRaw = (registryBase: string, status: number): RegistryManifestRaw => ({
  observation: { _tag: 'RegistryStatusObserved', status },
  manifest: Option.none<RegistryManifest>(),
  registryBase,
})

const unreadableRaw = (registryBase: string): RegistryManifestRaw => ({
  observation: { _tag: 'RegistryUnreadableShapeObserved' },
  manifest: Option.none<RegistryManifest>(),
  registryBase,
})

const noResponseRaw = (registryBase: string): RegistryManifestRaw => ({
  observation: { _tag: 'RegistryNoResponseObserved' },
  manifest: Option.none<RegistryManifest>(),
  registryBase,
})

const documentRaw = (registryBase: string, status: number, manifest: RegistryManifest): RegistryManifestRaw => ({
  observation: { _tag: 'RegistryStatusObserved', status },
  manifest: Option.some(manifest),
  registryBase,
})

const observationRaw = (
  registryBase: string,
  observation: RegistryDocumentRead | RegistryStatusRead,
): RegistryManifestRaw =>
  Match.value(observation).pipe(
    Match.tag('RegistryStatusRead', ({ status }) => refusedRaw(registryBase, status)),
    Match.tag('RegistryDocumentRead', ({ status, bytes }) =>
      Match.value(manifestOf(bytes)).pipe(
        Match.tag('Some', ({ value }) => documentRaw(registryBase, status, value)),
        Match.tag('None', () => unreadableRaw(registryBase)),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const registryUnreadable = (): RegistryBadResponseDecided =>
  new RegistryBadResponseDecided({
    message: 'The registry answered with a document this tool cannot read.',
    recovery: 'Check network access and the --registry URL, then rerun the same command.',
  })

export const resolveRegistryManifest = Sandwich.named('acquire.resolve_registry_manifest')(
  (request: RegistryManifestRequest) =>
    Effect.flatMap(
      Registry,
      (registry) =>
        Effect.matchEffect(registry.fetchDocument(buildManifestUrl(request.registryBase, request.spec)), {
          onFailure: (refusal) =>
            Match.value(refusal).pipe(
              Match.tag('RegistryUnreachable', () => Effect.succeed(noResponseRaw(request.registryBase))),
              Match.tag('RegistryPayloadOverBudget', (overBudget) => Effect.fail(overBudget)),
              Match.exhaustive,
            ),
          onSuccess: (observation) => Effect.succeed(observationRaw(request.registryBase, observation)),
        }),
    ),
)
  .decide(classifyRegistryFailure)
  .write({
    RegistryNotFound: (refused) => Effect.succeed(new RegistryNotFoundDecided(refused)),
    RegistryUnreachable: (refused) => Effect.succeed(new RegistryUnreachableDecided(refused)),
    RegistryBadResponse: (refused) => Effect.succeed(new RegistryBadResponseDecided(refused)),
    RegistryAnsweredSuccessfully: (_answered, command) =>
      Effect.succeed(
        Match.value(command.manifest).pipe(
          Match.tag(
            'Some',
            ({ value }) => new ManifestResolved({ registryBase: command.registryBase, manifest: value }),
          ),
          Match.tag('None', () => registryUnreadable()),
          Match.exhaustive,
        ),
      ),
    CommandRejected: (rejected) => Effect.fail(new AcquisitionCommandRejected({ issue: rejected.issue })),
  })
