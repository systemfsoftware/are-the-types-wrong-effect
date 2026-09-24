# Proposal: publish a stryker-js 10 compatible `workflow-make-boundary` ignorer

Owner: the maintainers of `@systemfsoftware/stryker-plugins` in
`systemfsoftware/systemfsoftware`. This is a **proposal and a wait**. The ignorer set is part of
the mutation gate, and the work it grades must not rebuild it (CONST-E9).

## CONST-W3 declaration

The plan (`docs/plans/2026-09-23-2030-refactor-cell-architecture-compliance-plan.md`, KTD6)
says the `stryker.config.json` -> `stryker.config.ts` port kept identical values. It did not:
the dependency upgrade (`301ed76`) changed the ignorer set, as described below. This file is the
open declaration of that change; the plan is frozen and is not rewritten.

## The gap

Before the toolchain upgrade, both mutation configs in this repo ignored
`effect-schema-declarations` and `workflow-make-boundary`:

```json
"plugins": ["@systemfsoftware/stryker-plugins/effect-schema-ignorer", "@systemfsoftware/stryker-plugins/workflow-make-ignorer", ...],
"ignorers": ["effect-schema-declarations", "workflow-make-boundary"]
```

`workflow-make-ignorer` ships only in `@systemfsoftware/stryker-plugins@3.1.0`, which peers
`@systemfsoftware/stryker-js ^4.0.0` and `effect 4.0.0-rc.112`. This repo now runs
`@systemfsoftware/stryker-js` 10.1.1 on effect `4.0.0-rc.116`. The schema ignorer has a
standalone successor (`@systemfsoftware/stryker-ignorer-effect-schema-declarations`); the
workflow-make ignorer has none (npm 404 for `stryker-ignorer-workflow-make*`).

## Current state

`apps/arethetypeswrong-cli/stryker.config.ts` and `packages/arethetypeswrong/stryker.config.ts`
ignore `effect-schema-declarations` and `in-source-vitest-block`. Neither package has an
`import.meta.vitest` block, so the net effect is that `Workflow.make` boundary mutants are graded
rather than ignored. The gate is stricter than base, and both packages score 100 under it: the
surviving boundary mutants were instrumentation maps no tracer reads, and they were deleted.

## Ask

Publish `workflow-make-boundary` as a standalone `@systemfsoftware/stryker-ignorer-*` package
compatible with `@systemfsoftware/stryker-js` 10 (like the schema-declarations ignorer), or state
that boundary mutants are meant to be graded. Once a package exists, whoever owns this repo's
mutation config restores the base ignorer set.
