import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { CohereLocalUsageReport } from '../api/usage-report'
import { CohereLocalUsagePanel } from './cohere-local-usage-panel'
import { ProviderCard } from './provider-card'
import type { ProviderMetrics } from './provider-card-types'

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

const emptyMetrics: ProviderMetrics = {
  tokens_in: 0,
  tokens_out: 0,
  cost_usd: null,
  requests: 0,
  errors: 0,
  p95_ms: null,
  cache_input: 0,
  cache_creation: 0,
  cache_miss_usd: 0,
  reasoning_reported: 0,
  reasoning_estimated: 0,
  recent_requests_90m: 0,
  traces: 0,
  rate_limits: 0,
  capacity: 0,
  packet_loss_pct: null,
}

describe('Cohere locally counted usage panel', () => {
  test('renders the monthly cap and a missing RPM limit as different states', () => {
    render(<CohereLocalUsagePanel report={report()} />)

    expect(screen.getByText('Locally counted')).toBeInTheDocument()
    expect(screen.getByText('locally_counted')).toBeInTheDocument()
    expect(screen.getByText('Accepted-call accounting')).toBeInTheDocument()
    expect(screen.getByText('Source fresh')).toBeInTheDocument()
    expect(screen.getByText('412 requests')).toBeInTheDocument()
    expect(screen.getByText('Local cap 1,000')).toBeInTheDocument()
    expect(screen.getByText('Local cap remaining 588')).toBeInTheDocument()
    expect(screen.getByText('3 requests')).toBeInTheDocument()
    expect(screen.getByText('RPM limit unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Local cap remaining 0')).not.toBeInTheDocument()
    expect(
      screen.getAllByText(
        'route cohere_native · codex_cohere_chat_completions_adapter'
      )
    ).toHaveLength(2)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '412')
    expect(screen.getAllByRole('meter')).toHaveLength(1)
  })

  test('renders a stale source without hiding the known count', () => {
    render(
      <CohereLocalUsagePanel report={report({ sourceFreshness: 'stale' })} />
    )

    expect(screen.getByText('Source stale')).toBeInTheDocument()
    expect(screen.getByText('412 requests')).toBeInTheDocument()
  })

  test('renders unavailable and unknown data without a zero count', () => {
    const { rerender } = render(
      <CohereLocalUsagePanel
        report={report({
          readStatus: 'unavailable',
          unavailableReason: 'relation_absent',
          sourceFreshness: 'unavailable',
          scopes: [],
        })}
      />
    )

    expect(screen.getByText('Source unavailable')).toBeInTheDocument()
    expect(
      screen.getByText('Locally counted ledger unavailable')
    ).toBeInTheDocument()
    expect(document.querySelector('.cohere-local-usage-used')).toBeNull()
    expect(screen.queryByText('0 requests')).not.toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()

    rerender(
      <CohereLocalUsagePanel
        report={report({
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
        })}
      />
    )

    expect(screen.getByText('UTC month usage unavailable')).toBeInTheDocument()
    expect(screen.queryByText('0 requests')).not.toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  test('renders inside a quota-only provider card', () => {
    render(
      <ProviderCard
        config={{
          provider: 'cohere',
          color: '#d97706',
          displayName: 'Cohere',
          quotaOnly: true,
        }}
        data={emptyMetrics}
        healthCells={[]}
        extraPaneLeft={<CohereLocalUsagePanel report={report()} />}
      />
    )

    expect(screen.getByText('COHERE')).toBeInTheDocument()
    expect(screen.getByText('412 requests')).toBeInTheDocument()
    expect(screen.getByText('RPM limit unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/^requests$/)).not.toBeInTheDocument()
  })
})
