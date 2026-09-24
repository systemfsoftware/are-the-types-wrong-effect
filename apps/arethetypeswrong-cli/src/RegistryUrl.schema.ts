import { Array, Match } from 'effect'
import * as S from 'effect/Schema'

const strippedCodeUnits: ReadonlyArray<string> = [
  ...Array.map(Array.makeBy(0x21, (code) => code), (code) => String.fromCharCode(code)),
  String.fromCharCode(0x7f),
]

const escapeForClass = (unit: string): string =>
  Match.value(unit.charCodeAt(0) >= 0x20).pipe(
    Match.when(true, () => unit),
    Match.orElse(() => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`),
  )

const strippedInner = strippedCodeUnits.map((unit) => escapeForClass(unit)).join('')

const authoritySource = `[^\\/${strippedInner}@?#]+`

const pathSource = `(?:\\/[^${strippedInner}?#]*)?`

const localHostSource =
  '(?:localhost|\\[::1\\]|::1|127(?:\\.\\d{1,3}){3}|10(?:\\.\\d{1,3}){3}|192\\.168(?:\\.\\d{1,3}){2}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d{1,3}){2})'

const registryUrlSource =
  `^(?:https:\\/\\/${authoritySource}(?::\\d+)?${pathSource}|http:\\/\\/${localHostSource}(?::\\d+)?${pathSource})$`

export const RegistryUrlSchema = S.String.pipe(
  S.check(
    S.isPattern(new RegExp(registryUrlSource), {
      expected: 'an http(s) registry URL with no credentials, query, fragment, or stripped characters',
    }),
  ),
)
