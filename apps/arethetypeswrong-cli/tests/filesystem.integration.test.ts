import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { Effect, Layer } from 'effect'
import * as PlatformFs from 'effect/FileSystem'
import { expect } from 'vitest'

import * as NodeFilesystem from '../src/drivers/node-filesystem.js'
import { Filesystem } from '../src/filesystem.service.js'

const Feature = makeFeature({ it, layer })

const TARBALL_BYTES = new Uint8Array([31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 75, 76, 4, 0, 12, 125, 105, 63])

const filesystemLayer: Layer.Layer<Filesystem, never, never> = NodeFilesystem.layer().pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
)

const missingRead = (path: string) => Effect.flatMap(Filesystem, (fs) => Effect.flip(fs.readBytes(path)))

const writeTarball = (path: string) =>
  Effect.flatMap(PlatformFs.FileSystem, (platform) => platform.writeFile(path, TARBALL_BYTES))

Feature('Reading package files from the local disk')
  .withLayer(Layer.provideMerge(filesystemLayer, NodeFileSystem.layer))
  .body(({ scenario }) => {
    scenario(
      'A packed tarball in a scratch folder reads back byte for byte',
      Gherkin.Do.pipe(
        Given('a scratch folder with a packed tarball inside')(
          'directory',
          () =>
            Effect.flatMap(Filesystem, (fs) =>
              Effect.flatMap(fs.makeTempDirectory, (directory) =>
                Effect.as(
                  writeTarball(fs.join(directory.path, 'attw.tgz')),
                  directory,
                ))),
        ),
        When('the tool reads that tarball back')(
          'read',
          (s) => Effect.flatMap(Filesystem, (fs) => fs.readBytes(fs.join(s.directory.path, 'attw.tgz'))),
        ),
        Then('the bytes match what was packed')((s) => {
          expect(Array.from(s.read)).toEqual(Array.from(TARBALL_BYTES))
        }),
      ),
    )

    scenario(
      'The packed tarball is gone from the scratch folder',
      Gherkin.Do.pipe(
        Given('a scratch folder holding a tarball')(
          'directory',
          () => Effect.flatMap(Filesystem, (fs) => fs.makeTempDirectory),
        ),
        When('the tool asks for a tarball that was never packed')(
          'refusal',
          (s) => missingRead(`${s.directory.path}/missing.tgz`),
        ),
        Then('the missing tarball is refused, not invented')((s) => {
          expect(s.refusal._tag).toBe('FilesystemReadRefused')
        }),
      ),
    )

    scenario(
      'The scratch folder disappears when the tool is done with it',
      Gherkin.Do.pipe(
        Given('a scratch folder from a finished command')('path', () =>
          Effect.map(
            Effect.scoped(Effect.flatMap(Filesystem, (fs) => fs.makeTempDirectory)),
            (directory) => directory.path,
          )),
        When('the tool checks that folder afterwards')(
          'gone',
          (s) => Effect.flatMap(Filesystem, (fs) => fs.fileExists(s.path)),
        ),
        Then('the folder is gone')((s) => {
          expect(s.gone).toBe(false)
        }),
      ),
    )
  })
