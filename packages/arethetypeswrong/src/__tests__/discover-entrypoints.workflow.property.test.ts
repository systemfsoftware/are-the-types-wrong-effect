import { it } from '@effect/vitest'
import { Equal, Result } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Arbitrary } from 'effect/unstable/arbitrary'

import {
  DiscoverEntrypoints,
  discoverEntrypoints,
  type DiscoverEntrypointsDecision,
} from '../discover-entrypoints.workflow.js'
import type { ManifestExportsConditions, ManifestExportsTarget, PackageManifest } from '../PackageManifest.schema.js'

interface PlainEntrypoint {
  readonly subpath: string
  readonly isWildcard: boolean
}

type PlainDecision =
  | { readonly status: 'discovered'; readonly entrypoints: ReadonlyArray<PlainEntrypoint> }
  | { readonly status: 'notDeclared' }

const observedDecision = (command: DiscoverEntrypoints): PlainDecision =>
  Result.match(discoverEntrypoints(command), {
    onFailure: (): PlainDecision => ({ status: 'discovered', entrypoints: [] }),
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('EntrypointsDiscovered', ({ entrypoints }): PlainDecision => ({
          status: 'discovered',
          entrypoints: entrypoints.map(({ subpath, isWildcard }) => ({ subpath, isWildcard })),
        })),
        Match.tag('EntrypointsNotDeclared', (): PlainDecision => ({ status: 'notDeclared' })),
        Match.exhaustive,
      ),
  })

const manifest = (exports?: ManifestExportsTarget): PackageManifest => ({
  name: 'pkg',
  version: '1.0.0',
  exports,
})

const command = (overrides: {
  readonly packageName?: string
  readonly manifest?: PackageManifest
  readonly entrypoints?: ReadonlyArray<string> | null
  readonly include?: ReadonlyArray<string>
  readonly exclude?: ReadonlyArray<string>
}): DiscoverEntrypoints =>
  new DiscoverEntrypoints({
    packageName: 'pkg',
    manifest: manifest({ './a': './a.js' }),
    entrypoints: null,
    include: [],
    exclude: [],
    ...overrides,
  })

const discovered = (entrypoints: ReadonlyArray<PlainEntrypoint>): PlainDecision => ({
  status: 'discovered',
  entrypoints,
})
const entrypoint = (subpath: string, isWildcard = false): PlainEntrypoint => ({ subpath, isWildcard })

const INTENDED_VERDICTS: ReadonlyArray<readonly [DiscoverEntrypoints, PlainDecision]> = [
  [command({ entrypoints: ['.'] }), discovered([entrypoint('.')])],
  [
    command({ entrypoints: ['one', 'pkg/two', 'pkg'] }),
    discovered([
      entrypoint('./one'),
      entrypoint('./two'),
      entrypoint('.'),
    ]),
  ],
  [command({ manifest: manifest({ './a': './a.js', './b': null }) }), discovered([entrypoint('./a')])],
  [
    command({ manifest: manifest({ './features/*': './src/*.js' }) }),
    discovered([
      entrypoint('./features/*', true),
    ]),
  ],
  [command({ manifest: manifest({ import: './a.js' }) }), discovered([entrypoint('.')])],
  [command({ manifest: manifest({}) }), discovered([])],
  [
    command({ manifest: manifest({ './a': './a.js', b: './b.js' }) }),
    discovered([
      entrypoint('./a'),
      entrypoint('b'),
    ]),
  ],
  [command({ manifest: manifest(['./a.js']) }), discovered([entrypoint('.')])],
  [command({ manifest: manifest(null) }), discovered([])],
  [
    command({ manifest: manifest({ './a': './a.js' }), include: ['b', './a'] }),
    discovered([
      entrypoint('./a'),
      entrypoint('./b'),
    ]),
  ],
  [
    command({
      manifest: manifest({ './a': './a.js', './b': './b.js' }),
      exclude: ['b'],
    }),
    discovered([entrypoint('./a')]),
  ],
  [
    command({
      packageName: 'other',
      entrypoints: ['other/one'],
    }),
    discovered([entrypoint('./one')]),
  ],
  [command({ manifest: {} }), { status: 'notDeclared' }],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0', main: './index.js' },
    }),
    { status: 'notDeclared' },
  ],
]

const intendedRowArbitrary: Arbitrary.Arbitrary<(typeof INTENDED_VERDICTS)[number]> = Arbitrary.flatMap(
  Arbitrary.schema(S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: INTENDED_VERDICTS.length - 1 })))),
  (index) => Arbitrary.Constant(INTENDED_VERDICTS[index]),
)

it.prop('∀command_DiscoverEntrypoints_≡IntendedVerdictTable', [intendedRowArbitrary], ([row]) => {
  const [candidate, intended] = row
  return Equal.equals(observedDecision(candidate), intended)
})

const isConditionsTarget = (target: ManifestExportsTarget): target is ManifestExportsConditions =>
  typeof target === 'object' && target !== null && !Array.isArray(target)

const referenceSubpaths = (target: ManifestExportsTarget): readonly string[] => {
  if (Array.isArray(target)) {
    return target.flatMap(referenceSubpaths)
  }
  if (!isConditionsTarget(target)) {
    return []
  }
  const keys = Object.keys(target)
  if (keys[0]?.startsWith('.')) {
    return keys.filter((key) => referenceHasTarget(target[key]))
  }
  return keys.flatMap((key) => referenceSubpaths(target[key]))
}

const referenceHasTarget = (target: ManifestExportsTarget): boolean => {
  if (Array.isArray(target)) {
    return target.some(referenceHasTarget)
  }
  if (!isConditionsTarget(target)) {
    return target !== null
  }
  return Object.keys(target).some((key) => referenceHasTarget(target[key]))
}

const referenceFormat = (path: string, packageName: string): string => {
  const formatted = path === '.' || path.startsWith('./')
    ? path
    : path === packageName
    ? '.'
    : path.startsWith(`${packageName}/`)
    ? `.${path.slice(packageName.length)}`
    : `./${path}`
  return formatted.trim()
}

const referenceDecision = (command: DiscoverEntrypoints): PlainDecision => {
  const format = (path: string): PlainEntrypoint => {
    const subpath = referenceFormat(path, command.packageName)
    return { subpath, isWildcard: subpath.includes('*') }
  }
  if (command.entrypoints !== null) {
    return discovered(command.entrypoints.map(format))
  }
  const exports = command.manifest.exports
  if (exports === undefined) {
    return { status: 'notDeclared' }
  }
  const subpaths = referenceSubpaths(exports)
  const detected = subpaths.length === 0 && referenceHasTarget(exports) ? ['.'] : subpaths
  const exclusions = command.exclude.map((path) => referenceFormat(path, command.packageName))
  const gathered = [
    ...detected,
    ...command.include.map((path) => referenceFormat(path, command.packageName)),
  ]
  const included = gathered.filter((name, index) => gathered.indexOf(name) === index)
  return discovered(included.filter((entrypoint) => !exclusions.includes(entrypoint)).map(format))
}

it.prop(
  '∀command_DiscoverEntrypoints_≡Reference',
  [DiscoverEntrypoints],
  ([candidate]) => Equal.equals(observedDecision(candidate), referenceDecision(candidate)),
)

const withIgnoredManifestFields = (command: DiscoverEntrypoints): DiscoverEntrypoints =>
  new DiscoverEntrypoints({
    packageName: command.packageName,
    manifest: {
      ...command.manifest,
      version: '9.9.9',
      type: 'module',
      main: './elsewhere.js',
      homepage: 'https://example.com',
      devDependencies: { typescript: '5.0.0' },
    },
    entrypoints: command.entrypoints === null ? null : [...command.entrypoints],
    include: [...command.include],
    exclude: [...command.exclude],
  })

it.prop(
  '∀command_DiscoverEntrypoints_ignoresUnreadManifestFields',
  [DiscoverEntrypoints],
  ([candidate]) => Equal.equals(observedDecision(candidate), observedDecision(withIgnoredManifestFields(candidate))),
)

const decisionDecided = (decision: DiscoverEntrypointsDecision): boolean =>
  Match.value(decision).pipe(
    Match.tag('EntrypointsDiscovered', ({ entrypoints }) =>
      entrypoints.every(({ subpath, isWildcard }) => isWildcard === subpath.includes('*'))),
    Match.tag('EntrypointsNotDeclared', () =>
      true),
    Match.exhaustive,
  )

it.prop(
  '∀command_DiscoverEntrypoints_wildcardIsTheSubpathShape',
  [DiscoverEntrypoints],
  ([candidate]) => decisionDecided(Result.getOrThrow(discoverEntrypoints(candidate))),
)
