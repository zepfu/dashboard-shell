import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import {
  fetchUsageReportQuotas,
  type CohereLocalUsageReport,
} from './usage-report'

const ACCOUNT_REF = 'a1b2c3d4e5f6'

function quotasMetadata() {
  return {
    generatedAt: '2026-10-19T13:00:00.000Z',
    latestRecordAt: '2026-10-19T12:40:00.000Z',
    latestRecordAgeMinutes: 20,
    latestRecordStale: false,
    staleRecordThresholdMinutes: 120,
  }
}

function localUsage(
  overrides: Partial<CohereLocalUsageReport> = {}
): CohereLocalUsageReport {
  return {
    provider: 'cohere',
    observationSource: 'locally_counted',
    accounting: 'accepted_success',
    readStatus: 'ok',
    unavailableReason: null,
    sourceFreshness: 'stale',
    observedAt: '2026-10-19T13:00:00.000Z',
    monthStart: '2026-10-01T00:00:00.000Z',
    monthEnd: '2026-11-01T00:00:00.000Z',
    latestAcceptedAt: '2026-10-19T08:00:00.000Z',
    latestPersistedAt: '2026-10-19T08:00:00.000Z',
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

describe('Cohere locally counted quotas API', () => {
  test('accepts monthly counts, missing RPM limits, and a stale source', async () => {
    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({
          metadata: quotasMetadata(),
          quotas: [],
          cohereLocalUsage: localUsage(),
        })
      )
    )

    await expect(fetchUsageReportQuotas()).resolves.toMatchObject({
      cohereLocalUsage: {
        observationSource: 'locally_counted',
        accounting: 'accepted_success',
        sourceFreshness: 'stale',
        rpmLimitState: 'missing',
      },
    })
  })

  test('accepts an unavailable source with no scopes', async () => {
    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({
          metadata: quotasMetadata(),
          quotas: [],
          cohereLocalUsage: localUsage({
            readStatus: 'unavailable',
            unavailableReason: 'relation_absent',
            sourceFreshness: 'unavailable',
            observedAt: null,
            monthStart: null,
            monthEnd: null,
            latestAcceptedAt: null,
            latestPersistedAt: null,
            scopes: [],
          }),
        })
      )
    )

    await expect(fetchUsageReportQuotas()).resolves.toMatchObject({
      cohereLocalUsage: {
        readStatus: 'unavailable',
        scopes: [],
      },
    })
  })

  test('rejects credential material and a zero RPM limit', async () => {
    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({
          metadata: quotasMetadata(),
          quotas: [],
          cohereLocalUsage: {
            ...localUsage(),
            credential_scope: 'scope-name-not-returned',
          },
        })
      )
    )

    await expect(fetchUsageReportQuotas()).rejects.toThrow(/private field/)

    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({
          metadata: quotasMetadata(),
          quotas: [],
          cohereLocalUsage: localUsage({
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
          }),
        })
      )
    )

    await expect(fetchUsageReportQuotas()).rejects.toThrow(/missing limit/)
  })

  test('rejects an unknown count that carries a zero', async () => {
    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({
          metadata: quotasMetadata(),
          quotas: [],
          cohereLocalUsage: localUsage({
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
                    used: 0,
                    limit: 1000,
                    remaining: 1000,
                    limitState: 'known',
                    dataState: 'unknown',
                    unit: 'requests',
                  },
                ],
              },
            ],
          }),
        })
      )
    )

    await expect(fetchUsageReportQuotas()).rejects.toThrow(/unknown data/)
  })
})
