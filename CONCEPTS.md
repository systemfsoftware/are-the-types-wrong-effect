# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Release model

### Workspace

The set of packages this repository version-controls and releases together. Only a workspace package that declares a name and a version and is not marked private is eligible for release; tool-only packages are workspace members but never release candidates.

### Change intent

A file recording that a workspace package is owed a release, authored alongside the change that earns it. It names a package and a bump level — `none` records a change that needs no release. An intent is not itself a release: it is consumed when the Release PR lands, and consumption is recorded separately from the intent file, so the presence of an intent never by itself implies a pending release.

_Avoid:_ changeset — the file format is a changeset, but the concept here is the recorded intent to release.

### Release set

The workspace packages owed a release in the current run — those whose manifest version carries no `<pkg>@vX.Y.Z` git tag yet. Membership is a git fact: a package leaves the set when its tag is written (which the shared release pipeline does as it tags the version and cuts its GitHub Release), not when a branch advances. There is no registry to probe — Nix flakes consumed from git refs are the distribution, so the tag is the record that a version shipped.

### Release phase

The stage the release pipeline decides it is in, derived rather than configured. `release` when the release set is non-empty (tag the untagged versions and cut their GitHub Releases); `version` when nothing is owed but unconsumed change intents remain; `none` when neither holds. The shared toolchain derives the phase from repository state on each push to `main`, so a half-finished release resumes on the next push. An intent file that still exists after consumption is recorded is not pending.

### Released version

A version that carries its `<pkg>@vX.Y.Z` git tag. The tag is the authority on this: the shared release pipeline writes it as it tags the version and cuts the GitHub Release, and a consumer pins it downstream through `flake.lock` (rev + narHash). An untagged manifest version is owed a release; a tagged one is done. Tagging and the GitHub Release are both idempotent on tag existence, so a half-finished release resumes safely on the next push to main.

## Registry resolution

### Scoped name

A package name carrying a scope, written `@scope/name`. A scoped name is a single path segment in a registry URL, so the scope separator must be percent-encoded rather than left literal.

## CLI output contract

### Machine envelope

The single JSON document `attw` writes to stdout on a non-TTY stream: a CLI-owned Schema with an explicit `status` discriminant (`ok` | `untyped`), default-tight fields, and a visible-problem set that agrees with the process exit code by construction. Failures never ride the envelope; they are typed stderr documents.

_Avoid:_ payload, output blob — the envelope is the contract surface `attw schema` describes.
