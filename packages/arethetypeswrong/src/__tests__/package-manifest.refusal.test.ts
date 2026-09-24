import { Schema } from 'effect'
import * as Result from 'effect/Result'
import { describe, expect, it } from 'vitest'

import { PackageManifestJson } from '../PackageManifest.schema.js'

describe('PackageManifestJson refusal boundary', () => {
  it('refuses text that is not JSON', () => {
    expect(Result.isFailure(Schema.decodeResult(PackageManifestJson)('not json at all'))).toBe(true)
  })

  it('refuses a truncated JSON document', () => {
    expect(Result.isFailure(Schema.decodeResult(PackageManifestJson)('{ "name": "demo" '))).toBe(true)
  })

  it('refuses JSON whose root is not an object', () => {
    expect(Result.isFailure(Schema.decodeResult(PackageManifestJson)('42'))).toBe(true)
  })

  it('refuses a manifest whose name is not a string', () => {
    expect(Result.isFailure(Schema.decodeResult(PackageManifestJson)('{ "name": 42 }'))).toBe(true)
  })

  it('refuses a manifest whose exports field is a number', () => {
    expect(Result.isFailure(Schema.decodeResult(PackageManifestJson)('{ "exports": 42 }'))).toBe(true)
  })

  it('refuses a manifest whose exports condition target is a number', () => {
    expect(
      Result.isFailure(Schema.decodeResult(PackageManifestJson)('{ "exports": { ".": { "default": 42 } } }')),
    ).toBe(true)
  })

  it('refuses a manifest whose exports array carries a number', () => {
    expect(
      Result.isFailure(Schema.decodeResult(PackageManifestJson)('{ "exports": { ".": ["./index.js", 42] } }')),
    ).toBe(true)
  })

  it('refuses a manifest whose type is neither module nor commonjs', () => {
    expect(Result.isFailure(Schema.decodeResult(PackageManifestJson)('{ "type": "esnext" }'))).toBe(true)
  })

  it('refuses a manifest whose devDependencies carry a non-string version', () => {
    expect(
      Result.isFailure(Schema.decodeResult(PackageManifestJson)('{ "devDependencies": { "tsdown": 42 } }')),
    ).toBe(true)
  })
})
