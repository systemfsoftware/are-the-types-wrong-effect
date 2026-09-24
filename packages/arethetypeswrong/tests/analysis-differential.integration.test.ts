import { effect, it } from '@effect/vitest'
import { Analysis, checkPackage, CheckResultSchema, type LegacyAnalysis } from '@systemfsoftware/arethetypeswrong'
import type { CheckPackageOptions, CheckResult, Problem } from '@systemfsoftware/arethetypeswrong'
import { Recipe } from '@systemfsoftware/arethetypeswrong-recipes'
import type { Package } from '@systemfsoftware/npm-package'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect, Exit, Result, Schema } from 'effect'
import { Arbitrary } from 'effect/unstable/arbitrary'
import { expect } from 'vitest'

import { TreePlan } from './__fixtures__/tree-plan.schema.js'

const encodeJsonText = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

const compareTexts = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const problemSortKey = (problem: Problem): string => {
  const entrypoint = 'entrypoint' in problem ? problem.entrypoint : ''
  const resolutionKind = 'resolutionKind' in problem ? problem.resolutionKind : ''
  return `${problem.kind}|${entrypoint}|${resolutionKind}`
}

const canonicalizeAnalysis = (analysed: CheckResult): CheckResult => {
  if (!('problems' in analysed)) return analysed
  return {
    ...analysed,
    problems: [...analysed.problems].sort((left, right) => compareTexts(problemSortKey(left), problemSortKey(right))),
  }
}

const canonicalText = (analysed: CheckResult) =>
  Effect.gen(function*() {
    const encoded = yield* Schema.encodeUnknownEffect(CheckResultSchema)(canonicalizeAnalysis(analysed))
    return yield* encodeJsonText(encoded)
  })

type CanonicalOutcome =
  | { readonly outcome: 'analysed'; readonly canonical: string }
  | { readonly outcome: 'refused' }

const canonicalOutcome = (
  analysis: Effect.Effect<CheckResult, { readonly message: string }>,
): Effect.Effect<CanonicalOutcome> =>
  Effect.matchEffect(analysis, {
    onFailure: () => Effect.succeed({ outcome: 'refused' as const }),
    onSuccess: (analysed) =>
      Effect.map(Effect.orDie(canonicalText(analysed)), (canonical): CanonicalOutcome => ({
        outcome: 'analysed' as const,
        canonical,
      })),
  })
interface OptionsCase {
  readonly name: string
  readonly options: CheckPackageOptions
  readonly build: (pkg: Package) => Analysis.AnalysisSpec
}

const optionsCases: ReadonlyArray<OptionsCase> = [
  { name: 'default options', options: {}, build: (pkg) => Analysis.make(pkg) },
  {
    name: 'legacy declared-code-file entrypoints',
    options: { entrypointsLegacy: true },
    build: (pkg) => Analysis.make(pkg).pipe(Analysis.withLegacyEntrypoints),
  },
  {
    name: 'explicit entrypoints',
    options: { entrypoints: ['.'] },
    build: (pkg) => Analysis.make(pkg).pipe(Analysis.withEntrypoints(['.'])),
  },
  {
    name: 'include entrypoints',
    options: { includeEntrypoints: ['.'] },
    build: (pkg) => Analysis.make(pkg).pipe(Analysis.includeEntrypoints(['.'])),
  },
  {
    name: 'exclude entrypoints',
    options: { excludeEntrypoints: [/utils/] },
    build: (pkg) => Analysis.make(pkg).pipe(Analysis.excludeEntrypoints([/utils/])),
  },
  {
    name: 'node16 profile modes',
    options: {},
    build: (pkg) => Analysis.make(pkg).pipe(Analysis.withModes(['node16-cjs', 'node16-esm'])),
  },
]

const agreeWithOptions = (pkg: Package, legacyOptions: CheckPackageOptions, build: OptionsCase['build']) =>
  Effect.gen(function*() {
    const builder = build(pkg)
    const legacyRun = yield* Effect.exit(checkPackage(pkg, legacyOptions))
    const rebuilt = yield* Effect.exit(builder.run)
    if (Exit.isFailure(legacyRun) || Exit.isFailure(rebuilt)) {
      expect(Exit.isFailure(rebuilt), 'the old engine and Analysis disagree on the failure class').toBe(true)
      expect(Exit.isFailure(legacyRun), 'the old engine and Analysis disagree on the failure class').toBe(true)
      return
    }
    const legacyCanonical = yield* Effect.orDie(canonicalText(legacyRun.value))
    const rebuiltCanonical = yield* Effect.orDie(canonicalText(rebuilt.value))
    expect(rebuiltCanonical, 'the rebuilt Analysis diverged from the old engine').toBe(legacyCanonical)
  })

const fixtureAnalysis: LegacyAnalysis = {
  packageName: 'fixture',
  packageVersion: '1.0.0',
  buildTools: {},
  types: { kind: 'included' },
  entrypoints: {},
  programInfo: { node10: {}, node16: {}, bundler: {} },
  problems: [
    { kind: 'UntypedResolution', entrypoint: './b', resolutionKind: 'node10' },
    { kind: 'NoResolution', entrypoint: '.', resolutionKind: 'node16-esm' },
    { kind: 'UntypedResolution', entrypoint: '.', resolutionKind: 'bundler' },
    { kind: 'NoResolution', entrypoint: '.', resolutionKind: 'node16-cjs' },
  ],
}

const expectedCanonicalText =
  '{"packageName":"fixture","packageVersion":"1.0.0","buildTools":{},"types":{"kind":"included"},' +
  '"entrypoints":{},"programInfo":{"node10":{},"node16":{},"bundler":{}},' +
  '"problems":[{"kind":"NoResolution","entrypoint":".","resolutionKind":"node16-cjs"},' +
  '{"kind":"NoResolution","entrypoint":".","resolutionKind":"node16-esm"},' +
  '{"kind":"UntypedResolution","entrypoint":"./b","resolutionKind":"node10"},' +
  '{"kind":"UntypedResolution","entrypoint":".","resolutionKind":"bundler"}]}'

const planArbitrary = Arbitrary.schema(TreePlan)

const encodeManifestText = (manifest: {
  readonly name: string
  readonly version: string
  readonly type?: string
  readonly main?: string
  readonly types?: string
  readonly exports?: {
    readonly ['.']: string | { readonly import: string; readonly require: string }
  }
}): string => Result.getOrThrow(Schema.encodeResult(Schema.fromJsonString(Schema.Unknown))(manifest))

const treeFiles = (plan: TreePlan): { readonly packageName: string; readonly files: Record<string, string> } => {
  const packageName = `generated-tree-${plan.nameVariant}`
  const implementation = plan.implementationSyntax === 'esm'
    ? { path: 'dist/index.mjs', body: 'export const value = 1;\n' }
    : { path: 'dist/index.cjs', body: 'module.exports = { value: 1 };\n' }
  const declarationPath = plan.declarationSyntax === 'esm' ? 'dist/index.d.mts' : 'dist/index.d.cts'
  const exportsTarget = plan.entrypointStyle === 'exports-conditions'
    ? { '.': { import: `./${implementation.path}`, require: `./${implementation.path}` } }
    : { '.': `./${implementation.path}` }
  const manifest = {
    name: packageName,
    version: '1.0.0',
    type: plan.moduleType === 'absent' ? undefined : plan.moduleType,
    main: plan.entrypointStyle === 'main-and-types' ? `./${implementation.path}` : undefined,
    types: plan.entrypointStyle === 'main-and-types' ? `./${declarationPath}` : undefined,
    exports: plan.entrypointStyle === 'main-and-types' ? undefined : exportsTarget,
  }
  const files: Record<string, string> = {
    'package.json': encodeManifestText(manifest),
    [implementation.path]: implementation.body,
    'dist/extra.cts': 'export const extra = 2;\n',
    'dist/extra.d.css.ts': 'export declare const extra: number;\n',
  }
  if (plan.shipsDeclarations) {
    files[declarationPath] = 'export declare const value: number;\n'
  }
  if (plan.proxyLayout === 'nested-proxy') {
    files['legacy/nested/package.json'] = encodeManifestText({
      name: packageName,
      version: '1.0.0',
      main: './index.js',
    })
    files['legacy/nested/index.js'] = 'module.exports = { nested: 1 };\n'
  }
  if (plan.proxyLayout === 'vendor' || plan.proxyLayout === 'nested-vendor-proxy') {
    files['thirdparty/dep/package.json'] = encodeManifestText({
      name: 'foreign-dep',
      version: '1.0.0',
      main: './index.js',
    })
    files['thirdparty/dep/index.js'] = 'module.exports = { dep: 1 };\n'
  }
  if (plan.proxyLayout === 'nested-vendor-proxy') {
    files['thirdparty/dep/nested/package.json'] = encodeManifestText({
      name: packageName,
      version: '1.0.0',
      main: './index.js',
    })
    files['thirdparty/dep/nested/index.js'] = 'module.exports = { hidden: 1 };\n'
  }
  if (plan.proxyLayout === 'mixed-case') {
    files['MixedCase/package.json'] = encodeManifestText({
      name: packageName,
      version: '1.0.0',
      main: './index.js',
    })
    files['MixedCase/index.js'] = 'module.exports = { mixed: 1 };\n'
    files['a-b/package.json'] = encodeManifestText({ name: packageName, version: '1.0.0', main: './index.js' })
    files['a-b/index.js'] = 'module.exports = { dashed: 1 };\n'
    files['a/b/package.json'] = encodeManifestText({ name: packageName, version: '1.0.0', main: './index.js' })
    files['a/b/index.js'] = 'module.exports = { slashed: 1 };\n'
  }
  if (plan.proxyLayout === 'malformed-proxy') {
    files['broken/package.json'] = '{ "name": "broken", '
    files['broken/index.js'] = 'module.exports = { broken: 1 };\n'
  }
  return { packageName, files }
}

effect(
  'the canonical form sorts report problems by kind, entrypoint, and resolution kind',
  () =>
    Effect.gen(function*() {
      const outcome = yield* canonicalOutcome(Effect.succeed(fixtureAnalysis))
      expect(outcome).toEqual({ outcome: 'analysed', canonical: expectedCanonicalText })
    }),
)

effect('a failed analysis canonicalizes to the refused outcome class', () =>
  Effect.gen(function*() {
    const outcome = yield* canonicalOutcome(Effect.fail({ message: 'the package could not be read' }))
    expect(outcome).toEqual({ outcome: 'refused' })
  }))

it.prop('every generated tree is mounted whole under its own package name', [planArbitrary], ([plan]) => {
  const { packageName, files } = treeFiles(plan)
  const pkg = createPackage(files, packageName, '1.0.0')
  const mounted = pkg.listFiles(`/node_modules/${packageName}`)
  for (const path of Object.keys(files)) {
    expect(mounted).toContain(`/node_modules/${packageName}/${path}`)
  }
})

for (const [recipe, make] of Object.entries(Recipe)) {
  for (const optionsCase of optionsCases) {
    effect(
      `the old engine and the Analysis builder agree on the ${recipe} fixture package under ${optionsCase.name}`,
      () => agreeWithOptions(make(), optionsCase.options, optionsCase.build),
    )
  }
}

it.effect.prop(
  'the old engine and the Analysis builder agree on every generated package tree under every option case',
  [planArbitrary],
  ([plan]) => {
    const { packageName, files } = treeFiles(plan)
    const pkg = createPackage(files, packageName, '1.0.0')
    return Effect.forEach(
      optionsCases,
      (optionsCase) => agreeWithOptions(pkg, optionsCase.options, optionsCase.build),
      { discard: true },
    )
  },
)

effect('the legacy combinator flags legacy declared-code-file discovery', () =>
  Effect.sync(() => {
    const { packageName, files } = treeFiles({
      nameVariant: 0,
      moduleType: 'absent',
      entrypointStyle: 'exports-conditions',
      implementationSyntax: 'esm',
      declarationSyntax: 'esm',
      shipsDeclarations: true,
      proxyLayout: 'flat',
    })
    const pkg = createPackage(files, packageName, '1.0.0')
    const piped = Analysis.make(pkg).pipe(Analysis.withLegacyEntrypoints)
    expect(piped.request.entrypointsLegacy).toBe(true)
  }))
