import * as S from 'effect/Schema'

export const CompactJson = S.fromJsonString(S.Json)

export const PrettyJson = S.fromJsonString(S.Json, { space: 2 })
