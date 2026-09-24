import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodeHttpClient,
  NodeHttpServer,
  NodePath,
} from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Layer, Match, Predicate } from 'effect'
import * as HttpRouter from 'effect/unstable/http/HttpRouter'
import * as HttpServer from 'effect/unstable/http/HttpServer'
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse'
import { expect } from 'vitest'

import { acquireTarball } from '../src/acquire-tarball.cell.js'
import * as HttpRegistry from '../src/drivers/http-registry.js'
import * as NodeFilesystem from '../src/drivers/node-filesystem.js'
import * as NpmPackRunner from '../src/drivers/npm-pack-runner.js'
import { Registry } from '../src/registry.service.js'

const Feature = makeFeature({ it, layer })

const PACKAGE_NAME = 'attw'
const PACKAGE_VERSION = '1.0.0'
const MISSING_VERSION = '9.9.9'
const TARBALL_BYTES = new Uint8Array([31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 75, 76, 4, 0, 12, 125, 105, 63])

const tarballPath = `/${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`
const manifestPath = `/${PACKAGE_NAME}/${PACKAGE_VERSION}`
const missingPath = `/${PACKAGE_NAME}/${MISSING_VERSION}`

const packumentFor = (registryBase: string) =>
  JSON.stringify({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    dist: { tarball: `${registryBase}${tarballPath}` },
  })

const routes = (registryBase: string) =>
  Layer.mergeAll(
    HttpRouter.add('GET', manifestPath, HttpServerResponse.text(packumentFor(registryBase))),
    HttpRouter.add('GET', missingPath, HttpServerResponse.text('{"status":"unclaimed"}', { status: 404 })),
    HttpRouter.add('GET', tarballPath, HttpServerResponse.uint8Array(TARBALL_BYTES)),
  )

const servedScenario = HttpRouter.serve(routes('http://registry.test'), {
  disableLogger: true,
  disableListenLog: true,
})

const listening = servedScenario.pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.orDie,
)

const registryScenario = HttpRegistry.layer().pipe(
  Layer.provide(NodeHttpClient.layerFetch),
  Layer.provideMerge(listening),
)

const filesystemScenario = NodeFilesystem.layer().pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
)

const platformBase = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const spawnerLayer = NodeChildProcessSpawner.layer.pipe(Layer.provide(platformBase))

const packScenario = NpmPackRunner.layer().pipe(Layer.provide(Layer.mergeAll(platformBase, spawnerLayer)))

const scenarioLayer = Layer.mergeAll(registryScenario, filesystemScenario, packScenario)

const serverBase = () => HttpServer.addressFormattedWith((address) => Effect.succeed(address))

const missingTarball = (base: string) =>
  Effect.match(
    acquireTarball.run({
      target: `${PACKAGE_NAME}@${MISSING_VERSION}`,
      fromNpm: true,
      registry: base.replace('[::]', '[::1]'),
    }),
    {
      onFailure: () => 'answered' as const,
      onSuccess: (answer) =>
        Match.value(answer).pipe(
          Match.when({ _tag: 'RegistryNotFound' }, () => 'missing' as const),
          Match.orElse(() => 'answered' as const),
        ),
    },
  )

const untouchedTarball = (base: string) =>
  Effect.flatMap(
    Registry,
    (registry) =>
      Effect.match(registry.fetchDocument(`${base.replace('[::]', '[::1]')}${tarballPath}`), {
        onFailure: () => 'refused' as const,
        onSuccess: (read) =>
          Predicate.isTagged(read, 'RegistryDocumentRead') && read.bytes.byteLength === TARBALL_BYTES.length
            ? ('served' as const)
            : ('short' as const),
      }),
  )

const refusedSpec = (target: string) =>
  Effect.match(acquireTarball.run({ target, fromNpm: true, registry: 'unreachable' }), {
    onFailure: () => 'answered' as const,
    onSuccess: (answer) =>
      Match.value(answer).pipe(
        Match.when({ _tag: 'InvalidPackageSpec' }, () => 'refused' as const),
        Match.orElse(() => 'answered' as const),
      ),
  })

Feature('Downloading a published package from a registry')
  .withScenarioLayer(scenarioLayer)
  .body(({ scenario }) => {
    scenario(
      'The registry has no such package',
      Gherkin.Do.pipe(
        Given('a registry that answers not found for the requested document')('base', () => serverBase()),
        When('the tool tries to fetch the published tarball')('verdict', (s) => missingTarball(s.base)),
        Then('the missing package surfaces as the registry refusing the name')((s) => {
          expect(s.verdict).toBe('missing')
        }),
      ),
    )

    scenario(
      'The tool can ask for tarball bytes the registry actually serves',
      Gherkin.Do.pipe(
        Given('a registry holding the published tarball')('base', () => serverBase()),
        When('the tool reads those tarball bytes')('verdict', (s) => untouchedTarball(s.base)),
        Then('the whole tarball arrives')((s) => {
          expect(s.verdict).toBe('served')
        }),
      ),
    )

    scenario(
      'A name with a control character never reaches the registry',
      Gherkin.Do.pipe(
        Given('a target carrying an ascii control character')(
          'target',
          () => Effect.succeed(`demo${String.fromCharCode(0x07)}`),
        ),
        When('the tool resolves where that target lives')('verdict', (s) => refusedSpec(s.target)),
        Then('the spec is refused before any network call')((s) => {
          expect(s.verdict).toBe('refused')
        }),
      ),
    )
  })
