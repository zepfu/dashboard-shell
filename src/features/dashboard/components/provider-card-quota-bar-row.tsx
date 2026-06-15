/**
 * Unified quota bar row layout (S2-21/S2-22).
 * Preserves lane vs legacy DOM contracts (including prior-bar reset '—').
 */
import type { ReactElement } from 'react'
import { QuotaIntervalBar } from './primitives/quota-interval-bar'
import { pctSeverityClass, quotaBarResetDisplay } from './provider-card-helpers'
import { buildQuotaTooltip } from './provider-card-quota-tooltip'
import type { QuotaBarGroup } from './provider-card-types'

export type QuotaBarRowLayout = 'lane' | 'legacy'

export interface QuotaBarRowProps {
  quotaBar: QuotaBarGroup
  isPrior: boolean
  layout: QuotaBarRowLayout
}

export function QuotaBarRow({
  quotaBar,
  isPrior,
  layout,
}: QuotaBarRowProps): ReactElement {
  const tooltipContent = buildQuotaTooltip(quotaBar)
  const resetDisplay = quotaBarResetDisplay(quotaBar, isPrior)

  if (layout === 'legacy') {
    return (
      <div>
        <div
          className='quota-row'
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 28px 38px',
            columnGap: '6px',
            alignItems: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--fg-muted)',
            lineHeight: '1.15',
          }}
        >
          <div
            className='quota-row-label'
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {quotaBar.label}
            </span>
          </div>
          <span
            className={`quota-row-pct ${pctSeverityClass(quotaBar.consumedPct)}`}
            style={{
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {quotaBar.consumedPct.toFixed(0)}%
          </span>
          <span
            className='quota-row-reset'
            style={{
              textAlign: 'right',
              fontSize: '9px',
              color: 'var(--fg-muted)',
            }}
          >
            {resetDisplay}
          </span>
        </div>
        <QuotaIntervalBar
          intervals={quotaBar.segments}
          tooltipContent={tooltipContent}
          isPrior={isPrior}
        />
      </div>
    )
  }

  return (
    <div
      className={`quota-bar-slot ${isPrior ? 'is-prior-slot' : 'is-current-slot'}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        ...(isPrior
          ? {
              paddingLeft: '6px',
              borderLeft:
                '2px solid var(--accent-chrome, rgba(255,255,255,0.12))',
              opacity: 0.72,
            }
          : {}),
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontFamily: 'var(--font-mono)',
          fontSize: '8px',
          color: 'var(--fg-muted)',
          lineHeight: '1.2',
          gap: '2px',
        }}
      >
        <span
          className={`quota-row-pct ${pctSeverityClass(quotaBar.consumedPct)}`}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {quotaBar.consumedPct.toFixed(0)}%
        </span>
        <span
          className='quota-row-reset'
          style={{
            fontSize: '7.5px',
            color: 'var(--fg-muted)',
            opacity: 0.7,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flexShrink: 1,
          }}
        >
          {resetDisplay}
        </span>
      </div>
      {isPrior && quotaBar.dateRangeLabel !== undefined && (
        <span
          className='quota-row-date-range'
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '6.5px',
            color: 'var(--fg-muted)',
            opacity: 0.55,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: '1.2',
            letterSpacing: '0.02em',
          }}
        >
          {quotaBar.dateRangeLabel}
        </span>
      )}
      <QuotaIntervalBar
        intervals={quotaBar.segments}
        tooltipContent={tooltipContent}
        isPrior={isPrior}
      />
    </div>
  )
}
