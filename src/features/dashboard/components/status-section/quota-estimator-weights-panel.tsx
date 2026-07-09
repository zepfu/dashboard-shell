import type { ReactElement } from 'react'
import type {
  UsageReportQuotaEstimatorCoefficient,
  UsageReportQuotaEstimatorEstimate,
  UsageReportQuotaEstimatorResponse,
} from '../../api/usage-report'
import { quotaTypeToLaneKey } from '../../lib/quota-bars/fields'
import { PROVIDER_LANE_DEFS } from '../../lib/quota-bars/lane-defs'
import {
  canonicalProvider,
  providerBrandHex,
} from '../../lib/usage-report-display'
import { STATUS_PILL_FALLBACK, StatusPanel, statusPill } from './section-chrome'

const ESTIMATOR_IDENT_PILL = {
  high_confidence: { label: 'high_confidence', className: 'is-healthy' },
  directional_only: { label: 'directional_only', className: 'is-warn' },
  not_identifiable: { label: 'not_identifiable', className: 'is-bad' },
} as const

function formatEstimatorPercent(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(decimals)}%`
}

function formatEstimatorNumber(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return value.toFixed(decimals)
}

function formatEstimatorStatusLabel(status: string): string {
  switch (status) {
    case 'high_confidence':
      return 'high_confidence'
    case 'directional_only':
      return 'directional_only'
    case 'not_identifiable':
      return 'not_identifiable'
    case 'evaluated':
      return 'evaluated'
    case 'not_enough_holdout_data':
      return 'holdout pending'
    case 'anomalous':
      return 'anomalous'
    case 'consistent':
      return 'consistent'
    default:
      return status
  }
}

function quotaEstimatorLaneLabel(
  estimate: UsageReportQuotaEstimatorEstimate
): string {
  const providerKey = canonicalProvider(estimate.provider).toLowerCase()
  const laneKey = quotaTypeToLaneKey(estimate.quota_type)
  const defs = PROVIDER_LANE_DEFS[providerKey]
  if (defs) {
    const match = defs.find((def) => {
      const defLaneKey =
        def.laneKey.split('/').slice(1).join('/') || def.quotaType
      return (
        quotaTypeToLaneKey(def.quotaType) === laneKey ||
        defLaneKey === laneKey ||
        def.quotaType === estimate.quota_type
      )
    })
    if (match) return match.laneLabel
  }
  return estimate.quota_lane
}

function groupEstimatorCoefficients(
  coefficients: UsageReportQuotaEstimatorCoefficient[]
): Array<{
  tokenCategory: UsageReportQuotaEstimatorCoefficient['token_category']
  families: Array<{
    modelFamily: string
    rows: UsageReportQuotaEstimatorCoefficient[]
  }>
}> {
  const byCategory = new Map<
    UsageReportQuotaEstimatorCoefficient['token_category'],
    Map<string, UsageReportQuotaEstimatorCoefficient[]>
  >()

  for (const coefficient of coefficients) {
    const category = coefficient.token_category
    const familyRows = byCategory.get(category) ?? new Map()
    const family = coefficient.model_family || 'unknown'
    const rows = familyRows.get(family) ?? []
    rows.push(coefficient)
    familyRows.set(family, rows)
    byCategory.set(category, familyRows)
  }

  return [...byCategory.entries()].map(([tokenCategory, familyRows]) => ({
    tokenCategory,
    families: [...familyRows.entries()]
      .map(([modelFamily, rows]) => ({
        modelFamily,
        rows: rows.sort((a, b) =>
          a.estimate_kind.localeCompare(b.estimate_kind)
        ),
      }))
      .sort((a, b) => a.modelFamily.localeCompare(b.modelFamily)),
  }))
}

export function QuotaEstimatorWeightsPanel({
  response,
  loading,
}: {
  response: UsageReportQuotaEstimatorResponse | undefined
  loading: boolean
}): ReactElement {
  const estimates = response?.estimates ?? []
  const metadata = response?.metadata
  const hasEstimates = estimates.length > 0

  if (loading && !hasEstimates) {
    return (
      <div className='status-estimator-empty' role='status'>
        Loading Phase 0-2 estimator detail…
      </div>
    )
  }

  if (!loading && !hasEstimates) {
    return (
      <div className='status-estimator-empty' role='status'>
        No Phase 0-2 estimator lanes for the selected range.
      </div>
    )
  }

  const subLabel = `${metadata?.phase === '0-2' ? 'Phase 0-2' : 'Phase unknown'} · ${
    metadata?.estimatorVersion ?? 'version unknown'
  }`
  const headPill = statusPill(
    ESTIMATOR_IDENT_PILL,
    estimates[0]?.identifiability.status,
    STATUS_PILL_FALLBACK
  )

  return (
    <StatusPanel
      className='status-estimator-panel'
      ariaLabel='Phase 0-2 estimator detail'
      title='Phase 0-2 estimator detail'
      subLabel={subLabel}
      headPill={headPill}
    >
      <div className='status-estimator-grid'>
        {estimates.map((estimate, index) => {
          const identStatus = estimate.identifiability.status
          const lanePill = statusPill(
            ESTIMATOR_IDENT_PILL,
            identStatus,
            STATUS_PILL_FALLBACK
          )
          const coefficientGroups = groupEstimatorCoefficients(
            estimate.coefficients
          )

          return (
            <article
              key={[
                estimate.provider,
                estimate.quota_key,
                estimate.quota_type,
                estimate.quota_lane,
                estimate.selected_lag_minutes,
                index,
              ].join('|')}
              className='status-estimator-lane'
            >
              <div className='status-estimator-lane-head'>
                <span style={{ color: providerBrandHex(estimate.provider) }}>
                  {canonicalProvider(estimate.provider)}
                </span>
                <span>{quotaEstimatorLaneLabel(estimate)}</span>
              </div>
              <div className='status-estimator-lane-key'>
                {estimate.quota_key} · {estimate.quota_lane}
              </div>
              <span
                className={`status-pill ${lanePill.className}`}
                role='status'
              >
                {formatEstimatorStatusLabel(identStatus)}
              </span>
              <div className='status-estimator-meta-grid'>
                <span>
                  lag <strong>{estimate.selected_lag_minutes}m</strong>
                </span>
                <span>
                  trainable{' '}
                  <strong>
                    {estimate.trainable_interval_count.toLocaleString()}
                  </strong>
                </span>
                <span>
                  effective sample{' '}
                  <strong>
                    {estimate.identifiability.effective_sample_size.toLocaleString()}
                  </strong>
                </span>
              </div>
              <div className='status-estimator-meta-grid'>
                <span>
                  intervals{' '}
                  <strong>{estimate.interval_count.toLocaleString()}</strong>
                </span>
                <span>
                  excluded{' '}
                  <strong>
                    {estimate.excluded_interval_count.toLocaleString()}
                  </strong>
                </span>
                <span>
                  active features{' '}
                  <strong>
                    {estimate.identifiability.active_feature_count.toLocaleString()}
                  </strong>
                </span>
              </div>
              <div className='status-estimator-block'>
                <strong>Residuals</strong>
                <span>
                  static RMSE{' '}
                  {formatEstimatorPercent(
                    estimate.residuals.static_baseline.rmse_pct
                  )}
                  , MAE{' '}
                  {formatEstimatorPercent(
                    estimate.residuals.static_baseline.mae_pct
                  )}
                </span>
                <span>
                  rolling RMSE{' '}
                  {formatEstimatorPercent(
                    estimate.residuals.rolling_exponential.rmse_pct
                  )}
                  , MAE{' '}
                  {formatEstimatorPercent(
                    estimate.residuals.rolling_exponential.mae_pct
                  )}
                </span>
                <span>
                  backtest{' '}
                  {formatEstimatorStatusLabel(estimate.backtest.status)} ·
                  holdout{' '}
                  {estimate.backtest.holdout_interval_count?.toLocaleString() ??
                    '—'}{' '}
                  · improved {estimate.backtest.rolling_improved ? 'yes' : 'no'}
                </span>
              </div>
              <div className='status-estimator-block'>
                <strong>Lag sensitivity</strong>
                {estimate.lag_sensitivity.length === 0 ? (
                  <span className='status-estimator-muted'>none</span>
                ) : (
                  estimate.lag_sensitivity.map((lag) => (
                    <span
                      key={`${estimate.quota_lane}-lag-${lag.lag_minutes}`}
                      className='status-estimator-row'
                    >
                      {lag.lag_minutes}m: {formatEstimatorPercent(lag.rmse_pct)}{' '}
                      RMSE · {lag.trainable_interval_count.toLocaleString()}{' '}
                      trainable · {formatEstimatorStatusLabel(lag.status)}
                    </span>
                  ))
                )}
              </div>
              <div className='status-estimator-block'>
                <strong>Cache-read ratios</strong>
                {estimate.cache_read_ratios.length === 0 ? (
                  <span className='status-estimator-muted'>none</span>
                ) : (
                  estimate.cache_read_ratios.map((ratio) => (
                    <span
                      key={`${estimate.quota_lane}-${ratio.model_family}`}
                      className='status-estimator-row'
                    >
                      {ratio.model_family}:&nbsp;
                      {formatEstimatorNumber(
                        ratio.cache_read_vs_uncached_workload_ratio,
                        3
                      )}{' '}
                      ({formatEstimatorStatusLabel(ratio.status)})
                    </span>
                  ))
                )}
              </div>
              <div className='status-estimator-block'>
                <strong>Coefficients</strong>
                {coefficientGroups.length === 0 ? (
                  <span className='status-estimator-muted'>none</span>
                ) : (
                  coefficientGroups.map((group) => (
                    <div key={`${estimate.quota_lane}-${group.tokenCategory}`}>
                      <div className='status-estimator-token-category'>
                        {group.tokenCategory === 'workload_excluding_cache_read'
                          ? 'workload (uncached + output + cache create/write + reasoning)'
                          : 'cache read'}
                      </div>
                      {group.families.map((family) => (
                        <div
                          key={`${estimate.quota_lane}-${group.tokenCategory}-${family.modelFamily}`}
                          className='status-estimator-family'
                        >
                          <div className='status-estimator-family-name'>
                            {family.modelFamily}
                          </div>
                          {family.rows.map((row) => (
                            <span
                              key={`${row.feature}-${row.estimate_kind}`}
                              className='status-estimator-row'
                            >
                              {row.estimate_kind === 'rolling_exponential'
                                ? 'rolling'
                                : 'static'}
                              :{' '}
                              {formatEstimatorPercent(
                                row.coefficient_pct_per_mtok
                              )}{' '}
                              / M tok, CI{' '}
                              {formatEstimatorPercent(
                                row.confidence_low_pct_per_mtok
                              )}{' '}
                              to{' '}
                              {formatEstimatorPercent(
                                row.confidence_high_pct_per_mtok
                              )}{' '}
                              ({formatEstimatorStatusLabel(row.estimate_status)}
                              )
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
              <div className='status-estimator-block'>
                <strong>Diagnostics</strong>
                {estimate.diagnostics.length === 0 ? (
                  <span className='status-estimator-muted'>none</span>
                ) : (
                  estimate.diagnostics.map((diagnostic, diagnosticIndex) => (
                    <span
                      key={`${estimate.quota_lane}-${diagnostic.code}-${diagnosticIndex}`}
                      className='status-estimator-row'
                    >
                      {diagnostic.severity}: {diagnostic.code} ·{' '}
                      {diagnostic.detail}
                    </span>
                  ))
                )}
              </div>
            </article>
          )
        })}
      </div>
    </StatusPanel>
  )
}
