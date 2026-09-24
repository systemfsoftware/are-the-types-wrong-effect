import * as S from 'effect/Schema'

import { CliFormat, CliProfile } from './ProblemUtils.js'

export const CliInputSchema = S.Struct({
  'pack': S.Boolean,
  'from-npm': S.Boolean,
  'definitely-typed': S.String.pipe(S.optionalKey),
  'format': S.Literals(CliFormat),
  'quiet': S.Boolean,
  'entrypoints': S.String.pipe(S.Array, S.optionalKey),
  'include-entrypoints': S.String.pipe(S.Array, S.optionalKey),
  'exclude-entrypoints': S.String.pipe(S.Array, S.optionalKey),
  'include': S.Literals(['entrypoints', 'buildTools', 'programInfo', 'traces']).pipe(S.Array, S.optionalKey),
  'entrypoints-legacy': S.Boolean,
  'ignore-rules': S.String.pipe(S.Array, S.optionalKey),
  'profile': S.Literals(CliProfile),
  'summary': S.Boolean,
  'emoji': S.Boolean,
  'color': S.Boolean,
  'registry': S.String,
})
