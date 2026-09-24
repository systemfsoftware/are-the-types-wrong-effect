import { Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { decodeRegistryUrl } from '../RegistryUrl.js'
import { RegistryUrlSchema } from '../RegistryUrl.schema.js'

const accepts = (raw: string): boolean => {
  const decoded = Result.isSuccess(decodeRegistryUrl(raw))
  const schemaAccepted = Result.isSuccess(Schema.decodeResult(RegistryUrlSchema)(raw))
  expect(decoded).toBe(true)
  expect(schemaAccepted).toBe(true)
  return decoded && schemaAccepted
}

const refuses = (raw: string): boolean => {
  const decoded = Result.isFailure(decodeRegistryUrl(raw))
  const schemaRefused = Result.isFailure(Schema.decodeResult(RegistryUrlSchema)(raw))
  expect(decoded).toBe(true)
  expect(schemaRefused).toBe(true)
  return decoded && schemaRefused
}

const accepted = [
  'https://registry.npmjs.org',
  'https://registry.npmjs.org/',
  'https://registry.example.com:8443',
  'http://localhost:4873',
  'http://127.0.0.1:4873',
  'http://127.0.0.53:4873',
  'http://[::1]:4873',
  'http://10.1.2.3:4873',
  'http://192.168.1.10:4873',
  'http://172.16.0.1:4873',
] as const

const credentialed = [
  'http://user:pass@localhost:4873',
  'https://user@registry.npmjs.org',
  'https://:pass@registry.npmjs.org',
] as const

const nonHttp = ['ftp://localhost:4873', 'file:///registry', 'ws://localhost:4873', 'gopher://localhost:4873'] as const

const stripped = [
  `http://127.0.0.1:4873/${String.fromCharCode(0x0a)}`,
  `http://127.0.0.1:4873/${String.fromCharCode(0x20)}`,
  ' https://registry.npmjs.org',
  `https://registry.npmjs.org${String.fromCharCode(0x7f)}`,
] as const

const remotePlaintext = ['http://registry.npmjs.org', 'http://93.184.216.34:4873'] as const

const namesRefusal = (raw: string, fragment: string): boolean => {
  const refusal = Result.getOrThrow(
    Result.match(decodeRegistryUrl(raw), {
      onFailure: (found) => Result.succeed(found),
      onSuccess: () => Result.fail(new Error('expected a refusal')),
    }),
  )
  expect(refusal.message).toContain(fragment)
  return refusal.message.includes(fragment)
}

describe('Registry URL refusal boundary', () => {
  it('decodes every loopback and https URL the tool assumes', () => {
    for (const raw of accepted) expect(accepts(raw)).toBe(true)
  })

  it('refuses credentialed URLs', () => {
    for (const raw of credentialed) expect(refuses(raw)).toBe(true)
  })

  it('refuses non-http schemes', () => {
    for (const raw of nonHttp) expect(refuses(raw)).toBe(true)
  })

  it('refuses stripped whitespace and control characters', () => {
    for (const raw of stripped) expect(refuses(raw)).toBe(true)
  })

  it('refuses remote plaintext http', () => {
    for (const raw of remotePlaintext) expect(refuses(raw)).toBe(true)
  })

  it('names the credentials refusal for a credentialed URL', () => {
    expect(namesRefusal('https://user@registry.npmjs.org', 'credentials')).toBe(true)
  })

  it('names the scheme refusal for a non-http URL', () => {
    expect(namesRefusal('ftp://localhost:4873', 'http')).toBe(true)
  })

  it('names the stripped-character refusal for a newline-bearing URL', () => {
    expect(namesRefusal(`http://127.0.0.1:4873/${String.fromCharCode(0x0a)}`, 'whitespace')).toBe(true)
  })
})
