# starter

Starter template for TypeScript / Effect libraries and tools.

## Boundaries

| Surface            | Examples                                     | Limit                                                  |
| ------------------ | -------------------------------------------- | ------------------------------------------------------ |
| **Evaluator**      | `commitlint.config.ts`, `.github/workflows/` | Read-only; never edit the instrument that grades work. |
| **Doctrine**       | `CONSTITUTION.md`, `subtrees.toml`           | Project law; edit only on deliberate direction.        |
| **Vendored**       | `repos/**`                                   | Read-only; updated via git subtree, never hand-edited. |
| **Human approval** | Releases, publishing, external credentials   | User-confirmed only.                                   |
| **Editable**       | Workspace source, tests, documentation       | Edit freely.                                           |

## Doc Triggers

| Doc                                 | Trigger                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONSTITUTION.md`                   | architecture changes, rule authoring, or design disputes                                                                                        |
| `repos/constitution/ENFORCEMENT.md` | building or changing an instrument that grades work (lint gates, stream rules, CI checks, thresholds, rubrics, advisors); situational read only |

## Definition of Done

| ID        | Rule                                                | Gate                |
| --------- | --------------------------------------------------- | ------------------- |
| `START-1` | Formatting passes dprint with no diffs              | `pnpm format:check` |
| `START-2` | Typechecking succeeds workspace-wide with no errors | `pnpm typecheck`    |
| `START-3` | All test suites pass                                | `pnpm test`         |
| `START-4` | CI passes on the pushed head; not run locally       | CI: `pnpm check:ci` |

The publishable CLI lives under `apps/`; `packages/` holds the published engine
and the private recipes fixture. `turbo.json` mirrors both roots' `dist/**` as
build outputs — verify with `pnpm gate:dist`.

## End of Session

Commit changes using conventional commits (`<type>(<scope>): <subject>`). Ensure the working tree is clean and pushed; CI runs `pnpm check:ci`, never run it locally.
