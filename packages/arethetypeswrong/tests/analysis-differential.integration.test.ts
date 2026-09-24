import { effect, it } from '@effect/vitest'
import { Analysis, checkPackage, CheckResultSchema, type LegacyAnalysis } from '@systemfsoftware/arethetypeswrong'
import type { CheckResult, Problem } from '@systemfsoftware/arethetypeswrong'
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

const agreeOn = (pkg: Package): Effect.Effect<void> =>
  Effect.gen(function*() {
    const legacy = yield* Effect.exit(checkPackage(pkg))
    const rebuilt = yield* Effect.exit(Analysis.make(pkg).run)
    if (Exit.isFailure(legacy) || Exit.isFailure(rebuilt)) {
      expect(Exit.isFailure(rebuilt), 'the old engine and Analysis disagree on the failure class').toBe(true)
      expect(Exit.isFailure(legacy), 'the old engine and Analysis disagree on the failure class').toBe(true)
      return
    }
    const legacyCanonical = yield* Effect.orDie(canonicalText(legacy.value))
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
  }
  if (plan.shipsDeclarations) {
    files[declarationPath] = 'export declare const value: number;\n'
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
  effect(`the old engine and the Analysis builder agree on the ${recipe} fixture package`, () => agreeOn(make()))
}

it.effect.prop(
  'the old engine and the Analysis builder agree on every generated package tree',
  [planArbitrary],
  ([plan]) => {
    const { packageName, files } = treeFiles(plan)
    return agreeOn(createPackage(files, packageName, '1.0.0'))
  },
)

effect('the pipe and data-first combinator forms yield equal specs', () =>
  Effect.sync(() => {
    const { packageName, files } = treeFiles({
      nameVariant: 0,
      moduleType: 'absent',
      entrypointStyle: 'exports-conditions',
      implementationSyntax: 'esm',
      declarationSyntax: 'esm',
      shipsDeclarations: true,
    })
    const pkg = createPackage(files, packageName, '1.0.0')
    const piped = Analysis.make(pkg).pipe(Analysis.excludeEntrypoints(['./private']))
    const direct = Analysis.excludeEntrypoints(Analysis.make(pkg), ['./private'])
    expect(piped.request).toEqual(direct.request)
  }))
