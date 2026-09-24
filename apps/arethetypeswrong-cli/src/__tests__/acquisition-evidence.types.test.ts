import { describe, expectTypeOf, it } from 'vitest'

import type * as S from 'effect/Schema'
import type { AcquiredTarballSource } from '../acquire-tarball.cell.js'
import { ManifestResolved, PackCleaned } from '../Acquisition.schema.js'
import { DirectoryPacked } from '../classify-pack-outcome.workflow.js'
import { fetchRegistryTarball } from '../fetch-registry-tarball.cell.js'
import { readTarballFile } from '../read-tarball-file.cell.js'
import { RegistryDocument } from '../Registry.schema.js'

const manifest: S.Schema.Type<typeof RegistryDocument> = {
  name: 'attw',
  version: '1.0.0',
  dist: { tarball: 'https://registry.test/attw-1.0.0.tgz' },
}

const resolved = new ManifestResolved({ registryBase: 'https://registry.test', manifest })

const packed = new DirectoryPacked({
  directory: 'packages/attw',
  tarballName: 'attw.tgz',
  tarballPath: '/tmp/attw.tgz',
})

const cleaned = new PackCleaned({
  ref: { packageName: 'packages/attw', packageVersion: 'local', tarballUrl: 'file:///tmp/attw.tgz' },
  bytes: new Uint8Array([1]),
})

const analysisBytes = (evidence: AcquiredTarballSource) => evidence.bytes

describe('Acquisition evidence chain', () => {
  it('read-tarball-file demands packed evidence', () => {
    expectTypeOf(readTarballFile.run).parameters.toExtend<[DirectoryPacked]>()
    expectTypeOf(readTarballFile.run(packed)).exclude<never>()
    expectTypeOf<Parameters<typeof readTarballFile.run>[0]>().toEqualTypeOf<DirectoryPacked>()
  })

  it('fetch-registry-tarball demands manifest evidence', () => {
    expectTypeOf(fetchRegistryTarball.run(resolved)).exclude<never>()
    expectTypeOf<Parameters<typeof fetchRegistryTarball.run>[0]>().toEqualTypeOf<ManifestResolved>()
    expectTypeOf(manifest).not.toExtend<Parameters<typeof fetchRegistryTarball.run>[0]>()
  })

  it('analysis accepts only acquired tarball evidence', () => {
    expectTypeOf(analysisBytes(cleaned)).toEqualTypeOf<Uint8Array>()
    expectTypeOf<AcquiredTarballSource>().toExtend<{ readonly bytes: Uint8Array }>()
    expectTypeOf<DirectoryPacked>().not.toExtend<AcquiredTarballSource>()
    expectTypeOf<string>().not.toExtend<AcquiredTarballSource>()
  })
})
