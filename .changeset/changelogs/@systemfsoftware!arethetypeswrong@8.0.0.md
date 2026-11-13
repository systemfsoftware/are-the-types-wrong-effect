# @systemfsoftware/arethetypeswrong@8.0.0

The CLI is now machine-first whenever stdout is not a terminal. A piped `attw` prints one compact JSON envelope instead of a table, failures print a typed JSON document on stderr and exit `1`, and `attw --quiet` reports only through its exit code. A terminal run still prints the tables it always did.

Read `status` in the envelope to tell a typed package from an untyped one — exit code `0` covers both — and add `--include entrypoints,traces` only when you need the entrypoint graph or problem traces. `-f json` forces the envelope on a terminal, `-f table` forces a table on a pipe, and `attw schema` prints the JSON Schema of the input flags and of the envelope.

The analysis engine now constrains the published `programInfo` schema to the shape it actually carries, and `InternalResolutionError` problems decode against the same shape the analysis emits — so consumers of its schemas no longer meet an unconstrained value or a shape mismatch.

`--version` now reports the version of the CLI you installed; it previously printed a fixed number unrelated to the release.

The engine publishes one namespace, `Analysis`. `checkPackage` is gone: `Analysis.make(pkg).run` yields an `Analysis.PackageReport` — an `Analysis.Report`, or an `Analysis.UntypedReport` with `types: false` when a package ships no declarations. Entrypoint selection moved to the spec as combinators (pipeable and data-first), all on `Analysis`: `withEntrypoints`, `includeEntrypoints`, `excludeEntrypoints`, `withTypesCompanion`, and `withLegacyEntrypoints`; `spec.run` is the only execution.

Failures are values: `ManifestUnreadable`, `CompilerFailed`, and `LexerUnavailable` arrive on the error channel, and `EntrypointsAllExcluded` arrives when the `RegExp` patterns passed to `excludeEntrypoints` remove every entrypoint (string exclusions still yield an empty report). `withModes` is gone — every analysis covers all four resolution kinds — and so are `CheckResult`, the `PackageStore` services, and `parsePackageSpec`; bring a `Package` from `@systemfsoftware/npm-package`. `pos`, `end`, `resolutionMode`, and `visibleProblems` now decode as natural numbers.

Release tooling moves to the shared `systemfsoftware/pnpm-release-management` toolchain (CI workflows and root config only); no package code changes and nothing is released
