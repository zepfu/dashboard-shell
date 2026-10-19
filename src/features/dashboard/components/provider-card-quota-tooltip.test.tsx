import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { UsageReportQuotaHistoryRow } from '../api/usage-report'
import { buildPriorBarFromHistory } from '../lib/quota-bars/lanes'
import { buildQuotaTooltip } from './provider-card-quota-tooltip'
import type { QuotaBarGroup } from './provider-card-types'

function quotaBar(overrides: Partial<QuotaBarGroup> = {}): QuotaBarGroup {
  return {
    label: '5-hour Quota Units',
    consumedPct: 20,
    remainingPct: 80,
    segments: [],
    ...overrides,
  }
}

describe('D1-492 quota tooltip absolutes', () => {
  test('renders Kimi Code limit, used, remaining, and quota-units semantics', () => {
    render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            tipQuotaLimit: 100,
            tipQuotaUsed: 20.25,
            tipQuotaRemaining: 79.75,
            tipQuotaUnit: 'quota_units',
          })
        )}
      </div>
    )

    expect(screen.getByText('quota limit')).toBeInTheDocument()
    expect(screen.getByText('100 quota units')).toBeInTheDocument()
    expect(screen.getByText('quota used')).toBeInTheDocument()
    expect(screen.getByText('20.25 quota units')).toBeInTheDocument()
    expect(screen.getByText('quota remaining')).toBeInTheDocument()
    expect(screen.getByText('79.75 quota units')).toBeInTheDocument()
  })

  test('uses quota-units unavailable wording for null Kimi absolutes', () => {
    render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            tipQuotaUnit: 'quota_units',
            tipQuotaLimit: null,
            tipQuotaUsed: null,
            tipQuotaRemaining: null,
            tipAbsolutesUnavailable: true,
          })
        )}
      </div>
    )

    expect(screen.getByText('quota units: unavailable')).toBeInTheDocument()
    expect(screen.queryByText('credits: unavailable')).not.toBeInTheDocument()
  })

  test('preserves Alibaba credits unavailable wording', () => {
    render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            label: '5-hour Credits',
            tipQuotaUnit: 'credits',
            tipAbsolutesUnavailable: true,
          })
        )}
      </div>
    )

    expect(screen.getByText('credits: unavailable')).toBeInTheDocument()
  })

  test('renders missing persisted model cost as unavailable', () => {
    const { container } = render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            tipModels: [
              {
                model: 'claude-sonnet-4-6',
                costDelta: '—',
                requests: 1,
              },
            ],
          })
        )}
      </div>
    )

    const costValues = container.querySelectorAll('.v9-tip-row .t-count')
    expect(costValues[1]?.textContent).toBe('—')
  })
})

describe('D1-502 quota tooltip billing period', () => {
  test('renders explicit billing bounds apart from the reset window', () => {
    const { container } = render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            tipWindow: '7/24 12:00 → 7/24 17:00',
            resetAt: '2026-07-24T17:22:00.000Z',
            tipQuotaLimit: 100,
            tipQuotaUsed: 20.25,
            tipQuotaRemaining: 79.75,
            tipQuotaUnit: 'quota_units',
            tipObservedAt: '2026-07-24T12:00:00.000Z',
            tipBillingPeriodStartAt: '2026-07-01T04:00:00.000Z',
            tipBillingPeriodEndAt: '2026-07-08T04:00:00.000Z',
          })
        )}
      </div>
    )

    const billing = container.querySelector('.quota-tip-billing-period')
    const head = container.querySelector('.v9-tip-head')
    const reset = container.querySelector('.quota-tip-reset')
    expect(billing?.textContent).toBe(
      'billing period 2026-07-01 00:00 → 2026-07-08 00:00'
    )
    expect(head?.textContent).toContain('7/24 12:00 → 7/24 17:00')
    expect(billing?.textContent).not.toContain('7/24 12:00 → 7/24 17:00')
    expect(reset?.textContent).toMatch(/^resets /)
    expect(reset?.textContent).not.toContain('billing period')
    expect(screen.getByText('100 quota units')).toBeInTheDocument()
    expect(screen.getByText('20.25 quota units')).toBeInTheDocument()
    expect(screen.getByText('79.75 quota units')).toBeInTheDocument()
    expect(
      container.querySelector('.quota-tip-freshness')?.textContent
    ).toMatch(/^observed /)
  })

  test('shows a partial billing bound as unavailable instead of the reset time', () => {
    const { container } = render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            tipWindow: '7/24 12:00 → 7/24 17:00',
            resetAt: '2026-07-24T17:22:00.000Z',
            tipBillingPeriodStartAt: '2026-07-01T04:15:00.000Z',
            tipBillingPeriodUnavailable: true,
          })
        )}
      </div>
    )

    expect(
      container.querySelector('.quota-tip-billing-period')?.textContent
    ).toBe('billing period start 2026-07-01 00:15 · end unavailable')
    expect(container.textContent).not.toContain('2026-07-24 13:22')
  })

  test('renders a far-future billing end as that timestamp', () => {
    const { container } = render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            tipWindow: '7/1 00:00 → 7/19 09:40',
            tipBillingPeriodStartAt: '2026-07-01T04:00:00.000Z',
            tipBillingPeriodEndAt: '9999-12-31T00:00:00.000Z',
          })
        )}
      </div>
    )

    const billing = container.querySelector('.quota-tip-billing-period')
    expect(billing?.textContent).toBe(
      'billing period 2026-07-01 00:00 → 9999-12-30 19:00'
    )
    expect(billing?.textContent).not.toContain('7/1 00:00 → 7/19 09:40')
  })

  test('shows unavailable billing bounds for percentage-only details', () => {
    const { container } = render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            label: '5-hour Credits',
            tipWindow: '7/21 17:00 → 7/22 02:00',
            resetAt: '2026-07-22T02:22:00.000Z',
            tipQuotaUnit: 'credits',
            tipAbsolutesUnavailable: true,
            tipBillingPeriodUnavailable: true,
            tipObservedAt: '2026-07-21T22:39:00.000Z',
            showSubPercentPrecision: true,
            remainingPct: 99.96,
            consumedPct: 0.04,
          })
        )}
      </div>
    )

    expect(screen.getByText('credits: unavailable')).toBeInTheDocument()
    expect(
      container.querySelector('.quota-tip-billing-period')?.textContent
    ).toBe('billing period: unavailable')
    expect(
      container.querySelector('.quota-tip-freshness')?.textContent
    ).toMatch(/^observed /)
    expect(
      container.querySelector('.quota-tip-billing-period')?.textContent
    ).not.toContain('7/21')
    expect(container.textContent).not.toContain('tokens')
    expect(container.textContent).not.toContain('$')
  })

  test('keeps count and wtus units beside an explicit billing period', () => {
    const { container } = render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            label: 'WTUs',
            tipQuotaUnit: 'wtus',
            tipQuotaLimit: 50,
            tipQuotaUsed: 10,
            tipQuotaRemaining: 40,
            tipBillingPeriodStartAt: '2026-07-01T04:00:00.000Z',
            tipBillingPeriodEndAt: '2026-07-01T09:00:00.000Z',
          })
        )}
      </div>
    )

    expect(screen.getByText('50 wtus')).toBeInTheDocument()
    expect(screen.getByText('10 wtus')).toBeInTheDocument()
    expect(screen.getByText('40 wtus')).toBeInTheDocument()
    expect(
      container.querySelector('.quota-tip-billing-period')?.textContent
    ).toBe('billing period 2026-07-01 00:00 → 2026-07-01 05:00')
    expect(container.textContent).not.toContain('tokens')
    expect(container.textContent).not.toContain('$')
  })

  test('leaves billing period absent for unknown and historical bars', () => {
    const unknown = render(
      <div>
        {buildQuotaTooltip(
          quotaBar({
            tipWindow: '7/24 12:00 → 7/24 17:00',
            resetAt: '2026-07-24T17:22:00.000Z',
          })
        )}
      </div>
    )
    expect(unknown.container.textContent).not.toContain('billing period')
    unknown.unmount()

    const history: UsageReportQuotaHistoryRow = {
      provider: 'kimi_code',
      model: null,
      quota_type: 'short',
      quota_key: 'kimi_code_5h:quota_units',
      quota_period: '5h',
      source: 'kimi_code_usage',
      client: 'kimi-code',
      quota_unit: 'quota_units',
      quota_limit: 100,
      quota_used: 20,
      quota_remaining: 80,
      expected_reset_at: '2026-07-24T17:22:00.000Z',
      interval_start: '2026-07-24T12:22:00.000Z',
      interval_end: '2026-07-24T17:22:00.000Z',
      min_remaining_pct: 80,
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    }
    const prior = buildPriorBarFromHistory(history, 'kimi_code')
    const historical = render(<div>{buildQuotaTooltip(prior)}</div>)

    expect(prior.tipBillingPeriodStartAt).toBeUndefined()
    expect(prior.tipBillingPeriodUnavailable).toBeUndefined()
    expect(prior.resetAt).toBe(history.expected_reset_at)
    expect(historical.container.textContent).not.toContain('billing period')
    expect(screen.getByText('100 quota units')).toBeInTheDocument()
    expect(
      historical.container.querySelector('.v9-tip-head')?.textContent
    ).toContain('→')
  })
})
