import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type {
  UsageReportQuotaEstimatorEstimate,
  UsageReportQuotaEstimatorOperational,
  UsageReportQuotaEstimatorResponse,
} from '../../api/usage-report'
import { QuotaBarRow } from '../provider-card-quota-bar-row'
import type { QuotaBarGroup } from '../provider-card-types'
import { QuotaEstimatorForecastPanel } from './quota-estimator-forecast-panel'

function operational(
  overrides: Partial<UsageReportQuotaEstimatorOperational> = {}
): UsageReportQuotaEstimatorOperational {
  return {
    derivation: 'phase_2',
    confidence_model: 'rolling_exponential',
    interval_censored: false,
    state_space: false,
    lane_label: 'Weekly Sonnet-only',
    lane_family: 'sonnet_only',
    warning_scope: 'Anthropic weekly Sonnet-only lane',
    weight_source: 'promoted_phase_2',
    observation: {
      observed_at: '2026-05-21T12:00:00.000Z',
      provider: 'anthropic',
      quota_key: 'anthropic_unified_7d_sonnet:7d_sonnet',
      quota_type: 'special',
      quota_lane: 'anthropic_weekly_sonnet',
      lane_label: 'Weekly Sonnet-only',
      lane_family: 'sonnet_only',
      lag_assumption_minutes: 5,
      freshness: {
        generated_at: '2026-05-21T12:10:00.000Z',
        observation_age_minutes: 10,
        stale: false,
        stale_after_minutes: 120,
        trainable_interval_count: 24,
        effective_sample_size: 18.5,
        sample_cap: 40,
        bounded_window: true,
      },
    },
    forecast: {
      derivation: 'phase_2',
      status: 'high_confidence',
      promoted: true,
      promotion_blocked: false,
      weight_source: 'promoted_phase_2',
      observed_consumed_pct: 42,
      observed_interval_delta_pct: 3.2,
      predicted_interval_delta_pct: 3.05,
      residual_pct: 0.15,
      forecast_next_interval_burn_pct: 3.05,
      forecast_basis: 'latest_trainable_token_mix_phase_2',
      forecast_mix_observed_at: '2026-05-21T12:00:00.000Z',
    },
    weights: [
      {
        model_family: 'sonnet',
        token_category: 'uncached_input',
        coefficient_pct_per_mtok: 2.1,
        confidence_low_pct_per_mtok: 1.8,
        confidence_high_pct_per_mtok: 2.4,
        relative_weight_vs_sonnet_uncached_input: 1,
        estimate_status: 'high_confidence',
        promoted: true,
      },
      {
        model_family: 'sonnet',
        token_category: 'cache_read',
        coefficient_pct_per_mtok: 0.42,
        confidence_low_pct_per_mtok: 0.2,
        confidence_high_pct_per_mtok: 0.6,
        relative_weight_vs_sonnet_uncached_input: null,
        estimate_status: 'high_confidence',
        promoted: true,
      },
      {
        model_family: 'sonnet',
        token_category: 'cache_create',
        coefficient_pct_per_mtok: 1.15,
        confidence_low_pct_per_mtok: 0.9,
        confidence_high_pct_per_mtok: 1.4,
        relative_weight_vs_sonnet_uncached_input: null,
        estimate_status: 'high_confidence',
        promoted: true,
      },
      {
        model_family: 'sonnet',
        token_category: 'output',
        coefficient_pct_per_mtok: null,
        confidence_low_pct_per_mtok: null,
        confidence_high_pct_per_mtok: null,
        relative_weight_vs_sonnet_uncached_input: null,
        estimate_status: 'not_identifiable',
        promoted: false,
      },
      {
        model_family: 'sonnet',
        token_category: 'reasoning',
        coefficient_pct_per_mtok: null,
        confidence_low_pct_per_mtok: null,
        confidence_high_pct_per_mtok: null,
        relative_weight_vs_sonnet_uncached_input: null,
        estimate_status: 'not_identifiable',
        promoted: false,
      },
    ],
    cache_read_vs_uncached_input_ratios: [
      {
        model_family: 'sonnet',
        cache_read_vs_uncached_input_ratio: 0.2,
        status: 'consistent',
      },
    ],
    alerts: [],
    data_quality: {
      large_residual: false,
      checks_ran: true,
      promotion_blocked: false,
      clear_residual_pct: 3,
      large_residual_pct: 5,
      gate_residual_pct: 0.15,
      checks: [],
    },
    ...overrides,
  }
}

function estimate(
  overrides: Partial<UsageReportQuotaEstimatorEstimate> = {}
): UsageReportQuotaEstimatorEstimate {
  return {
    provider: 'anthropic',
    quota_key: 'anthropic_unified_7d_sonnet:7d_sonnet',
    quota_type: 'special',
    quota_lane: 'anthropic_weekly_sonnet',
    selected_lag_minutes: 5,
    lag_sensitivity: [],
    interval_count: 24,
    trainable_interval_count: 24,
    excluded_interval_count: 0,
    excluded_reasons: {},
    residuals: {
      static_baseline: { rmse_pct: 0.2, mae_pct: 0.1, max_abs_error_pct: 0.4 },
      rolling_exponential: {
        rmse_pct: 0.2,
        mae_pct: 0.1,
        max_abs_error_pct: 0.4,
      },
    },
    identifiability: {
      status: 'high_confidence',
      trainable_interval_count: 24,
      effective_sample_size: 18.5,
      active_feature_count: 4,
      model_family_mix_count: 2,
      max_feature_correlation: 0.2,
      risks: [],
    },
    backtest: {
      status: 'evaluated',
      holdout_interval_count: 4,
      static_rmse_pct: 0.3,
      rolling_rmse_pct: 0.2,
      rolling_improved: true,
    },
    cache_read_ratios: [],
    coefficients: [],
    diagnostics: [],
    operational: operational(),
    ...overrides,
  }
}

function response(
  estimates: UsageReportQuotaEstimatorEstimate[]
): UsageReportQuotaEstimatorResponse {
  return {
    metadata: {
      from: '2026-05-01',
      to: '2026-05-21',
      phase: '0-2',
      derivation: 'phase_2',
      operationalPhase: '4',
      confidenceModel: 'rolling_exponential',
      intervalCensored: false,
      stateSpace: false,
      lagCandidatesMinutes: [0],
      estimatorVersion: 'quota-weight-phase0-2-v1',
    },
    phase0Audit: {
      source_database: 'aawm_tristore',
      usage_event_shape: {},
      quota_pct_interval_shape: {},
      provider_lane_policy: {},
      known_missing_fields: [],
    },
    estimates,
  }
}

function observedQuotaBar(): QuotaBarGroup {
  return {
    label: 'Weekly',
    consumedPct: 42,
    remainingPct: 58,
    segments: [
      {
        widthPct: 100,
        severityClass: 'iv-25-50',
        highVelocity: false,
      },
    ],
  }
}

describe('QuotaEstimatorForecastPanel', () => {
  test('shows phase 2 anthropic weights, cache split, and confidence', () => {
    render(
      <QuotaEstimatorForecastPanel
        response={response([estimate()])}
        loading={false}
      />
    )

    expect(screen.getByText('Phase 2 quota burn forecast')).toBeInTheDocument()
    expect(
      screen.getByText(
        /interval-censored and state-space confidence are not used/i
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Weekly Sonnet-only')).toBeInTheDocument()
    expect(screen.getAllByText('High confidence').length).toBeGreaterThan(0)
    expect(screen.getByText('2026-05-21T12:00:00.000Z')).toBeInTheDocument()
    expect(screen.getByText(/lag/i).textContent).toContain('5m')
    expect(screen.getByText(/freshness/i).textContent).toContain('fresh')
    expect(screen.getByTestId('quota-forecast-burn').textContent).toContain(
      '3.05%'
    )
    expect(screen.getByText(/uncached input: 2.10%/i)).toBeInTheDocument()
    expect(screen.getByText(/cache read: 0.42%/i)).toBeInTheDocument()
    expect(screen.getByText(/cache create\/write: 1.15%/i)).toBeInTheDocument()
    expect(
      screen.getByText(/cache-read \/ uncached input: 0.200/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/output: —/i)).toBeInTheDocument()
  })

  test('filters openai spark lanes separately from all-model lanes', () => {
    render(
      <QuotaEstimatorForecastPanel
        response={response([
          estimate(),
          estimate({
            provider: 'openai',
            quota_key: 'codex_bengalfox:primary',
            quota_type: 'short',
            quota_lane: 'openai_short',
            operational: operational({
              lane_label: 'Codex all-model · 5-hour',
              lane_family: 'all_model',
              warning_scope:
                'OpenAI Codex all-model 5-hour lane, separate from Codex Spark lanes',
              forecast: {
                ...operational().forecast,
                status: 'directional_only',
                forecast_next_interval_burn_pct: 1.25,
              },
              observation: {
                ...operational().observation,
                provider: 'openai',
                quota_type: 'short',
                lane_label: 'Codex all-model · 5-hour',
                lane_family: 'all_model',
              },
            }),
          }),
          estimate({
            provider: 'openai',
            quota_key: 'codex_spark:tokens',
            quota_type: 'special',
            quota_lane: 'openai_spark_weekly',
            operational: operational({
              lane_label: 'Codex Spark · weekly',
              lane_family: 'codex_spark',
              warning_scope:
                'OpenAI Codex Spark weekly lane, separate from OpenAI all-model lanes',
              weight_source: 'withheld',
              forecast: {
                ...operational().forecast,
                status: 'not_identifiable',
                promoted: false,
                promotion_blocked: true,
                weight_source: 'withheld',
                predicted_interval_delta_pct: null,
                residual_pct: null,
                forecast_next_interval_burn_pct: null,
                forecast_basis: null,
                forecast_mix_observed_at: null,
              },
              weights: operational().weights.map((weight) => ({
                ...weight,
                coefficient_pct_per_mtok: null,
                confidence_low_pct_per_mtok: null,
                confidence_high_pct_per_mtok: null,
                estimate_status: 'not_identifiable',
                promoted: false,
              })),
              cache_read_vs_uncached_input_ratios: [
                {
                  model_family: 'sonnet',
                  cache_read_vs_uncached_input_ratio: null,
                  status: 'not_identifiable',
                },
              ],
              alerts: [
                {
                  code: 'residual_anomaly',
                  severity: 'info',
                  suppressed: true,
                  lane_family: 'codex_spark',
                  warning_scope:
                    'OpenAI Codex Spark weekly lane, separate from OpenAI all-model lanes',
                  detail: 'suppressed hysteresis residual',
                },
              ],
            }),
          }),
        ])}
        loading={false}
      />
    )

    expect(screen.getByText('Weekly Sonnet-only')).toBeInTheDocument()
    expect(screen.getByText('Codex all-model · 5-hour')).toBeInTheDocument()
    expect(screen.getByText('Codex Spark · weekly')).toBeInTheDocument()
    expect(screen.getAllByText('Directional only').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Not identifiable').length).toBeGreaterThan(0)
    expect(screen.queryByText('suppressed hysteresis residual')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'OpenAI Codex Spark' }))
    expect(screen.getByText('Codex Spark · weekly')).toBeInTheDocument()
    expect(screen.queryByText('Codex all-model · 5-hour')).toBeNull()
    expect(screen.queryByText('Weekly Sonnet-only')).toBeNull()
    const sparkLane = screen.getByTestId('quota-forecast-lane')
    expect(sparkLane.textContent).toContain('next-interval burn —')
    expect(sparkLane.textContent).toContain('Not identifiable')

    fireEvent.click(screen.getByRole('button', { name: 'OpenAI all-model' }))
    expect(screen.getByText('Codex all-model · 5-hour')).toBeInTheDocument()
    expect(screen.queryByText('Codex Spark · weekly')).toBeNull()
    expect(
      screen.getByText(/separate from Codex Spark lanes/i)
    ).toBeInTheDocument()
  })

  test('shows a large residual alert without replacing the observed quota bar', () => {
    const bar = observedQuotaBar()
    render(
      <>
        <QuotaBarRow quotaBar={bar} isPrior={false} layout='lane' />
        <QuotaEstimatorForecastPanel
          response={response([
            estimate({
              operational: operational({
                weight_source: 'held_pending_data_quality',
                forecast: {
                  ...operational().forecast,
                  status: 'directional_only',
                  promoted: false,
                  promotion_blocked: true,
                  weight_source: 'held_pending_data_quality',
                  forecast_next_interval_burn_pct: 2.5,
                  residual_pct: 27.5,
                },
                alerts: [
                  {
                    code: 'residual_anomaly',
                    severity: 'warning',
                    suppressed: false,
                    lane_family: 'sonnet_only',
                    warning_scope: 'Anthropic weekly Sonnet-only lane',
                    detail:
                      'Anthropic weekly Sonnet-only lane: large residual 30.00 pct. Data-quality checks block promoting that weight change.',
                  },
                  {
                    code: 'usage_contamination',
                    severity: 'warning',
                    suppressed: false,
                    lane_family: 'sonnet_only',
                    warning_scope: 'Anthropic weekly Sonnet-only lane',
                    detail:
                      'Anthropic weekly Sonnet-only lane: usage contamination suspected because consumed quota moved without matching LiteLLM tokens.',
                  },
                  {
                    code: 'coefficient_drift',
                    severity: 'warning',
                    suppressed: false,
                    lane_family: 'sonnet_only',
                    warning_scope: 'Anthropic weekly Sonnet-only lane',
                    detail:
                      'Anthropic weekly Sonnet-only lane: coefficient drift on sonnet:uncached_input. The change is not promoted into the displayed forecast.',
                  },
                ],
              }),
            }),
          ])}
          loading={false}
        />
      </>
    )

    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText(/does not replace those bars/i)).toBeInTheDocument()
    expect(screen.getByTestId('quota-forecast-burn').textContent).toContain(
      '2.50%'
    )
    expect(screen.getByTestId('quota-forecast-burn').textContent).not.toContain(
      '42%'
    )
    const alerts = screen.getAllByTestId('quota-forecast-alert')
    expect(alerts.map((alert) => alert.textContent).join('\n')).toContain(
      'residual_anomaly'
    )
    expect(alerts.map((alert) => alert.textContent).join('\n')).toContain(
      'usage_contamination'
    )
    expect(alerts.map((alert) => alert.textContent).join('\n')).toContain(
      'coefficient_drift'
    )
    expect(
      screen.getByText('Held pending data-quality checks')
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('quota-forecast-lane')).getByText(
        'Directional only'
      )
    ).toBeInTheDocument()
  })

  test('does not invent a forecast when the operational payload is missing', () => {
    render(
      <QuotaEstimatorForecastPanel
        response={response([
          estimate({
            operational: undefined,
          }),
        ])}
        loading={false}
      />
    )

    expect(screen.getByText(/Forecast unavailable/i)).toBeInTheDocument()
    expect(screen.queryByTestId('quota-forecast-burn')).toBeNull()
  })
})
