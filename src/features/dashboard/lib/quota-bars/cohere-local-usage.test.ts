import { describe, expect, test } from 'vitest'
import type { CohereLocalUsageReport } from '../../api/usage-report'
import { PROVIDER_LANE_DEFS } from './lane-defs'
import {
  buildCohereLocalUsageLanes,
  buildProviderLanes,
  cohereLocalUsageCardTarget,
} from './lanes'

const ACCOUNT_REF = 'a1b2c3d4e5f6'

function report(
  overrides: Partial<CohereLocalUsageReport> = {}
): CohereLocalUsageReport {
  return {
    provider: 'cohere',
    observationSource: 'locally_counted',
    accounting: 'accepted_success',
    readStatus: 'ok',
    unavailableReason: null,
    sourceFreshness: 'fresh',
    observedAt: '2026-10-19T13:00:00.000Z',
    monthStart: '2026-10-01T00:00:00.000Z',
    monthEnd: '2026-11-01T00:00:00.000Z',
    latestAcceptedAt: '2026-10-19T12:40:00.000Z',
    latestPersistedAt: '2026-10-19T12:40:00.000Z',
    monthlyLimit: 1000,
    rpmWindowSeconds: 60,
    rpmLimitState: 'missing',
    scopesTruncated: false,
    routesTruncated: false,
    modelsTruncated: false,
    scopes: [
      {
        accountRef: ACCOUNT_REF,
        routes: [
          {
            lane: 'cohere_native',
            source: 'codex_cohere_chat_completions_adapter',
          },
        ],
        windows: [
          {
            window: 'monthly',
            period: 'monthly',
            model: null,
            modelScoped: false,
            windowSeconds: null,
            used: 412,
            limit: 1000,
            remaining: 588,
            limitState: 'known',
            dataState: 'known',
            unit: 'requests',
          },
          {
            window: 'rpm',
            period: 'rolling_seconds',
            model: 'command-r-plus',
            modelScoped: true,
            windowSeconds: 60,
            used: 3,
            limit: null,
            remaining: null,
            limitState: 'missing',
            dataState: 'known',
            unit: 'requests',
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe('Cohere locally counted lanes', () => {
  test('does not register a provider quota lane', () => {
    expect(PROVIDER_LANE_DEFS.cohere).toBeUndefined()
    expect(buildProviderLanes('cohere', [], [])).toEqual([])
  })

  test('splits credential-wide monthly counts from exact-model RPM', () => {
    const lanes = buildCohereLocalUsageLanes(report())

    expect(lanes.map((lane) => lane.window)).toEqual(['monthly', 'rpm'])
    expect(lanes[0]).toMatchObject({
      model: null,
      modelScoped: false,
      used: 412,
      limit: 1000,
      remaining: 588,
      limitState: 'known',
      observationSource: 'locally_counted',
      accountRef: ACCOUNT_REF,
    })
    expect(lanes[1]).toMatchObject({
      model: 'command-r-plus',
      modelScoped: true,
      windowSeconds: 60,
      used: 3,
      limit: null,
      remaining: null,
      limitState: 'missing',
    })
    expect(lanes[1]?.routes).toEqual([
      {
        lane: 'cohere_native',
        source: 'codex_cohere_chat_completions_adapter',
      },
    ])
  })

  test('omits lanes when the count is unknown or the source is unavailable', () => {
    const unknown = report({
      scopes: [
        {
          accountRef: ACCOUNT_REF,
          routes: [],
          windows: [
            {
              window: 'monthly',
              period: 'monthly',
              model: null,
              modelScoped: false,
              windowSeconds: null,
              used: null,
              limit: 1000,
              remaining: null,
              limitState: 'known',
              dataState: 'unknown',
              unit: 'requests',
            },
          ],
        },
      ],
    })
    const unavailable = report({
      readStatus: 'unavailable',
      unavailableReason: 'relation_absent',
      sourceFreshness: 'unavailable',
      scopes: [],
    })

    expect(buildCohereLocalUsageLanes(unknown)).toEqual([])
    expect(buildCohereLocalUsageLanes(unavailable)).toEqual([])
    expect(buildCohereLocalUsageLanes(null)).toEqual([])
  })

  test('drops an RPM lane that substitutes a zero limit', () => {
    const substituted = report({
      scopes: [
        {
          accountRef: ACCOUNT_REF,
          routes: [],
          windows: [
            {
              window: 'rpm',
              period: 'rolling_seconds',
              model: 'command-r-plus',
              modelScoped: true,
              windowSeconds: 60,
              used: 3,
              limit: 0,
              remaining: 0,
              limitState: 'missing',
              dataState: 'known',
              unit: 'requests',
            },
          ],
        },
      ],
    })

    expect(buildCohereLocalUsageLanes(substituted)).toEqual([])
  })

  test('chooses a separate card only when Cohere is not already shown', () => {
    expect(cohereLocalUsageCardTarget(['openai'], report())).toBe('separate')
    expect(cohereLocalUsageCardTarget(['cohere'], report())).toBe('existing')
    expect(cohereLocalUsageCardTarget(['cohere'], undefined)).toBe('hidden')
  })
})
