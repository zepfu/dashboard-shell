import { useMemo, useState, type ReactElement } from 'react'
import type {
  UsageReportQuotaEstimatorEstimate,
  UsageReportQuotaEstimatorOperational,
  UsageReportQuotaEstimatorResponse,
  UsageReportQuotaForecastStatus,
  UsageReportQuotaForecastTokenCategory,
} from '../../api/usage-report'
import {
  canonicalProvider,
  providerBrandHex,
} from '../../lib/usage-report-display'
import { STATUS_PILL_FALLBACK, StatusPanel, statusPill } from './section-chrome'

const FORECAST_STATUS_PILL = {
  high_confidence: { label: 'High confidence', className: 'is-healthy' },
  directional_only: { label: 'Directional only', className: 'is-warn' },
  not_identifiable: { label: 'Not identifiable', className: 'is-bad' },
} as const

const TOKEN_CATEGORY_LABEL: Record<
  UsageReportQuotaForecastTokenCategory,
  string
> = {
  uncached_input: 'uncached input',
  cache_read: 'cache read',
  cache_create: 'cache create/write',
  output: 'output',
  reasoning: 'reasoning',
}

const WEIGHT_SOURCE_LABEL = {
  promoted_phase_2: 'Promoted Phase 2 weights',
  held_pending_data_quality: 'Held pending data-quality checks',
  withheld: 'Withheld',
} as const

type ForecastFilter = 'all' | 'anthropic' | 'openai_all_model' | 'openai_spark'

const FORECAST_FILTERS: Array<{ id: ForecastFilter; label: string }> = [
  { id: 'all', label: 'All lanes' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai_all_model', label: 'OpenAI all-model' },
  { id: 'openai_spark', label: 'OpenAI Codex Spark' },
]

function formatForecastPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(2)}%`
}

function formatForecastNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return value.toFixed(3)
}

function formatStatusLabel(status: string | null | undefined): string {
  if (status === 'high_confidence') return 'High confidence'
  if (status === 'directional_only') return 'Directional only'
  if (status === 'not_identifiable') return 'Not identifiable'
  if (status === 'consistent') return 'Consistent'
  if (status === 'anomalous') return 'Anomalous'
  if (status == null || status === '') return '—'
  return status
}

function forecastFilterKey(
  estimate: UsageReportQuotaEstimatorEstimate
): ForecastFilter | 'other' {
  const provider = canonicalProvider(estimate.provider).toLowerCase()
  const laneFamily = estimate.operational?.lane_family
  if (provider === 'anthropic' || provider === 'claude') return 'anthropic'
  if (provider === 'openai' && laneFamily === 'codex_spark') {
    return 'openai_spark'
  }
  if (provider === 'openai' && laneFamily === 'all_model') {
    return 'openai_all_model'
  }
  return 'other'
}

function ForecastStatusPill({
  status,
}: {
  status: UsageReportQuotaForecastStatus | string | null | undefined
}): ReactElement {
  const pill = statusPill(FORECAST_STATUS_PILL, status, STATUS_PILL_FALLBACK)
  return (
    <span
      className={`status-pill ${pill.className}`}
      data-testid='quota-forecast-status'
      role='status'
    >
      {pill.label === 'unknown' ? formatStatusLabel(status) : pill.label}
    </span>
  )
}

function ForecastLane({
  estimate,
}: {
  estimate: UsageReportQuotaEstimatorEstimate
}): ReactElement {
  const operational = estimate.operational
  if (!operational) {
    return (
      <article
        className='status-estimator-lane'
        data-testid='quota-forecast-lane'
      >
        <div className='status-estimator-lane-head'>
          <span style={{ color: providerBrandHex(estimate.provider) }}>
            {canonicalProvider(estimate.provider)}
          </span>
          <span>{estimate.quota_lane}</span>
        </div>
        <span className='status-estimator-muted'>
          Forecast unavailable. The Phase 2 operational payload is absent, so no
          burn figure is shown.
        </span>
      </article>
    )
  }

  return (
    <article
      className='status-estimator-lane'
      data-testid='quota-forecast-lane'
    >
      <ForecastLaneBody
        operational={operational}
        provider={estimate.provider}
      />
    </article>
  )
}

function ForecastLaneBody({
  operational,
  provider,
}: {
  operational: UsageReportQuotaEstimatorOperational
  provider: string
}): ReactElement {
  const visibleAlerts = operational.alerts.filter((alert) => !alert.suppressed)
  const families = [
    ...new Set(operational.weights.map((weight) => weight.model_family)),
  ]
  const freshness = operational.observation.freshness
  const ageLabel =
    freshness.observation_age_minutes === null
      ? 'age unknown'
      : `${freshness.observation_age_minutes.toLocaleString()}m old`
  const freshLabel = freshness.stale ? 'stale' : 'fresh'

  return (
    <>
      <div className='status-estimator-lane-head'>
        <span style={{ color: providerBrandHex(provider) }}>
          {canonicalProvider(provider)}
        </span>
        <span>{operational.lane_label}</span>
      </div>
      <div className='status-estimator-lane-key'>
        {operational.warning_scope}
      </div>
      <ForecastStatusPill status={operational.forecast.status} />
      <div className='status-estimator-meta-grid'>
        <span>
          observed <strong>{operational.observation.observed_at ?? '—'}</strong>
        </span>
        <span>
          lag{' '}
          <strong>
            {operational.observation.lag_assumption_minutes ?? '—'}m
          </strong>
        </span>
        <span>
          freshness <strong>{freshLabel}</strong> · {ageLabel}
        </span>
      </div>
      <div className='status-estimator-meta-grid'>
        <span>
          trainable{' '}
          <strong>{freshness.trainable_interval_count.toLocaleString()}</strong>
        </span>
        <span>
          effective sample{' '}
          <strong>
            {freshness.effective_sample_size === null
              ? '—'
              : freshness.effective_sample_size.toLocaleString()}
          </strong>
        </span>
        <span>
          sample cap <strong>{freshness.sample_cap.toLocaleString()}</strong>
        </span>
      </div>
      <div className='status-estimator-block'>
        <strong>Quota burn forecast</strong>
        <span data-testid='quota-forecast-burn'>
          next-interval burn{' '}
          {formatForecastPercent(
            operational.forecast.forecast_next_interval_burn_pct
          )}
        </span>
        <span>
          residual {formatForecastPercent(operational.forecast.residual_pct)}
        </span>
        <span>
          {WEIGHT_SOURCE_LABEL[operational.weight_source] ??
            operational.weight_source}
        </span>
        <span className='status-estimator-muted'>
          Phase 2-derived from the latest trainable token mix. This is not an
          observed quota bar.
        </span>
      </div>
      <div className='status-estimator-block'>
        <strong>Model-family weights</strong>
        {families.length === 0 ? (
          <span className='status-estimator-muted'>none</span>
        ) : (
          families.map((family) => {
            const rows = operational.weights.filter(
              (weight) => weight.model_family === family
            )
            const ratio = operational.cache_read_vs_uncached_input_ratios.find(
              (entry) => entry.model_family === family
            )
            return (
              <div key={family} className='status-estimator-family'>
                <div className='status-estimator-family-name'>{family}</div>
                {rows.map((row) => (
                  <span
                    key={`${family}-${row.token_category}`}
                    className='status-estimator-row'
                  >
                    {TOKEN_CATEGORY_LABEL[row.token_category]}:{' '}
                    {formatForecastPercent(row.coefficient_pct_per_mtok)} / M
                    tok ({formatStatusLabel(row.estimate_status)})
                  </span>
                ))}
                <span className='status-estimator-row'>
                  cache-read / uncached input:{' '}
                  {formatForecastNumber(
                    ratio?.cache_read_vs_uncached_input_ratio
                  )}{' '}
                  ({formatStatusLabel(ratio?.status)})
                </span>
              </div>
            )
          })
        )}
      </div>
      <div className='status-estimator-block'>
        <strong>Data-quality alerts</strong>
        {visibleAlerts.length === 0 ? (
          <span className='status-estimator-muted'>none</span>
        ) : (
          visibleAlerts.map((alert) => (
            <span
              key={`${alert.code}-${alert.warning_scope}`}
              className='status-estimator-row'
              data-testid='quota-forecast-alert'
            >
              {alert.severity}: {alert.code} · {alert.detail}
            </span>
          ))
        )}
      </div>
    </>
  )
}

export function QuotaEstimatorForecastPanel({
  response,
  loading,
}: {
  response: UsageReportQuotaEstimatorResponse | undefined
  loading: boolean
}): ReactElement {
  const [filter, setFilter] = useState<ForecastFilter>('all')
  const estimates = response?.estimates
  const visibleEstimates = useMemo(
    () =>
      (estimates ?? []).filter((estimate) => {
        if (filter === 'all') return true
        return forecastFilterKey(estimate) === filter
      }),
    [estimates, filter]
  )
  const hasEstimates = (estimates?.length ?? 0) > 0

  if (loading && !hasEstimates) {
    return (
      <div className='status-estimator-empty' role='status'>
        Loading Phase 2 quota burn forecast…
      </div>
    )
  }

  if (!loading && !hasEstimates) {
    return (
      <div className='status-estimator-empty' role='status'>
        No Phase 2 quota burn forecasts for the selected range.
      </div>
    )
  }

  const leadStatus = visibleEstimates[0]?.operational?.forecast.status
  const headPill = statusPill(
    FORECAST_STATUS_PILL,
    leadStatus,
    STATUS_PILL_FALLBACK
  )

  return (
    <StatusPanel
      className='status-estimator-panel status-forecast-panel'
      ariaLabel='Phase 2 quota burn forecast'
      title='Phase 2 quota burn forecast'
      subLabel='Phase 2-derived rolling estimate · interval-censored and state-space confidence are not used'
      headPill={headPill}
    >
      <p className='status-forecast-note'>
        Provider Status quota bars remain the observed quota. This forecast does
        not replace those bars.
      </p>
      <div
        className='status-forecast-filters'
        role='group'
        aria-label='Quota forecast lane filters'
      >
        {FORECAST_FILTERS.map((entry) => (
          <button
            key={entry.id}
            type='button'
            className={`status-forecast-filter${
              filter === entry.id ? 'is-selected' : ''
            }`}
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {visibleEstimates.length === 0 ? (
        <div className='status-estimator-muted' role='status'>
          No forecasts in this lane filter.
        </div>
      ) : (
        <div className='status-estimator-grid'>
          {visibleEstimates.map((estimate, index) => (
            <ForecastLane
              key={[
                estimate.provider,
                estimate.quota_key,
                estimate.quota_type,
                estimate.quota_lane,
                index,
              ].join('|')}
              estimate={estimate}
            />
          ))}
        </div>
      )}
    </StatusPanel>
  )
}
