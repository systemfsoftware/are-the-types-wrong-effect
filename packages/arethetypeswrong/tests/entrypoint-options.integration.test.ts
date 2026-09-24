import { Analysis } from '@systemfsoftware/arethetypeswrong'
import { Recipe } from '@systemfsoftware/arethetypeswrong-recipes'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import type { Package } from '@systemfsoftware/npm-package'
import { Effect } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const compareTexts = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const reportOf = (analysed: Analysis.PackageReport): Analysis.Report => {
  if (!('entrypoints' in analysed)) {
    throw new Error('expected the analysis of a package carrying declarations')
  }
  return analysed
}

const subpathsOf = (analysed: Analysis.PackageReport): readonly string[] =>
  Object.keys(reportOf(analysed).entrypoints).sort(compareTexts)

const multiEntrypoint = () => Effect.sync(() => Recipe.MultiEntrypoint())

type EntrypointOptionCase = {
  readonly option: string
  readonly reported: string
  readonly subpaths: ReadonlyArray<string>
  readonly build: (pkg: Package) => Analysis.AnalysisSpec
}

const entrypointOptionCases: ReadonlyArray<EntrypointOptionCase> = [
  {
    option: 'no entrypoint option',
    reported: 'every declared entrypoint',
    subpaths: ['.', './macros', './utils'],
    build: (pkg) => Analysis.make(pkg),
  },
  {
    option: 'explicit entrypoints',
    reported: 'only the two named entrypoints',
    subpaths: ['.', './utils'],
    build: (pkg) => Analysis.make(pkg).pipe(Analysis.withEntrypoints(['.', './utils'])),
  },
  {
    option: 'an entrypoint the include list adds',
    reported: 'the added entrypoint beside the declared ones',
    subpaths: ['.', './added', './macros', './utils'],
    build: (pkg) => Analysis.make(pkg).pipe(Analysis.includeEntrypoints(['./added'])),
  },
  {
    option: 'an entrypoint excluded by name',
    reported: 'the declared entrypoints except the excluded one',
    subpaths: ['.', './utils'],
    build: (pkg) => Analysis.make(pkg).pipe(Analysis.excludeEntrypoints(['./macros'])),
  },
  {
    option: 'an entrypoint excluded by pattern',
    reported: 'the declared entrypoints except the excluded one',
    subpaths: ['.', './utils'],
    build: (pkg) => Analysis.make(pkg).pipe(Analysis.excludeEntrypoints([/macros/])),
  },
]

Feature('The entrypoints an analysis reports once an entrypoint option is applied').body(
  ({ scenario, scenarioOutline }) => {
    scenarioOutline(
      'the multi-entrypoint package analysed with <option> reports <reported>',
      entrypointOptionCases,
      (row) =>
        Gherkin.Do.pipe(
          Given('the multi-entrypoint synthetic package publishing three subpaths')('pkg', multiEntrypoint),
          When('the package is analysed under that entrypoint option')('analysed', ({ pkg }) => row.build(pkg).run),
          Then('the analysis reports exactly the entrypoints that option leaves')(({ analysed }) => {
            expect(subpathsOf(analysed)).toEqual([...row.subpaths].sort(compareTexts))
          }),
        ),
    )

    scenario(
      'the data-first and the piped form of one option report the same analysis',
      Gherkin.Do.pipe(
        Given('the multi-entrypoint synthetic package publishing three subpaths')('pkg', multiEntrypoint),
        When('the package is analysed through the data-first and the piped form')('analysed', ({ pkg }) =>
          Effect.all([
            Analysis.excludeEntrypoints(Analysis.make(pkg), ['./macros']).run,
            Analysis.make(pkg).pipe(Analysis.excludeEntrypoints(['./macros'])).run,
          ])),
        Then('both forms report the same analysis')(({ analysed }) => {
          expect(analysed[0]).toEqual(analysed[1])
        }),
      ),
    )
  },
)
