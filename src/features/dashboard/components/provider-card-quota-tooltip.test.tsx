import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
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
})
