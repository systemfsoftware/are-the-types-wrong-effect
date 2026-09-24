import { Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { FilesystemReadRefused, FilesystemTempDirectoryRefused } from '../FilesystemError.schema.js'
import { PackRunnerOutputUnreadable, PackRunnerSpawnRefused } from '../PackRunnerError.schema.js'
import { RegistryPayloadOverBudget, RegistryUnreachable } from '../RegistryError.schema.js'
import { RegistryDocumentRead, RegistryStatusRead } from '../RegistryObservation.schema.js'
import { TerminalWriteRefused } from '../TerminalError.schema.js'

const refusedRead = {
  _tag: 'FilesystemReadRefused',
  path: 'packages/attw/manifest.json',
} as const

const refusedScratchFolder = {
  _tag: 'FilesystemTempDirectoryRefused',
} as const

const refusedPack = {
  _tag: 'PackRunnerSpawnRefused',
  directory: 'packages/attw',
} as const

const unreadablePackOutput = {
  _tag: 'PackRunnerOutputUnreadable',
  directory: 'packages/attw',
} as const

const unreachableRegistry = {
  _tag: 'RegistryUnreachable',
  url: 'http://127.0.0.1:9/packages/attw/manifest.json',
} as const

const overBudgetRegistry = {
  _tag: 'RegistryPayloadOverBudget',
  url: 'http://127.0.0.1:4873/packages/attw/manifest.json',
  byteLength: 33_554_433,
  budgetBytes: 33_554_432,
} as const

const readDocument = {
  _tag: 'RegistryDocumentRead',
  status: 200,
  bytes: new Uint8Array([123, 125]),
} as const

const readStatus = {
  _tag: 'RegistryStatusRead',
  status: 404,
} as const

const refusedTerminalWrite = {
  _tag: 'TerminalWriteRefused',
  stream: 'stdout',
} as const

describe('Driver refusal boundary', () => {
  it('refuses a read whose path is absent', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(FilesystemReadRefused)({ _tag: 'FilesystemReadRefused' }),
      ),
    ).toBe(true)
  })

  it('refuses a read tagged with a sibling variant', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(FilesystemReadRefused)({ _tag: 'FilesystemTempDirectoryRefused' }),
      ),
    ).toBe(true)
  })

  it('accepts the read tag the filesystem driver raises', () => {
    expect(Result.isSuccess(Schema.decodeResult(FilesystemReadRefused)(refusedRead))).toBe(true)
  })

  it('accepts the scratch-folder tag the filesystem driver raises', () => {
    expect(
      Result.isSuccess(Schema.decodeResult(FilesystemTempDirectoryRefused)(refusedScratchFolder)),
    ).toBe(true)
  })

  it('keeps the platform failure on the read refusal for support', () => {
    const refused = Schema.decodeResult(FilesystemReadRefused)({
      ...refusedRead,
      cause: 'ENOENT',
    })
    expect(
      Result.match(refused, {
        onFailure: () => false,
        onSuccess: (found) => found.cause === 'ENOENT',
      }),
    ).toBe(true)
  })

  it('accepts the pack tag the pack driver raises', () => {
    expect(Result.isSuccess(Schema.decodeResult(PackRunnerSpawnRefused)(refusedPack))).toBe(true)
  })

  it('refuses a pack payload tagged with the unreadable variant', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(PackRunnerSpawnRefused)({ _tag: 'PackRunnerOutputUnreadable' }),
      ),
    ).toBe(true)
  })

  it('accepts the unreadable-output tag the pack driver raises', () => {
    expect(
      Result.isSuccess(Schema.decodeResult(PackRunnerOutputUnreadable)(unreadablePackOutput)),
    ).toBe(true)
  })

  it('accepts the unreachable tag the registry driver raises', () => {
    expect(Result.isSuccess(Schema.decodeResult(RegistryUnreachable)(unreachableRegistry))).toBe(true)
  })

  it('refuses an unreachable payload tagged with the over-budget variant', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(RegistryUnreachable)({ _tag: 'RegistryPayloadOverBudget' }),
      ),
    ).toBe(true)
  })

  it('accepts the over-budget tag carrying the measured size', () => {
    const refused = Schema.decodeResult(RegistryPayloadOverBudget)(overBudgetRegistry)
    expect(
      Result.match(refused, {
        onFailure: () => false,
        onSuccess: (found) => found.byteLength > found.budgetBytes,
      }),
    ).toBe(true)
  })

  it('accepts the document observation the registry driver returns', () => {
    expect(Result.isSuccess(Schema.decodeResult(RegistryDocumentRead)(readDocument))).toBe(true)
  })

  it('accepts the status observation the registry driver returns', () => {
    expect(Result.isSuccess(Schema.decodeResult(RegistryStatusRead)(readStatus))).toBe(true)
  })

  it('accepts the terminal tag the terminal driver raises', () => {
    expect(Result.isSuccess(Schema.decodeResult(TerminalWriteRefused)(refusedTerminalWrite))).toBe(true)
  })

  it('refuses a terminal payload naming an unknown stream', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(TerminalWriteRefused)({
          _tag: 'TerminalWriteRefused',
          stream: 'serial',
        }),
      ),
    ).toBe(true)
  })
})
