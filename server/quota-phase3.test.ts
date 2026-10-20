import { describe, expect, test } from 'vitest'
import {
  buildQuotaPhase3Report,
  compareQuotaPhase3ToPhase2,
  quotaPhase3BandDistance,
  quotaPhase3DisplayBand,
  quotaPhase3Lag1Autocorrelation,
  quotaPhase3OneStepDisplayedChangeResiduals,
  type QuotaPhase3Coefficient,
  type QuotaPhase3History,
  type QuotaPhase3Report,
} from './quota-phase3'
import { buildQuotaEstimatorReport } from './report-service'

interface FeatureTotals {
  uncachedInputMtok: number
  outputMtok: number
  cacheReadMtok: number
  cacheCreateMtok: number
  reasoningMtok: number
}

interface EstimatorInterval {
  lagMinutes: number
  provider: string
  quotaKey: string
  quotaType: string
  quotaLane: string
  expectedResetAt: string
  resetStartAt: string
  resetEndAt: string
  intervalStartAt: string
  intervalEndAt: string
  previousConsumedPct: number
  currentConsumedPct: number
  deltaPct: number
  isResetBoundary: boolean
  isCappedAt100: boolean
  trainable: boolean
  excludeReason: string | null
  featureTotals: Record<string, FeatureTotals>
}

function emptyTotals(): FeatureTotals {
  return {
    uncachedInputMtok: 0,
    outputMtok: 0,
    cacheReadMtok: 0,
    cacheCreateMtok: 0,
    reasoningMtok: 0,
  }
}

function atMinute(minute: number): string {
  return new Date(Date.UTC(2026, 4, 1, 0, minute)).toISOString()
}

function makeInterval(
  fields: Partial<EstimatorInterval> &
    Pick<
      EstimatorInterval,
      'previousConsumedPct' | 'currentConsumedPct' | 'intervalEndAt'
    >
): EstimatorInterval {
  const previous = fields.previousConsumedPct
  const current = fields.currentConsumedPct
  const delta = current - previous
  const boundary = fields.isResetBoundary ?? delta < 0
  return {
    lagMinutes: 0,
    provider: 'anthropic',
    quotaKey: 'anthropic_unified_7d:7d',
    quotaType: 'weekly',
    quotaLane: 'anthropic_weekly_all_model',
    expectedResetAt: '2026-05-08T00:00:00.000Z',
    resetStartAt: '2026-05-01T00:00:00.000Z',
    resetEndAt: '2026-05-08T00:00:00.000Z',
    intervalStartAt: fields.intervalStartAt ?? fields.intervalEndAt,
    deltaPct: delta,
    isResetBoundary: boundary,
    isCappedAt100: false,
    trainable: delta > 0 && !boundary,
    excludeReason: null,
    featureTotals: {},
    ...fields,
  }
}

function exactBurn(options: {
  count: number
  x: number
  beta: number
  opening?: number
  family: string
  category?: 'uncached' | 'cacheRead' | 'cacheCreate'
  provider?: string
  quotaKey?: string
  quotaType?: string
  quotaLane?: string
  resetAt?: string
  startMinute?: number
}): EstimatorInterval[] {
  const opening = options.opening ?? 0
  const category = options.category ?? 'uncached'
  const intervals: EstimatorInterval[] = []
  let previous = opening
  for (let index = 0; index < options.count; index += 1) {
    const current = previous + options.x * options.beta
    const totals = emptyTotals()
    if (category === 'uncached') totals.uncachedInputMtok = options.x
    if (category === 'cacheRead') totals.cacheReadMtok = options.x
    if (category === 'cacheCreate') totals.cacheCreateMtok = options.x
    const minute = (options.startMinute ?? 0) + (index + 1) * 10
    intervals.push(
      makeInterval({
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.quotaKey ? { quotaKey: options.quotaKey } : {}),
        ...(options.quotaType ? { quotaType: options.quotaType } : {}),
        ...(options.quotaLane ? { quotaLane: options.quotaLane } : {}),
        ...(options.resetAt ? { expectedResetAt: options.resetAt } : {}),
        previousConsumedPct: previous,
        currentConsumedPct: current,
        intervalStartAt: atMinute(minute - 10),
        intervalEndAt: atMinute(minute),
        featureTotals: { [options.family]: totals },
      })
    )
    previous = current
  }
  return intervals
}

function displayedBurn(options: {
  opening: number
  steps: Array<{ mtok: number; displayed: number }>
  family?: string
}): EstimatorInterval[] {
  const family = options.family ?? 'sonnet'
  let previous = options.opening
  return options.steps.map((step, index) => {
    const totals = emptyTotals()
    totals.uncachedInputMtok = step.mtok
    const interval = makeInterval({
      previousConsumedPct: previous,
      currentConsumedPct: step.displayed,
      intervalEndAt: atMinute((index + 1) * 15),
      featureTotals: { [family]: totals },
    })
    previous = step.displayed
    return interval
  })
}

function quantizedLatentBurn(
  rule: 'rounded' | 'floored',
  count: number
): EstimatorInterval[] {
  const opening = 10
  const increments = [0.2, 0.8]
  const display = (value: number) =>
    rule === 'floored' ? Math.floor(value) : Math.round(value)
  let cumulativeBurn = 0

  return Array.from({ length: count }, (_, index) => {
    const previousBurn = cumulativeBurn
    cumulativeBurn += increments[index % increments.length] ?? 0
    const previous = display(opening + previousBurn)
    const current = display(opening + cumulativeBurn)
    const totals = emptyTotals()
    totals.uncachedInputMtok = cumulativeBurn - previousBurn
    return makeInterval({
      previousConsumedPct: previous,
      currentConsumedPct: current,
      intervalStartAt: atMinute(index * 10),
      intervalEndAt: atMinute((index + 1) * 10),
      featureTotals: { sonnet: totals },
    })
  })
}

function reportFor(intervals: readonly EstimatorInterval[]): QuotaPhase3Report {
  return buildQuotaPhase3Report(intervals)
}

function history(
  estimate: QuotaPhase3Report['estimates'][number],
  rule: 'rounded' | 'floored' = 'rounded'
): QuotaPhase3History {
  return estimate.coefficient_history_by_rule[rule]
}

function coefficientAt(
  path: QuotaPhase3History,
  epochIndex: number,
  feature: string
): QuotaPhase3Coefficient {
  const row = path.epochs[epochIndex]?.coefficients.find(
    (coefficient) => coefficient.feature === feature
  )
  if (!row) throw new Error(`missing ${feature} at epoch ${epochIndex}`)
  return row
}

function intervalWidth(row: QuotaPhase3Coefficient): number {
  return row.confidence_high_pct_per_mtok - row.confidence_low_pct_per_mtok
}

describe('quota phase 3 interval-censored model', () => {
  test('scores rounded and floored observation bands, including right censoring', () => {
    const floored = quotaPhase3DisplayBand(1, 'floored')
    const rounded = quotaPhase3DisplayBand(1, 'rounded')
    const capped = quotaPhase3DisplayBand(100, 'rounded', { capped: true })

    expect(quotaPhase3BandDistance(1.6, floored)).toBe(0)
    expect(quotaPhase3BandDistance(1.6, rounded)).toBeCloseTo(0.1)
    expect(quotaPhase3BandDistance(1.2, rounded)).toBe(0)
    expect(quotaPhase3BandDistance(0.4, floored)).toBeCloseTo(0.6)
    expect(quotaPhase3BandDistance(80, capped)).toBeCloseTo(20)
    expect(quotaPhase3BandDistance(140, capped)).toBe(0)
  })

  test('lag-1 autocorrelation matches a persistent series and an alternating series', () => {
    expect(quotaPhase3Lag1Autocorrelation([1, 2, 3, 4, 5])).toBeCloseTo(0.4)
    expect(quotaPhase3Lag1Autocorrelation([1, -1, 1, -1, 1, -1])).toBeCloseTo(
      -5 / 6
    )
    expect(quotaPhase3Lag1Autocorrelation([1, 1])).toBeNull()
  })

  test('selects the floored likelihood when displayed percents were floored', () => {
    const estimate = reportFor(
      displayedBurn({
        opening: 10,
        steps: [
          { mtok: 0.3, displayed: 10 },
          { mtok: 0.3, displayed: 10 },
          { mtok: 0.3, displayed: 10 },
          { mtok: 1.4, displayed: 12 },
        ],
      })
    ).estimates[0]

    expect(estimate.display_rule_comparison.basis).toBe(
      'in_sample_censored_loss'
    )
    expect(estimate.display_rule_comparison.preferred_rule).toBe('floored')
    expect(
      estimate.display_rule_comparison.floored.mean_observation_band_distance ??
        1
    ).toBeLessThan(1e-4)
    expect(
      estimate.display_rule_comparison.rounded.mean_observation_band_distance ??
        0
    ).toBeGreaterThan(0.02)
  })

  test('selects the rounded likelihood when displayed percents were rounded', () => {
    const estimate = reportFor(
      displayedBurn({
        opening: 10,
        steps: [
          { mtok: 0.3, displayed: 10 },
          { mtok: 0.3, displayed: 11 },
          { mtok: 0.3, displayed: 11 },
          { mtok: 1.4, displayed: 12 },
        ],
      })
    ).estimates[0]

    expect(estimate.display_rule_comparison.preferred_rule).toBe('rounded')
    expect(
      estimate.display_rule_comparison.rounded.mean_observation_band_distance ??
        1
    ).toBeLessThan(1e-4)
    expect(
      estimate.display_rule_comparison.floored.mean_observation_band_distance ??
        0
    ).toBeGreaterThan(0.05)
  })

  test('calibrates a reset window inside the censored burn band', () => {
    const estimate = reportFor(
      exactBurn({ count: 8, x: 1, beta: 2, family: 'sonnet' })
    ).estimates[0]
    const path = history(estimate)
    const window = path.epochs[0].reset_window

    expect(window?.displayed_delta_pct).toBe(16)
    expect(window?.predicted_burn_pct).toBeCloseTo(16, 0)
    expect(window?.band_distance_pct).toBe(0)
    expect(window?.inside_band).toBe(true)
    expect(
      estimate.display_rule_comparison.rounded.mean_reset_window_band_distance
    ).toBe(0)
    expect(
      Math.abs(
        estimate.display_rule_comparison.rounded
          .interval_residual_autocorrelation ?? 1
      )
    ).toBeLessThan(0.2)
  })

  test('tracks gradual coefficient drift and keeps reset-boundary jumps out of sigma', () => {
    const first = exactBurn({
      count: 8,
      x: 1,
      beta: 2,
      family: 'sonnet',
      resetAt: '2026-05-08T00:00:00.000Z',
    })
    const second = exactBurn({
      count: 8,
      x: 1,
      beta: 6,
      family: 'sonnet',
      resetAt: '2026-05-15T00:00:00.000Z',
      startMinute: 2000,
    })
    const drifted = reportFor([...first, ...second]).estimates[0]
    const driftedPath = history(drifted)
    const early = coefficientAt(driftedPath, 0, 'sonnet:uncached_input')
    const late = coefficientAt(driftedPath, 1, 'sonnet:uncached_input')

    expect(early.coefficient_pct_per_mtok).toBeGreaterThan(1)
    expect(early.coefficient_pct_per_mtok).toBeLessThan(3.5)
    expect(late.coefficient_pct_per_mtok).toBeGreaterThan(4.5)
    expect(late.coefficient_pct_per_mtok).toBeLessThan(7)
    expect(driftedPath.drift.transitions[0].classification).toBe(
      'gradual_drift'
    )
    expect(driftedPath.drift.sigma_status).toBe(
      'estimated_from_gradual_transitions_only'
    )
    expect(
      driftedPath.drift.sigma_pct_per_mtok_by_feature?.[
        'sonnet:uncached_input'
      ] ?? 0
    ).toBeGreaterThan(0.5)

    const stable = exactBurn({
      count: 6,
      x: 1,
      beta: 2,
      family: 'sonnet',
      resetAt: '2026-05-08T00:00:00.000Z',
    })
    const boundary = makeInterval({
      previousConsumedPct: 12,
      currentConsumedPct: 2,
      intervalEndAt: atMinute(70),
      isResetBoundary: true,
      trainable: false,
      featureTotals: {
        sonnet: { ...emptyTotals(), uncachedInputMtok: 5 },
      },
    })
    const after = exactBurn({
      count: 6,
      x: 1,
      beta: 2,
      opening: 2,
      family: 'sonnet',
      resetAt: '2026-05-08T00:00:00.000Z',
      startMinute: 80,
    })
    const artifact = reportFor([...stable, boundary, ...after]).estimates[0]
    const artifactPath = history(artifact)

    expect(artifactPath.epochs).toHaveLength(2)
    expect(artifactPath.epochs[1].opened_after_reset_boundary).toBe(true)
    expect(artifactPath.drift.transitions[0].classification).toBe(
      'reset_boundary_artifact'
    )
    expect(artifactPath.drift.sigma_status).not.toBe(
      'estimated_from_gradual_transitions_only'
    )
    expect(artifactPath.drift.gradual_transition_count).toBe(0)
  })

  test('labels sonnet-only non-sonnet movement as contamination rather than policy drift', () => {
    const early = exactBurn({
      count: 6,
      x: 1,
      beta: 1,
      family: 'haiku',
      quotaKey: 'anthropic_unified_7d_sonnet:7d_sonnet',
      quotaType: 'special',
      quotaLane: 'anthropic_weekly_sonnet',
      resetAt: '2026-05-08T00:00:00.000Z',
    })
    const late = exactBurn({
      count: 6,
      x: 1,
      beta: 4,
      family: 'haiku',
      quotaKey: 'anthropic_unified_7d_sonnet:7d_sonnet',
      quotaType: 'special',
      quotaLane: 'anthropic_weekly_sonnet',
      resetAt: '2026-05-15T00:00:00.000Z',
      startMinute: 2000,
    })
    const estimate = reportFor([...early, ...late]).estimates[0]
    const path = history(estimate)

    expect(path.drift.transitions[0].classification).toBe(
      'data_quality_contamination'
    )
    expect(path.drift.transitions[0].contamination_reasons).toContain(
      'haiku_on_sonnet_only_quota'
    )
    expect(path.drift.sigma_status).toBe(
      'no_gradual_drift_in_clean_transitions'
    )
    expect(estimate.diagnostics.map((row) => row.code)).toContain(
      'sonnet_only_non_sonnet_signal'
    )
    expect(estimate.diagnostics.map((row) => row.code)).toContain(
      'drift_separated_from_contamination'
    )
  })

  test('keeps cache read and cache create separate and does not invent duration splits', () => {
    const intervals: EstimatorInterval[] = []
    const pattern = [
      { category: 'uncached' as const, beta: 2 },
      { category: 'cacheRead' as const, beta: 0.4 },
      { category: 'cacheCreate' as const, beta: 1.5 },
    ]
    let previous = 0
    for (let index = 0; index < 12; index += 1) {
      const step = pattern[index % pattern.length]
      const current = previous + step.beta
      const totals = emptyTotals()
      if (step.category === 'uncached') totals.uncachedInputMtok = 1
      if (step.category === 'cacheRead') totals.cacheReadMtok = 1
      if (step.category === 'cacheCreate') totals.cacheCreateMtok = 1
      intervals.push(
        makeInterval({
          previousConsumedPct: previous,
          currentConsumedPct: current,
          intervalEndAt: atMinute((index + 1) * 10),
          featureTotals: { sonnet: totals },
        })
      )
      previous = current
    }
    const report = reportFor(intervals)
    const rows = history(report.estimates[0]).epochs[0].coefficients
    const features = rows.map((row) => row.feature)
    const uncached = rows.find((row) => row.feature === 'sonnet:uncached_input')
    const cacheRead = rows.find((row) => row.feature === 'sonnet:cache_read')
    const cacheCreate = rows.find(
      (row) => row.feature === 'sonnet:cache_create'
    )

    expect(features).toEqual([
      'sonnet:uncached_input',
      'sonnet:cache_read',
      'sonnet:cache_create',
    ])
    expect(features.join(' ')).not.toContain('cache_write_5m')
    expect(features.join(' ')).not.toContain('cache_write_1h')
    expect(uncached!.coefficient_pct_per_mtok).toBeGreaterThan(
      cacheRead!.coefficient_pct_per_mtok
    )
    expect(cacheCreate!.coefficient_pct_per_mtok).toBeGreaterThan(0.5)
    expect(report.cache_read_prior.numeric_ratio).toBeNull()
    expect(report.cache_read_prior.strength).toBe('weak')
    expect(report.cache_read_prior.evidence).toContain('not a prior')
    expect(report.cache_write_policy.duration_split).toBe('unavailable')
    expect(report.cache_write_policy.coefficients_not_estimated).toEqual([
      'cache_write_5m',
      'cache_write_1h',
    ])
  })

  test('widens confidence intervals when evidence is weak or not identifiable', () => {
    const strong = coefficientAt(
      history(
        reportFor(exactBurn({ count: 16, x: 1, beta: 3, family: 'sonnet' }))
          .estimates[0]
      ),
      0,
      'sonnet:uncached_input'
    )
    const directional = coefficientAt(
      history(
        reportFor(exactBurn({ count: 6, x: 1, beta: 3, family: 'sonnet' }))
          .estimates[0]
      ),
      0,
      'sonnet:uncached_input'
    )
    const weakIntervals: EstimatorInterval[] = []
    let previous = 0
    for (let index = 0; index < 3; index += 1) {
      const current = previous + 2
      weakIntervals.push(
        makeInterval({
          previousConsumedPct: previous,
          currentConsumedPct: current,
          intervalEndAt: atMinute((index + 1) * 10),
          featureTotals: {
            sonnet: { ...emptyTotals(), uncachedInputMtok: 1 },
            haiku: { ...emptyTotals(), uncachedInputMtok: 1 },
          },
        })
      )
      previous = current
    }
    const weakEstimate = reportFor(weakIntervals).estimates[0]
    const weak = coefficientAt(
      history(weakEstimate),
      0,
      'sonnet:uncached_input'
    )

    expect(strong.estimate_status).toBe('high_confidence')
    expect(directional.estimate_status).toBe('directional_only')
    expect(weak.estimate_status).toBe('not_identifiable')
    expect(weakEstimate.identifiability.status).toBe('not_identifiable')
    expect(weakEstimate.identifiability.risks).toContain('too_few_observations')
    expect(intervalWidth(directional)).toBeGreaterThan(intervalWidth(strong))
    expect(intervalWidth(weak)).toBeGreaterThan(intervalWidth(directional))
  })

  test('keeps OpenAI Spark semantics distinct from Anthropic Sonnet', () => {
    const report = reportFor([
      ...exactBurn({
        count: 6,
        x: 1,
        beta: 2,
        family: 'sonnet',
        provider: 'anthropic',
        quotaKey: 'anthropic_unified_7d:7d',
        quotaType: 'weekly',
        quotaLane: 'anthropic_weekly_all_model',
        resetAt: '2026-05-08T00:00:00.000Z',
      }),
      ...exactBurn({
        count: 6,
        x: 1,
        beta: 3,
        family: 'spark',
        provider: 'openai',
        quotaKey: 'codex_bengalfox:primary',
        quotaType: 'short_special',
        quotaLane: 'openai_codex_spark_5h',
        resetAt: '2026-05-08T05:00:00.000Z',
        startMinute: 3000,
      }),
    ])
    const anthropic = report.estimates.find(
      (estimate) => estimate.provider === 'anthropic'
    )
    const spark = report.estimates.find(
      (estimate) => estimate.quota_lane === 'openai_codex_spark_5h'
    )
    const sparkCoefficient = coefficientAt(
      history(spark!),
      0,
      'spark:uncached_input'
    )

    expect(anthropic?.provider_semantics).toBe('anthropic_sonnet')
    expect(anthropic?.anchor_family).toBe('sonnet')
    expect(
      history(anthropic!).epochs[0].coefficients.map((row) => row.feature)
    ).not.toContain('spark:uncached_input')
    expect(spark?.provider_semantics).toBe('openai_spark')
    expect(spark?.anchor_family).toBe('spark')
    expect(sparkCoefficient.anchor_semantics).toBe('openai_spark')
    expect(sparkCoefficient.relative_weight_vs_sonnet).toBeNull()
    expect(sparkCoefficient.relative_weight_vs_anchor).toBeCloseTo(1)
  })

  test('excludes partial reset windows from calibration while retaining their diagnostics', () => {
    const phase2Intervals = []
    const phase3Intervals = []
    const expectedIntervalManifest = []
    for (const [windowIndex, resetWindow] of [
      'reset-a',
      'reset-b',
      'reset-c',
    ].entries()) {
      for (let index = 0; index < 3; index += 1) {
        const intervalId = `${resetWindow}|${index}`
        const startMinute = windowIndex * 40 + index * 10
        const observedPct = resetWindow === 'reset-a' ? 1 : 2
        const phase2PredictedPct = resetWindow === 'reset-a' ? 0.2 : 0.5
        const phase3PredictedPct = resetWindow === 'reset-a' ? 0.8 : 1.5
        const interval = {
          interval_id: intervalId,
          lane_id: 'lane-a',
          series_id: `lane-a|${resetWindow}`,
          reset_window_id: resetWindow,
          interval_start_at: atMinute(startMinute),
          interval_end_at: atMinute(startMinute + 10),
          observed_pct: observedPct,
          predicted_pct: phase2PredictedPct,
          residual_pct: observedPct - phase2PredictedPct,
        }
        expectedIntervalManifest.push({
          interval_id: intervalId,
          reset_window_id: resetWindow,
        })
        if (resetWindow === 'reset-b' && index === 0) continue
        phase2Intervals.push(interval)
        phase3Intervals.push({
          ...interval,
          predicted_pct: phase3PredictedPct,
          residual_pct: observedPct - phase3PredictedPct,
        })
      }
    }
    phase3Intervals.push({
      ...phase3Intervals.at(-1)!,
      interval_id: 'reset-c|phase3-only',
    })
    const comparison = compareQuotaPhase3ToPhase2({
      scope: 'fixture',
      expectedIntervalManifest,
      phase2: {
        interval_residuals: phase2Intervals,
      },
      phase3: {
        interval_residuals: phase3Intervals,
        reset_band_distances: [
          { reset_window_id: 'reset-a', band_distance_pct: 0.01 },
          { reset_window_id: 'reset-b', band_distance_pct: 0.03 },
        ],
        uncertainty_intervals: [
          {
            confidence_low_pct_per_mtok: 0,
            confidence_high_pct_per_mtok: 1,
            estimate_status: 'not_identifiable',
          },
        ],
      },
    })

    expect(comparison.scope).toBe('fixture')
    expect(comparison.live_evaluation_status).toBe('unmet')
    expect(comparison.metric_outcomes.better_reset_window_calibration).toBe(
      'better'
    )
    expect(comparison.acceptance.better_reset_window_calibration).toBe('unmet')
    expect(comparison.acceptance.lower_interval_residual_autocorrelation).toBe(
      'unmet'
    )
    expect(comparison.acceptance.clear_uncertainty_intervals).toBe('met')
    expect(
      comparison.metrics.phase2_reset_window_one_step_sum_mae_pct
    ).toBeCloseTo(2.4)
    expect(
      comparison.metrics.phase3_reset_window_one_step_sum_mae_pct
    ).toBeCloseTo(0.6)
    expect(
      comparison.metrics.partial_phase2_reset_window_one_step_sum_mae_pct
    ).toBeCloseTo(3.75)
    expect(
      comparison.metrics.partial_phase3_reset_window_one_step_sum_mae_pct
    ).toBeCloseTo(1.25)
    expect(comparison.cohort.paired_reset_window_count).toBe(1)
    expect(comparison.cohort.diagnostic_paired_reset_window_count).toBe(3)
    expect(comparison.cohort.partial_paired_reset_window_count).toBe(2)
    expect(comparison.metrics.phase3_reset_window_mean_band_distance_pct).toBe(
      0.02
    )
    expect(comparison.cohort.paired_interval_forecast_count).toBe(8)
    expect(comparison.cohort.unmatched_phase3_interval_count).toBe(1)
    expect(comparison.cohort.same_interval_cohort).toBe(false)
    expect(comparison.metric_definitions.prediction_task).toContain(
      'not_a_heldout_or_out_of_sample_backtest'
    )
    expect(comparison).not.toHaveProperty('phase3_is_better')
  })

  test('keeps phase 0-2 on the estimator path and attaches phase 3 without a live claim', () => {
    const intervals = exactBurn({
      count: 8,
      x: 1,
      beta: 2,
      family: 'sonnet',
    })
    const rows = intervals.flatMap((interval) =>
      Object.entries(interval.featureTotals).map(([family, totals]) => ({
        lag_minutes: interval.lagMinutes,
        provider: interval.provider,
        quota_key: interval.quotaKey,
        quota_type: interval.quotaType,
        quota_lane: interval.quotaLane,
        expected_reset_at: interval.expectedResetAt,
        reset_start_at: interval.resetStartAt,
        reset_end_at: interval.resetEndAt,
        interval_start_at: interval.intervalStartAt,
        interval_end_at: interval.intervalEndAt,
        previous_consumed_pct: interval.previousConsumedPct,
        current_consumed_pct: interval.currentConsumedPct,
        delta_pct: interval.deltaPct,
        is_reset_boundary: interval.isResetBoundary,
        is_capped_at_100: interval.isCappedAt100,
        trainable: interval.trainable,
        exclude_reason: interval.excludeReason,
        model_family: family,
        traces: 1,
        uncached_input_tokens: totals.uncachedInputMtok * 1_000_000,
        output_tokens: totals.outputMtok * 1_000_000,
        cache_read_tokens: totals.cacheReadMtok * 1_000_000,
        cache_create_tokens: totals.cacheCreateMtok * 1_000_000,
        reasoning_tokens: totals.reasoningMtok * 1_000_000,
        usd_cost: 0,
        tool_calls: 0,
      }))
    )
    const report = buildQuotaEstimatorReport(rows, {
      from: '2026-05-01',
      to: '2026-05-08',
    })
    const phase2 = report.estimates[0]
    const rolling = phase2.coefficients.find(
      (coefficient) =>
        coefficient.estimate_kind === 'rolling_exponential' &&
        coefficient.feature === 'sonnet:workload'
    )

    expect(report.metadata?.phase).toBe('0-2')
    expect(report.metadata?.estimatorVersion).toBe('quota-weight-phase0-2-v1')
    expect(report.phase0Audit.known_missing_fields).toContain(
      'cache_write_5m_tokens'
    )
    expect(rolling?.coefficient_pct_per_mtok).toBeGreaterThan(0)
    expect(report.phase3?.phase).toBe('3')
    expect(report.phase3?.estimator_version).toBe('quota-weight-phase3-v1')
    expect(report.phase3?.live_evaluation.status).toBe('unmet')
    expect(report.phase3?.live_evaluation.better_reset_window_calibration).toBe(
      'unmet'
    )
    expect(
      report.phase3?.live_evaluation.lower_interval_residual_autocorrelation
    ).toBe('unmet')
    expect(
      report.phase3?.live_evaluation.evidence_search.rolling_vs_static_backtests
    ).not.toBe('met')
    expect(report.phase3?.live_evaluation.evidence_status).toBe('not_retained')
  })

  test('compares a displayed-change forecast residual, not a persistent level gap', () => {
    const intervals: EstimatorInterval[] = []
    let current = 4
    for (let index = 0; index < 18; index += 1) {
      const previous = current
      current += 2
      const totals = emptyTotals()
      totals.uncachedInputMtok = 1
      intervals.push(
        makeInterval({
          previousConsumedPct: previous,
          currentConsumedPct: current,
          intervalStartAt: atMinute(index * 10),
          intervalEndAt: atMinute((index + 1) * 10),
          featureTotals: { sonnet: totals },
        })
      )
    }

    const report = reportFor(intervals)
    const selectedRule =
      report.estimates[0]?.display_rule_comparison.preferred_rule ?? 'rounded'
    const residuals = quotaPhase3OneStepDisplayedChangeResiduals(intervals, {
      displayRule: selectedRule,
    })
    const opening = intervals[0]?.previousConsumedPct ?? 0
    let consumed = 0
    const levelGaps = intervals.map((interval) => {
      consumed += 1
      return opening + consumed * 3 - interval.currentConsumedPct
    })
    const forecastAutocorrelation =
      quotaPhase3Lag1Autocorrelation(residuals) ?? 1
    const levelGapAutocorrelation =
      quotaPhase3Lag1Autocorrelation(levelGaps) ?? 0
    const meanAbsolute = (values: number[]) =>
      values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length

    expect(
      report.phase2_comparison.metric_definitions.phase3_interval_residual
    ).toBe(
      'displayed_delta_minus_phase3_one_step_interval_censored_prefix_fit_projected_through_selected_display_rule'
    )
    expect(
      report.phase2_comparison.metric_definitions.phase2_interval_residual
    ).toBe(
      'displayed_delta_minus_phase2_one_step_rolling_exponential_prefix_fit'
    )
    expect(residuals.length).toBeGreaterThan(3)
    expect(meanAbsolute(residuals)).toBeLessThan(0.05)
    expect(meanAbsolute(levelGaps)).toBeGreaterThan(5)
    expect(Math.abs(forecastAutocorrelation)).toBeLessThan(0.2)
    expect(levelGapAutocorrelation).toBeGreaterThan(0.8)
    expect(Math.abs(forecastAutocorrelation)).toBeLessThan(
      levelGapAutocorrelation
    )
    expect(
      report.phase2_comparison.metrics.phase3_interval_residual_autocorrelation
    ).toBeCloseTo(forecastAutocorrelation, 8)
    expect(report.phase2_comparison.live_evaluation_status).toBe('unmet')
    expect(report.live_evaluation.lower_interval_residual_autocorrelation).toBe(
      'unmet'
    )
  })

  test('projects rounded and floored plateau forecasts through their display rule', () => {
    for (const rule of ['rounded', 'floored'] as const) {
      const intervals = quantizedLatentBurn(rule, 32)
      const residuals = quotaPhase3OneStepDisplayedChangeResiduals(intervals, {
        displayRule: rule,
      })
      const plateauCount = intervals.filter(
        (interval) => interval.deltaPct === 0
      ).length
      const thresholdCrossingCount = intervals.filter(
        (interval) => interval.deltaPct === 1
      ).length

      expect(plateauCount).toBeGreaterThan(0)
      expect(thresholdCrossingCount).toBeGreaterThan(0)
      expect(residuals.length).toBe(28)
      expect(residuals).toEqual(Array.from({ length: 28 }, () => 0))

      const prefixResiduals = quotaPhase3OneStepDisplayedChangeResiduals(
        intervals.slice(0, 20),
        { displayRule: rule }
      )
      expect(residuals.slice(0, prefixResiduals.length)).toEqual(
        prefixResiduals
      )

      const last = intervals[intervals.length - 1]
      if (!last) throw new Error('missing final quantized interval')
      const changedEnding = [
        ...intervals.slice(0, -1),
        {
          ...last,
          currentConsumedPct: last.currentConsumedPct + 1,
          deltaPct: last.deltaPct + 1,
        },
      ]
      const changedResiduals = quotaPhase3OneStepDisplayedChangeResiduals(
        changedEnding,
        { displayRule: rule }
      )
      expect(changedResiduals.slice(0, -1)).toEqual(residuals.slice(0, -1))
      expect(changedResiduals[changedResiduals.length - 1]).toBe(
        residuals[residuals.length - 1]! + 1
      )
    }
  })

  test('scores paired plateaus and reports the selected cohort per lane', () => {
    const intervals: EstimatorInterval[] = []
    const opening = 10
    for (let index = 0; index < 48; index += 1) {
      const previous = Math.floor(opening + index * 0.37)
      const current = Math.floor(opening + (index + 1) * 0.37)
      const totals = emptyTotals()
      totals.uncachedInputMtok = 1
      intervals.push(
        makeInterval({
          previousConsumedPct: previous,
          currentConsumedPct: current,
          intervalStartAt: atMinute(index * 10),
          intervalEndAt: atMinute((index + 1) * 10),
          featureTotals: { sonnet: totals },
        })
      )
    }

    const report = buildQuotaPhase3Report(intervals, {
      comparisonScope: 'retained_live_cohort',
      phase2Estimates: [
        {
          provider: 'anthropic',
          quota_key: 'anthropic_unified_7d:7d',
          quota_type: 'weekly',
          quota_lane: 'anthropic_weekly_all_model',
          residuals: {
            static_baseline: {},
            rolling_exponential: { rmse_pct: 1, mae_pct: 1 },
          },
          lag_sensitivity: [
            {
              lag_minutes: 0,
              trainable_interval_count: intervals.length,
              status: 'evaluated',
            },
          ],
          identifiability: { status: 'directional_only' },
          backtest: {
            status: 'evaluated',
            static_rmse_pct: 1,
            rolling_rmse_pct: 1,
          },
          trainable_interval_count: intervals.length,
          selected_lag_minutes: 0,
        },
      ],
      evaluationEvidence: {
        cohort_validation: { status: 'verified' },
        phase2_baseline_validation: { status: 'verified' },
      },
    })
    const lane = report.estimates[0]

    expect(lane?.display_rule_comparison.preferred_rule).toBe('floored')
    expect(
      lane?.phase2_comparison.cohort.paired_interval_forecast_count
    ).toBeGreaterThan(0)
    expect(
      lane?.phase2_comparison.cohort.paired_plateau_interval_count
    ).toBeGreaterThan(0)
    expect(lane?.phase2_comparison.metrics.paired_interval_forecast_count).toBe(
      report.phase2_comparison.metrics.paired_interval_forecast_count
    )
    expect(
      lane?.phase2_comparison.metrics.phase3_interval_residual_autocorrelation
    ).toBe(
      report.phase2_comparison.metrics.phase3_interval_residual_autocorrelation
    )
    expect(lane?.phase2_comparison.scope).toBe(report.phase2_comparison.scope)
    expect(lane?.phase2_comparison.evidence_status).toBe(
      report.phase2_comparison.evidence_status
    )
    expect(lane?.phase2_comparison.live_evaluation_status).toBe(
      report.phase2_comparison.live_evaluation_status
    )
  })
})
