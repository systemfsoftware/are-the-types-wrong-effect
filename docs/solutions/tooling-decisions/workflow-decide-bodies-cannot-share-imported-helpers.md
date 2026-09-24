---
title: Workflow decide bodies cannot share imported helpers, so pin the shared vocabulary by type
date: 2026-09-24
category: tooling-decisions
module: attw CLI decision workflows
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - two or more `*.workflow.ts` decisions need the same lookup table or classifier
  - a review asks to replace a per-workflow table with an import from a shared module
tags: [workflow-make, make-body-purity, dmmf-workflow, oxlint, duplication, type-only-import]
---

# Workflow decide bodies cannot share imported helpers, so pin the shared vocabulary by type

## Context

The attw CLI has several `Workflow.make` decisions that need the same facts. `render-report.workflow.ts`
and `select-exit-code.workflow.ts` both map a `ProblemKind` to its CLI rule flag, and both need the
`resolutionKind` that four problem variants carry. `ProblemUtils.ts` already exports
`problemFlagForKind` for the shell's renderers.

A code review flagged each workflow's local map as a copy of `problemFlagForKind` and proposed
deleting it and importing the shared helper. That edit fails lint: the
`@systemfsoftware/oxlint-plugin-dmmf-workflow` rule `make-body-purity` rejects any value binding
imported from outside the sealed Effect surface when it is referenced inside a `Workflow.make` decide
body, and it follows same-file helpers the body calls. The fixing worker checked this against the
plugin's shipped classifier: a relative `./ProblemUtils.js` import is refused however pure it is.
Positions that are only types are not walked.

## Guidance

Keep the table local to each workflow, and single-source its vocabulary through a type-only import:

```ts
import type { CliProblemFlag } from './ProblemUtils.js'

const ruleFlagOf = (kind: Problem['kind']): CliProblemFlag =>
  Match.value(kind).pipe(
    Match.when('NoResolution', (): CliProblemFlag => 'no-resolution'),
    // one arm per ProblemKind
    Match.exhaustive,
  )
```

`Match.exhaustive` pins the input set (a new `ProblemKind` breaks every table), and the
`CliProblemFlag` return type pins the output set (a renamed flag breaks every table). Before this
change the tables returned `string`, so renaming a flag left a waiver that silently no longer
matched.

Do not work around the rule by moving the decision into the cell or by editing the lint config. The
rule is a judgment surface, and the decision belongs in the workflow.

## Why This Matters

A decide body that may reference only its parameters, same-file declarations, and the sealed Effect
surface stays pure and mutation-visible whatever happens in other modules. What looks like
duplication across workflows is the price of that guarantee, and paying it is safe only when the
compiler keeps the copies in agreement. Without that, the next review re-flags the duplication and
the next fixer hits the same lint wall.

## When to Apply

- A reviewer or a refactor proposes importing a shared helper into a `*.workflow.ts` decision.
- Two workflows encode the same closed mapping and each copy returns a bare `string` or `boolean`
  instead of a named union type.

## Examples

Before: `problemFlagOf` in `render-report.workflow.ts` and `ruleFlagOf` in
`select-exit-code.workflow.ts` each returned `string`.

After (pending on branch `updates`, commit "refactor(repo): keep one render-mode decision in the CLI"): both return
`CliProblemFlag` through `import type { CliProblemFlag } from './ProblemUtils.js'`, and each
workflow extracts `resolutionKind` with one local helper instead of a four-hop chain.

## Related

- `docs/solutions/tooling-decisions/self-name-imports-type-aware-lint.md`, another case where a
  type-aware lint decides what an import may do
