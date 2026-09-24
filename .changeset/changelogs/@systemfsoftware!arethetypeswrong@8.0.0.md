## 8.0.0

### Major Changes

- The engine publishes one namespace, `Analysis`. `checkPackage` is gone: `Analysis.make(pkg).run` yields an `Analysis.PackageReport` — an `Analysis.Report`, or an `Analysis.UntypedReport` with `types: false` when a package ships no declarations. Entrypoint selection moved to the spec as combinators (pipeable and data-first), all on `Analysis`: `withEntrypoints`, `includeEntrypoints`, `excludeEntrypoints`, `withTypesCompanion`, and `withLegacyEntrypoints`; `spec.run` is the only execution.

  Failures are values: `ManifestUnreadable`, `CompilerFailed`, and `LexerUnavailable` arrive on the error channel, and `EntrypointsAllExcluded` arrives when the `RegExp` patterns passed to `excludeEntrypoints` remove every entrypoint (string exclusions still yield an empty report). `withModes` is gone — every analysis covers all four resolution kinds — and so are `CheckResult`, the `PackageStore` services, and `parsePackageSpec`; bring a `Package` from `@systemfsoftware/npm-package`. `pos`, `end`, `resolutionMode`, and `visibleProblems` now decode as natural numbers.
