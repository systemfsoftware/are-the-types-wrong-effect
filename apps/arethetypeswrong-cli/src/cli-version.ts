declare const __ATTW_CLI_VERSION__: string

/**
 * The manifest version, substituted at build and test time (`tsdown` and
 * `vitest` both `define` it from `manifest-version.ts`), because the npm package
 * ships no `package.json` for a runtime read and no program here may import it.
 */
export const cliVersion: string = __ATTW_CLI_VERSION__
