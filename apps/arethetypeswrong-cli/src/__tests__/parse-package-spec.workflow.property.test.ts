import { it } from '@effect/vitest'
import { Array, Match, Option, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'

import { parsePackageSpec as engineParsePackageSpec } from '@systemfsoftware/arethetypeswrong'
import { verdictFor } from '../parse-package-spec.cell.js'
import {
  IllFormedUnicode,
  InvalidPackageName,
  MalformedScope,
  parsePackageSpec,
  ParsePackageSpecCommand,
} from '../parse-package-spec.workflow.js'

type PackageSpecKind = 'none' | 'exact' | 'range' | 'tag'

const decisionOf = (target: string) => parsePackageSpec(verdictFor(target))

const tagOf = (target: string): string =>
  Result.match(decisionOf(target), {
    onFailure: (refusal) => refusal._tag,
    onSuccess: () => 'PackageSpecParsed',
  })

interface SpecRow {
  readonly target: string
  readonly expected: string
}

const oneOf = <T>(values: readonly T[]): Arbitrary.Arbitrary<T> =>
  Arbitrary.flatMap(
    Arbitrary.schema(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: values.length - 1 })))),
    (index) => Arbitrary.Constant(values[index]),
  )

const intBetween = (minimum: number, maximum: number): Arbitrary.Arbitrary<number> =>
  Arbitrary.schema(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum, maximum }))))

const textMatching = (pattern: RegExp): Arbitrary.Arbitrary<string> =>
  Arbitrary.schema(Schema.String.pipe(Schema.check(Schema.isPattern(pattern))))

const nameHead = textMatching(/^[a-z]$/)
const nameTail = textMatching(/^[a-z0-9._-]$/)
const nameSegment = Arbitrary.map(
  Arbitrary.all([nameHead, Arbitrary.array(nameTail, { maxLength: 20 })]),
  ([head, tail]) => head + tail.join(''),
)

const bareSpec = nameSegment

const scopedSpec = Arbitrary.map(
  Arbitrary.all([nameSegment, nameSegment]),
  ([scope, name]) => `@${scope}/${name}`,
)

const component = intBetween(0, 999)

const exactVersion = Arbitrary.map(
  Arbitrary.all([component, component, component]),
  ([major, minor, patch]) => `${major}.${minor}.${patch}`,
)

const caretRange = Arbitrary.map(exactVersion, (version) => `^${version}`)
const tildeRange = Arbitrary.map(exactVersion, (version) => `~${version}`)
const comparatorRange = Arbitrary.map(exactVersion, (version) => `>=${version}`)

const partialRange = Arbitrary.map(
  Arbitrary.all([component, component]),
  ([major, minor]) => `${major}.${minor}`,
)

const starRange: Arbitrary.Arbitrary<string> = Arbitrary.Constant('*')

const tagVersion = textMatching(/^[a-z][a-z0-9._-]{0,11}$/)

const oneArbitraryBranch = <A>(branches: ReadonlyArray<Arbitrary.Arbitrary<A>>): Arbitrary.Arbitrary<A> =>
  Arbitrary.flatMap(
    Arbitrary.schema(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: branches.length - 1 })))),
    (index) =>
      Array.get(branches, index).pipe((found) => Option.getOrElse(found, (): Arbitrary.Arbitrary<A> => branches[0])),
  )

const versionedSpec = Arbitrary.map(
  Arbitrary.all([
    oneArbitraryBranch([bareSpec, scopedSpec]),
    oneArbitraryBranch([exactVersion, caretRange, tildeRange, comparatorRange, partialRange, starRange, tagVersion]),
  ]),
  ([spec, version]) => `${spec}@${version}`,
)

const kindOf = (target: string): Option.Option<PackageSpecKind> =>
  Result.match(decisionOf(target), {
    onFailure: () => Option.none(),
    onSuccess: (decided) => Option.some(decided.spec.versionKind),
  })

const specRowTable: ReadonlyArray<SpecRow> = [
  { target: 'demo', expected: 'PackageSpecParsed' },
  { target: 'demo@1.2.3', expected: 'PackageSpecParsed' },
  { target: 'demo@^1.2.3', expected: 'PackageSpecParsed' },
  { target: 'demo@~1.2', expected: 'PackageSpecParsed' },
  { target: 'demo@1.2', expected: 'PackageSpecParsed' },
  { target: 'demo@*', expected: 'PackageSpecParsed' },
  { target: 'demo@next', expected: 'PackageSpecParsed' },
  { target: 'demo@latest', expected: 'PackageSpecParsed' },
  { target: '@scope/demo', expected: 'PackageSpecParsed' },
  { target: '@scope/demo@1.2.3', expected: 'PackageSpecParsed' },
  { target: '@scope/demo@next', expected: 'PackageSpecParsed' },
  { target: '@scope', expected: 'MalformedScope' },
  { target: '@/demo', expected: 'MalformedScope' },
  { target: 'demo@', expected: 'PackageSpecParsed' },
  { target: '', expected: 'InvalidPackageName' },
  { target: '.demo', expected: 'InvalidPackageName' },
  { target: '_demo', expected: 'InvalidPackageName' },
  { target: '-demo', expected: 'InvalidPackageName' },
  { target: 'demo ', expected: 'InvalidPackageName' },
  { target: 'node_modules', expected: 'InvalidPackageName' },
  { target: `demo${String.fromCharCode(0xd800)}`, expected: 'IllFormedUnicode' },
]

const illFormedTarget = Arbitrary.map(
  Arbitrary.all([nameSegment, intBetween(0xd800, 0xdfff)]),
  ([name, lone]) => `${name}${String.fromCharCode(lone)}`,
)

const controlCodeUnitTarget = Arbitrary.map(
  Arbitrary.all([nameSegment, intBetween(0, 0x1f)]),
  ([name, code]) => `${name}${String.fromCharCode(code)}`,
)

const malformedScopeTarget = oneOf([
  '@scope',
  '@/demo',
])

const invalidNameTarget = oneOf([
  '',
  '.demo',
  '_demo',
  '-demo',
  'demo ',
  'node_modules',
  'favicon.ico',
])

const expectedKind = (target: string): Option.Option<PackageSpecKind> =>
  Match.value(target).pipe(
    Match.when('', () => Option.none<PackageSpecKind>()),
    Match.orElse(() => kindOf(target)),
  )

const holdsRefusalTarget = (target: string): boolean =>
  Result.match(decisionOf(target), {
    onFailure: (refusal) =>
      Match.value(refusal).pipe(
        Match.tag('InvalidPackageName', ({ name }) => name.length >= 0),
        Match.tag('MalformedScope', ({ target: refused }) => refused === target),
        Match.tag('IllFormedUnicode', ({ target: refused }) => refused === target),
        Match.exhaustive,
      ),
    onSuccess: () => false,
  })

it.prop('∀row_SpecParity_=authoredTag', [oneOf(specRowTable)], ([row]) => tagOf(row.target) === row.expected)

it.prop('∀target_VersionedSpec_∃Kind', [versionedSpec], ([target]) => Option.isSome(expectedKind(target)))

it.prop('∀target_LoneSurrogate_⊥IllFormed', [illFormedTarget], ([target]) => tagOf(target) === 'IllFormedUnicode')

it.prop('∀target_MalformedScope_⊥Scope', [malformedScopeTarget], ([target]) => tagOf(target) === 'MalformedScope')

it.prop('∀target_InvalidName_⊥Name', [invalidNameTarget], ([target]) => tagOf(target) === 'InvalidPackageName')

it.prop(
  '∀target_BareScopedSpec_∃Parsed',
  [oneArbitraryBranch([bareSpec, scopedSpec])],
  ([target]) => tagOf(target) === 'PackageSpecParsed',
)

it.prop('∀target_RefusalCarriesTarget', [controlCodeUnitTarget], ([target]) => holdsRefusalTarget(target))

it.prop('∀target_FactsParity_≡EngineVerdict', [oneOf(specRowTable)], ([row]) => {
  const facts = verdictFor(row.target)
  const ours = parsePackageSpec(new ParsePackageSpecCommand({ ...facts }))
  const theirs = engineParsePackageSpec(row.target)
  return Result.match(ours, {
    onFailure: () => Result.isFailure(theirs),
    onSuccess: () => Result.isSuccess(theirs),
  })
})

it.prop('∀target_ScopedVersioned_≡EngineParse', [versionedSpec], ([target]) => {
  const facts = verdictFor(target)
  const ours = parsePackageSpec(new ParsePackageSpecCommand({ ...facts }))
  const theirs = engineParsePackageSpec(target)
  return Result.match(ours, {
    onFailure: () => Result.isFailure(theirs),
    onSuccess: (decided) =>
      Result.match(theirs, {
        onFailure: () => false,
        onSuccess: (engine) =>
          decided.spec.name === engine.name &&
          decided.spec.version === engine.version &&
          decided.spec.versionKind === engine.versionKind,
      }),
  })
})

it.prop('∀target_ControlParity_≡EngineRefusal', [controlCodeUnitTarget], ([target]) => {
  const facts = verdictFor(target)
  const ours = parsePackageSpec(new ParsePackageSpecCommand({ ...facts }))
  const theirs = engineParsePackageSpec(target)
  return Result.isFailure(ours) === Result.isFailure(theirs)
})

it.prop('∀target_MalformedParity_≡EngineRefusal', [malformedScopeTarget], ([target]) => {
  const facts = verdictFor(target)
  const ours = parsePackageSpec(new ParsePackageSpecCommand({ ...facts }))
  const theirs = engineParsePackageSpec(target)
  return Result.isFailure(ours) === Result.isFailure(theirs)
})

it.prop('∀target_InvalidNameParity_≡EngineRefusal', [invalidNameTarget], ([target]) => {
  const facts = verdictFor(target)
  const ours = parsePackageSpec(new ParsePackageSpecCommand({ ...facts }))
  const theirs = engineParsePackageSpec(target)
  return Result.isFailure(ours) === Result.isFailure(theirs)
})

it.prop('∀target_IllFormedParity_≡EngineRefusal', [illFormedTarget], ([target]) => {
  const facts = verdictFor(target)
  const ours = parsePackageSpec(new ParsePackageSpecCommand({ ...facts }))
  const theirs = engineParsePackageSpec(target)
  return Result.isFailure(ours) && Result.isFailure(theirs)
})

void Array
void IllFormedUnicode
void InvalidPackageName
void MalformedScope
