import { Schema } from 'effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import { describe, expect, it } from 'vitest'

import { CompilerFailed, LexerUnavailable, ManifestUnreadable } from '../AnalysisError.schema.js'
import { PackageManifestJson } from '../PackageManifest.schema.js'

describe('AnalysisError refusal boundary', () => {
  it('refuses a payload that carries no tag', () => {
    expect(Result.isFailure(Schema.decodeUnknownResult(ManifestUnreadable)({ cause: 'boom' }))).toBe(true)
  })

  it('refuses a payload tagged with a sibling variant', () => {
    expect(Result.isFailure(Schema.decodeUnknownResult(ManifestUnreadable)({ _tag: 'LexerUnavailable' }))).toBe(true)
  })

  it('accepts the manifest-unreadable tag a consumer branches on', () => {
    expect(Result.isSuccess(Schema.decodeResult(ManifestUnreadable)({ _tag: 'ManifestUnreadable' }))).toBe(true)
  })

  it('accepts the compiler-failed tag a consumer branches on', () => {
    expect(Result.isSuccess(Schema.decodeResult(CompilerFailed)({ _tag: 'CompilerFailed' }))).toBe(true)
  })

  it('accepts the lexer-unavailable tag a consumer branches on', () => {
    expect(Result.isSuccess(Schema.decodeResult(LexerUnavailable)({ _tag: 'LexerUnavailable' }))).toBe(true)
  })

  it('carries the manifest parse failure as an untouched cause', () => {
    const parseFailure = Result.getOrUndefined(
      Schema.decodeResult(PackageManifestJson)('{ "name": ').pipe(Result.flip),
    )
    expect(parseFailure).toBeDefined()
    const decodedCause = Option.map(
      Schema.decodeOption(ManifestUnreadable)({ _tag: 'ManifestUnreadable', cause: parseFailure }),
      (unreadable) => unreadable.cause,
    )
    expect(Option.getOrUndefined(decodedCause)).toBe(parseFailure)
  })
})
