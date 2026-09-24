import { it } from '@effect/vitest'
import { Equal, Result } from 'effect'
import * as Match from 'effect/Match'
import { Arbitrary } from 'effect/unstable/arbitrary'
import {
  DiscoverEntrypoints,
  discoverEntrypoints,
  type DiscoverEntrypointsDecision,
  type ObservedDeclaredFile,
  type ObservedPackageJson,
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
        Match.tag('ProxiesDiscovered', ({ proxies }): PlainDecision => ({
          status: 'discovered',
          entrypoints: proxies.map((subpath) => ({ subpath, isWildcard: subpath.includes('*') })),
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

const declared = (fileName: string, isDeclaration: boolean): ObservedDeclaredFile => ({ fileName, isDeclaration })

const packageJsonFile = (
  path: string,
  name: string | null,
  hasMain: boolean,
  ancestors: ReadonlyArray<string>,
  parsed = true,
): ObservedPackageJson => ({ path, name, hasMain, parsed, ancestors: [...ancestors] })

const rootAncestors: ReadonlyArray<string> = [
  '/node_modules/pkg/package.json',
  '/node_modules/pkg',
  '/node_modules',
  '/',
]

const vendorAncestors: ReadonlyArray<string> = [
  '/node_modules/pkg/vendor/package.json',
  '/node_modules/pkg/vendor',
  '/node_modules/pkg',
  '/node_modules',
  '/',
]

const nestedVendorAncestors: ReadonlyArray<string> = [
  '/node_modules/pkg/vendor/nested/package.json',
  '/node_modules/pkg/vendor/nested',
  '/node_modules/pkg/vendor',
  '/node_modules/pkg',
  '/node_modules',
  '/',
]

const command = (overrides: {
  readonly packageName?: string
  readonly manifest?: PackageManifest
  readonly entrypoints?: ReadonlyArray<string> | null
  readonly include?: ReadonlyArray<string>
  readonly exclude?: ReadonlyArray<string>
  readonly legacy?: boolean
  readonly declaredFiles?: ReadonlyArray<ObservedDeclaredFile>
  readonly packageJsonFiles?: ReadonlyArray<ObservedPackageJson>
}): DiscoverEntrypoints =>
  new DiscoverEntrypoints({
    packageName: 'pkg',
    manifest: manifest({ './a': './a.js' }),
    entrypoints: null,
    include: [],
    exclude: [],
    legacy: false,
    declaredFiles: [],
    packageJsonFiles: [],
    ...overrides,
  })

const discovered = (entrypoints: ReadonlyArray<PlainEntrypoint>): PlainDecision => ({
  status: 'discovered',
  entrypoints,
})
const entrypoint = (subpath: string, isWildcard = false): PlainEntrypoint => ({ subpath, isWildcard })

const INTENDED_VERDICTS: ReadonlyArray<readonly [DiscoverEntrypoints, PlainDecision]> = [
  [command({ entrypoints: ['pkg-suffix', 'other'] }), discovered([entrypoint('./pkg-suffix'), entrypoint('./other')])],
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
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      legacy: true,
      declaredFiles: [declared('/node_modules/pkg/index.js', false), declared('/node_modules/pkg/index.d.ts', true)],
    }),
    discovered([entrypoint('./index.js')]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      legacy: true,
      declaredFiles: [
        declared('/node_modules/pkg/src/main.mjs', false),
        declared('/node_modules/pkg/package.json', false),
      ],
    }),
    discovered([entrypoint('./src/main.mjs')]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      legacy: true,
      declaredFiles: [
        declared('/node_modules/pkg/a.jsx', false),
        declared('/node_modules/pkg/b.tsx', false),
        declared('/node_modules/pkg/c.js', false),
        declared('/node_modules/pkg/d.ts', false),
        declared('/node_modules/pkg/e.mjs', false),
        declared('/node_modules/pkg/f.cjs', false),
        declared('/node_modules/pkg/g.mts', false),
      ],
    }),
    discovered([
      entrypoint('./a.jsx'),
      entrypoint('./b.tsx'),
      entrypoint('./c.js'),
      entrypoint('./d.ts'),
      entrypoint('./e.mjs'),
      entrypoint('./f.cjs'),
      entrypoint('./g.mts'),
    ]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      packageJsonFiles: [
        packageJsonFile('/node_modules/pkg/package.json', 'pkg', false, rootAncestors),
        packageJsonFile('/node_modules/pkg/vendor/package.json', '', true, vendorAncestors),
      ],
    }),
    discovered([entrypoint('./vendor')]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      legacy: true,
      declaredFiles: [declared('/node_modules/pkg/index.d.ts', true)],
    }),
    discovered([]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      legacy: false,
      declaredFiles: [declared('/node_modules/pkg/index.js', false)],
    }),
    { status: 'notDeclared' },
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0', main: './index.js' },
      packageJsonFiles: [
        packageJsonFile('/node_modules/pkg/package.json', 'pkg', true, rootAncestors),
        packageJsonFile('/node_modules/pkg/proxy/package.json', 'pkg', true, [
          '/node_modules/pkg/proxy/package.json',
          '/node_modules/pkg/proxy',
          '/node_modules/pkg',
          '/node_modules',
          '/',
        ]),
      ],
    }),
    discovered([entrypoint('.'), entrypoint('./proxy')]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      legacy: true,
      packageJsonFiles: [
        packageJsonFile('/node_modules/pkg/package.json', 'pkg', false, rootAncestors),
        packageJsonFile('/node_modules/pkg/vendor/package.json', 'foreign-dep', true, vendorAncestors),
        packageJsonFile('/node_modules/pkg/vendor/nested/package.json', 'pkg', true, nestedVendorAncestors),
        packageJsonFile('/node_modules/pkg/broken/package.json', null, false, [], false),
      ],
      declaredFiles: [declared('/node_modules/pkg/index.js', false)],
    }),
    discovered([entrypoint('./index.js')]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      packageJsonFiles: [
        packageJsonFile('/node_modules/pkg/package.json', 'pkg', false, rootAncestors),
        packageJsonFile('/node_modules/pkg/zulu/package.json', 'pkg', true, [
          '/node_modules/pkg/zulu/package.json',
          '/node_modules/pkg/zulu',
          '/node_modules/pkg',
          '/node_modules',
          '/',
        ]),
        packageJsonFile('/node_modules/pkg/Alpha/package.json', 'pkg', true, [
          '/node_modules/pkg/Alpha/package.json',
          '/node_modules/pkg/Alpha',
          '/node_modules/pkg',
          '/node_modules',
          '/',
        ]),
      ],
    }),
    discovered([entrypoint('./zulu'), entrypoint('./Alpha')]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      legacy: true,
      declaredFiles: [declared('/node_modules/pkg/index.cts', false)],
    }),
    discovered([]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      packageJsonFiles: [
        packageJsonFile('/node_modules/pkg/package.json', 'pkg', false, rootAncestors),
        packageJsonFile('/node_modules/pkg/vendor/package.json', 'foreign-dep', true, vendorAncestors),
      ],
    }),
    { status: 'notDeclared' },
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      packageJsonFiles: [
        packageJsonFile('/node_modules/pkg/package.json', 'pkg', false, rootAncestors),
        packageJsonFile('/node_modules/pkg/vendor/package.json', 'vendor-pkg', true, vendorAncestors),
      ],
    }),
    { status: 'notDeclared' },
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      packageJsonFiles: [
        packageJsonFile('/node_modules/pkg/package.json', 'pkg', true, rootAncestors),
        packageJsonFile('/node_modules/pkg/vendor/package.json', 'foreign-dep', true, vendorAncestors),
        packageJsonFile('/node_modules/pkg/vendor/nested/package.json', 'pkg', true, nestedVendorAncestors),
      ],
    }),
    discovered([entrypoint('.')]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      packageJsonFiles: [
        packageJsonFile('/node_modules/pkg/package.json', 'pkg', true, rootAncestors),
        packageJsonFile('/node_modules/pkg/broken/package.json', null, true, [], false),
      ],
    }),
    discovered([entrypoint('.')]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      legacy: true,
      declaredFiles: [declared('/node_modules/pkg/index.js', false)],
      packageJsonFiles: [
        packageJsonFile('/node_modules/pkg/package.json', 'pkg', true, rootAncestors),
      ],
    }),
    discovered([entrypoint('.')]),
  ],
  [
    command({
      manifest: { name: 'pkg', version: '1.0.0' },
      packageJsonFiles: [],
    }),
    { status: 'notDeclared' },
  ],
]
const allIntendedVerdicts: Arbitrary.Arbitrary<typeof INTENDED_VERDICTS> = Arbitrary.Constant(INTENDED_VERDICTS)

it.prop(
  '∀command_DiscoverEntrypoints_≡IntendedVerdictTable',
  [allIntendedVerdicts],
  ([rows]) => rows.every(([candidate, intended]) => Equal.equals(observedDecision(candidate), intended)),
)

const legacyExtensions: ReadonlyArray<string> = ['.jsx', '.tsx', '.js', '.ts', '.mjs', '.cjs', '.mts']

const legacyExtensionOf = (fileName: string): string => fileName.slice(fileName.lastIndexOf('.'))

const referenceIsLegacyDeclared = (declared: ObservedDeclaredFile): boolean =>
  !declared.isDeclaration && legacyExtensions.includes(legacyExtensionOf(declared.fileName))

const referenceDeclaredSubpaths = (command: DiscoverEntrypoints): ReadonlyArray<string> =>
  command.declaredFiles
    .filter(referenceIsLegacyDeclared)
    .map((declared) => `.${declared.fileName.slice(`/node_modules/${command.packageName}`.length)}`)

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

const referenceProxies = (command: DiscoverEntrypoints): ReadonlyArray<string> => {
  const root = `/node_modules/${command.packageName}`
  const vendors: Array<string> = []
  const proxies: Array<string> = []
  for (const row of command.packageJsonFiles) {
    if (!row.parsed) {
      continue
    }
    if (typeof row.name === 'string' && row.name !== '' && !row.name.startsWith(command.packageName)) {
      vendors.push(row.path.slice(0, row.path.lastIndexOf('/')))
      continue
    }
    if (row.hasMain && !row.ancestors.some((directory) => vendors.includes(directory))) {
      proxies.push(`.${row.path.slice(root.length, row.path.lastIndexOf('/'))}`)
    }
  }
  return proxies
}

const referenceDecision = (command: DiscoverEntrypoints): PlainDecision => {
  const asEntrypoint = (subpath: string): PlainEntrypoint => ({ subpath, isWildcard: subpath.includes('*') })
  const format = (path: string): PlainEntrypoint => asEntrypoint(referenceFormat(path, command.packageName))
  if (command.entrypoints !== null) {
    return discovered(command.entrypoints.map(format))
  }
  const exports = command.manifest.exports
  if (exports === undefined) {
    const proxies = referenceProxies(command)
    if (proxies.length > 0) {
      return discovered(proxies.map(format))
    }
    if (command.legacy) {
      return discovered(referenceDeclaredSubpaths(command).map(format))
    }
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
  return discovered(included.filter((entrypoint) => !exclusions.includes(entrypoint)).map(asEntrypoint))
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
    legacy: command.legacy,
    declaredFiles: [...command.declaredFiles],
    packageJsonFiles: [...command.packageJsonFiles],
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
    Match.tag('ProxiesDiscovered', () =>
      true),
    Match.tag('EntrypointsNotDeclared', () => true),
    Match.exhaustive,
  )

it.prop(
  '∀command_DiscoverEntrypoints_wildcardIsTheSubpathShape',
  [DiscoverEntrypoints],
  ([candidate]) => decisionDecided(Result.getOrThrow(discoverEntrypoints(candidate))),
)
