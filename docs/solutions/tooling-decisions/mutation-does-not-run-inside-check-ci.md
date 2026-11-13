---
problem_type: tooling_decision
---

# Mutation Does Not Run Inside check:ci

SYS-1411. `check:ci` ran `pnpm mutation` (Stryker, break threshold 100) on every pull request. In are-the-types-wrong-effect
run 43368492402 (job 131698452263, `ubuntu-latest`), the format, lint, typecheck, test and dist gates finished in about
50 s, the first package's mutation run took 9 min 12 s, and the job then sat in a second mutation run until it was
cancelled at 44 min. `check:ci` no longer runs mutation; the shared `reusable-mutation.yml` (SYS-1417) owns it.
