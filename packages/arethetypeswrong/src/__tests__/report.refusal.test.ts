import { Schema } from 'effect'
import * as Result from 'effect/Result'
import { describe, expect, it } from 'vitest'

import type { ResolutionKind } from '../Problem.schema.js'
import { PackageReport, Report, UntypedReport } from '../Report.schema.js'

const wildcardResolution = (resolutionKind: ResolutionKind) => ({
  name: './features/*',
  resolutionKind,
  isWildcard: true,
})

const validReport: Report = {
  packageName: 'demo',
  packageVersion: '1.0.0',
  buildTools: { tsdown: '1.0.0' },
  types: { kind: 'included' },
  entrypoints: {
    './features/*': {
      subpath: './features/*',
      resolutions: {
        node10: wildcardResolution('node10'),
        'node16-cjs': wildcardResolution('node16-cjs'),
        'node16-esm': wildcardResolution('node16-esm'),
        bundler: wildcardResolution('bundler'),
      },
      hasTypes: false,
      isWildcard: true,
    },
  },
  programInfo: { node10: {}, node16: {}, bundler: {} },
  problems: [],
}

const validUntypedReport: UntypedReport = {
  packageName: 'demo',
  packageVersion: '1.0.0',
  types: false,
}

describe('Report refusal boundary', () => {
  it('refuses a report whose package name is absent', () => {
    expect(
      Result.isFailure(Schema.decodeUnknownResult(Report)({ ...validReport, packageName: undefined })),
    ).toBe(true)
  })

  it('refuses a build tool version that is not a string', () => {
    expect(
      Result.isFailure(Schema.decodeUnknownResult(Report)({ ...validReport, buildTools: { tsdown: 1 } })),
    ).toBe(true)
  })

  it('refuses types of an unknown kind', () => {
    expect(
      Result.isFailure(Schema.decodeUnknownResult(Report)({ ...validReport, types: { kind: 'bogus' } })),
    ).toBe(true)
  })

  it('refuses a companion types entry missing its version', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(Report)({
          ...validReport,
          types: { kind: '@types', packageName: 'demo-types' },
        }),
      ),
    ).toBe(true)
  })

  it('refuses program info whose detected module kind is outside the module kinds', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(Report)({
          ...validReport,
          programInfo: {
            node10: {},
            node16: {
              moduleKinds: {
                '/node_modules/demo/index.js': {
                  detectedKind: 3,
                  detectedReason: 'extension',
                  reasonFileName: '/node_modules/demo/index.js',
                },
              },
            },
            bundler: {},
          },
        }),
      ),
    ).toBe(true)
  })

  it('refuses a problem whose module syntax is outside the module kinds', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(Report)({
          ...validReport,
          problems: [
            {
              kind: 'UnexpectedModuleSyntax',
              fileName: '/node_modules/demo/index.js',
              pos: 0,
              end: 24,
              syntax: 2,
              moduleKind: {
                detectedKind: 1,
                detectedReason: 'extension',
                reasonFileName: '/node_modules/demo/index.js',
              },
            },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('refuses a problem of an unknown kind', () => {
    expect(
      Result.isFailure(Schema.decodeUnknownResult(Report)({ ...validReport, problems: [{ kind: 'NotAProblem' }] })),
    ).toBe(true)
  })

  it('refuses a no-resolution problem missing its entrypoint', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(Report)({ ...validReport, problems: [{ kind: 'NoResolution' }] }),
      ),
    ).toBe(true)
  })

  it('refuses a no-resolution problem carrying an unknown resolution kind', () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(Report)({
          ...validReport,
          problems: [{ kind: 'NoResolution', entrypoint: '.', resolutionKind: 'node12' }],
        }),
      ),
    ).toBe(true)
  })
})

describe('UntypedReport refusal boundary', () => {
  it('refuses an untyped result whose types flag is not false', () => {
    expect(
      Result.isFailure(Schema.decodeUnknownResult(UntypedReport)({ ...validUntypedReport, types: 'false' })),
    ).toBe(true)
  })

  it('refuses an untyped result missing its package version', () => {
    expect(
      Result.isFailure(Schema.decodeUnknownResult(UntypedReport)({ packageName: 'demo', types: false })),
    ).toBe(true)
  })
})

describe('PackageReport refusal boundary', () => {
  it('refuses a payload that is neither a typed nor an untyped report', () => {
    expect(
      Result.isFailure(Schema.decodeUnknownResult(PackageReport)({ packageName: 'demo', packageVersion: '1.0.0' })),
    ).toBe(true)
  })
})
