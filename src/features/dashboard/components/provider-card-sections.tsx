/**
 * ProviderCard layout sub-components (S2-22 decomposition).
 */
import type { ReactElement, ReactNode } from 'react'
import type { UsageReportLocalHealthRow } from '../api/usage-report'
import { fmtCompact } from '../lib/format-utils'
import {
  formatLatency,
  formatUsd,
  providerBrandHex,
} from '../lib/usage-report-display'
import { ReasoningTokenValue } from './primitives/reasoning-token-value'
import {
  fmtPacketLoss,
  hasEarlyReset,
  PACKET_LOSS_STATUS_WARN_THRESHOLD,
} from './provider-card-helpers'
import { QuotaBarRow } from './provider-card-quota-bar-row'
import type {
  AnomalyFlags,
  ProviderCardConfig,
  ProviderMetrics,
  QuotaBarGroup,
  QuotaLane,
  TopModelRow,
} from './provider-card-types'

interface PcSubTitleProps {
  title: string
}

/** Section sub-title with dashed border-top, amber color. */
export function PcSubTitle({ title }: PcSubTitleProps): ReactElement {
  return (
    <div
      className='pc-sub-title'
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--accent-chrome)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginTop: '6px',
        marginBottom: '3px',
        paddingTop: '4px',
        borderTop: '1px dashed var(--border)',
      }}
    >
      {title}
    </div>
  )
}

interface PcMiniRowProps {
  label: string
  /** String or JSX value (e.g. with est-mark asterisk). */
  value: ReactNode
  valueMod?: 'cost' | 'muted' | undefined
}

/** Mini table row: label left, value right. */
export function PcMiniRow({
  label,
  value,
  valueMod,
}: PcMiniRowProps): ReactElement {
  const valueColor =
    valueMod === 'cost'
      ? 'var(--accent-warm)'
      : valueMod === 'muted'
        ? 'var(--fg-muted)'
        : 'var(--fg)'

  return (
    <div
      className='pc-mini-row'
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: '6px',
        alignItems: 'baseline',
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--fg-muted)',
        padding: '1px 0',
      }}
    >
      <span className='label' style={{ color: 'var(--fg-muted)' }}>
        {label}
      </span>
      <span
        className={`value${valueMod !== undefined ? ` ${valueMod}` : ''}`}
        style={{
          textAlign: 'right',
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function localHealthStatusLabel(
  status: UsageReportLocalHealthRow['status']
): string {
  if (status === 'green') return 'healthy'
  if (status === 'yellow') return 'warning'
  return 'down'
}

export function LocalHealthIndicators({
  items,
}: {
  items: UsageReportLocalHealthRow[]
}): ReactElement | null {
  if (items.length === 0) return null

  return (
    <>
      <PcSubTitle title='LOCAL HEALTH' />
      <div className='local-health-list'>
        {items.map((item) => (
          <div
            key={`${item.category}-${item.key}`}
            className={`local-health-chip is-${item.status}`}
            title={[
              item.label,
              localHealthStatusLabel(item.status),
              item.detail,
              item.target,
            ]
              .filter(Boolean)
              .join(' · ')}
            aria-label={`${item.label}: ${localHealthStatusLabel(item.status)}`}
          >
            <span className='local-health-dot' aria-hidden='true' />
            <span className='local-health-label'>{item.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}

interface QuotaSectionTitleProps {
  title: string
}

/** Quota section title with dashed border-top. */
export function QuotaSectionTitle({
  title,
}: QuotaSectionTitleProps): ReactElement {
  return (
    <div
      className='quota-section-title'
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '9px',
        color: 'var(--accent-chrome)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginTop: '6px',
        marginBottom: '3px',
        paddingTop: '4px',
        borderTop: '1px dashed var(--border)',
      }}
    >
      {title}
    </div>
  )
}

interface ProviderMetricProps {
  label: string
  children: ReactNode
  valueColor?: string
}

/** Primary metric row matching mockup .provider-metric pattern. */
export function ProviderMetric({
  label,
  children,
  valueColor,
}: ProviderMetricProps): ReactElement {
  return (
    <div
      className='provider-metric'
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '4px',
        padding: '2px 0',
        color: 'var(--fg-muted)',
        fontSize: 'clamp(9px, 0.5vw, 13px)',
      }}
    >
      <span>{label}</span>
      <span
        className='provider-metric-value'
        style={{
          textAlign: 'right',
          color: valueColor ?? 'var(--fg)',
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {children}
      </span>
    </div>
  )
}

export interface ProviderCardTopModelsPaneProps {
  topModels: TopModelRow[]
  errorCount: number
}

export function ProviderCardTopModelsPane({
  topModels,
  errorCount,
}: ProviderCardTopModelsPaneProps): ReactElement {
  return (
    <div className='card-pane-right' style={{ display: 'none' }}>
      <div
        className='pane-title'
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          color: 'var(--accent-chrome)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          paddingBottom: '4px',
          borderBottom: '1px dashed var(--border)',
          marginBottom: '4px',
        }}
      >
        Top Models
      </div>
      {topModels.map((m) => (
        <div
          key={m.model}
          className='model-mini-row'
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto auto auto',
            columnGap: '6px',
            alignItems: 'baseline',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--fg-muted)',
            padding: '3px 0',
            borderBottom: '1px solid rgba(42,53,71,0.4)',
          }}
        >
          <span
            className='name'
            style={{
              color: 'var(--fg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {m.model}
          </span>
          <span
            className='tok'
            style={{
              color: 'var(--fg)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: '9.5px',
            }}
          >
            {fmtCompact(m.tokens)}
          </span>
          <span
            className='cost'
            style={{
              color: 'var(--fg)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: '9.5px',
            }}
          >
            $
            {m.cost_usd.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <span
            className='p95'
            style={{
              color: 'var(--fg)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: '9.5px',
            }}
          >
            {formatLatency(m.p95_ms)}
          </span>
        </div>
      ))}
      <div className='model-mini-row errors errors-row-only-5k'>
        <span className='name'>{`${errorCount.toLocaleString()} errors`}</span>
      </div>
    </div>
  )
}

export interface ProviderCardQuotasSectionProps {
  quotas: QuotaBarGroup[]
  lanes: QuotaLane[] | undefined
  config: ProviderCardConfig
  anomalies: AnomalyFlags | undefined
}

export function ProviderCardQuotasSection({
  quotas,
  lanes,
  config,
  anomalies,
}: ProviderCardQuotasSectionProps): ReactElement | null {
  const hasQuotaContent =
    lanes !== undefined ? lanes.length > 0 : quotas.length > 0
  if (!hasQuotaContent) return null

  const showEarlyReset =
    anomalies !== undefined &&
    hasEarlyReset(anomalies.earlyReset, config.provider)
  const showCacheStale = anomalies?.cacheStale === true

  return (
    <>
      <QuotaSectionTitle title='Quotas' />
      {(showEarlyReset || showCacheStale) && (
        <div
          className='quota-anomaly-header'
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '4px',
            fontFamily: 'var(--font-mono)',
            fontSize: '8px',
            color: 'var(--fg-muted)',
          }}
        >
          {showEarlyReset && (
            <span
              className='quota-anomaly-icon icon-reset'
              aria-label='early reset'
              title='Early quota reset detected'
              style={{ fontSize: '8px' }}
            >
              ⟲
            </span>
          )}
          {showCacheStale && (
            <span
              className='quota-anomaly-icon icon-cache'
              aria-label='cache stale'
              title='Cache data is stale'
              style={{ fontSize: '8px' }}
            >
              ⚠
            </span>
          )}
        </div>
      )}
      {lanes !== undefined ? (
        <div
          className='quota-lanes'
          style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}
        >
          {lanes.map((lane) => {
            const allBars: Array<{
              bar: QuotaBarGroup
              isPrior: boolean
            }> = []
            if (lane.currentBar !== null) {
              allBars.push({ bar: lane.currentBar, isPrior: false })
            }
            for (const pb of lane.priorBars) {
              allBars.push({ bar: pb, isPrior: true })
            }
            if (allBars.length === 0) return null

            return (
              <div
                key={lane.laneKey}
                className='quota-lane-row'
                style={{ marginTop: '2px' }}
              >
                <div
                  className='quota-lane-label'
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '8.5px',
                    color: 'var(--accent-chrome)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    opacity: 0.7,
                    marginBottom: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {lane.laneLabel}
                </div>
                <div
                  className='quota-lane-bars'
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                  }}
                >
                  {allBars.map(({ bar: quotaBar, isPrior }, barIdx) => (
                    <QuotaBarRow
                      key={
                        quotaBar.resetAt ??
                        `${lane.laneKey}-${isPrior ? 'prior' : 'current'}-${barIdx.toString()}`
                      }
                      quotaBar={quotaBar}
                      isPrior={isPrior}
                      layout='lane'
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <ProviderCardLegacyQuotas quotas={quotas} />
      )}
    </>
  )
}

function ProviderCardLegacyQuotas({
  quotas,
}: {
  quotas: QuotaBarGroup[]
}): ReactElement {
  const currentQuotas = quotas.filter((q) => q.periodType === undefined)
  const historyQuotas = quotas.filter((q) => q.periodType !== undefined)

  const LEGACY_LANE_ORDER: ReadonlyArray<QuotaBarGroup['periodType']> = [
    '5hr',
    'weekly',
    'weekly_overage_included',
    'special',
    'monthly',
  ]
  const LEGACY_LANE_LABEL: Readonly<Record<string, string>> = {
    '5hr': '5hr resets',
    weekly: 'weekly resets',
    weekly_overage_included: 'weekly OI resets',
    special: 'special resets',
    monthly: 'monthly resets',
  }

  return (
    <>
      {currentQuotas.length > 0 && (
        <div
          className='quota-list quota-list-current'
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          {currentQuotas.map((qb, i) => (
            <QuotaBarRow
              key={qb.resetAt ?? `${qb.label}-current-${i.toString()}`}
              quotaBar={qb}
              isPrior={false}
              layout='legacy'
            />
          ))}
        </div>
      )}
      {historyQuotas.length > 0 && (
        <div className='quota-history-lanes' style={{ marginTop: '4px' }}>
          {LEGACY_LANE_ORDER.map((lane) => {
            const laneBars = historyQuotas.filter((q) => q.periodType === lane)
            if (laneBars.length === 0) return null
            return (
              <div key={lane} className={`quota-lane quota-lane-${lane ?? ''}`}>
                <div
                  className='quota-lane-label'
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '8px',
                    color:
                      lane === '5hr'
                        ? 'var(--accent-teal, #2dd4bf)'
                        : 'var(--fg-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    opacity: lane === '5hr' ? 0.85 : 0.55,
                    marginTop: '4px',
                    marginBottom: '2px',
                  }}
                >
                  {LEGACY_LANE_LABEL[lane ?? ''] ?? lane}
                </div>
                <div
                  className='quota-list quota-list-history'
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                  }}
                >
                  {laneBars.map((qb, i) => (
                    <QuotaBarRow
                      key={qb.resetAt ?? `${qb.label}-prior-${i.toString()}`}
                      quotaBar={qb}
                      isPrior
                      layout='legacy'
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export interface ProviderCardMetricsBodyProps {
  config: ProviderCardConfig
  data: ProviderMetrics
  localHealthItems: UsageReportLocalHealthRow[]
  quotas: QuotaBarGroup[]
  lanes: QuotaLane[] | undefined
  anomalies: AnomalyFlags | undefined
  extraPaneLeft: ReactNode | undefined
}

export function ProviderCardMetricsBody({
  config,
  data,
  localHealthItems,
  quotas,
  lanes,
  anomalies,
  extraPaneLeft,
}: ProviderCardMetricsBodyProps): ReactElement {
  const isHealthy =
    data.errors === 0 &&
    (data.packet_loss_pct === null ||
      data.packet_loss_pct < PACKET_LOSS_STATUS_WARN_THRESHOLD)
  const statusColor = isHealthy
    ? providerBrandHex(config.provider)
    : 'var(--accent-hot)'
  const statusGlyph = isHealthy ? '✓' : '✗'

  return (
    <div
      className='card-pane-left'
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <PcSubTitle title='REQUESTS' />
      <div className='pc-mini-table'>
        <PcMiniRow label='requests' value={data.requests.toLocaleString()} />
        <PcMiniRow
          label='requests 90m'
          value={data.recent_requests_90m.toLocaleString()}
        />
      </div>

      {config.provider.toLowerCase() === 'local' ? (
        <LocalHealthIndicators items={localHealthItems} />
      ) : null}

      <ProviderMetric label='p95 Latency'>
        {formatLatency(data.p95_ms)}
      </ProviderMetric>

      <ProviderMetric
        label='Errors'
        valueColor={data.errors > 0 ? 'var(--accent-hot)' : 'var(--fg)'}
      >
        {data.errors.toLocaleString()}
      </ProviderMetric>

      <ProviderMetric label='Rate Limits'>
        {data.rate_limits.toLocaleString()}
      </ProviderMetric>

      <ProviderMetric label='Capacity'>
        {data.capacity.toLocaleString()}
      </ProviderMetric>

      <ProviderMetric label='Packet Loss'>
        {fmtPacketLoss(data.packet_loss_pct)}
      </ProviderMetric>

      <ProviderMetric label='Status'>
        <span style={{ color: statusColor }}>{statusGlyph}</span>
      </ProviderMetric>

      <PcSubTitle title='TOKENS' />
      <div className='pc-mini-table'>
        <PcMiniRow label='in' value={fmtCompact(data.tokens_in)} />
        <PcMiniRow label='out' value={fmtCompact(data.tokens_out)} />
        <PcMiniRow
          label='cost'
          value={formatUsd(data.cost_usd)}
          valueMod='cost'
        />
        <PcMiniRow label='cache in' value={fmtCompact(data.cache_input)} />
        <PcMiniRow
          label='cache creation'
          value={fmtCompact(data.cache_creation)}
        />
        <PcMiniRow
          label='cache miss $'
          value={formatUsd(data.cache_miss_usd)}
          valueMod='cost'
        />
        <PcMiniRow
          label='reasoning'
          value={
            <ReasoningTokenValue
              reported={data.reasoning_reported}
              estimated={data.reasoning_estimated}
            />
          }
        />
      </div>

      <ProviderCardQuotasSection
        quotas={quotas}
        lanes={lanes}
        config={config}
        anomalies={anomalies}
      />

      {extraPaneLeft}
    </div>
  )
}
