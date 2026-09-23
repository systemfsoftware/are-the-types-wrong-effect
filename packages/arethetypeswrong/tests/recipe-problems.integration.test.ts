import {
  allResolutionKinds,
  type Analysis,
  checkPackage,
  type EntrypointInfo,
  type EntrypointResolutionAnalysis,
  type Problem,
  type ProblemKind,
  ProblemKindSchema,
  type ResolutionKind,
  ResolutionKindSchema,
  withTypesCompanion,
} from '@systemfsoftware/arethetypeswrong'
import { Recipe } from '@systemfsoftware/arethetypeswrong-recipes'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { createPackage } from '@systemfsoftware/npm-package'
import { Effect, Schema } from 'effect'
import * as Match from 'effect/Match'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const encodeJsonText = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

const compareTexts = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const uniqueTexts = (values: readonly string[]): readonly string[] => {
  const seen: Record<string, true> = {}
  for (const value of values) seen[value] = true
  return Object.keys(seen).sort(compareTexts)
}

const authoredProblems = [
  { recipe: 'FalseCJS', kind: 'FalseCJS', cells: ['node16-esm'], placements: [] },
  { recipe: 'FalseESM', kind: 'FalseESM', cells: ['node16-cjs'], placements: [] },
  { recipe: 'CJSResolvesToESM', kind: 'CJSResolvesToESM', cells: ['node16-cjs'], placements: [['.', 'node16-cjs']] },
  { recipe: 'NamedExports', kind: 'NamedExports', cells: ['node16-esm'], placements: [] },
  {
    recipe: 'FallbackCondition',
    kind: 'FallbackCondition',
    cells: ['node16-cjs', 'node16-esm', 'bundler'],
    placements: [['.', 'node16-cjs'], ['.', 'node16-esm'], ['.', 'bundler']],
  },
  {
    recipe: 'FalseExportDefault',
    kind: 'FalseExportDefault',
    cells: ['node10', 'node16-cjs', 'node16-esm', 'bundler'],
    placements: [],
  },
  {
    recipe: 'MissingExportEquals',
    kind: 'MissingExportEquals',
    cells: ['node10', 'node16-cjs', 'node16-esm', 'bundler'],
    placements: [],
  },
  {
    recipe: 'InternalResolutionError',
    kind: 'InternalResolutionError',
    cells: ['node10', 'node16-cjs', 'node16-esm', 'bundler'],
    placements: [],
  },
  {
    recipe: 'UnexpectedModuleSyntax',
    kind: 'UnexpectedModuleSyntax',
    cells: ['node16-cjs', 'node16-esm'],
    placements: [],
  },
  { recipe: 'CJSOnlyExportsDefault', kind: 'CJSOnlyExportsDefault', cells: ['node16-esm', 'bundler'], placements: [] },
  {
    recipe: 'NoResolution',
    kind: 'NoResolution',
    cells: ['node16-cjs', 'node16-esm', 'bundler'],
    placements: [['.', 'node16-cjs'], ['.', 'node16-esm'], ['.', 'bundler']],
  },
  {
    recipe: 'UntypedResolution',
    kind: 'UntypedResolution',
    cells: ['node10', 'node16-cjs', 'node16-esm', 'bundler'],
    placements: [['.', 'node10'], ['.', 'node16-cjs'], ['.', 'node16-esm'], ['.', 'bundler']],
  },
] as const

const declarationPlacements = [
  { placement: 'inside its own directory', verdict: 'shipping its own declarations' },
  { placement: 'in a sibling directory beside it', verdict: 'shipping no declarations' },
] as const

const recipeCount = Object.entries(Recipe).length

const generatedPackageTree = (variant: number, placement: (typeof declarationPlacements)[number]['placement']) =>
  Effect.gen(function*() {
    const directories = ['dist', 'build', 'lib'] as const
    const moduleNames = ['index', 'main', 'entry'] as const
    const directory = directories[variant % directories.length]
    const moduleName = moduleNames[(variant + 1) % moduleNames.length]
    const packageName = `generated-tree-${variant}`
    const siblingName = `generated-sibling-${variant}`
    const declarationPath = `${directory}/${moduleName}.d.ts`
    const modulePath = `${directory}/${moduleName}.js`
    const declarationsInside = placement === 'inside its own directory'
    const manifestText = (name: string, withTypes: boolean) =>
      Effect.gen(function*() {
        const manifest: Record<string, string> = {
          name,
          version: '1.0.0',
          main: `./${modulePath}`,
        }
        if (withTypes) {
          manifest['types'] = `./${declarationPath}`
        }
        return yield* encodeJsonText(manifest)
      })

    const subjectFiles: Record<string, string> = {
      'package.json': yield* manifestText(packageName, declarationsInside),
      [modulePath]: 'export const value = 1;\n',
    }
    if (declarationsInside) {
      subjectFiles[declarationPath] = 'export declare const value: number;\n'
    }

    return {
      packageName,
      declarationPath,
      subject: createPackage(subjectFiles, packageName, '1.0.0'),
      sibling: createPackage(
        {
          'package.json': yield* manifestText(siblingName, !declarationsInside),
          [declarationPath]: 'export declare const value: number;\n',
        },
        siblingName,
        '1.0.0',
      ),
    }
  })

const cellsVisibleProblems = (entrypoint: EntrypointInfo, problems: readonly Problem[]): readonly Problem[] => {
  const visible: Problem[] = []
  const cells = cellsAt(entrypoint)
  for (const resolutionKind of allResolutionKinds) {
    const indices = cells[resolutionKind].visibleProblems ?? []
    for (const index of indices) visible.push(problems[index])
  }
  return visible
}

const cellsAt = (
  entrypoint: EntrypointInfo,
): Record<ResolutionKind, EntrypointResolutionAnalysis> => entrypoint.resolutions

const cellsShowing = (analysed: Analysis, kind: ProblemKind): readonly ResolutionKind[] => {
  const cells = cellsAt(analysed.entrypoints['.'])
  const showing: ResolutionKind[] = []
  for (const resolutionKind of allResolutionKinds) {
    const visible = (cells[resolutionKind].visibleProblems ?? []).map((index) => problemKindOf(analysed, index))
    if (visible.includes(kind)) showing.push(resolutionKind)
  }
  return showing
}

const problemKindOf = (analysed: Analysis, index: number): ProblemKind => analysed.problems[index].kind

const placementsOf = (problems: readonly Problem[], kind: ProblemKind): readonly string[] => {
  const placements: string[] = []
  for (const problem of problems) {
    if (problem.kind !== kind) continue
    if (!('entrypoint' in problem) || !('resolutionKind' in problem)) continue
    placements.push(`${problem.entrypoint} ${problem.resolutionKind}`)
  }
  return placements.sort(compareTexts)
}

Feature('The problems a synthetic package was authored to produce').body(({ scenario, scenarioOutline }) => {
  scenarioOutline(
    'the <recipe> package is reported as <kind>',
    authoredProblems,
    (row) =>
      Gherkin.Do.pipe(
        Given(`the ${row.recipe} synthetic package`)('pkg', () => Effect.sync(() => Recipe[row.recipe]())),
        When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
        Then(`the analysis reports the ${row.kind} problem and nothing else`)(({ analysed }) => {
          if (!('entrypoints' in analysed)) {
            throw new Error('expected the analysis of a package carrying declarations')
          }
          expect(uniqueTexts(analysed.problems.map((problem) => problem.kind))).toEqual([row.kind])
          expect(cellsShowing(analysed, row.kind)).toEqual([...row.cells])
          expect(placementsOf(analysed.problems, row.kind)).toEqual(
            row.placements.map(([entrypoint, resolutionKind]) => `${entrypoint} ${resolutionKind}`).sort(compareTexts),
          )
        }),
      ),
  )

  scenario(
    'the authored expectations name every problem kind and every resolution kind',
    Gherkin.Do.pipe(
      Given('an expectation for every synthetic problem package')('authored', () => Effect.succeed(authoredProblems)),
      When('the covered kinds are collected from the expectations')('coverage', ({ authored }) =>
        Effect.succeed({
          kinds: uniqueTexts(authored.map((row) => row.kind)),
          cells: uniqueTexts(
            authored.flatMap((row) => [
              ...row.cells,
              ...row.placements.map(([, resolutionKind]) => resolutionKind),
            ]),
          ),
        })),
      Then('every problem kind and every resolution kind is covered at least once')(({ coverage }) => {
        expect(coverage.kinds).toEqual([...ProblemKindSchema.literals].sort(compareTexts))
        expect(coverage.cells).toEqual([...ResolutionKindSchema.literals].sort(compareTexts))
      }),
    ),
  )

  scenario(
    'a well-formed package reports no problems at any entrypoint',
    Gherkin.Do.pipe(
      Given('the well-formed synthetic package whose entrypoint agrees under every resolution kind')(
        'pkg',
        () => Effect.sync(() => Recipe.WellFormed()),
      ),
      When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
      Then('no problem is reported under any resolution kind of any entrypoint')(({ analysed }) => {
        if (!('entrypoints' in analysed)) {
          throw new Error('expected the analysis of a package carrying declarations')
        }
        expect(analysed.problems).toEqual([])
        for (const entrypoint of Object.values(analysed.entrypoints)) {
          expect(cellsVisibleProblems(entrypoint, analysed.problems)).toEqual([])
        }
      }),
    ),
  )

  scenario(
    'a package that ships JavaScript only yields the untyped result',
    Gherkin.Do.pipe(
      Given('the synthetic package that ships JavaScript without declarations')(
        'pkg',
        () => Effect.sync(() => Recipe.TypesCompanion()),
      ),
      When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
      Then('the analysis is the untyped result naming the package')(({ analysed }) => {
        expect(analysed).toEqual({ packageName: 'types-companion', packageVersion: '1.0.0', types: false })
      }),
    ),
  )

  scenario(
    'a package with a types companion reports the companion as the source of its types',
    Gherkin.Do.pipe(
      Given('the JavaScript-only synthetic package paired with its companion types package')(
        'pkg',
        () => Effect.sync(() => withTypesCompanion(Recipe.TypesCompanion(), Recipe.TypesCompanionTypes())),
      ),
      When('the package is analysed')('analysed', ({ pkg }) => checkPackage(pkg)),
      Then('the analysis names the companion package as the types source')(({ analysed }) => {
        if (!('entrypoints' in analysed)) {
          throw new Error('expected the analysis of a package carrying declarations')
        }
        expect(analysed.types).toEqual({
          kind: '@types',
          packageName: '@types/types-companion',
          packageVersion: '1.0.0',
        })
        expect(analysed.entrypoints['.']?.hasTypes).toBe(true)
        expect(analysed.entrypoints['.']?.resolutions.node10.resolution?.fileName).toBe(
          '/node_modules/@types/types-companion/index.d.ts',
        )
      }),
    ),
  )

  scenarioOutline(
    'a generated package whose declarations live <placement> is reported as <verdict>',
    declarationPlacements,
    (row) =>
      Gherkin.Do.pipe(
        Given(`a generated package tree whose declarations live ${row.placement}, with a sibling package beside it`)(
          'generated',
          () =>
            Effect.gen(function*() {
              const variant = Match.value(row.placement).pipe(
                Match.when('inside its own directory', () => 0),
                Match.when('in a sibling directory beside it', () => 1),
                Match.exhaustive,
              )
              return yield* generatedPackageTree(variant, row.placement)
            }),
        ),
        When('the generated package is analysed')('analysed', ({ generated }) => checkPackage(generated.subject)),
        Then(`the analysed package is reported as ${row.verdict}`)(({ analysed, generated }) => {
          expect(analysed.packageName).toBe(generated.packageName)
          Match.value(row.verdict).pipe(
            Match.when('shipping its own declarations', () => {
              expect(analysed.types).toMatchObject({ kind: 'included' })
              if (!('entrypoints' in analysed)) {
                throw new Error('expected the analysis of a package carrying declarations')
              }
              expect(analysed.entrypoints['.']?.hasTypes).toBe(true)
              expect(analysed.entrypoints['.']?.resolutions.node10.resolution?.fileName).toBe(
                `/node_modules/${generated.packageName}/${generated.declarationPath}`,
              )
            }),
            Match.when('shipping no declarations', () => {
              expect(analysed.types).toBe(false)
              expect('entrypoints' in analysed).toBe(false)
            }),
            Match.exhaustive,
          )
        }),
      ),
  )

  scenario(
    'only the package authored to be refused fails analysis',
    Gherkin.Do.pipe(
      Given('every synthetic recipe package')(
        'packages',
        () => Effect.sync(() => Object.entries(Recipe).map(([name, make]) => ({ name, pkg: make() }))),
      ),
      When('the engine analyses every package')(
        'outcomes',
        ({ packages }) =>
          Effect.forEach(packages, (entry) =>
            checkPackage(entry.pkg).pipe(
              Effect.exit,
              Effect.map((exit) => ({
                name: entry.name,
                outcome: Match.value(exit).pipe(
                  Match.tag('Success', () => 'analysed' as const),
                  Match.tag('Failure', () => 'refused' as const),
                  Match.exhaustive,
                ),
              })),
            )),
      ),
      Then('exactly the known-bad package is refused and every other package is analysed')(({ outcomes }) => {
        const refused = outcomes.filter((entry) => entry.outcome === 'refused').map((entry) => entry.name)
        const analysed = outcomes.filter((entry) => entry.outcome === 'analysed')
        expect(refused).toEqual(['KnownBad'])
        expect(analysed.length).toBe(recipeCount - 1)
      }),
    ),
  )
})
