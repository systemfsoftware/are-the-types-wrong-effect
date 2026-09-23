import * as S from 'effect/Schema'

export const TreePlan = S.Struct({
  nameVariant: S.Int.pipe(S.check(S.isBetween({ minimum: 0, maximum: 15 }))),
  moduleType: S.Literals(['module', 'commonjs', 'absent']),
  entrypointStyle: S.Literals(['exports-string', 'exports-conditions', 'main-and-types']),
  implementationSyntax: S.Literals(['esm', 'cjs']),
  declarationSyntax: S.Literals(['esm', 'cjs']),
  shipsDeclarations: S.Boolean,
})
export type TreePlan = S.Schema.Type<typeof TreePlan>
