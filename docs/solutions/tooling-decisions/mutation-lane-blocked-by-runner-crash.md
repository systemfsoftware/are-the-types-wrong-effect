---
title: The mutation lane was vacuous, and its runner cannot boot
date: 2026-09-11
category: tooling-decisions
module: ci
problem_type: tooling_decision
component: tooling
severity: medium
symptoms:
  - "pnpm mutation exits 0 having executed no task, because no package defines a mutation script"
  - "Stryker prints phase prepare, phase instrument, then dies at dry-run"
  - "Dry run failed: Test runner crashed. Tried 2 times to restart it without any luck. TestRunnerFailed:"
  - "the TestRunnerFailed cause is empty, so the CLI names no underlying error"
root_cause: environment
resolution_type: config_change
related_components:
  - package.json
  - stryker.config.base.json
  - packages/arethetypeswrong/stryker.config.json
  - .github/AGENTS.md
tags: [stryker, mutation-testing, ci, turbo, vitest]
---

# The mutation lane was vacuous, and its runner cannot boot

## Problem

Two defects, one lane.

1. **The gate was vacuous.** The root gate composed `pnpm mutation || s=1` while no workspace package defined a `mutation` script. `turbo run mutation` therefore executed zero tasks and exited 0: the gate published a green that graded nothing.
2. **The lane's toolchain cannot boot here.** With the mutation script, configs, and the Stryker devDependencies in place, every run dies before the first mutant: instrumentation completes, the dry run crashes the test-runner child, and the engine reports `TestRunnerFailed:` with an empty cause.

The lane is consequently unwired: the step is gone from the gate and no `.github/workflows/mutation.yml` exists. The blocker, not a workaround, is what unblocks it.

## Failure mechanics

1. **Zero providers, zero tasks, exit 0.** $\text{exit} = 0$ whenever $\text{tasks} = 0$. A gate that aggregates with `… || s=1` cannot distinguish "the lane passed" from "the lane ran nothing". `pnpm exec turbo run mutation --dry=json` is the only honest check of a turbo lane; it listed no tasks here.
2. **Instrumentation is not the failing stage.** Stryker resolves the config, selects the mutate set, and finishes `phase: instrument`. The `.schema.ts` exclusions and the in-source-test ignorer are therefore sound as configured.
3. **The dry run kills the runner child.** `phase: prepare → instrument → dry-run` then `Dry run failed: Test runner crashed. Tried 2 times to restart it without any luck.` The engine spawns a test-runner child over an Effect RPC socket and maps a child that exits without a result to `TestRunnerFailed`; the mapped cause arrives empty, so the CLI names no error.
4. **The repo's vitest configuration is not the trigger.** The crash is identical with the engine's own config and with a stub config carrying only `globals`, `environment`, and `include`; with the runner's optional `vitest.related` and `vitest.dir` removed; and with the `coverage: { enabled: false }` the runner itself passes.
5. **The toolchain version is not the trigger.** Reproduced on CLI 6.0.0 and 7.0.1 (and on the engine versions each pulls).
6. **The path length is not the trigger.** A short project copy at `/tmp/mut` (same package, symlinked `node_modules`) crashes identically, which refutes the unix-socket path-length hypothesis a deep worktree path suggests.
7. **The sandbox is not the trigger.** Vitest in Stryker's own sandbox clone runs the same suite green (7 files, 92 tests, under a second), and the same suite runs green through vitest's programmatic `createVitest` API in-process.
8. **The workers themselves boot.** Starting the engine's worker bundle standalone prints `checker worker: STRYKER_SOCKET is not set`, which is the expected message outside Stryker.

## Architectural Invariants

**I1 — A turbo gate must have a provider.** A task name in the gate is a claim that some package implements it. $\text{tasks} = 0 \Rightarrow$ the gate's exit code is not evidence.

```bash
wrong: "check:ci": "…; pnpm mutation || s=1; exit $s"   # no package defines mutation
right: "check:ci": "…; exit $s"                          # until a package's mutation green is real
```

**I2 — A lane is enrolled when its runner runs, not when its config lands.** Configs, catalog entries, and a task name are scaffolding; the gate is a dry run that exits 0 and a score computed from a non-empty mutated set. A mutated set that is empty or a score that is `NaN` is the same vacuous green by another route — the failure mode recorded in `stryker-nan-mutation-score-scaffold-packages.md`.

**I3 — The instrument that grades is not the graded.** The crash lives inside the published mutation engine and its CLI. It is reported upstream with this reproduction, never patched locally: editing the grader so the current change passes is the exact behaviour `CONST-E9` forbids.

## What didn't work

- Removing the runner's optional vitest options, and passing a minimal stub config — the crash is identical, so the hunt moved off our configuration.
- `CI=true`, invoking the CLI's `main.mjs` directly, and a short project path — no change.
- Upgrading the CLI/engine to the major the reference repo's working CI uses — no change.
- Reading the engine log at `--logLevel trace --fileLogLevel trace` — the published CLI writes no log file, and its stream carries the empty-cause error above.

## Verification

Reproduce the blocker:

```bash
cd packages/arethetypeswrong && pnpm exec stryker run --dryRunOnly
```

Expect exit 3 and `Dry run failed: Test runner crashed`.

While the lane is unwired: `pnpm check:ci` composes static, types, tests, and build, and says nothing about mutation; `pnpm exec turbo run mutation --dry=json` returns zero tasks.

Kill test, in order: (1) the dry run exits 0; (2) a real run reports a non-empty mutated set with a perfect kill score under the declared thresholds; (3) only then add `.github/workflows/mutation.yml` and re-add the step to the gate. Step (2) is what `CONST-T3` requires before any mutation number is trusted.

## Prevention

- Smell: a gate line `pnpm <task> || s=1` where `pnpm exec turbo run <task> --dry=json` lists no tasks.
- Smell: a committed mutation config in a repo whose history has never printed a mutation score.
- Rule: before trusting an aggregated gate, enumerate the tasks each component executes; an exit code is evidence only for the work actually attempted.

## Related

- `docs/solutions/tooling-decisions/stryker-nan-mutation-score-scaffold-packages.md` — the zero-mutant variant of the same vacuous green
- `.github/AGENTS.md` — the CI runbook's _Known blocker_ section, which gates the mutation workflow on this document's kill test
