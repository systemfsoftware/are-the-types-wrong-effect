# .github/AGENTS.md — CI runbook

Read this file to find which local command a red lane mirrors, and what is deliberately not in CI.

## Lanes

Every lane runs one root `package.json` script; that script is the lane's local mirror. The workflow/action files implement it — read them for the wiring, run the script to reproduce.

| Lane           | Local command (mirror)                           | Implemented by (job)                                   | Exit        |
| -------------- | ------------------------------------------------ | ------------------------------------------------------ | ----------- |
| static         | `pnpm check:static` (`format:check` + `lint`)    | `.github/workflows/reusable-checks.yml` (`static`)     | 0           |
| types          | `pnpm check:types` (`turbo typecheck`)           | `.github/workflows/reusable-checks.yml` (`types`)      | 0           |
| tests          | `pnpm check:tests` (`turbo test`)                | `.github/workflows/reusable-checks.yml` (`tests`)      | 0           |
| build          | `pnpm check:build` (`turbo build`)               | `.github/workflows/reusable-checks.yml` (`build`)      | 0           |
| contract       | `pnpm check:contract` (`turbo test:e2e`)         | `.github/workflows/reusable-contract.yml` (`contract`) | 0           |
| changeset      | `./scripts/check-changeset.ts <base-sha>`        | `.github/workflows/changeset-check.yml`                | 0           |
| commitlint     | `pnpm exec commitlint --from <base> --to <head>` | `.github/workflows/commitlint.yml`                     | 0           |
| merge conflict | `git merge-tree --write-tree HEAD origin/main`   | `.github/workflows/conflict-check.yml` (`conflicts`)   | 0 / 1 / 128 |

Expected exit code is `0` unless the lane's contract says otherwise; a non-zero exit fails the lane. `check:ci` is the local aggregate over the static/types/tests/build lanes — `s=0; … || s=1; exit $s`, so it is non-zero when any composed lane fails; CI runs the lanes as separate jobs instead of the aggregate. The merge-conflict lane is the one exception: `0` no conflicts, `1` conflicts with base (annotated `::error`), `128` unrelated histories or a git error — the explicit `status=$?` capture is deliberate (in the reference, `status=$?` after the `if` captures the `if` statement's own status, which POSIX defines as `0` when no branch ran, so its guard always exits `0`).

`ci.yml` fans out to `.github/workflows/reusable-checks.yml` (static/types/tests/build) and `.github/workflows/reusable-contract.yml` (contract), both gated by `.github/workflows/conflict-check.yml`. Node and pnpm come from `.github/actions/setup-node-runtime` (`pnpm/action-setup@v6`, resolving `packageManager: pnpm@11.21.0`; behind its `nix` input — default true — Nix is installed and the flake-built dprint is put on PATH for `format:check`). The frozen-lockfile install and the turbo cache live in `.github/actions/install-deps`.

## Rules

1. **A CI step runs a lane script, never a lane's internals.** A step invokes one of `pnpm check:static`, `check:types`, `check:tests`, `check:build`, `check:contract`, or the aggregate `pnpm check:ci` — never a raw composed command (`format:check`, `lint`, `typecheck`, `test`, `build`). `check:ci` is the one local definition of the container-free gate; a workflow re-enumerating its steps is the defect. Gate: review — a `.github/workflows/*.yml` step whose `run:` lists a raw composed command is the violation.
2. **`check:contract` is the one definition of the integration/contract gate.** `.github/workflows/reusable-contract.yml` invokes `pnpm check:contract` (→ `turbo test:e2e`), never a raw `test:e2e`. Gate: review — as rule 1, for the contract runner.
3. **A lane command is exactly the developer command.** Gate: the lane table itself — every row's command exists in root `package.json`, and a workflow step with no matching root script is a broken mirror to report, not work around.
4. **The evaluator surface is read-only.** `.github/workflows/**` and `.github/actions/**` grade a change; never edit them to make a change pass. Gate: review (root `AGENTS.md` boundaries; `CONST-E9`).
5. **Each lane owns its turbo cache-key prefix.** `install-deps` keys the cache `turbo-<os>-<cache-key-prefix>-<hashFiles('pnpm-lock.yaml')>` and restores across prefixes; actions/cache keys are immutable, so two lanes sharing a primary prefix race and the faster lane's partial save drops the slower lane's entries. Gate: review — every caller passes a distinct `cache-key-prefix`.

## Known blocker: mutation lane not wired

The mutation lane is NOT in CI. Do not add `.github/workflows/mutation.yml` or a mutation step to `check:ci` until this is killed.

Evidence, recorded verbatim:

- Stryker instrumentation succeeds against a narrow mutate set — `packages/arethetypeswrong/stryker.config.json` extends `stryker.config.base.json`.
- Every run dies at the dry-run stage: `Dry run failed: Test runner crashed. Tried 2 times to restart it without any luck. TestRunnerFailed:` with an empty cause.
- Reproduced with the full engine vitest config AND with a minimal stub vitest config; with CLI 6.0.0 and 7.0.1; with `CI=true`; and from a short project path (`/tmp/mut`).
- Vitest itself runs the same suite green in-process and inside Stryker's sandbox.

Reproduce:

```bash
cd packages/arethetypeswrong && pnpm exec stryker run --dryRunOnly
```

The root `mutation` script exists; it is simply not invoked by the gate. Killing this blocker is the precondition for adding `mutation.yml` and re-adding the mutation step to `check:ci`.

## Release lane

`Release` is push-triggered on `main` (`.github/workflows/release.yml`). A `plan` job derives the phase from repository state with `scripts/plan-release.ts --output "$GITHUB_OUTPUT"`; the phase selects exactly one downstream job:

1. **`publish`** — some released tag is absent from `origin`. Captures the release set (`scripts/tag-released-packages.ts --dry-run --json`), asserts notes (`scripts/create-github-releases.ts --assert`), builds, publishes via npm OIDC trusted publishing (`scripts/tag-released-packages.ts --unpublished --publish`), tags (`scripts/tag-released-packages.ts`), and creates GitHub Releases (`scripts/create-github-releases.ts`).
2. **`version`** — pending `.changeset/` intents exist. Consumes them with `pnpm version -r`, asserts release notes, and opens/updates the Release PR (`changeset-release/main`) via `scripts/open-release-pr.sh`.
3. **none** — neither; no downstream job runs.

A failed publish leaves tags absent, so the next push re-plans into `publish` and retries only what is owed — never re-trigger a release by hand. `Force Release` (`.github/workflows/force-release.yml`, `workflow_dispatch`) drops a dummy intent for a chosen package and bump. `changeset-check.yml` enforces release intent for publishable-package changes via `scripts/check-changeset.ts`.
