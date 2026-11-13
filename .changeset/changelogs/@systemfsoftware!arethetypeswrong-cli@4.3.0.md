# @systemfsoftware/arethetypeswrong-cli@4.3.0

The CLI is now machine-first whenever stdout is not a terminal. A piped `attw` prints one compact JSON envelope instead of a table, failures print a typed JSON document on stderr and exit `1`, and `attw --quiet` reports only through its exit code. A terminal run still prints the tables it always did.

Read `status` in the envelope to tell a typed package from an untyped one — exit code `0` covers both — and add `--include entrypoints,traces` only when you need the entrypoint graph or problem traces. `-f json` forces the envelope on a terminal, `-f table` forces a table on a pipe, and `attw schema` prints the JSON Schema of the input flags and of the envelope.

The analysis engine now constrains the published `programInfo` schema to the shape it actually carries, and `InternalResolutionError` problems decode against the same shape the analysis emits — so consumers of its schemas no longer meet an unconstrained value or a shape mismatch.

`--version` now reports the version of the CLI you installed; it previously printed a fixed number unrelated to the release.

The environment no longer supplies defaults for `--registry` and `--ignore-rules`: the config provider that read the `registry` and `ignoreRules` environment values is gone. Move either setting into the configuration file the CLI reads from the working directory, or pass the flag. Every other flag, output format, exit code, and failure document is unchanged.

Release tooling moves to the shared `systemfsoftware/pnpm-release-management` toolchain (CI workflows and root config only); no package code changes and nothing is released
