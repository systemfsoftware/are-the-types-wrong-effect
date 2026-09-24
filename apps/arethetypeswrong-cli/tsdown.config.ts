import { readFileSync } from 'node:fs'

import { Result, Schema } from 'effect'
import { defineConfig } from 'tsdown'

const ManifestVersion = Schema.fromJsonString(Schema.Struct({ version: Schema.String }))
const { version } = Result.getOrThrow(
  Schema.decodeResult(ManifestVersion)(readFileSync(new URL('./package.json', import.meta.url), 'utf8')),
)
const cliVersionDefine = {
  __ATTW_CLI_VERSION__: Result.getOrThrow(Schema.encodeResult(Schema.fromJsonString(Schema.String))(version)),
}

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  clean: true,
  platform: 'node',
  shims: true,
  dts: false,
  define: { 'import.meta.vitest': 'undefined', ...cliVersionDefine },
  outExtensions: () => ({ js: '.mjs' }),
  tsconfig: './tsconfig.build.json',
  deps: {
    alwaysBundle: [/./],
    onlyImport: [/^node:/],
    onlyBundle: false,
  },
})
