import { Result } from 'effect'
import { describe, expect, it } from 'vitest'

import { parsePackageSpec as engineParsePackageSpec } from '@systemfsoftware/arethetypeswrong'
import { verdictFor } from '../parse-package-spec.cell.js'
import { parsePackageSpec } from '../parse-package-spec.workflow.js'

const decided = (target: string) => parsePackageSpec(verdictFor(target))

const tagsAgree = (target: string): boolean => {
  const ours = decided(target)
  const theirs = engineParsePackageSpec(target)
  return Result.isSuccess(ours) === Result.isSuccess(theirs)
}

describe('Package spec refusal boundary', () => {
  it('refuses the empty string as an invalid name', () => {
    expect(decided('')).toMatchObject({ _tag: 'Failure' })
  })

  it('refuses a name starting with a period', () => {
    expect(decided('.demo')).toMatchObject({ _tag: 'Failure' })
  })

  it('refuses a scoped target with no scope name', () => {
    expect(decided('@/demo')).toMatchObject({ _tag: 'Failure' })
  })

  it('refuses a scope with no package name', () => {
    expect(decided('@scope')).toMatchObject({ _tag: 'Failure' })
  })

  it('refuses a lone high surrogate as ill-formed Unicode', () => {
    expect(decided(`demo${String.fromCharCode(0xd800)}`)).toMatchObject({ _tag: 'Failure' })
  })

  it('refuses a lone low surrogate as ill-formed Unicode', () => {
    expect(decided(`demo${String.fromCharCode(0xdd00)}`)).toMatchObject({ _tag: 'Failure' })
  })

  it('accepts a well-formed scoped name with a tag', () => {
    expect(decided('@scope/demo@next')).toMatchObject({ _tag: 'Success' })
  })

  it('agrees with the engine parser on every pinned refusal', () => {
    for (const target of ['', '.demo', '_demo', '-demo', 'demo ', '@scope', '@/demo']) {
      expect(tagsAgree(target)).toBe(true)
    }
  })

  it('agrees with the engine parser on every pinned acceptance', () => {
    for (const target of ['demo', 'demo@1.2.3', 'demo@^1.2.3', 'demo@next', '@scope/demo', '@scope/demo@1.2.3']) {
      expect(tagsAgree(target)).toBe(true)
    }
  })

  it('names the malformed-scope refusal separately from the engine', () => {
    const refusalTag = Result.match(decided('@scope'), {
      onFailure: (refusal) => refusal._tag,
      onSuccess: () => 'unexpected-success',
    })
    expect(refusalTag).toBe('MalformedScope')
    expect(Result.isFailure(engineParsePackageSpec('@scope'))).toBe(true)
  })
})
