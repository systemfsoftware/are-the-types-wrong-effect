# Changesets

This directory holds change-intent files consumed by pnpm-native workspace
versioning (`pnpm version -r`). One file per change, authored with:

```
pnpm change --bump <none|patch|minor|major> --summary "<changelog entry>" [<pkg>...]
```

- A PR that changes anything under an application or package path MUST ship with
  an intent here. Root tooling is outside the verdict.
- `--bump none` records a change that needs no release. A `none` on a
  behavior-visible change is the same silent non-release the gate exists to
  catch.
- Intents are consumed by `pnpm version -r` when the Release PR
  lands: consumption is recorded in `ledger.yaml` and the intent files
  are retained, so a present intent alone never implies a pending release.
- This README is NOT a changeset: the gate requires a file whose frontmatter
  parses as `"<pkg>": <none|patch|minor|major>`.

The release pipeline is the shared toolchain in
`systemfsoftware/pnpm-release-management`, consumed as a reusable workflow
(`.github/workflows/release.yml` and `changeset-check.yml` are thin callers
pinned to its `prm/toolchain` ref). On a push to `main` it opens or updates the
version PR when intents are pending, and otherwise tags each released version
`<pkg>@vX.Y.Z` and cuts a GitHub Release from its authored changelog. A version
with no such tag is what the pipeline treats as owed a release.

Distribution is Nix flakes consumed from git refs, not an npm registry: the git
tag, pinned downstream by a consumer's `flake.lock` rev + narHash, is the
durable record that a version shipped. There is no registry step to debut a
package.
