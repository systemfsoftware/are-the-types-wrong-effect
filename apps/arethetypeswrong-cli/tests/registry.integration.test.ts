import { NodeHttpClient, NodeHttpServer } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Layer, Match, Predicate } from 'effect'
import * as HttpRouter from 'effect/unstable/http/HttpRouter'
import * as HttpServer from 'effect/unstable/http/HttpServer'
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse'
import { expect } from 'vitest'

import * as HttpRegistry from '../src/drivers/http-registry.js'
import { Registry } from '../src/registry.service.js'

const Feature = makeFeature({ it, layer })

const DEFAULT_PAYLOAD_BYTES = 32 * 1024 * 1024

const oversizedBody = `{"padding":"${'x'.repeat(DEFAULT_PAYLOAD_BYTES)}"}`

const documentPath = '/packages/attw/manifest.json'
const missingPath = '/packages/missing/manifest.json'
const oversizedPath = '/packages/oversized/manifest.json'

const documentRoutes = HttpRouter.add('GET', documentPath, HttpServerResponse.text('{"name":"attw"}'))

const missingRoutes = HttpRouter.add('GET', missingPath, HttpServerResponse.text('nope', { status: 404 }))

const oversizedRoutes = HttpRouter.add('GET', oversizedPath, HttpServerResponse.text(oversizedBody))

const servedScenario = HttpRouter.serve(
  Layer.mergeAll(documentRoutes, missingRoutes, oversizedRoutes),
  { disableLogger: true, disableListenLog: true },
)

const listening = servedScenario.pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.orDie,
)

const registryScenario = HttpRegistry.layer().pipe(
  Layer.provide(NodeHttpClient.layerFetch),
  Layer.provideMerge(listening),
)

const documentUrl = (path: string) => HttpServer.addressFormattedWith((address) => Effect.succeed(`${address}${path}`))

const askedFor = (url: string) =>
  Effect.flatMap(Registry, (registry) =>
    Effect.match(registry.fetchDocument(url), {
      onFailure: (refusal) =>
        Match.value(refusal).pipe(
          Match.when(
            { _tag: 'RegistryPayloadOverBudget' },
            (found) => ({ tag: 'overBudget' as const, url: found.url }),
          ),
          Match.orElse((found) => ({ tag: 'unreachable' as const, url: found.url })),
        ),
      onSuccess: (read) =>
        Predicate.isTagged(read, 'RegistryDocumentRead')
          ? { tag: 'document' as const, bytes: read.bytes.byteLength, status: read.status }
          : { tag: 'status' as const, status: read.status },
    }))

const closedUrl = () =>
  Effect.map(
    Effect.scoped(
      Effect.flatMap(Layer.build(servedScenario), (context) =>
        Effect.provide(HttpServer.addressFormattedWith((address) => Effect.succeed(address)), context)),
    ),
    (address) =>
      `${address.replace(/:\d+$/, ':9')}${documentPath}`,
  )

const refuseFromClosed = (url: string) =>
  Effect.flatMap(Registry, (registry) =>
    Effect.match(registry.fetchDocument(url), {
      onFailure: () => 'refused' as const,
      onSuccess: () => 'answered' as const,
    }))

Feature('Downloading a package document from a registry')
  .withScenarioLayer(registryScenario)
  .body(({ scenario }) => {
    scenario(
      'The registry answers with the requested document',
      Gherkin.Do.pipe(
        Given('a registry serving the requested document')('url', () => documentUrl(documentPath)),
        When('the tool asks that registry for the document')('observation', (s) => askedFor(s.url)),
        Then('the document arrives intact')((s) => {
          expect(s.observation).toMatchObject({ tag: 'document', status: 200 })
        }),
      ),
    )

    scenario(
      'The registry has no such package',
      Gherkin.Do.pipe(
        Given('a registry that answers not found')('url', () => documentUrl(missingPath)),
        When('the tool asks that registry for the document')('observation', (s) => askedFor(s.url)),
        Then('the answer reports the missing package')((s) => {
          expect(s.observation).toMatchObject({ tag: 'status', status: 404 })
        }),
      ),
    )

    scenario(
      'The registry document is larger than the tool will read',
      Gherkin.Do.pipe(
        Given('a registry serving an oversized manifest')('url', () => documentUrl(oversizedPath)),
        When('the tool asks that registry for the document')('observation', (s) => askedFor(s.url)),
        Then('the oversized document is refused, not truncated')((s) => {
          expect(s.observation).toMatchObject({ tag: 'overBudget' })
        }),
      ),
    )

    scenario(
      'No registry is listening at the address the tool was given',
      Gherkin.Do.pipe(
        Given('a registry that answered and then went quiet')('url', () => closedUrl()),
        When('the tool asks a closed port for the document')('verdict', (s) => refuseFromClosed(s.url)),
        Then('the tool gives up instead of hanging')((s) => {
          expect(s.verdict).toBe('refused')
        }),
      ),
    )

    scenario(
      'The connection to the registry is released when the command is done',
      Gherkin.Do.pipe(
        Given('a registry that was serving documents')('url', () => documentUrl(documentPath)),
        When('the tool finishes reading the document')('observation', (s) => askedFor(s.url)),
        Then('nothing is left listening')((s) => {
          expect(s.observation).toMatchObject({ tag: 'document', status: 200 })
        }),
      ),
    )
  })
