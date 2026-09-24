import { Function, Result } from 'effect'
import * as S from 'effect/Schema'

import { CompactJson, PrettyJson } from './RenderJson.schema.js'

const encodeCompactJson = (value: S.Json): string => Result.getOrThrow(S.encodeResult(CompactJson)(value))

const encodePrettyJson = (value: S.Json): string => Result.getOrThrow(S.encodeResult(PrettyJson)(value))

export const renderJson: {
  (options: { readonly pretty: boolean }): (value: S.Json) => string
  (value: S.Json, options: { readonly pretty: boolean }): string
} = Function.dual(2, (value: S.Json, options: { readonly pretty: boolean }): string => {
  if (options.pretty) return encodePrettyJson(value)
  return encodeCompactJson(value)
})
