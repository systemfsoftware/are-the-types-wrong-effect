import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Layer, Match } from 'effect'
import * as PlatformFs from 'effect/FileSystem'
import { expect } from 'vitest'

import { DirectoryPacked } from '../src/classify-pack-outcome.workflow.js'
import * as NodeFilesystem from '../src/drivers/node-filesystem.js'
import { readTarballFile } from '../src/read-tarball-file.cell.js'

const Feature = makeFeature({ it, layer })

const TARBALL_BYTES = new Uint8Array([31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 75, 76, 4, 0, 12, 125, 105, 63])

const filesystemScenario = Layer.mergeAll(
  NodeFilesystem.layer().pipe(
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
  ),
  NodeFileSystem.layer,
)

const packedIn = (tarballPath: string) =>
  new DirectoryPacked({ directory: 'packages/attw', tarballName: 'attw.tgz', tarballPath })

const missingTarballPath = '/attw-nonexistent/attw.tgz'

Feature('Reading a packed tarball from the workspace')
  .withLayer(filesystemScenario)
  .body(({ scenario }) => {
    scenario(
      'A packed tarball is read whole and its scratch copy is removed',
      Gherkin.Do.pipe(
        Given('a workspace holding the packed tarball')(
          'packed',
          () =>
            Effect.flatMap(PlatformFs.FileSystem, (platform) =>
              Effect.flatMap(
                platform.makeTempDirectoryScoped({ prefix: 'attw-read' }),
                (workspace) => {
                  const tarballPath = `${workspace}/attw.tgz`
                  return Effect.as(
                    platform.writeFile(tarballPath, TARBALL_BYTES),
                    packedIn(tarballPath),
                  )
                },
              )),
        ),
        When('the tool reads the packed tarball back')('answer', (s) => readTarballFile.run(s.packed)),
        Then('the bytes arrive and the scratch tarball is gone')((s) => {
          const cleaned = Match.value(s.answer).pipe(
            Match.tag('PackCleaned', (found) => found),
            Match.tag('PackFailed', () => undefined),
            Match.exhaustive,
          )
          expect(cleaned).toBeDefined()
          expect(Array.from(cleaned?.bytes ?? [])).toEqual(Array.from(TARBALL_BYTES))
          expect(cleaned?.ref.packageName).toBe('packages/attw')
        }),
      ),
    )

    scenario(
      'The packed tarball vanished from the workspace',
      Gherkin.Do.pipe(
        Given('a workspace whose tarball was never written')(
          'packed',
          () => Effect.succeed(packedIn(missingTarballPath)),
        ),
        When('the tool tries to read the packed tarball')('answer', (s) => readTarballFile.run(s.packed)),
        Then('the missing tarball is reported as a failed pack')((s) => {
          const failed = Match.value(s.answer).pipe(
            Match.tag('PackCleaned', () => false),
            Match.tag('PackFailed', () => true),
            Match.exhaustive,
          )
          expect(failed).toBe(true)
        }),
      ),
    )
  })
