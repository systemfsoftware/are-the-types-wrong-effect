---
problem_type: tooling_decision
---

# Mutation Runs on Main, Not Before the Merge

SYS-1411. `check:ci` ran `pnpm mutation` (Stryker, break threshold 100) on every pull request. In are-the-types-wrong-effect
run 43368492402 (job 131698452263, `ubuntu-latest`), the format, lint, typecheck, test and dist gates finished in about
50 s, the first package's mutation run took 9 min 12 s, and the job then sat in a second mutation run until it was
cancelled at 44 min. `check:ci` now holds the pre-merge gate, and `ci.yml` runs `pnpm mutation` on main only.
