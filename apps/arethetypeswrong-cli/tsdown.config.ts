import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  clean: true,
  platform: 'node',
  shims: true,
  dts: false,
  define: { 'import.meta.vitest': 'undefined' },
  outExtensions: () => ({ js: '.mjs' }),
  tsconfig: './tsconfig.build.json',
  deps: {
    alwaysBundle: [/./],
    onlyImport: [/^node:/],
    onlyBundle: false,
  },
})
