import { Schema } from 'effect'
import * as Result from 'effect/Result'
import { describe, expect, it } from 'vitest'

import {
  CJSOnlyExportsDefaultObservation,
  ExportDefaultDisagreementObservation,
  InternalResolutionErrorObservation,
  NamedExportsObservation,
  ResolutionObservation,
  ResolvedModule,
  UnexpectedModuleSyntaxObservation,
} from '../Observation.schema.js'
import type { ModuleKind } from '../Problem.schema.js'

const esmModuleKind: ModuleKind = {
  detectedKind: 99,
  detectedReason: 'type',
  reasonFileName: '/node_modules/demo/package.json',
}
const cjsModuleKind: ModuleKind = {
  detectedKind: 1,
  detectedReason: 'extension',
  reasonFileName: '/node_modules/demo/index.cjs',
}

const resolvedModule: ResolvedModule = {
  fileName: '/node_modules/demo/index.d.ts',
  isTypeScript: true,
  isJson: false,
}

const validResolutionObservation: ResolutionObservation = {
  entrypoint: '.',
  resolutionKind: 'node10',
  isWildcard: false,
  typesResolution: resolvedModule,
  implementationResolution: null,
  node16ModuleKind: null,
}

const validNamedExportsObservation: NamedExportsObservation = {
  resolutionKind: 'node16-esm',
  typesFileName: '/node_modules/demo/index.d.ts',
  implementationFileName: '/node_modules/demo/index.js',
  typesModuleKind: esmModuleKind,
  implementationModuleKind: cjsModuleKind,
  typesIsArrayLikeModule: false,
  typesValueExportNames: ['createThing'],
  implementationExportNames: ['createThing'],
}

const validExportDefaultObservation: ExportDefaultDisagreementObservation = {
  typesFileName: '/node_modules/demo/index.d.ts',
  implementationFileName: '/node_modules/demo/index.js',
  resolutionKind: 'node16-cjs',
  typesModuleKind: cjsModuleKind,
  implementationModuleKind: cjsModuleKind,
  types: {
    hasDefaultExportSymbol: true,
    hasDefaultSymbol: true,
    hasExportEquals: false,
    hasNonDefaultValueExport: false,
    defaultTypeIsObject: true,
    defaultTypeHasCallOrConstructSignatures: false,
  },
  implementation: {
    hasDefault: false,
    exportEqualsSharesContainer: true,
    exportsAreAnalyzable: true,
    hasExportEquals: false,
    exportEqualsIsExportDefault: false,
    moduleExportsTypeHasCallOrConstructSignatures: false,
    hasNonDefaultExport: true,
  },
}

const validInternalResolutionErrorObservation: InternalResolutionErrorObservation = {
  resolutionOption: 'node16',
  fileName: '/node_modules/demo/index.js',
  moduleSpecifier: '#internal',
  pos: 120,
  end: 131,
  resolutionMode: 99,
  trace: ['Entering conditional exports.'],
}

const validUnexpectedModuleSyntaxObservation: UnexpectedModuleSyntaxObservation = {
  fileName: '/node_modules/demo/index.js',
  expectedModuleKind: cjsModuleKind,
  impliedSyntax: 99,
  pos: 0,
  end: 24,
}

const validCjsOnlyExportsDefaultObservation: CJSOnlyExportsDefaultObservation = {
  resolutionKind: 'node16-esm',
  implementationFileName: '/node_modules/demo/index.js',
  isCommonJsOnlyFile: true,
  hasDefaultAndEsModuleMarkers: true,
  hasExportEquals: false,
  defaultDeclarationStart: 0,
  defaultDeclarationEnd: 31,
}

describe('ResolutionObservation refusal boundary', () => {
  it('refuses an empty entrypoint path', () => {
    expect(
      Result.isFailure(Schema.decodeResult(ResolutionObservation)({ ...validResolutionObservation, entrypoint: '' })),
    ).toBe(true)
  })

  it('refuses an unknown resolution kind', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(ResolutionObservation)({ ...validResolutionObservation, resolutionKind: 'node12' }),
      ),
    ).toBe(true)
  })

  it('refuses a wildcard flag that is not a boolean', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(ResolutionObservation)({ ...validResolutionObservation, isWildcard: 'yes' }),
      ),
    ).toBe(true)
  })

  it('refuses a types resolution whose file name is empty', () => {
    expect(
      Result.isFailure(
        Schema.decodeResult(ResolutionObservation)({
          ...validResolutionObservation,
          typesResolution: { ...resolvedModule, fileName: '' },
        }),
      ),
    ).toBe(true)
  })
})

describe('NamedExportsObservation refusal boundary', () => {
  it('refuses an empty types file name', () => {
    expect(
      Result.isFailure(
        Schema.decodeResult(NamedExportsObservation)({ ...validNamedExportsObservation, typesFileName: '' }),
      ),
    ).toBe(true)
  })

  it('refuses a resolution kind that is a resolution option', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(NamedExportsObservation)({
          ...validNamedExportsObservation,
          resolutionKind: 'node16',
        }),
      ),
    ).toBe(true)
  })

  it('refuses implementation export names that are not a list', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(NamedExportsObservation)({
          ...validNamedExportsObservation,
          implementationExportNames: 'createThing',
        }),
      ),
    ).toBe(true)
  })
})

describe('ExportDefaultDisagreementObservation refusal boundary', () => {
  it('refuses an empty implementation file name', () => {
    expect(
      Result.isFailure(
        Schema.decodeResult(ExportDefaultDisagreementObservation)({
          ...validExportDefaultObservation,
          implementationFileName: '',
        }),
      ),
    ).toBe(true)
  })

  it('refuses a types default-export fact that is not a boolean', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(ExportDefaultDisagreementObservation)({
          ...validExportDefaultObservation,
          types: { ...validExportDefaultObservation.types, hasDefaultExportSymbol: 'true' },
        }),
      ),
    ).toBe(true)
  })

  it('refuses an implementation fact block that is not an object', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(ExportDefaultDisagreementObservation)({
          ...validExportDefaultObservation,
          implementation: true,
        }),
      ),
    ).toBe(true)
  })
})

describe('InternalResolutionErrorObservation refusal boundary', () => {
  it('refuses an empty module specifier', () => {
    expect(
      Result.isFailure(
        Schema.decodeResult(InternalResolutionErrorObservation)({
          ...validInternalResolutionErrorObservation,
          moduleSpecifier: '',
        }),
      ),
    ).toBe(true)
  })

  it('refuses a negative source offset', () => {
    expect(
      Result.isFailure(
        Schema.decodeResult(InternalResolutionErrorObservation)({
          ...validInternalResolutionErrorObservation,
          pos: -1,
        }),
      ),
    ).toBe(true)
  })

  it('refuses a fractional source offset', () => {
    expect(
      Result.isFailure(
        Schema.decodeResult(InternalResolutionErrorObservation)({
          ...validInternalResolutionErrorObservation,
          pos: 1.5,
        }),
      ),
    ).toBe(true)
  })

  it('refuses an unknown resolution option', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(InternalResolutionErrorObservation)({
          ...validInternalResolutionErrorObservation,
          resolutionOption: 'node14',
        }),
      ),
    ).toBe(true)
  })

  it('refuses a trace that is not a list', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(InternalResolutionErrorObservation)({
          ...validInternalResolutionErrorObservation,
          trace: 'Entering conditional exports.',
        }),
      ),
    ).toBe(true)
  })
})

describe('UnexpectedModuleSyntaxObservation refusal boundary', () => {
  it('refuses an implied syntax outside the module kinds', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(UnexpectedModuleSyntaxObservation)({
          ...validUnexpectedModuleSyntaxObservation,
          impliedSyntax: 2,
        }),
      ),
    ).toBe(true)
  })

  it('refuses an expected module kind outside the module kinds', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(UnexpectedModuleSyntaxObservation)({
          ...validUnexpectedModuleSyntaxObservation,
          expectedModuleKind: { ...cjsModuleKind, detectedKind: 0 },
        }),
      ),
    ).toBe(true)
  })

  it('refuses a negative indicator offset', () => {
    expect(
      Result.isFailure(
        Schema.decodeResult(UnexpectedModuleSyntaxObservation)({
          ...validUnexpectedModuleSyntaxObservation,
          pos: -1,
        }),
      ),
    ).toBe(true)
  })

  it('refuses an empty inspected file name', () => {
    expect(
      Result.isFailure(
        Schema.decodeResult(UnexpectedModuleSyntaxObservation)({
          ...validUnexpectedModuleSyntaxObservation,
          fileName: '',
        }),
      ),
    ).toBe(true)
  })
})

describe('CJSOnlyExportsDefaultObservation refusal boundary', () => {
  it('refuses an empty implementation file name', () => {
    expect(
      Result.isFailure(
        Schema.decodeResult(CJSOnlyExportsDefaultObservation)({
          ...validCjsOnlyExportsDefaultObservation,
          implementationFileName: '',
        }),
      ),
    ).toBe(true)
  })

  it('refuses a commonjs-only flag that is not a boolean', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(CJSOnlyExportsDefaultObservation)({
          ...validCjsOnlyExportsDefaultObservation,
          isCommonJsOnlyFile: 'yes',
        }),
      ),
    ).toBe(true)
  })

  it('refuses an unknown resolution kind', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(CJSOnlyExportsDefaultObservation)({
          ...validCjsOnlyExportsDefaultObservation,
          resolutionKind: 'esm',
        }),
      ),
    ).toBe(true)
  })
})
