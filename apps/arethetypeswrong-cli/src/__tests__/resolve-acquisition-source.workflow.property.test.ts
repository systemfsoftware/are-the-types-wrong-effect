import { it } from '@effect/vitest'
import { Match, Option, Predicate, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { type ParsedPackageSpec, ParsedPackageSpecSchema } from '../PackageSpec.schema.js'
import {
  buildManifestUrl,
  decodePayloadSize,
  decodeRegistryUrl,
  type PayloadKind,
  payloadLimit,
} from '../RegistryUrl.js'
import {
  type AcquisitionSourceDecision,
  type InvalidPackageSpec,
  resolveAcquisitionSource,
  ResolveAcquisitionSourceCommand,
  type TargetNotPackable,
} from '../resolve-acquisition-source.workflow.js'

const registryBase = 'https://registry.npmjs.org'
const defaultTag = 'latest'

type Disposition = 'registryPackage' | 'existingTarball' | 'packDirectory' | 'targetNotPackable' | 'invalidSpec'

interface SpecRow {
  readonly target: string
  readonly fromNpm: boolean
  readonly pack?: boolean
  readonly expected: Disposition
  readonly name?: string
  readonly version?: string
}

const longName = (length: number): string => 'a'.repeat(length)

const specDispositionTable: readonly SpecRow[] = [
  { target: 'demo', fromNpm: true, expected: 'registryPackage', name: 'demo' },
  { target: 'demo', fromNpm: false, expected: 'registryPackage', name: 'demo' },
  { target: 'demo@1.2.3', fromNpm: true, expected: 'registryPackage', name: 'demo', version: '1.2.3' },
  { target: 'demo@^1.2.3', fromNpm: true, expected: 'registryPackage', name: 'demo', version: '^1.2.3' },
  { target: 'demo@next', fromNpm: true, expected: 'registryPackage', name: 'demo', version: 'next' },
  { target: '@scope/demo', fromNpm: true, expected: 'registryPackage', name: '@scope/demo' },
  {
    target: '@scope/demo@1.2.3',
    fromNpm: true,
    expected: 'registryPackage',
    name: '@scope/demo',
    version: '1.2.3',
  },
  { target: 'demo.tgz', fromNpm: false, expected: 'existingTarball' },
  { target: 'demo.tgz', fromNpm: false, expected: 'existingTarball' },
  { target: 'demo.tgz', fromNpm: true, expected: 'existingTarball' },
  { target: './demo', fromNpm: false, pack: true, expected: 'packDirectory' },
  { target: './demo', fromNpm: true, pack: true, expected: 'packDirectory' },
  { target: 'demo', fromNpm: true, pack: true, expected: 'packDirectory' },
  { target: 'demo.tgz', fromNpm: false, pack: true, expected: 'packDirectory' },
  { target: 'demo?fields=name', fromNpm: true, pack: true, expected: 'packDirectory' },
  { target: '.', fromNpm: false, pack: true, expected: 'packDirectory' },
  { target: './demo', fromNpm: false, expected: 'targetNotPackable' },
  { target: '../demo', fromNpm: false, expected: 'targetNotPackable' },
  { target: '/abs/demo', fromNpm: false, expected: 'targetNotPackable' },
  { target: '.', fromNpm: false, expected: 'targetNotPackable' },
  { target: './demo', fromNpm: true, expected: 'invalidSpec' },
  { target: 'demo?fields=name', fromNpm: true, expected: 'invalidSpec' },
  { target: 'demo#fragment', fromNpm: true, expected: 'invalidSpec' },
  { target: 'demo%20name', fromNpm: true, expected: 'invalidSpec' },
  { target: `demo${String.fromCharCode(7)}`, fromNpm: true, expected: 'invalidSpec' },
  { target: `demo${String.fromCharCode(0x7f)}`, fromNpm: true, expected: 'invalidSpec' },
  { target: 'demo@next!', fromNpm: true, expected: 'invalidSpec' },
  { target: longName(213), fromNpm: true, expected: 'registryPackage', name: longName(213) },
  { target: longName(214), fromNpm: true, expected: 'registryPackage', name: longName(214) },
  { target: longName(215), fromNpm: true, expected: 'invalidSpec' },
]

const parsedSpecTable: Readonly<Record<string, ParsedPackageSpec>> = {
  demo: { name: 'demo', version: '', versionKind: 'none' },
  'demo@1.2.3': { name: 'demo', version: '1.2.3', versionKind: 'exact' },
  'demo@^1.2.3': { name: 'demo', version: '^1.2.3', versionKind: 'range' },
  'demo@next': { name: 'demo', version: 'next', versionKind: 'tag' },
  '@scope/demo': { name: '@scope/demo', version: '', versionKind: 'none' },
  '@scope/demo@1.2.3': { name: '@scope/demo', version: '1.2.3', versionKind: 'exact' },
  [longName(213)]: { name: longName(213), version: '', versionKind: 'none' },
  [longName(214)]: { name: longName(214), version: '', versionKind: 'none' },
}

const parsedSpecOf = (target: string): Option.Option<ParsedPackageSpec> =>
  Object.hasOwn(parsedSpecTable, target) ? Option.some(parsedSpecTable[target]) : Option.none()

const decisionOf = (target: string, fromNpm: boolean, pack?: boolean) =>
  resolveAcquisitionSource(
    new ResolveAcquisitionSourceCommand({ target, fromNpm, pack, parsed: parsedSpecOf(target) }),
  )

const holdsSpecRow = (row: SpecRow): boolean =>
  Result.match(decisionOf(row.target, row.fromNpm, row.pack), {
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('ExistingTarball', () => row.expected === 'existingTarball'),
        Match.tag('PackDirectory', () => row.expected === 'packDirectory'),
        Match.tag('RegistryPackage', ({ spec }) =>
          row.expected === 'registryPackage' &&
          (row.name === undefined || spec.name === row.name) &&
          (row.version === undefined || spec.version === row.version)),
        Match.exhaustive,
      ),
    onFailure: (refusal) =>
      Match.value(row.expected).pipe(
        Match.when(
          'invalidSpec',
          () => Predicate.isTagged(refusal, 'InvalidPackageSpec') && refusal.recovery.length > 0,
        ),
        Match.when(
          'targetNotPackable',
          () => Predicate.isTagged(refusal, 'TargetNotPackable') && refusal.recovery.includes('pack'),
        ),
        Match.orElse(() => false),
      ),
  })

const oneOf = <A>(values: readonly A[]): Arbitrary.Arbitrary<A> =>
  Arbitrary.flatMap(
    Arbitrary.schema(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: values.length - 1 })))),
    (index) => Arbitrary.Constant(values[index]),
  )

const oneArbitrary = <A>(branches: ReadonlyArray<Arbitrary.Arbitrary<A>>): Arbitrary.Arbitrary<A> =>
  oneOf(branches).pipe(Arbitrary.flatMap((branch) => branch))

const targetText = Arbitrary.schema(Schema.String)

const commandPackForced = Arbitrary.map(targetText, (target) =>
  new ResolveAcquisitionSourceCommand({
    target,
    fromNpm: true,
    pack: true,
    parsed: Option.none<ParsedPackageSpec>(),
  }))

const commandWithoutPack = Arbitrary.map(
  Arbitrary.all({ target: targetText, fromNpm: Arbitrary.schema(Schema.Boolean) }),
  ({ target, fromNpm }) => new ResolveAcquisitionSourceCommand({ target, fromNpm, parsed: parsedSpecOf(target) }),
)

const packDirectoryOf = (command: ResolveAcquisitionSourceCommand): boolean =>
  Result.match(resolveAcquisitionSource(command), {
    onSuccess: (decision) =>
      Match.value(decision).pipe(
        Match.tag('PackDirectory', () => true),
        Match.orElse(() => false),
      ),
    onFailure: () => false,
  })

it.prop('∀command_PackPresent_∃PackDirectory', [commandPackForced], ([command]) => packDirectoryOf(command))

it.prop('∀command_PackAbsent_⊥PackDirectory', [commandWithoutPack], ([command]) => !packDirectoryOf(command))

const intBetween = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum, maximum }))))

const textMatching = (pattern: RegExp): Arbitrary.Arbitrary<string> =>
  Arbitrary.schema(Schema.String.pipe(Schema.check(Schema.isPattern(pattern))))

const nameHead = textMatching(/^[a-z]$/)
const nameTail = textMatching(/^[a-z0-9._-]$/)

const bareName: Arbitrary.Arbitrary<string> = Arbitrary.map(
  Arbitrary.all([nameHead, Arbitrary.array(nameTail, { maxLength: 24 })]),
  ([head, tail]) => head + tail.join(''),
)

const overlengthName: Arbitrary.Arbitrary<string> = Arbitrary.map(
  Arbitrary.all([nameHead, Arbitrary.array(nameTail, { minLength: 214, maxLength: 299 })]),
  ([head, tail]) => `${head}${tail.join('')}`,
)

const weldedWithPrefix: Arbitrary.Arbitrary<string> = Arbitrary.map(
  Arbitrary.all([
    Arbitrary.array(nameTail, { maxLength: 10 }),
    oneOf(['?fields=name', '#fragment', '?a=1&b=2']),
  ]),
  ([prefix, welded]) => `p${prefix.join('')}kg${welded}`,
)

const weldedSpec: Arbitrary.Arbitrary<string> = oneArbitrary([
  oneOf(['demo?fields=name', 'demo#fragment', 'demo?a=1&b=2']),
  weldedWithPrefix,
])

const acceptedSpecRecovery = (fix: string): string =>
  `${fix} Expected \`pkg\`, \`pkg@1.2.3\`, \`pkg@^1.2.3\`, \`pkg@next\`, or \`@scope/pkg\`.`

interface AuthoredRefusal {
  readonly tag: 'InvalidPackageSpec' | 'TargetNotPackable'
  readonly message: string
  readonly recovery: string
}

const controlCharacterRefusal: AuthoredRefusal = {
  tag: 'InvalidPackageSpec',
  message: 'The package spec contains an ASCII control character.',
  recovery: acceptedSpecRecovery('Remove it and rerun the same command.'),
}

const urlMarkerRefusal: AuthoredRefusal = {
  tag: 'InvalidPackageSpec',
  message: 'The package spec contains a URL query or fragment marker.',
  recovery: acceptedSpecRecovery('Drop the URL syntax and rerun the same command.'),
}

const percentEncodingRefusal: AuthoredRefusal = {
  tag: 'InvalidPackageSpec',
  message: 'The package spec contains percent-encoding.',
  recovery: acceptedSpecRecovery('Write the name literally and rerun the same command.'),
}

const overlengthRefusal: AuthoredRefusal = {
  tag: 'InvalidPackageSpec',
  message: 'The package spec is longer than 214 characters.',
  recovery: acceptedSpecRecovery('Shorten it and rerun the same command.'),
}

const versionShapeRefusal: AuthoredRefusal = {
  tag: 'InvalidPackageSpec',
  message: 'The version in the package spec is neither an exact version, a range, nor a dist-tag.',
  recovery: acceptedSpecRecovery('Pass an exact version, a range, or a published tag, and rerun the same command.'),
}

const unparseableRefusal: AuthoredRefusal = {
  tag: 'InvalidPackageSpec',
  message: 'The package spec is not a package name npm accepts.',
  recovery: acceptedSpecRecovery('Correct the package spec and rerun the same command.'),
}

const notPackableRefusal: AuthoredRefusal = {
  tag: 'TargetNotPackable',
  message: 'The target is not a package tarball this tool can read.',
  recovery:
    'Pass --pack with a directory, an existing .tgz path, or a package name with --from-npm, then rerun the same command.',
}

const holdsAuthoredRefusal = (
  outcome: Result.Result<AcquisitionSourceDecision, InvalidPackageSpec | TargetNotPackable>,
  expected: AuthoredRefusal,
): boolean =>
  Result.match(outcome, {
    onSuccess: () => false,
    onFailure: (refusal) =>
      Predicate.isTagged(refusal, expected.tag) &&
      refusal.message === expected.message &&
      refusal.recovery === expected.recovery,
  })

const tagVersionCommand = (version: string): ResolveAcquisitionSourceCommand =>
  new ResolveAcquisitionSourceCommand({
    target: `demo@${version}`,
    fromNpm: true,
    parsed: Option.some<ParsedPackageSpec>({ name: 'demo', version, versionKind: 'tag' }),
  })

const nameTailRun = (minLength: number, maxLength: number): Arbitrary.Arbitrary<string> =>
  Arbitrary.map(Arbitrary.array(nameTail, { minLength, maxLength }), (tail) => tail.join(''))

const controlCharacterTarget: Arbitrary.Arbitrary<string> = Arbitrary.map(
  Arbitrary.all([bareName, oneArbitrary([intBetween(0x00, 0x1f), Arbitrary.Constant(0x7f)])]),
  ([name, code]) => `${name}${String.fromCharCode(code)}`,
)

const urlMarkerTarget: Arbitrary.Arbitrary<string> = Arbitrary.map(
  Arbitrary.all([bareName, oneOf(['?', '#']), nameTailRun(0, 8)]),
  ([name, marker, tail]) => `${name}${marker}${tail}`,
)

const percentEncodingTarget: Arbitrary.Arbitrary<string> = Arbitrary.map(
  Arbitrary.all([bareName, nameTailRun(0, 8)]),
  ([name, tail]) => `${name}%${tail}`,
)

const nonDistTagVersion: Arbitrary.Arbitrary<string> = oneArbitrary([
  Arbitrary.map(
    Arbitrary.all([oneOf(['!', '-', '_', '.', '+']), nameTailRun(1, 8)]),
    ([lead, tail]) => `${lead}${tail}`,
  ),
  Arbitrary.map(Arbitrary.all([nameHead, oneOf(['!', '+', '~', ' '])]), ([head, trail]) => `${head}${trail}`),
])

const unknownBareName: Arbitrary.Arbitrary<string> = Arbitrary.map(nameTailRun(0, 24), (tail) => `z${tail}`)

const notPackableTarget: Arbitrary.Arbitrary<string> = oneArbitrary([
  Arbitrary.map(nameTailRun(0, 10), (middle) => `./${middle}x`),
  Arbitrary.map(Arbitrary.all([nameHead, nameTailRun(1, 8)]), ([head, tail]) => `${head}${tail}/x`),
  Arbitrary.map(nameTailRun(0, 10), (middle) => `.tar.gz-${middle}x`),
])

const tarballTarget: Arbitrary.Arbitrary<string> = Arbitrary.map(
  Arbitrary.all([bareName, oneOf(['.tgz', '.tar.gz'])]),
  ([name, suffix]) => `${name}${suffix}`,
)

const specLengthBoundary: Arbitrary.Arbitrary<number> = oneArbitrary([
  Arbitrary.Constant(213),
  Arbitrary.Constant(214),
  Arbitrary.Constant(215),
])

const boundaryCommand = (length: number): ResolveAcquisitionSourceCommand =>
  new ResolveAcquisitionSourceCommand({
    target: 'q'.repeat(length),
    fromNpm: true,
    parsed: Option.some<ParsedPackageSpec>({ name: 'q'.repeat(length), version: '', versionKind: 'none' }),
  })

const isRegistryPackage = (
  outcome: Result.Result<AcquisitionSourceDecision, InvalidPackageSpec | TargetNotPackable>,
): boolean =>
  Result.match(outcome, {
    onSuccess: (decision) =>
      Match.value(decision).pipe(Match.tag('RegistryPackage', () => true), Match.orElse(() => false)),
    onFailure: () => false,
  })

const isExistingTarball = (
  outcome: Result.Result<AcquisitionSourceDecision, InvalidPackageSpec | TargetNotPackable>,
): boolean =>
  Result.match(outcome, {
    onSuccess: (decision) =>
      Match.value(decision).pipe(Match.tag('ExistingTarball', () => true), Match.orElse(() => false)),
    onFailure: () => false,
  })

const holdsSpecLengthBoundary = (length: number): boolean => {
  const outcome = resolveAcquisitionSource(boundaryCommand(length))
  return Match.value(length <= 214).pipe(
    Match.when(true, () => isRegistryPackage(outcome)),
    Match.when(false, () => holdsAuthoredRefusal(outcome, overlengthRefusal)),
    Match.exhaustive,
  )
}

const codeUnit = intBetween(0, 0xff)

interface InjectedCodeUnit {
  readonly target: string
  readonly code: number
}

const injectedCodeUnit: Arbitrary.Arbitrary<InjectedCodeUnit> = Arbitrary.map(
  Arbitrary.all([bareName, codeUnit]),
  ([name, code]) => ({ target: `${name}${String.fromCharCode(code)}`, code }),
)

const authoredControlRefusal = (code: number): boolean => code <= 0x1f || code === 0x7f

const refusedAsControlCharacter = (target: string): boolean =>
  Result.match(decisionOf(target, true), {
    onSuccess: () => false,
    onFailure: (refusal) => refusal.message.includes('control character'),
  })

type UrlDisposition = 'accepted' | 'refused'

const registryUrlTable: ReadonlyArray<{ readonly raw: string; readonly expected: UrlDisposition }> = [
  { raw: 'https://registry.npmjs.org', expected: 'accepted' },
  { raw: 'https://registry.npmjs.org/', expected: 'accepted' },
  { raw: 'https://registry.example.com:8443', expected: 'accepted' },
  { raw: 'http://localhost:4873', expected: 'accepted' },
  { raw: 'http://127.0.0.1:4873', expected: 'accepted' },
  { raw: 'http://127.0.0.53:4873', expected: 'accepted' },
  { raw: 'http://[::1]:4873', expected: 'accepted' },
  { raw: 'http://10.1.2.3:4873', expected: 'accepted' },
  { raw: 'http://192.168.1.10:4873', expected: 'accepted' },
  { raw: 'http://172.16.0.1:4873', expected: 'accepted' },
  { raw: 'http://registry.npmjs.org', expected: 'refused' },
  { raw: 'http://93.184.216.34:4873', expected: 'refused' },
  { raw: 'http://public.example.com:4873', expected: 'refused' },
  { raw: 'http://user:pass@localhost:4873', expected: 'refused' },
  { raw: 'https://user@registry.npmjs.org', expected: 'refused' },
  { raw: 'ftp://localhost:4873', expected: 'refused' },
  { raw: 'http://127.0.0.1:4873/?scope=x', expected: 'refused' },
  { raw: 'http://127.0.0.1:4873/#fragment', expected: 'refused' },
  { raw: `http://127.0.0.1:4873/${String.fromCharCode(0x0a)}`, expected: 'refused' },
  { raw: 'not a url', expected: 'refused' },
]

const octet = intBetween(0, 255)
const publicFirstOctet = oneArbitrary([intBetween(0, 9), intBetween(11, 126), intBetween(128, 255)])
const publicSecondOctet = oneArbitrary([intBetween(0, 15), intBetween(32, 167), intBetween(169, 255)])
const publicIpv4 = Arbitrary.map(
  Arbitrary.all([publicFirstOctet, publicSecondOctet, octet, octet]),
  ([a, b, c, d]) => `${a}.${b}.${c}.${d}`,
)
const publicHostname = Arbitrary.map(
  Arbitrary.all([textMatching(/^[a-z][a-z0-9-]{0,12}$/), textMatching(/^[a-z]{2,8}\.[a-z]{2,8}$/)]),
  ([label, suffix]) => `${label}.${suffix}`,
)
const publicHost: Arbitrary.Arbitrary<string> = oneArbitrary([publicIpv4, publicHostname])

const loopbackIpv4 = Arbitrary.map(Arbitrary.all([octet, octet, octet]), ([b, c, d]) => `127.${b}.${c}.${d}`)
const privateClassA = Arbitrary.map(Arbitrary.all([octet, octet, octet]), ([b, c, d]) => `10.${b}.${c}.${d}`)
const privateClassB = Arbitrary.map(
  Arbitrary.all([intBetween(16, 31), octet, octet]),
  ([b, c, d]) => `172.${b}.${c}.${d}`,
)
const privateClassC = Arbitrary.map(Arbitrary.all([octet, octet]), ([c, d]) => `192.168.${c}.${d}`)
const localHost: Arbitrary.Arbitrary<string> = oneArbitrary([
  Arbitrary.Constant('localhost'),
  Arbitrary.Constant('[::1]'),
  loopbackIpv4,
  privateClassA,
  privateClassB,
  privateClassC,
])

const port = intBetween(1024, 65_535)
const publicHostPort = Arbitrary.all({ host: publicHost, chosenPort: port })
const localHostPort = Arbitrary.all({ host: localHost, chosenPort: port })

const credentialLabel = textMatching(/^[a-z][a-z0-9]{0,8}$/)
const credentialedUser: Arbitrary.Arbitrary<string> = oneArbitrary([
  credentialLabel,
  Arbitrary.map(Arbitrary.all([credentialLabel, credentialLabel]), ([user, pass]) => `${user}:${pass}`),
])
const anyHost: Arbitrary.Arbitrary<string> = oneArbitrary([publicHost, localHost])
const credentialedUrl = Arbitrary.map(
  Arbitrary.all([oneOf(['https', 'http']), credentialedUser, anyHost]),
  ([scheme, credential, host]) => `${scheme}://${credential}@${host}/`,
)

const nonHttpScheme = textMatching(/^x[a-z]{1,4}$/)
const nonHttpUrl = Arbitrary.map(
  Arbitrary.all([nonHttpScheme, anyHost]),
  ([scheme, host]) => `${scheme}://${host}/`,
)

const strippedCodeUnit = oneArbitrary([intBetween(0, 0x20), Arbitrary.Constant(0x7f)])
const strippedUrl = Arbitrary.map(
  Arbitrary.all([oneOf(['https', 'http']), anyHost, strippedCodeUnit]),
  ([scheme, host, code]) => `${scheme}://${host}/${String.fromCharCode(code)}`,
)

const registryDocumentLimit = 8_388_608
const tarballLimit = 536_870_912

interface PayloadRow {
  readonly kind: PayloadKind
  readonly byteLength: number
  readonly accepted: boolean
}

const payloadLimitTable: Readonly<Record<PayloadKind, number>> = {
  'registry-document': registryDocumentLimit,
  tarball: tarballLimit,
}

const payloadBoundaryTable: readonly PayloadRow[] = [
  { kind: 'registry-document', byteLength: 0, accepted: true },
  { kind: 'registry-document', byteLength: registryDocumentLimit - 1, accepted: true },
  { kind: 'registry-document', byteLength: registryDocumentLimit, accepted: true },
  { kind: 'registry-document', byteLength: registryDocumentLimit + 1, accepted: false },
  { kind: 'tarball', byteLength: tarballLimit - 1, accepted: true },
  { kind: 'tarball', byteLength: tarballLimit, accepted: true },
  { kind: 'tarball', byteLength: tarballLimit + 1, accepted: false },
]

const payloadSize: Arbitrary.Arbitrary<{ readonly kind: PayloadKind; readonly byteLength: number }> = Arbitrary.all({
  kind: oneOf<PayloadKind>(['registry-document', 'tarball']),
  byteLength: oneArbitrary([
    intBetween(0, registryDocumentLimit),
    intBetween(registryDocumentLimit + 1, tarballLimit),
    intBetween(tarballLimit + 1, 2_147_483_647),
  ]),
})

const parsedSpec: Arbitrary.Arbitrary<ParsedPackageSpec> = Arbitrary.schema(ParsedPackageSpecSchema)

const holdsPayloadRow = (row: PayloadRow): boolean =>
  Result.match(decodePayloadSize(row.kind, row.byteLength), {
    onSuccess: (size) => row.accepted && row.byteLength <= payloadLimitTable[row.kind] && size === row.byteLength,
    onFailure: (refusal) => !row.accepted && refusal.recovery.length > 0,
  })

it.prop('∀row_SpecDisposition_=authoredTable', [oneOf(specDispositionTable)], ([row]) => holdsSpecRow(row))

it.prop('∀target_OverlengthSpec_⊥Accepted', [overlengthName], ([name]) =>
  Result.match(decisionOf(name, true), {
    onFailure: (refusal) => Predicate.isTagged(refusal, 'InvalidPackageSpec') && refusal.message.includes('214'),
    onSuccess: () => false,
  }))

it.prop('∀target_WeldedSpec_⊥Accepted', [weldedSpec], ([target]) =>
  Result.match(decisionOf(target, true), {
    onFailure: (refusal) =>
      Predicate.isTagged(refusal, 'InvalidPackageSpec') && refusal.recovery.includes('@scope/pkg'),
    onSuccess: () => false,
  }))

it.prop(
  '∀target,code_ControlCharacterSpec_=authoredRefusal',
  [injectedCodeUnit],
  ([injected]) => refusedAsControlCharacter(injected.target) === authoredControlRefusal(injected.code),
)

it.prop(
  '∀target_ControlCharacterRefusal_=authoredText',
  [controlCharacterTarget],
  ([target]) => holdsAuthoredRefusal(decisionOf(target, true), controlCharacterRefusal),
)

it.prop(
  '∀target_UrlMarkerRefusal_=authoredText',
  [urlMarkerTarget],
  ([target]) => holdsAuthoredRefusal(decisionOf(target, true), urlMarkerRefusal),
)

it.prop(
  '∀target_PercentEncodingRefusal_=authoredText',
  [percentEncodingTarget],
  ([target]) => holdsAuthoredRefusal(decisionOf(target, true), percentEncodingRefusal),
)

it.prop(
  '∀target_OverlengthRefusal_=authoredText',
  [overlengthName],
  ([target]) => holdsAuthoredRefusal(decisionOf(target, true), overlengthRefusal),
)

it.prop(
  '∀version_NonDistTagVersion_=authoredText',
  [nonDistTagVersion],
  ([version]) => holdsAuthoredRefusal(resolveAcquisitionSource(tagVersionCommand(version)), versionShapeRefusal),
)

it.prop(
  '∀target_UnknownBareName_=authoredText',
  [unknownBareName],
  ([target]) => holdsAuthoredRefusal(decisionOf(target, true), unparseableRefusal),
)

it.prop(
  '∀target_NotBareNotTarball_=authoredText',
  [notPackableTarget],
  ([target]) => holdsAuthoredRefusal(decisionOf(target, false), notPackableRefusal),
)

it.prop(
  '∀target_TarballSuffix_∃ExistingTarball',
  [tarballTarget],
  ([target]) => isExistingTarball(decisionOf(target, false)),
)

it.prop(
  '∀length_SpecLengthBoundary_=authoredLimit',
  [specLengthBoundary],
  ([length]) => holdsSpecLengthBoundary(length),
)

it.prop(
  '∀row_RegistryUrlBoundary_=authoredDisposition',
  [oneOf(registryUrlTable)],
  ([row]) =>
    Match.value(row.expected).pipe(
      Match.when('accepted', () => Result.isSuccess(decodeRegistryUrl(row.raw))),
      Match.when('refused', () => Result.isFailure(decodeRegistryUrl(row.raw))),
      Match.exhaustive,
    ),
)

it.prop(
  '∀host,port_HttpPublicHost_⊥RegistryUrl',
  [publicHostPort],
  ([{ host, chosenPort }]) => Result.isFailure(decodeRegistryUrl(`http://${host}:${chosenPort}/`)),
)

it.prop(
  '∀host,port_LoopbackPrivateHost_⊥Refusal',
  [localHostPort],
  ([{ host, chosenPort }]) => Result.isSuccess(decodeRegistryUrl(`http://${host}:${chosenPort}/`)),
)

it.prop(
  '∀host_HttpsHost_=HttpsBase',
  [anyHost],
  ([host]) =>
    Result.match(decodeRegistryUrl(`https://${host}/`), {
      onSuccess: (base) => base === `https://${host}`,
      onFailure: () => false,
    }),
)

it.prop('∀url_CredentialedUrl_⊥RegistryUrl', [credentialedUrl], ([raw]) => Result.isFailure(decodeRegistryUrl(raw)))

it.prop('∀url_NonHttpScheme_⊥RegistryUrl', [nonHttpUrl], ([raw]) => Result.isFailure(decodeRegistryUrl(raw)))

it.prop('∀url_StrippedCharacter_⊥RegistryUrl', [strippedUrl], ([raw]) => Result.isFailure(decodeRegistryUrl(raw)))

it.prop('∀spec_ManifestUrl_≡EncodedSegments', [parsedSpec], ([spec]) => {
  const manifest = buildManifestUrl(registryBase, spec)
  const segments = manifest.slice(registryBase.length + 1).split('/')
  const nameSegment = segments[0] ?? ''
  const versionSegment = segments[1] ?? ''
  return segments.length === 2 &&
    decodeURIComponent(nameSegment) === spec.name &&
    Match.value(spec.versionKind === 'none').pipe(
      Match.when(true, () => versionSegment === defaultTag),
      Match.when(false, () => decodeURIComponent(versionSegment) === spec.version),
      Match.exhaustive,
    ) &&
    !manifest.includes('?') &&
    !manifest.includes('#') &&
    !manifest.includes(' ')
})

it.prop(
  '∀row_PayloadBoundary_=authoredLimit',
  [oneOf(payloadBoundaryTable)],
  ([row]) => holdsPayloadRow(row),
)

it.prop(
  '∀kind,byteLength_PayloadSize_=authoredLimit',
  [payloadSize],
  ([{ kind, byteLength }]) =>
    payloadLimit(kind) === payloadLimitTable[kind] &&
    Result.match(decodePayloadSize(kind, byteLength), {
      onSuccess: (size) => byteLength <= payloadLimitTable[kind] && size === byteLength,
      onFailure: () => byteLength > payloadLimitTable[kind],
    }),
)
