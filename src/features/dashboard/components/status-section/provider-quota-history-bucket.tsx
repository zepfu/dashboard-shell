import { useMemo, useState, type ReactElement } from 'react'
import type { UsageReportQuotaHistoryRow } from '../../api/usage-report'
import { fmtIntervalCompact } from '../../lib/quota-bars/fields'
import {
  buildProviderQuotaHistoryTabs,
  formatCompactQuantity,
  quotaHistoryConsumedPct,
  quotaHistoryFillColor,
  quotaHistoryRequests,
} from '../../lib/quota-history-display'
import {
  canonicalProvider,
  providerBrandHex,
} from '../../lib/usage-report-display'

export function ProviderQuotaHistoryBucket({
  provider,
  rows,
  rangeFrom,
  rangeTo,
}: {
  provider: string
  rows: UsageReportQuotaHistoryRow[]
  rangeFrom: string
  rangeTo: string
}): ReactElement {
  const providerColor = providerBrandHex(provider)
  const providerLabel = canonicalProvider(provider)
  const rangeLabel =
    rangeFrom.trim().length > 0 && rangeTo.trim().length > 0
      ? `${rangeFrom} to ${rangeTo}`
      : 'the selected range'
  const quotaTabs = useMemo(
    () => buildProviderQuotaHistoryTabs(provider, rows),
    [provider, rows]
  )
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null)
  const defaultTab =
    quotaTabs.find((tab) => tab.rows.length > 0) ?? quotaTabs[0]
  const selectedTab =
    quotaTabs.find((tab) => tab.tabKey === activeTabKey) ?? defaultTab ?? null
  const selectedRows = selectedTab?.rows ?? []
  const visibleRowCount = quotaTabs.reduce(
    (sum, tab) => sum + tab.rows.length,
    0
  )

  return (
    <article
      className='provider-quota-bucket'
      style={{ borderTopColor: providerColor }}
    >
      <div className='provider-quota-bucket-head'>
        <span style={{ color: providerColor }}>{providerLabel}</span>
        {provider !== providerLabel ? (
          <span className='provider-quota-bucket-raw-key'>{provider}</span>
        ) : null}
        <span>{visibleRowCount.toLocaleString()} bars</span>
      </div>
      {quotaTabs.length === 0 ? null : (
        <div
          role='tablist'
          aria-label={`${provider} quota bars`}
          className='provider-quota-type-tabs'
        >
          {quotaTabs.map((tab) => {
            const selected = selectedTab?.tabKey === tab.tabKey
            return (
              <button
                key={tab.tabKey}
                type='button'
                role='tab'
                aria-selected={selected}
                className={selected ? 'is-active' : undefined}
                onClick={() => {
                  setActiveTabKey(tab.tabKey)
                }}
              >
                <span>{tab.label}</span>
                <span className='provider-quota-type-count'>
                  {tab.rows.length}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div className='provider-quota-bucket-scroll'>
        {selectedRows.length === 0 ? (
          <div className='provider-quota-empty'>
            no quota history for {providerLabel} in {rangeLabel}
          </div>
        ) : (
          selectedRows.map((row) => {
            const consumedPct = quotaHistoryConsumedPct(row)
            const requests = quotaHistoryRequests(row)
            const modelLabel =
              row.quota_key !== undefined && row.quota_key !== null
                ? row.quota_key
                : (row.model ?? 'all models')
            const unitLabel =
              row.quota_unit === 'credits'
                ? 'credits'
                : row.quota_unit === 'requests'
                  ? 'requests'
                  : null
            const identityBits = [
              row.quota_key ?? null,
              row.source ?? null,
              row.client ?? null,
            ].filter((bit): bit is string => Boolean(bit && bit.length > 0))
            const rowIntervalLabel = fmtIntervalCompact(
              row.interval_start,
              row.interval_end
            )
            return (
              <div
                key={[
                  row.provider,
                  row.model ?? 'all',
                  row.quota_type,
                  row.expected_reset_at ?? rowIntervalLabel,
                  row.quota_key ?? '',
                  row.source ?? '',
                ].join('|')}
                className='provider-quota-history-row'
              >
                <div className='provider-quota-history-meta'>
                  <span className='provider-quota-history-label'>
                    {modelLabel}
                  </span>
                  <span className='provider-quota-history-pct'>
                    {consumedPct.toFixed(0)}%
                  </span>
                </div>
                <div className='provider-quota-static-bar'>
                  <div
                    className='provider-quota-static-fill'
                    style={{
                      width: `${consumedPct.toFixed(1)}%`,
                      background: quotaHistoryFillColor(consumedPct),
                    }}
                  />
                </div>
                <div className='provider-quota-history-foot'>
                  <span>{rowIntervalLabel}</span>
                  <span>
                    {formatCompactQuantity(row.usage_tokens)} tok ·{' '}
                    {formatCompactQuantity(requests)} req
                    {unitLabel !== null ? ` · ${unitLabel}` : ''}
                  </span>
                </div>
                {identityBits.length > 0 ? (
                  <div className='provider-quota-history-identity'>
                    {identityBits.join(' · ')}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </article>
  )
}
