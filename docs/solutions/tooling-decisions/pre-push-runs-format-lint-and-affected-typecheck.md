---
title: Pre-push runs format, lint and affected typecheck, never tests
date: 2026-11-12
category: tooling-decisions
module: repo
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "editing .husky/pre-push"
  - "deciding what an agent runs locally before a push"
symptoms:
  - "the pre-push hook only checked that main was not behind origin, so pushes skipped format, lint and typecheck"
root_cause: config_error
resolution_type: config_change
---

# Pre-push runs format, lint and affected typecheck, never tests

Agents run format, lint and typecheck before every push. Tests run only in CI.

`.husky/pre-push` now runs `format:check`, `lint`, and `turbo run typecheck lint --affected` with base = the merge-base with `origin/main`. The main-behind check still runs for `main`.

Measured on `@systemfsoftware/arethetypeswrong`, one-file edit, `turbo run typecheck`: cold 5.5 s and 8.3 s, warm with a copied per-package `node_modules/.cache` 3.6 s and 3.8 s. Peak memory 907 to 950 MB in every run. The copy of the cache (about 1 MB) gave no measurable gain, so `.worktreeinclude` is unchanged.
