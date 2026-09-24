---
"@systemfsoftware/arethetypeswrong-cli": patch
---

The environment no longer supplies defaults for `--registry` and `--ignore-rules`: the config provider that read the `registry` and `ignoreRules` environment values is gone. Move either setting into the configuration file the CLI reads from the working directory, or pass the flag. Every other flag, output format, exit code, and failure document is unchanged.
