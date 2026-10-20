/**
 * Phase 3 cumulative interval-censored quota model.
 *
 * Phase 0-2 regresses exact deltas of rounded displayed percentages. This
 * module treats each displayed percent as a band around latent burn since the
 * reset anchor, keeps token categories separate, and lets coefficients follow
 * a random walk that is smoothed backward. The autocorrelation compared with
 * Phase 2 is the innovation of a one-step forecast of the displayed quota
 * change, not the gap between latent level and displayed percent. Live
 * improvement over the Phase 2 rolling estimator is not claimed: this
 * repository has no verified Phase 0-2 residual report, lag-sensitivity
 * artifact, identifiability score, or rolling-versus-static backtest to
 * compare against.
 */
import { createHash } from 'node:crypto'

const INTERIOR_TIE_BREAK_WEIGHT = 1e-6
const STATE_SMOOTH_WEIGHT = 0.35
const SONNET_ONLY_PRIOR_WEIGHT = 1e-4
const CACHE_READ_PRIOR_WEIGHT = 1e-8
const FIT_ITERATIONS = 250
const DRIFT_L2_THRESHOLD = 0.25
const HOLDOUT_MIN_OBSERVATIONS = 6
const HIGH_CONFIDENCE_OBSERVATIONS = 12
const MIN_OBSERVATIONS = 4
const DISPLAY_RULES = ['rounded', 'floored']

const TOKEN_CATEGORIES = [
  ['uncached_input', 'uncachedInputMtok'],
  ['output', 'outputMtok'],
  ['cache_read', 'cacheReadMtok'],
  ['cache_create', 'cacheCreateMtok'],
  ['reasoning', 'reasoningMtok'],
]

export const QUOTA_PHASE3_LIVE_EVALUATION = {
  status: 'unmet',
  evidence_status: 'not_retained',
  better_reset_window_calibration: 'unmet',
  lower_interval_residual_autocorrelation: 'unmet',
  clear_uncertainty_intervals: 'unmet',
  evidence_search: {
    phase_0_2_residual_reports: 'not_provided',
    lag_sensitivity_artifacts: 'not_provided',
    identifiability_score_artifacts: 'not_provided',
    rolling_vs_static_backtests: 'not_provided',
  },
  reason:
    'Reset-window and residual-autocorrelation comparisons require validated retained-cohort evidence and Phase 0-2 prerequisites.',
}

export const QUOTA_PHASE3_CACHE_READ_PRIOR = {
  source: 'phase0_audit_directional_expectation',
  expectation:
    'cache-read weight is expected to be lower than uncached input for the same model family',
  numeric_ratio: null,
  strength: 'weak',
  evidence:
    'The repository has no verified live Phase 0-2 cache-read ratio. The synthetic estimator test uses workload 2 and cache-read 0.4 and is not a prior.',
  penalty:
    'one-sided tie-break only; a higher cache-read coefficient stays reportable and is flagged',
  uncertainty:
    'independent cache-read variation is required; otherwise the coefficient stays directional_only or not_identifiable and its interval widens',
}

export const QUOTA_PHASE3_CACHE_WRITE_POLICY = {
  generic_feature: 'cache_create',
  source_field: 'cache_creation_input_tokens',
  duration_split: 'unavailable',
  coefficients_not_estimated: ['cache_write_5m', 'cache_write_1h'],
}

export function quotaPhase3DisplayBand(displayedPct, rule, options = {}) {
  const displayed = Number(displayedPct)
  if (!Number.isFinite(displayed)) return null
  if (options.capped || displayed >= 99.5) {
    return {
      lower: Math.min(100, displayed),
      upper: Number.POSITIVE_INFINITY,
      right_censored: true,
    }
  }
  if (rule === 'floored') {
    return {
      lower: displayed,
      upper: displayed + 1,
      right_censored: false,
    }
  }
  return {
    lower: displayed - 0.5,
    upper: displayed + 0.5,
    right_censored: false,
  }
}

export function quotaPhase3BandDistance(prediction, band) {
  if (!band || !Number.isFinite(prediction)) return null
  if (prediction < band.lower) return band.lower - prediction
  if (Number.isFinite(band.upper) && prediction >= band.upper) {
    return prediction - band.upper
  }
  return 0
}

export function quotaPhase3Lag1Autocorrelation(values) {
  if (!Array.isArray(values) || values.length < 3) return null
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length < 3) return null
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length
  let variance = 0
  for (const value of finite) {
    const delta = value - mean
    variance += delta * delta
  }
  if (variance <= 1e-12) return 0
  let covariance = 0
  for (let index = 1; index < finite.length; index += 1) {
    covariance += (finite[index] - mean) * (finite[index - 1] - mean)
  }
  return covariance / variance
}

export function compareQuotaPhase3ToPhase2({
  scope = 'fixture',
  phase2 = {},
  phase3 = {},
  expectedIntervalManifest = [],
  phase0_2Prerequisites = {},
  evidence = {},
} = {}) {
  const intervalForecastPairs = pairEvaluationRows(
    phase2.interval_residuals,
    phase3.interval_residuals,
    'interval_id'
  )
  const pairedResetWindows = aggregatePairedResetWindows(
    intervalForecastPairs.pairs
  )
  const { complete: completeResetWindows, partial: partialResetWindows } =
    partitionPairedResetWindows(
      pairedResetWindows,
      intervalForecastPairs,
      phase2.interval_residuals,
      phase3.interval_residuals,
      expectedIntervalManifest
    )
  const phase2ResetWindowIds = uniqueResetWindowIds(phase2.interval_residuals)
  const phase3ResetWindowIds = uniqueResetWindowIds(phase3.interval_residuals)
  const pairedResetWindowIds = new Set(
    pairedResetWindows.map((window) => window.reset_window_id)
  )
  const unmatchedPhase2ResetWindowCount = [...phase2ResetWindowIds].filter(
    (id) => !pairedResetWindowIds.has(id)
  ).length
  const unmatchedPhase3ResetWindowCount = [...phase3ResetWindowIds].filter(
    (id) => !pairedResetWindowIds.has(id)
  ).length
  const phase2ResetMae = meanOf(
    completeResetWindows.map((window) =>
      Math.abs(window.phase2_predicted_pct - window.observed_pct)
    )
  )
  const phase3ResetMae = meanOf(
    completeResetWindows.map((window) =>
      Math.abs(window.phase3_predicted_pct - window.observed_pct)
    )
  )
  const partialPhase2ResetMae = meanOf(
    partialResetWindows.map((window) =>
      Math.abs(window.phase2_predicted_pct - window.observed_pct)
    )
  )
  const partialPhase3ResetMae = meanOf(
    partialResetWindows.map((window) =>
      Math.abs(window.phase3_predicted_pct - window.observed_pct)
    )
  )
  const phase2Autocorrelation = pooledLag1Autocorrelation(
    intervalForecastPairs.pairs,
    'phase2'
  )
  const phase3Autocorrelation = pooledLag1Autocorrelation(
    intervalForecastPairs.pairs,
    'phase3'
  )
  const resetOutcome = compareLowerMetric(
    phase2ResetMae,
    phase3ResetMae,
    completeResetWindows.length > 0
  )
  const autocorrelationOutcome = compareLowerMetric(
    phase2Autocorrelation.value === null
      ? null
      : Math.abs(phase2Autocorrelation.value),
    phase3Autocorrelation.value === null
      ? null
      : Math.abs(phase3Autocorrelation.value),
    phase2Autocorrelation.series_count > 0 &&
      phase3Autocorrelation.series_count > 0
  )
  const evidenceStatus = retainedEvidenceStatus(scope, evidence)
  const prerequisitesMet = phase0_2Prerequisites.status === 'met'
  const verifiedLiveEvidence =
    evidenceStatus === 'retained_live_verified' && prerequisitesMet
  const clearUncertaintyIntervals = hasClearUncertaintyIntervals(
    phase3.uncertainty_intervals
  )
  const resetBandPairs = pairEvaluationRows(
    pairedResetWindows,
    phase3.reset_band_distances,
    'reset_window_id'
  )
  const phase3BandDistance = meanOf(
    resetBandPairs.pairs
      .map((pair) => finiteOrNull(pair.phase3.band_distance_pct))
      .filter((value) => value !== null)
  )
  const acceptance = {
    better_reset_window_calibration:
      verifiedLiveEvidence && resetOutcome === 'better' ? 'met' : 'unmet',
    lower_interval_residual_autocorrelation:
      verifiedLiveEvidence && autocorrelationOutcome === 'better'
        ? 'met'
        : 'unmet',
    clear_uncertainty_intervals: clearUncertaintyIntervals ? 'met' : 'unmet',
  }
  const status = Object.values(acceptance).every((value) => value === 'met')
    ? 'met'
    : 'unmet'
  const evidenceSearch = phase0_2Prerequisites
  return {
    scope,
    live_evaluation_status: status,
    evidence_status: evidenceStatus,
    phase0_2_prerequisite_status: prerequisitesMet ? 'met' : 'incomplete',
    acceptance,
    metric_outcomes: {
      better_reset_window_calibration: resetOutcome,
      lower_interval_residual_autocorrelation: autocorrelationOutcome,
      clear_uncertainty_intervals: clearUncertaintyIntervals
        ? 'available'
        : 'unavailable',
    },
    cohort: {
      paired_reset_window_count: completeResetWindows.length,
      paired_reset_window_id_sha256: digestIds(
        completeResetWindows.map((window) => window.reset_window_id)
      ),
      diagnostic_paired_reset_window_count: pairedResetWindows.length,
      partial_paired_reset_window_count: partialResetWindows.length,
      unmatched_phase2_reset_window_count: unmatchedPhase2ResetWindowCount,
      unmatched_phase3_reset_window_count: unmatchedPhase3ResetWindowCount,
      paired_interval_forecast_count: intervalForecastPairs.pairs.length,
      paired_plateau_interval_count: intervalForecastPairs.pairs.filter(
        (pair) =>
          pair.phase2.observed_pct === 0 && pair.phase3.observed_pct === 0
      ).length,
      paired_interval_id_sha256: digestIds(
        intervalForecastPairs.pairs.map((pair) => pair.phase2.interval_id)
      ),
      unmatched_phase2_interval_count:
        intervalForecastPairs.unmatched_phase2_ids.length,
      unmatched_phase3_interval_count:
        intervalForecastPairs.unmatched_phase3_ids.length,
      paired_autocorrelation_interval_count: Math.min(
        phase2Autocorrelation.interval_count,
        phase3Autocorrelation.interval_count
      ),
      paired_autocorrelation_series_count: Math.min(
        phase2Autocorrelation.series_count,
        phase3Autocorrelation.series_count
      ),
      phase3_reset_band_distance_count: resetBandPairs.pairs.length,
      same_interval_cohort:
        intervalForecastPairs.unmatched_phase2_ids.length === 0 &&
        intervalForecastPairs.unmatched_phase3_ids.length === 0,
    },
    phase0_2_prerequisites: evidenceSearch,
    evidence: publicEvaluationEvidence(evidence, evidenceStatus),
    note: comparisonNote({
      evidenceStatus,
      prerequisitesMet,
      resetOutcome,
      autocorrelationOutcome,
      phase0_2Prerequisites,
      unmatchedPhase2Intervals:
        intervalForecastPairs.unmatched_phase2_ids.length,
      unmatchedPhase3Intervals:
        intervalForecastPairs.unmatched_phase3_ids.length,
      partialResetWindowCount: partialResetWindows.length,
    }),
    metric_definitions: {
      prediction_task:
        'causal_one_step_interval_forecasts_within_the_retained_window_not_a_heldout_or_out_of_sample_backtest',
      phase2_interval_residual:
        'displayed_delta_minus_phase2_one_step_rolling_exponential_prefix_fit',
      phase3_interval_residual:
        'displayed_delta_minus_phase3_one_step_interval_censored_prefix_fit_projected_through_selected_display_rule',
      phase2_reset:
        'mae_of_summed_phase2_one_step_predictions_on_complete_expected_eligible_intervals_by_reset_window',
      phase3_reset:
        'mae_of_summed_phase3_one_step_predictions_on_complete_expected_eligible_intervals_by_reset_window',
      partial_reset_diagnostic:
        'mae_of_summed_one_step_predictions_on_available_forecasts_in_reset_windows_missing_expected_eligible_intervals_or_incomplete_phase2_phase3_pairing',
      phase3_reset_band_distance:
        'retrospective_smoothed_censored_band_distance_reported_separately',
      interval_residual_autocorrelation:
        'absolute_pooled_within_lane_lag1_autocorrelation_of_paired_one_step_displayed_delta_forecast_residuals',
    },
    metrics: {
      phase2_reset_window_one_step_sum_mae_pct: phase2ResetMae,
      phase3_reset_window_one_step_sum_mae_pct: phase3ResetMae,
      partial_phase2_reset_window_one_step_sum_mae_pct: partialPhase2ResetMae,
      partial_phase3_reset_window_one_step_sum_mae_pct: partialPhase3ResetMae,
      phase3_reset_window_mean_band_distance_pct: phase3BandDistance,
      phase2_interval_residual_autocorrelation: phase2Autocorrelation.value,
      phase3_interval_residual_autocorrelation: phase3Autocorrelation.value,
      phase2_interval_residual_abs_autocorrelation:
        phase2Autocorrelation.value === null
          ? null
          : Math.abs(phase2Autocorrelation.value),
      phase3_interval_residual_abs_autocorrelation:
        phase3Autocorrelation.value === null
          ? null
          : Math.abs(phase3Autocorrelation.value),
      paired_reset_window_count: completeResetWindows.length,
      partial_paired_reset_window_count: partialResetWindows.length,
      paired_interval_forecast_count: intervalForecastPairs.pairs.length,
      paired_plateau_interval_count: intervalForecastPairs.pairs.filter(
        (pair) =>
          pair.phase2.observed_pct === 0 && pair.phase3.observed_pct === 0
      ).length,
      uncertainty_interval_count: phase3.uncertainty_intervals?.length ?? 0,
    },
  }
}

function aggregatePairedResetWindows(pairs) {
  const windows = new Map()
  for (const pair of pairs ?? []) {
    const phase2 = pair.phase2
    const phase3 = pair.phase3
    const resetWindowId = phase2?.reset_window_id
    if (!resetWindowId || phase3?.reset_window_id !== resetWindowId) continue
    const phase2Observed = finiteOrNull(phase2.observed_pct)
    const phase3Observed = finiteOrNull(phase3.observed_pct)
    const phase2Predicted = finiteOrNull(phase2.predicted_pct)
    const phase3Predicted = finiteOrNull(phase3.predicted_pct)
    if (
      phase2Observed === null ||
      phase3Observed === null ||
      phase2Predicted === null ||
      phase3Predicted === null
    ) {
      continue
    }
    const window = windows.get(resetWindowId) ?? {
      reset_window_id: resetWindowId,
      phase2_predicted_pct: 0,
      phase3_predicted_pct: 0,
      observed_pct: 0,
      paired_interval_count: 0,
    }
    window.phase2_predicted_pct += phase2Predicted
    window.phase3_predicted_pct += phase3Predicted
    window.observed_pct += phase2Observed
    window.paired_interval_count += 1
    windows.set(resetWindowId, window)
  }
  return [...windows.values()].sort((left, right) =>
    left.reset_window_id.localeCompare(right.reset_window_id)
  )
}

function partitionPairedResetWindows(
  windows,
  intervalPairing,
  phase2Rows,
  phase3Rows,
  expectedIntervalManifest = []
) {
  const unmatchedIntervalIds = new Set([
    ...(intervalPairing.unmatched_phase2_ids ?? []),
    ...(intervalPairing.unmatched_phase3_ids ?? []),
  ])
  const partialWindowIds = new Set()
  for (const row of [
    ...(Array.isArray(phase2Rows) ? phase2Rows : []),
    ...(Array.isArray(phase3Rows) ? phase3Rows : []),
  ]) {
    if (unmatchedIntervalIds.has(row?.interval_id) && row?.reset_window_id) {
      partialWindowIds.add(row.reset_window_id)
    }
  }
  const phase2IntervalIds = new Set(
    (Array.isArray(phase2Rows) ? phase2Rows : [])
      .map((row) => row?.interval_id)
      .filter((id) => typeof id === 'string' && id.length > 0)
  )
  const phase3IntervalIds = new Set(
    (Array.isArray(phase3Rows) ? phase3Rows : [])
      .map((row) => row?.interval_id)
      .filter((id) => typeof id === 'string' && id.length > 0)
  )
  for (const expected of Array.isArray(expectedIntervalManifest)
    ? expectedIntervalManifest
    : []) {
    if (
      typeof expected?.interval_id === 'string' &&
      expected.interval_id.length > 0 &&
      typeof expected?.reset_window_id === 'string' &&
      expected.reset_window_id.length > 0 &&
      (!phase2IntervalIds.has(expected.interval_id) ||
        !phase3IntervalIds.has(expected.interval_id))
    ) {
      partialWindowIds.add(expected.reset_window_id)
    }
  }
  return {
    complete: windows.filter(
      (window) => !partialWindowIds.has(window.reset_window_id)
    ),
    partial: windows.filter((window) =>
      partialWindowIds.has(window.reset_window_id)
    ),
  }
}

function uniqueResetWindowIds(rows) {
  return new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => row?.reset_window_id)
      .filter((id) => typeof id === 'string' && id.length > 0)
  )
}

function pairEvaluationRows(phase2Rows, phase3Rows, idKey) {
  const indexRows = (rows) => {
    const byId = new Map()
    const duplicates = new Set()
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = typeof row?.[idKey] === 'string' ? row[idKey] : ''
      if (!id) continue
      if (byId.has(id)) {
        byId.delete(id)
        duplicates.add(id)
      } else if (!duplicates.has(id)) {
        byId.set(id, row)
      }
    }
    return { byId, duplicates }
  }

  const phase2 = indexRows(phase2Rows)
  const phase3 = indexRows(phase3Rows)
  const pairs = []
  for (const [id, phase2Row] of phase2.byId) {
    const phase3Row = phase3.byId.get(id)
    if (!phase3Row || phase3.duplicates.has(id)) continue
    pairs.push({ id, phase2: phase2Row, phase3: phase3Row })
  }
  pairs.sort((left, right) => compareEvaluationRows(left.phase2, right.phase2))
  const pairedIds = new Set(pairs.map((pair) => pair.id))
  const unmatchedIds = (indexed) =>
    new Set([
      ...indexed.duplicates,
      ...[...indexed.byId.keys()].filter((id) => !pairedIds.has(id)),
    ])

  return {
    pairs,
    unmatched_phase2_ids: [...unmatchedIds(phase2)],
    unmatched_phase3_ids: [...unmatchedIds(phase3)],
  }
}

function compareEvaluationRows(left, right) {
  const leftStart = Date.parse(left?.interval_start_at ?? '')
  const rightStart = Date.parse(right?.interval_start_at ?? '')
  if (
    Number.isFinite(leftStart) &&
    Number.isFinite(rightStart) &&
    leftStart !== rightStart
  ) {
    return leftStart - rightStart
  }
  const leftEnd = Date.parse(left?.interval_end_at ?? '')
  const rightEnd = Date.parse(right?.interval_end_at ?? '')
  if (
    Number.isFinite(leftEnd) &&
    Number.isFinite(rightEnd) &&
    leftEnd !== rightEnd
  ) {
    return leftEnd - rightEnd
  }
  return String(left?.interval_id ?? left?.reset_window_id ?? '').localeCompare(
    String(right?.interval_id ?? right?.reset_window_id ?? '')
  )
}

function pooledLag1Autocorrelation(pairs, side) {
  const bySeries = new Map()
  for (const pair of pairs ?? []) {
    const row = pair?.[side]
    const residual = finiteOrNull(row?.residual_pct)
    const seriesId = typeof row?.series_id === 'string' ? row.series_id : ''
    if (residual === null || !seriesId) continue
    const rows = bySeries.get(seriesId) ?? []
    rows.push({ ...row, residual_pct: residual })
    bySeries.set(seriesId, rows)
  }

  let covariance = 0
  let variance = 0
  let intervalCount = 0
  let seriesCount = 0
  for (const rows of bySeries.values()) {
    rows.sort(compareEvaluationRows)
    let segment = []
    const addSegment = () => {
      if (segment.length < 3) {
        segment = []
        return
      }
      const mean =
        segment.reduce((sum, row) => sum + row.residual_pct, 0) / segment.length
      for (const row of segment) {
        variance += (row.residual_pct - mean) ** 2
      }
      for (let index = 1; index < segment.length; index += 1) {
        covariance +=
          (segment[index].residual_pct - mean) *
          (segment[index - 1].residual_pct - mean)
      }
      intervalCount += segment.length
      seriesCount += 1
      segment = []
    }

    for (const row of rows) {
      const previous = segment[segment.length - 1]
      const previousEnd = Date.parse(previous?.interval_end_at ?? '')
      const currentStart = Date.parse(row.interval_start_at ?? '')
      if (
        previous &&
        (!Number.isFinite(previousEnd) ||
          !Number.isFinite(currentStart) ||
          previousEnd !== currentStart)
      ) {
        addSegment()
      }
      segment.push(row)
    }
    addSegment()
  }

  return {
    value:
      intervalCount === 0
        ? null
        : variance <= 1e-12
          ? 0
          : covariance / variance,
    interval_count: intervalCount,
    series_count: seriesCount,
  }
}

function compareLowerMetric(phase2Value, phase3Value, available) {
  const left = finiteOrNull(phase2Value)
  const right = finiteOrNull(phase3Value)
  if (!available || left === null || right === null) return 'unavailable'
  if (right < left - 1e-12) return 'better'
  if (right > left + 1e-12) return 'worse'
  return 'tie'
}

function hasClearUncertaintyIntervals(intervals) {
  return (
    Array.isArray(intervals) &&
    intervals.length > 0 &&
    intervals.every((row) => {
      const lower = finiteOrNull(row?.confidence_low_pct_per_mtok)
      const upper = finiteOrNull(row?.confidence_high_pct_per_mtok)
      return (
        lower !== null &&
        upper !== null &&
        lower >= 0 &&
        upper > lower &&
        ['high_confidence', 'directional_only', 'not_identifiable'].includes(
          row?.estimate_status
        )
      )
    })
  )
}

function retainedEvidenceStatus(scope, evidence) {
  if (scope !== 'retained_live_cohort') {
    return evidence && Object.keys(evidence).length
      ? 'provided_unverified'
      : 'not_retained'
  }
  const cohort = evidence?.cohort_validation ?? evidence?.cohort
  const phase2 = evidence?.phase2_baseline_validation ?? evidence?.phase2
  if (cohort?.status === 'verified' && phase2?.status === 'verified') {
    return 'retained_live_verified'
  }
  return evidence && Object.keys(evidence).length
    ? 'retained_live_unverified'
    : 'not_retained'
}

function publicEvaluationEvidence(evidence, status) {
  const cohort = evidence?.cohort_validation ?? evidence?.cohort
  const phase2 = evidence?.phase2_baseline_validation ?? evidence?.phase2
  const providers = Array.isArray(cohort?.providers)
    ? [
        ...new Set(
          cohort.providers.filter((value) => typeof value === 'string')
        ),
      ].sort()
    : []
  return {
    status,
    cohort: cohort
      ? {
          status: cohort.status ?? 'unverified',
          sha256: cohort.sha256 ?? null,
          source_revision: cohort.source_revision ?? null,
          captured_at: cohort.captured_at ?? null,
          database: cohort.database ?? null,
          window: cohort.window ?? null,
          observation_count: cohort.observation_count ?? 0,
          usage_bucket_count: cohort.usage_bucket_count ?? 0,
          providers,
        }
      : null,
    phase0_2_baseline: phase2
      ? {
          status: phase2.status ?? 'unverified',
          sha256: phase2.sha256 ?? null,
          source_revision: phase2.source_revision ?? null,
          generated_at: phase2.generated_at ?? null,
          database: phase2.database ?? null,
          window: phase2.window ?? null,
          interval_row_count: phase2.interval_row_count ?? 0,
          estimate_lane_count: phase2.estimate_lane_count ?? 0,
        }
      : null,
  }
}

function comparisonNote({
  evidenceStatus,
  prerequisitesMet,
  resetOutcome,
  autocorrelationOutcome,
  phase0_2Prerequisites,
  unmatchedPhase2Intervals,
  unmatchedPhase3Intervals,
  partialResetWindowCount,
}) {
  if (evidenceStatus !== 'retained_live_verified') {
    return 'Live acceptance requires verified retained-cohort and Phase 0-2 provenance; available fixture or in-request metrics remain descriptive.'
  }
  if (!prerequisitesMet) {
    return `Retained cohort provenance is valid, but Phase 0-2 prerequisites are incomplete: ${phase0_2Prerequisites.evaluable_lane_count ?? 0} of ${phase0_2Prerequisites.lane_count ?? 0} lanes are evaluable, with ${phase0_2Prerequisites.not_identifiable_lane_count ?? 0} not-identifiable lanes and ${phase0_2Prerequisites.no_trainable_lane_count ?? 0} lanes without trainable intervals.`
  }
  if (
    resetOutcome === 'unavailable' ||
    autocorrelationOutcome === 'unavailable'
  ) {
    return 'Retained evidence is verified, but there are not enough complete shared reset windows or contiguous one-step forecasts to evaluate every live gate.'
  }
  const exclusions =
    unmatchedPhase2Intervals || unmatchedPhase3Intervals
      ? ` The shared eligible interval cohort excludes ${unmatchedPhase2Intervals ?? 0} Phase 2-only and ${unmatchedPhase3Intervals ?? 0} Phase 3-only forecasts.`
      : ''
  const partialWindows = partialResetWindowCount
    ? ` ${partialResetWindowCount} partially paired reset windows are excluded from the reset-calibration gate and retained as diagnostics.`
    : ''
  return `Verified retained-cohort comparison: one-step calibration on complete shared forecast intervals is ${resetOutcome} and absolute within-lane interval residual autocorrelation is ${autocorrelationOutcome}. This is an in-window prefix forecast comparison, not a held-out backtest. Lag and display rule were selected retrospectively from this cohort, so the result is not prospective validation.${exclusions}${partialWindows} Retrospective censored-band distance and uncertainty intervals are reported separately.`
}

function digestIds(ids) {
  const values = [
    ...new Set((ids ?? []).filter((id) => typeof id === 'string')),
  ].sort()
  return values.length
    ? createHash('sha256').update(values.join('\n')).digest('hex')
    : null
}

function isValidDateOnly(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  )
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function inspectPhase2Prerequisites(estimates) {
  const lanes = (Array.isArray(estimates) ? estimates : []).map((estimate) => {
    const residuals = estimate?.residuals
    const residualReportPresent =
      residuals &&
      typeof residuals === 'object' &&
      residuals.static_baseline &&
      residuals.rolling_exponential &&
      ['rmse_pct', 'mae_pct'].every((key) =>
        Object.hasOwn(residuals.rolling_exponential, key)
      )
    const lagSensitivityPresent =
      Array.isArray(estimate?.lag_sensitivity) &&
      estimate.lag_sensitivity.length > 0 &&
      estimate.lag_sensitivity.every(
        (row) =>
          Number.isFinite(row?.lag_minutes) &&
          Number.isFinite(row?.trainable_interval_count) &&
          typeof row?.status === 'string'
      )
    const identifiabilityPresent = [
      'high_confidence',
      'directional_only',
      'not_identifiable',
    ].includes(estimate?.identifiability?.status)
    const backtestPresent =
      typeof estimate?.backtest?.status === 'string' &&
      Object.hasOwn(estimate.backtest, 'static_rmse_pct') &&
      Object.hasOwn(estimate.backtest, 'rolling_rmse_pct')
    const trainableCount = finiteOrNull(estimate?.trainable_interval_count) ?? 0
    const backtestEvaluated =
      estimate?.backtest?.status === 'evaluated' &&
      Number.isFinite(estimate.backtest.static_rmse_pct) &&
      Number.isFinite(estimate.backtest.rolling_rmse_pct)
    return {
      provider: estimate?.provider ?? 'unknown',
      quota_lane: estimate?.quota_lane ?? 'unknown',
      trainable_interval_count: trainableCount,
      identifiability_status: estimate?.identifiability?.status ?? 'unknown',
      residual_report: residualReportPresent ? 'present' : 'missing',
      lag_sensitivity: lagSensitivityPresent ? 'present' : 'missing',
      identifiability_score: identifiabilityPresent ? 'present' : 'missing',
      rolling_vs_static_backtest: backtestPresent ? 'present' : 'missing',
      backtest_status: estimate?.backtest?.status ?? 'missing',
      evaluable: trainableCount > 0 && backtestEvaluated,
    }
  })
  const nonEmpty = lanes.length > 0
  const outputsPresent =
    nonEmpty &&
    lanes.every(
      (lane) =>
        lane.residual_report === 'present' &&
        lane.lag_sensitivity === 'present' &&
        lane.identifiability_score === 'present' &&
        lane.rolling_vs_static_backtest === 'present'
    )
  const evaluableLaneCount = lanes.filter((lane) => lane.evaluable).length
  const status =
    outputsPresent && evaluableLaneCount === lanes.length && lanes.length > 0
      ? 'met'
      : 'incomplete'
  return {
    status,
    coverage_status:
      evaluableLaneCount === lanes.length && lanes.length > 0
        ? 'complete'
        : evaluableLaneCount > 0
          ? 'limited'
          : 'none',
    lane_count: lanes.length,
    evaluable_lane_count: evaluableLaneCount,
    not_identifiable_lane_count: lanes.filter(
      (lane) => lane.identifiability_status === 'not_identifiable'
    ).length,
    no_trainable_lane_count: lanes.filter(
      (lane) => lane.trainable_interval_count === 0
    ).length,
    components: {
      residual_reports: outputsPresent ? 'met' : 'incomplete',
      lag_sensitivity: outputsPresent ? 'met' : 'incomplete',
      identifiability_scores: outputsPresent ? 'met' : 'incomplete',
      rolling_vs_static_backtests:
        evaluableLaneCount === lanes.length && lanes.length > 0
          ? 'met'
          : 'incomplete',
    },
    lanes,
  }
}

function phase2DataByLane(estimates) {
  const map = new Map()
  for (const estimate of estimates ?? []) {
    const key = [
      estimate.provider,
      estimate.quota_key,
      estimate.quota_type,
      estimate.quota_lane,
    ].join('|')
    map.set(key, {
      prerequisites: inspectPhase2Prerequisites([estimate]),
    })
  }
  return map
}

export function validateQuotaPhase3RetainedCohort({
  artifactText,
  expectedSha256,
  expectedSourceRevision,
} = {}) {
  const failures = []
  const raw = typeof artifactText === 'string' ? artifactText : ''
  const actualSha256 = createHash('sha256').update(raw).digest('hex')
  if (
    typeof expectedSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(expectedSha256) ||
    actualSha256 !== expectedSha256.toLowerCase()
  ) {
    failures.push('sha256_mismatch')
  }

  let artifact = null
  try {
    artifact = JSON.parse(raw)
  } catch {
    failures.push('invalid_json')
  }
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    failures.push('invalid_artifact')
  } else {
    if (artifact.database !== 'aawm_tristore') {
      failures.push('unexpected_database')
    }
    if (artifact.transaction !== 'REPEATABLE READ READ ONLY; ROLLBACK') {
      failures.push('read_only_transaction_not_verified')
    }
    if (
      !Number.isFinite(artifact.statement_timeout_ms) ||
      artifact.statement_timeout_ms <= 0
    ) {
      failures.push('statement_timeout_missing')
    }
    if (
      typeof artifact.source_revision !== 'string' ||
      !/^[a-f0-9]{40}$/i.test(artifact.source_revision) ||
      (expectedSourceRevision &&
        artifact.source_revision.toLowerCase() !==
          expectedSourceRevision.toLowerCase())
    ) {
      failures.push('source_revision_mismatch')
    }
    if (
      typeof artifact.captured_at !== 'string' ||
      !Number.isFinite(Date.parse(artifact.captured_at))
    ) {
      failures.push('capture_timestamp_missing')
    }
    if (
      !isValidDateOnly(artifact.window?.from) ||
      !isValidDateOnly(artifact.window?.to) ||
      artifact.window.from >= artifact.window.to
    ) {
      failures.push('invalid_window')
    }
    if (
      !Array.isArray(artifact.observations) ||
      artifact.observations.length === 0
    ) {
      failures.push('observations_missing')
    }
    if (
      !Array.isArray(artifact.usage_buckets) ||
      artifact.usage_buckets.length === 0
    ) {
      failures.push('usage_buckets_missing')
    }
    for (const key of ['report_service', 'quota_phase3']) {
      if (!isSha256(artifact.source_hashes?.[key])) {
        failures.push(`source_hash_missing:${key}`)
      }
    }
    for (const key of ['observations', 'usage_buckets']) {
      if (!isSha256(artifact.query_hashes?.[key])) {
        failures.push(`query_hash_missing:${key}`)
      }
    }
  }

  const validationStatus = failures.length ? 'unverified' : 'verified'
  const evidence = artifact && typeof artifact === 'object' ? artifact : {}
  return {
    status: validationStatus,
    validation:
      validationStatus === 'verified'
        ? 'sha256_and_shape_verified'
        : 'validation_failed',
    sha256: actualSha256,
    source_revision: evidence.source_revision ?? null,
    captured_at: evidence.captured_at ?? null,
    database: evidence.database ?? null,
    transaction: evidence.transaction ?? null,
    statement_timeout_ms: evidence.statement_timeout_ms ?? null,
    window: evidence.window ?? null,
    observation_count: Array.isArray(evidence.observations)
      ? evidence.observations.length
      : 0,
    usage_bucket_count: Array.isArray(evidence.usage_buckets)
      ? evidence.usage_buckets.length
      : 0,
    providers: Array.isArray(evidence.observations)
      ? [
          ...new Set(
            evidence.observations.map((row) => row.provider).filter(Boolean)
          ),
        ].sort()
      : [],
    source_hashes: evidence.source_hashes ?? {},
    query_hashes: evidence.query_hashes ?? {},
    failures,
  }
}

export function validateQuotaPhase3Phase2Baseline({
  artifactText,
  expectedSha256,
  expectedSourceRevision,
  expectedCohortSha256,
} = {}) {
  const failures = []
  const raw = typeof artifactText === 'string' ? artifactText : ''
  const actualSha256 = createHash('sha256').update(raw).digest('hex')
  if (
    !isSha256(expectedSha256) ||
    actualSha256 !== expectedSha256.toLowerCase()
  ) {
    failures.push('sha256_mismatch')
  }

  let artifact = null
  try {
    artifact = JSON.parse(raw)
  } catch {
    failures.push('invalid_json')
  }
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    failures.push('invalid_artifact')
  } else {
    if (
      typeof artifact.source_revision !== 'string' ||
      !/^[a-f0-9]{40}$/i.test(artifact.source_revision) ||
      (expectedSourceRevision &&
        artifact.source_revision.toLowerCase() !==
          expectedSourceRevision.toLowerCase())
    ) {
      failures.push('source_revision_mismatch')
    }
    if (!isSha256(artifact.report_source_sha256)) {
      failures.push('report_source_hash_missing')
    }
    if (
      !isSha256(artifact.cohort_sha256) ||
      (expectedCohortSha256 &&
        artifact.cohort_sha256.toLowerCase() !==
          expectedCohortSha256.toLowerCase())
    ) {
      failures.push('cohort_hash_mismatch')
    }
    if (artifact.database !== 'aawm_tristore') {
      failures.push('unexpected_database')
    }
    if (
      !isValidDateOnly(artifact.window?.from) ||
      !isValidDateOnly(artifact.window?.to) ||
      artifact.window.from >= artifact.window.to
    ) {
      failures.push('invalid_window')
    }
    if (
      !Number.isInteger(artifact.interval_rows) ||
      artifact.interval_rows <= 0
    ) {
      failures.push('interval_rows_missing')
    }
    if (
      artifact.baseline?.metadata?.phase !== '0-2' ||
      !Array.isArray(artifact.baseline?.estimates) ||
      artifact.baseline.estimates.length === 0 ||
      Object.hasOwn(artifact.baseline, 'phase3')
    ) {
      failures.push('phase0_2_baseline_missing')
    }
  }

  const baseline = artifact?.baseline
  const prerequisites = inspectPhase2Prerequisites(baseline?.estimates)
  const validationStatus = failures.length ? 'unverified' : 'verified'
  return {
    status: validationStatus,
    validation:
      validationStatus === 'verified'
        ? 'sha256_and_provenance_verified'
        : 'validation_failed',
    sha256: actualSha256,
    source_revision: artifact?.source_revision ?? null,
    report_source_sha256: artifact?.report_source_sha256 ?? null,
    cohort_sha256: artifact?.cohort_sha256 ?? null,
    database: artifact?.database ?? null,
    generated_at: artifact?.generated_at ?? null,
    window: artifact?.window ?? null,
    interval_row_count: artifact?.interval_rows ?? 0,
    estimate_lane_count: baseline?.estimates?.length ?? 0,
    prerequisites,
    failures,
  }
}

export function buildQuotaPhase3Report(intervals, options = {}) {
  const lanes = groupIntervals(intervals ?? [], options.selectedLagByLane ?? {})
  const phase2ByLane = phase2DataByLane(options.phase2Estimates)
  const phase2Prerequisites = inspectPhase2Prerequisites(
    options.phase2Estimates
  )
  const laneResults = lanes.map((lane) =>
    buildLaneEstimate(lane, phase2ByLane.get(lane.key), {
      comparisonScope: options.comparisonScope,
      evaluationEvidence: options.evaluationEvidence,
    })
  )
  const selectedComparisons = laneResults.map((estimate) =>
    comparisonForSelectedDisplayRule(estimate)
  )
  const cohort = aggregateComparisonCohort(selectedComparisons)
  const comparison = compareQuotaPhase3ToPhase2({
    scope: options.comparisonScope ?? 'in_request',
    phase2: {
      interval_residuals: cohort.phase2_interval_residuals,
    },
    phase3: {
      reset_band_distances: cohort.phase3_reset_band_distances,
      interval_residuals: cohort.phase3_interval_residuals,
      uncertainty_intervals: cohort.phase3_uncertainty_intervals,
    },
    phase0_2Prerequisites: phase2Prerequisites,
    evidence: options.evaluationEvidence,
  })
  const estimates = laneResults.map(
    ({ selectedEvaluationCohort, ...estimate }) => estimate
  )

  return {
    phase: '3',
    estimator_version: 'quota-weight-phase3-v1',
    model: 'cumulative_interval_censored_state_space',
    level_anchor: 'observed_opening_displayed_percent',
    level_anchor_note:
      'The opening displayed percent is shared by both display rules. Giving each rule its own band-center anchor makes the linear models affine-equivalent, so the rounded-versus-floored comparison would be vacuous.',
    interior_tie_break_weight: INTERIOR_TIE_BREAK_WEIGHT,
    token_features: {
      separate: TOKEN_CATEGORIES.map(([name]) => name),
      cache_create_source: 'cache_creation_input_tokens',
      cache_write_5m_coefficient: null,
      cache_write_1h_coefficient: null,
    },
    provider_semantics: {
      anthropic: 'haiku_sonnet_opus_other',
      openai_codex: 'codex_gpt_other',
      openai_spark: 'spark',
      openai_not_collapsed_into_anthropic_sonnet: true,
    },
    retrospective_smoothing: {
      method: 'forward_backward_average',
      anthropic_first: true,
      openai: 'provider_specific_codex_or_spark',
    },
    cache_read_prior: QUOTA_PHASE3_CACHE_READ_PRIOR,
    cache_write_policy: QUOTA_PHASE3_CACHE_WRITE_POLICY,
    live_evaluation: publicLiveEvaluation(comparison),
    phase2_comparison: comparison,
    estimates,
    from: options.from ?? null,
    to: options.to ?? null,
  }
}

function publicLiveEvaluation(comparison) {
  const prerequisites = comparison.phase0_2_prerequisites ?? {}
  const components =
    comparison.evidence_status === 'retained_live_verified'
      ? (prerequisites.components ?? {})
      : {}
  return {
    status: comparison.live_evaluation_status,
    evidence_status: comparison.evidence_status,
    better_reset_window_calibration:
      comparison.acceptance.better_reset_window_calibration,
    lower_interval_residual_autocorrelation:
      comparison.acceptance.lower_interval_residual_autocorrelation,
    clear_uncertainty_intervals:
      comparison.acceptance.clear_uncertainty_intervals,
    evidence_search: {
      phase_0_2_residual_reports: components.residual_reports ?? 'not_provided',
      lag_sensitivity_artifacts: components.lag_sensitivity ?? 'not_provided',
      identifiability_score_artifacts:
        components.identifiability_scores ?? 'not_provided',
      rolling_vs_static_backtests:
        components.rolling_vs_static_backtests ?? 'not_provided',
    },
    reason: comparison.note,
  }
}

function comparisonForSelectedDisplayRule(estimate) {
  const cohort = estimate.selectedEvaluationCohort
  return cohort
    ? {
        phase3_reset_band_distances: cohort.phase3_reset_band_distances,
        phase2_interval_residuals: cohort.phase2_interval_residuals,
        phase3_interval_residuals: cohort.phase3_interval_residuals,
        phase3_uncertainty_intervals: cohort.phase3_uncertainty_intervals,
      }
    : null
}

function aggregateComparisonCohort(comparisons) {
  const result = {
    phase3_reset_band_distances: [],
    phase2_interval_residuals: [],
    phase3_interval_residuals: [],
    phase3_uncertainty_intervals: [],
  }
  for (const comparison of comparisons ?? []) {
    if (!comparison) continue
    for (const key of Object.keys(result)) {
      result[key].push(...(comparison[key] ?? []))
    }
  }
  return result
}

function buildLaneEstimate(lane, phase2LaneData, comparisonOptions = {}) {
  const compiled = compileEpochs(lane.intervals)
  const semantics = providerSemantics(lane.intervals[0] ?? {})
  const phase2ResidualRows = phase2OneStepDisplayedChangeResidualRows(
    lane.intervals
  )
  const byRule = {}
  for (const rule of DISPLAY_RULES) {
    byRule[rule] = fitDisplayRule({
      compiled,
      rule,
      semantics,
      phase2ResidualRows,
    })
  }
  const comparison = compareDisplayRules(byRule)
  const summarySource = comparison.preferred_rule
    ? byRule[comparison.preferred_rule]
    : null
  const selectedEvaluationCohort = summarySource?.evaluation_cohort ?? {
    phase3_reset_band_distances: [],
    phase2_interval_residuals: [],
    phase3_interval_residuals: [],
    phase3_uncertainty_intervals: [],
  }

  return {
    provider: lane.intervals[0]?.provider ?? 'unknown',
    quota_key: lane.intervals[0]?.quotaKey ?? 'unknown',
    quota_type: lane.intervals[0]?.quotaType ?? 'unknown',
    quota_lane: lane.intervals[0]?.quotaLane ?? 'unknown',
    provider_semantics: semantics.id,
    anchor_family: semantics.anchorFamily,
    lag_minutes: lane.lag,
    lag_fallback: lane.lagFallback,
    observation_count: compiled.epochs.reduce(
      (sum, epoch) => sum + epoch.observations.length,
      0
    ),
    epoch_count: compiled.epochs.length,
    identifiability: (summarySource ?? byRule.rounded).identifiability,
    display_rule_comparison: comparison,
    coefficient_history_by_rule: {
      rounded: byRule.rounded.history,
      floored: byRule.floored.history,
    },
    diagnostics: collectDiagnostics(
      byRule,
      lane.intervals[0] ?? {},
      comparison
    ),
    phase2_comparison: compareQuotaPhase3ToPhase2({
      scope: comparisonOptions.comparisonScope ?? 'in_request',
      phase2: {
        interval_residuals: selectedEvaluationCohort.phase2_interval_residuals,
      },
      phase3: {
        reset_band_distances:
          selectedEvaluationCohort.phase3_reset_band_distances,
        interval_residuals: selectedEvaluationCohort.phase3_interval_residuals,
        uncertainty_intervals:
          selectedEvaluationCohort.phase3_uncertainty_intervals,
      },
      phase0_2Prerequisites: phase2LaneData?.prerequisites,
      evidence: comparisonOptions.evaluationEvidence,
    }),
    selectedEvaluationCohort: summarySource ? selectedEvaluationCohort : null,
  }
}

function fitDisplayRule({ compiled, rule, semantics, phase2ResidualRows }) {
  const epochs = compiled.epochs.map((epoch) => applyRule(epoch, rule))
  const featureNames = compiled.featureNames
  const forward = []
  let anchor = null
  for (const epoch of epochs) {
    const beta = fitEpoch({
      epoch,
      featureNames,
      anchor,
      anchorWeight: anchor ? STATE_SMOOTH_WEIGHT : 0,
      semantics,
    })
    forward.push(beta)
    anchor = beta
  }
  const backward = Array(epochs.length)
  anchor = null
  for (let index = epochs.length - 1; index >= 0; index -= 1) {
    const beta = fitEpoch({
      epoch: epochs[index],
      featureNames,
      anchor,
      anchorWeight: anchor ? STATE_SMOOTH_WEIGHT : 0,
      semantics,
    })
    backward[index] = beta
    anchor = beta
  }
  const smoothed = forward.map((beta, index) =>
    beta.map((value, featureIndex) =>
      Math.max(0, 0.5 * (value + (backward[index]?.[featureIndex] ?? value)))
    )
  )
  const identifiability = assessIdentifiability(epochs, featureNames)
  const history = buildHistory({
    epochs,
    featureNames,
    smoothed,
    semantics,
    identifiability,
  })
  const phase3ResidualRows = phase3OneStepDisplayedChangeResidualRows(
    epochs,
    featureNames,
    semantics,
    rule
  )
  const pairedEvaluation = evaluatePairedCohort({
    epochs,
    smoothed,
    history,
    phase2ResidualRows,
    phase3ResidualRows,
    rule,
  })
  const observationDistances = []
  const resetBandDistances = []
  const resetPointErrors = []
  for (let index = 0; index < epochs.length; index += 1) {
    const epoch = epochs[index]
    const beta = smoothed[index] ?? []
    for (const observation of epoch.observations) {
      const prediction = predictLevel(
        epoch.openingDisplayed,
        observation.cum,
        beta
      )
      observationDistances.push(
        quotaPhase3BandDistance(prediction, observation.band) ?? 0
      )
    }
    if (epoch.resetTarget) {
      const predictedBurn = dot(epoch.resetTarget.total, beta)
      resetBandDistances.push(
        quotaPhase3BandDistance(predictedBurn, epoch.resetTarget.band) ?? 0
      )
      resetPointErrors.push(
        Math.abs(predictedBurn - epoch.resetTarget.displayedDelta)
      )
    }
  }
  const holdoutDistances = epochs.map((epoch) =>
    holdoutDistance(epoch, featureNames, semantics)
  )
  const holdout = meanOf(holdoutDistances)

  return {
    rule,
    identifiability,
    history,
    mean_observation_band_distance: meanOf(observationDistances),
    mean_reset_window_band_distance: meanOf(resetBandDistances),
    mean_reset_window_point_abs_error: meanOf(resetPointErrors),
    ...pairedEvaluation,
    holdout_mean_band_distance: holdout,
    selection_distance:
      holdout === null ? meanOf(observationDistances) : holdout,
    selection_basis:
      holdout === null
        ? 'in_sample_censored_loss'
        : 'heldout_tail_censored_loss',
  }
}

function phase2OneStepDisplayedChangeResidualRows(intervals) {
  const ordered = [...(intervals ?? [])].sort(compareIntervalTime)
  const trainable = ordered
    .filter(
      (interval) =>
        interval.trainable &&
        !isBoundaryInterval(interval) &&
        Number.isFinite(Number(interval.deltaPct))
    )
    .sort(compareIntervalTime)
  const families = new Set()
  for (const interval of trainable) {
    for (const family of Object.keys(interval.featureTotals ?? {})) {
      families.add(family)
    }
  }
  const featureNames = [...families]
    .sort()
    .flatMap((family) => [`${family}:workload`, `${family}:cache_read`])
  if (!featureNames.length) return []

  const gram = Array.from({ length: featureNames.length }, () =>
    Array(featureNames.length).fill(0)
  )
  const xty = Array(featureNames.length).fill(0)
  const rows = []
  let trained = 0
  let lastTime = null
  const halfLife = forecastHalfLifeHours(trainable[0]?.quotaType)

  for (const interval of ordered) {
    const time = Date.parse(interval.intervalEndAt ?? '')
    const finiteTime = Number.isFinite(time) ? time : null
    if (
      trained > 0 &&
      finiteTime !== null &&
      lastTime !== null &&
      finiteTime !== lastTime
    ) {
      const ageHours = Math.max(0, (finiteTime - lastTime) / 3_600_000)
      const decay = Math.exp((-Math.LN2 * ageHours) / Math.max(halfLife, 1))
      scaleMatrix(gram, decay)
      scaleVector(xty, decay)
    }

    if (
      trained >= FORECAST_MIN_TRAIN &&
      isQuotaPhase3ForecastEligible(interval)
    ) {
      const features = phase2FeatureVector(interval, featureNames)
      const observed = Number(interval.deltaPct)
      const beta = solveNonNegativeNormal(gram, xty)
      const predicted = dot(features, beta)
      rows.push(
        evaluationIntervalRow(interval, {
          observed_pct: observed,
          predicted_pct: predicted,
          residual_pct: observed - predicted,
          model: 'phase2',
        })
      )
    }
    const trainableInterval =
      interval.trainable &&
      !isBoundaryInterval(interval) &&
      Number.isFinite(Number(interval.deltaPct))
    if (trainableInterval) {
      const features = phase2FeatureVector(interval, featureNames)
      const observed = Number(interval.deltaPct)
      rankOneUpdate(gram, xty, features, observed, 1)
      trained += 1
    }
    if (finiteTime !== null) lastTime = finiteTime
  }
  return rows
}

function isQuotaPhase3ForecastEligible(interval) {
  const delta = Number(interval?.deltaPct)
  return (
    Number.isFinite(delta) &&
    delta >= 0 &&
    !interval?.isCappedAt100 &&
    !isBoundaryInterval(interval)
  )
}

function phase2FeatureVector(interval, featureNames) {
  return featureNames.map((name) => {
    const [family, category] = name.split(':')
    const totals = interval.featureTotals?.[family] ?? {}
    if (category === 'cache_read') return totals.cacheReadMtok ?? 0
    return (
      (totals.uncachedInputMtok ?? 0) +
      (totals.outputMtok ?? 0) +
      (totals.cacheCreateMtok ?? 0) +
      (totals.reasoningMtok ?? 0)
    )
  })
}

function evaluationIntervalRow(interval, metrics) {
  const lane = laneKey(interval)
  const reset = String(interval.expectedResetAt ?? '')
  const start = interval.intervalStartAt ?? ''
  const end = interval.intervalEndAt ?? ''
  return {
    interval_id: [lane, reset, start, end].join('|'),
    lane_id: lane,
    series_id: [lane, reset].join('|'),
    reset_window_id: [lane, reset].join('|'),
    interval_start_at: start,
    interval_end_at: end,
    ...metrics,
  }
}

function phase3OneStepDisplayedChangeResidualRows(
  epochs,
  featureNames,
  semantics,
  rule
) {
  const rows = []
  if (!featureNames.length) return rows
  let anchor = null
  for (const epoch of epochs) {
    const prefix = []
    for (const observation of epoch.observations) {
      const source = observation.source
      if (
        isQuotaPhase3ForecastEligible(source) &&
        (anchor || prefix.length >= FORECAST_MIN_TRAIN)
      ) {
        const prefixEpoch = {
          ...epoch,
          observations: prefix,
          resetTarget: null,
        }
        const beta = fitEpoch({
          epoch: prefixEpoch,
          featureNames,
          anchor,
          anchorWeight: anchor ? STATE_SMOOTH_WEIGHT : 0,
          semantics,
        })
        const observed = Number(source.deltaPct)
        const previousDisplayed = Number(source.previousConsumedPct)
        const previousCum =
          prefix[prefix.length - 1]?.cum ?? Array(featureNames.length).fill(0)
        const latentPrevious = predictLevel(
          epoch.openingDisplayed,
          previousCum,
          beta
        )
        const predictedLatentIncrement = dot(observation.increment, beta)
        const predicted = quotaPhase3ProjectDisplayedChange({
          latentPreviousPct: latentPrevious,
          previousDisplayedPct: previousDisplayed,
          latentIncrementPct: predictedLatentIncrement,
          displayRule: rule,
        })
        rows.push(
          evaluationIntervalRow(source, {
            observed_pct: observed,
            predicted_pct: predicted,
            residual_pct: observed - predicted,
            predicted_latent_increment_pct: predictedLatentIncrement,
            display_rule: rule,
            model: 'phase3',
          })
        )
      }
      prefix.push(observation)
    }
    if (prefix.length > 0) {
      anchor = fitEpoch({
        epoch,
        featureNames,
        anchor,
        anchorWeight: anchor ? STATE_SMOOTH_WEIGHT : 0,
        semantics,
      })
    }
  }
  return rows
}

function expectedIntervalManifestForEpochs(epochs) {
  return (epochs ?? []).flatMap((epoch) =>
    (epoch.observations ?? [])
      .map((observation) => observation.source)
      .filter(isQuotaPhase3ForecastEligible)
      .map((source) => {
        const row = evaluationIntervalRow(source, {})
        return {
          interval_id: row.interval_id,
          reset_window_id: row.reset_window_id,
        }
      })
  )
}

function reconcileLatentToDisplayBand(latent, displayed, rule) {
  const band = quotaPhase3DisplayBand(displayed, rule, {
    capped: displayed >= 99.5,
  })
  if (!band) return latent
  if (latent < band.lower) return band.lower
  if (Number.isFinite(band.upper) && latent >= band.upper) {
    const openUpperOffset =
      Number.EPSILON * Math.max(1, Math.abs(band.upper)) * 2
    return band.upper - openUpperOffset
  }
  return latent
}

function displayQuotaLevel(latent, rule) {
  return rule === 'floored' ? Math.floor(latent) : Math.round(latent)
}

export function quotaPhase3ProjectDisplayedChange({
  latentPreviousPct,
  previousDisplayedPct,
  latentIncrementPct,
  displayRule,
}) {
  const reconciledLatentPrevious = reconcileLatentToDisplayBand(
    latentPreviousPct,
    previousDisplayedPct,
    displayRule
  )
  const predictedLatentEnd = reconciledLatentPrevious + latentIncrementPct
  return (
    displayQuotaLevel(predictedLatentEnd, displayRule) - previousDisplayedPct
  )
}

function evaluatePairedCohort({
  epochs,
  smoothed,
  history,
  phase2ResidualRows,
  phase3ResidualRows,
  rule,
}) {
  const phase3ResetBandDistances = []
  const phase3UncertaintyIntervals = []

  for (let index = 0; index < epochs.length; index += 1) {
    const epoch = epochs[index]
    const beta = smoothed[index] ?? []
    const first = epoch.observations[0]?.source
    const resetWindowId = first
      ? [laneKey(first), epoch.resetKey].join('|')
      : null

    if (epoch.resetTarget && resetWindowId) {
      phase3ResetBandDistances.push({
        reset_window_id: resetWindowId,
        lane_id: first ? laneKey(first) : 'unknown',
        band_distance_pct:
          quotaPhase3BandDistance(
            dot(epoch.resetTarget.total, beta),
            epoch.resetTarget.band
          ) ?? null,
      })
    }

    for (const coefficient of history.epochs[index]?.coefficients ?? []) {
      phase3UncertaintyIntervals.push({
        reset_window_id: resetWindowId,
        lane_id: first ? laneKey(first) : 'unknown',
        display_rule: rule,
        feature: coefficient.feature,
        confidence_low_pct_per_mtok: coefficient.confidence_low_pct_per_mtok,
        confidence_high_pct_per_mtok: coefficient.confidence_high_pct_per_mtok,
        estimate_status: coefficient.estimate_status,
      })
    }
  }

  const expectedIntervalManifest = expectedIntervalManifestForEpochs(epochs)
  const intervalPairs = pairEvaluationRows(
    phase2ResidualRows,
    phase3ResidualRows,
    'interval_id'
  )
  const pairedResetWindows = aggregatePairedResetWindows(intervalPairs.pairs)
  const { complete: completeResetWindows, partial: partialResetWindows } =
    partitionPairedResetWindows(
      pairedResetWindows,
      intervalPairs,
      phase2ResidualRows,
      phase3ResidualRows,
      expectedIntervalManifest
    )
  const bandPairs = pairEvaluationRows(
    pairedResetWindows,
    phase3ResetBandDistances,
    'reset_window_id'
  )
  const phase2Autocorrelation = pooledLag1Autocorrelation(
    intervalPairs.pairs,
    'phase2'
  )
  const phase3Autocorrelation = pooledLag1Autocorrelation(
    intervalPairs.pairs,
    'phase3'
  )
  const phase2ResetMae = meanOf(
    completeResetWindows.map((window) =>
      Math.abs(window.phase2_predicted_pct - window.observed_pct)
    )
  )
  const phase3ResetMae = meanOf(
    completeResetWindows.map((window) =>
      Math.abs(window.phase3_predicted_pct - window.observed_pct)
    )
  )
  const partialPhase2ResetMae = meanOf(
    partialResetWindows.map((window) =>
      Math.abs(window.phase2_predicted_pct - window.observed_pct)
    )
  )
  const partialPhase3ResetMae = meanOf(
    partialResetWindows.map((window) =>
      Math.abs(window.phase3_predicted_pct - window.observed_pct)
    )
  )
  const phase3BandDistance = meanOf(
    bandPairs.pairs
      .map((pair) => finiteOrNull(pair.phase3.band_distance_pct))
      .filter((value) => value !== null)
  )
  const clearUncertaintyIntervals = hasClearUncertaintyIntervals(
    phase3UncertaintyIntervals
  )

  return {
    interval_residual_autocorrelation: phase3Autocorrelation.value,
    interval_residual_abs_autocorrelation:
      phase3Autocorrelation.value === null
        ? null
        : Math.abs(phase3Autocorrelation.value),
    phase2_interval_residual_autocorrelation: phase2Autocorrelation.value,
    phase2_interval_residual_abs_autocorrelation:
      phase2Autocorrelation.value === null
        ? null
        : Math.abs(phase2Autocorrelation.value),
    phase2_reset_window_one_step_sum_mae_pct: phase2ResetMae,
    phase3_reset_window_one_step_sum_mae_pct: phase3ResetMae,
    partial_phase2_reset_window_one_step_sum_mae_pct: partialPhase2ResetMae,
    partial_phase3_reset_window_one_step_sum_mae_pct: partialPhase3ResetMae,
    phase3_reset_window_mean_band_distance_pct: phase3BandDistance,
    reset_window_count: completeResetWindows.length,
    partial_reset_window_count: partialResetWindows.length,
    diagnostic_reset_window_count: pairedResetWindows.length,
    interval_forecast_count: intervalPairs.pairs.length,
    paired_plateau_interval_count: intervalPairs.pairs.filter(
      (pair) => pair.phase2.observed_pct === 0 && pair.phase3.observed_pct === 0
    ).length,
    same_interval_cohort:
      intervalPairs.pairs.length > 0 &&
      intervalPairs.unmatched_phase2_ids.length === 0 &&
      intervalPairs.unmatched_phase3_ids.length === 0,
    reset_window_id_sha256: digestIds(
      completeResetWindows.map((window) => window.reset_window_id)
    ),
    phase2_interval_id_sha256: digestIds(
      intervalPairs.pairs.map((pair) => pair.id)
    ),
    unmatched_phase2_interval_count: intervalPairs.unmatched_phase2_ids.length,
    unmatched_phase3_interval_count: intervalPairs.unmatched_phase3_ids.length,
    unmatched_phase2_reset_window_count: [
      ...uniqueResetWindowIds(phase2ResidualRows),
    ].filter(
      (id) =>
        !pairedResetWindows.some((window) => window.reset_window_id === id)
    ).length,
    unmatched_phase3_reset_window_count: [
      ...uniqueResetWindowIds(phase3ResidualRows),
    ].filter(
      (id) =>
        !pairedResetWindows.some((window) => window.reset_window_id === id)
    ).length,
    paired_autocorrelation_interval_count: Math.min(
      phase2Autocorrelation.interval_count,
      phase3Autocorrelation.interval_count
    ),
    paired_autocorrelation_series_count: Math.min(
      phase2Autocorrelation.series_count,
      phase3Autocorrelation.series_count
    ),
    clear_uncertainty_intervals: clearUncertaintyIntervals,
    evaluation_cohort: {
      phase3_reset_band_distances: phase3ResetBandDistances,
      expected_interval_manifest: expectedIntervalManifest,
      phase2_interval_residuals: phase2ResidualRows,
      phase3_interval_residuals: phase3ResidualRows,
      phase3_uncertainty_intervals: phase3UncertaintyIntervals,
    },
  }
}

function compareDisplayRules(byRule) {
  const rounded = byRule.rounded
  const floored = byRule.floored
  const basis = rounded.selection_basis
  let preferred = null
  let tie = false
  const left = rounded.selection_distance
  const right = floored.selection_distance
  if (left === null && right === null) {
    tie = true
  } else if (left === null) {
    preferred = 'floored'
  } else if (right === null) {
    preferred = 'rounded'
  } else if (Math.abs(left - right) <= 1e-4) {
    tie = true
  } else {
    preferred = left < right ? 'rounded' : 'floored'
  }
  return {
    basis,
    preferred_rule: preferred,
    tie,
    live_backtest: false,
    rounded: publicRuleScore(rounded),
    floored: publicRuleScore(floored),
  }
}

function publicRuleScore(result) {
  return {
    mean_observation_band_distance: result.mean_observation_band_distance,
    mean_reset_window_band_distance: result.mean_reset_window_band_distance,
    mean_reset_window_point_abs_error: result.mean_reset_window_point_abs_error,
    interval_residual_autocorrelation: result.interval_residual_autocorrelation,
    interval_residual_abs_autocorrelation:
      result.interval_residual_abs_autocorrelation,
    phase2_interval_residual_autocorrelation:
      result.phase2_interval_residual_autocorrelation,
    phase2_interval_residual_abs_autocorrelation:
      result.phase2_interval_residual_abs_autocorrelation,
    phase2_reset_window_one_step_sum_mae_pct:
      result.phase2_reset_window_one_step_sum_mae_pct,
    phase3_reset_window_one_step_sum_mae_pct:
      result.phase3_reset_window_one_step_sum_mae_pct,
    partial_phase2_reset_window_one_step_sum_mae_pct:
      result.partial_phase2_reset_window_one_step_sum_mae_pct,
    partial_phase3_reset_window_one_step_sum_mae_pct:
      result.partial_phase3_reset_window_one_step_sum_mae_pct,
    phase3_reset_window_mean_band_distance_pct:
      result.phase3_reset_window_mean_band_distance_pct,
    reset_window_count: result.reset_window_count,
    partial_reset_window_count: result.partial_reset_window_count,
    diagnostic_reset_window_count: result.diagnostic_reset_window_count,
    interval_forecast_count: result.interval_forecast_count,
    paired_plateau_interval_count: result.paired_plateau_interval_count,
    same_interval_cohort: result.same_interval_cohort,
    reset_window_id_sha256: result.reset_window_id_sha256,
    phase2_interval_id_sha256: result.phase2_interval_id_sha256,
    unmatched_phase2_reset_window_count:
      result.unmatched_phase2_reset_window_count,
    unmatched_phase3_reset_window_count:
      result.unmatched_phase3_reset_window_count,
    unmatched_phase2_interval_count: result.unmatched_phase2_interval_count,
    unmatched_phase3_interval_count: result.unmatched_phase3_interval_count,
    paired_autocorrelation_interval_count:
      result.paired_autocorrelation_interval_count,
    paired_autocorrelation_series_count:
      result.paired_autocorrelation_series_count,
    clear_uncertainty_intervals: result.clear_uncertainty_intervals,
    holdout_mean_band_distance: result.holdout_mean_band_distance,
    selection_distance: result.selection_distance,
    identifiability_status: result.identifiability.status,
  }
}

function buildHistory({
  epochs,
  featureNames,
  smoothed,
  semantics,
  identifiability,
}) {
  const epochRows = epochs.map((epoch, index) => {
    const beta = smoothed[index] ?? []
    const epochStatus = epochEstimateStatus(
      identifiability.status,
      epoch.observations.length
    )
    return {
      epoch_index: index,
      expected_reset_at: epoch.expectedResetAt,
      epoch_start_at: epoch.startAt,
      epoch_end_at: epoch.endAt,
      observation_count: epoch.observations.length,
      opened_after_reset_boundary: epoch.openedAfterBoundary,
      smoothing: 'retrospective_forward_backward',
      reset_window: publicResetWindow(epoch, beta),
      coefficients: featureNames.map((feature, featureIndex) =>
        coefficientRow({
          feature,
          featureIndex,
          beta,
          featureNames,
          epoch,
          semantics,
          status: featureStatus(epoch, featureIndex, epochStatus),
        })
      ),
    }
  })
  const transitions = []
  for (let index = 1; index < epochs.length; index += 1) {
    transitions.push(
      classifyTransition({
        previous: epochs[index - 1],
        next: epochs[index],
        previousBeta: smoothed[index - 1] ?? [],
        nextBeta: smoothed[index] ?? [],
        featureNames,
      })
    )
  }
  const gradual = transitions.filter(
    (transition) => transition.classification === 'gradual_drift'
  )
  const sigma = {}
  for (const feature of featureNames) {
    const innovations = gradual
      .map((transition) => transition.innovation_by_feature[feature])
      .filter((value) => Number.isFinite(value))
    sigma[feature] = innovations.length
      ? Math.sqrt(
          innovations.reduce((sum, value) => sum + value * value, 0) /
            innovations.length
        )
      : null
  }
  let sigmaStatus = 'estimated_from_gradual_transitions_only'
  let sigmaReason = null
  if (epochs.length < 2) {
    sigmaStatus = 'not_identifiable'
    sigmaReason = 'fewer_than_two_epochs'
  } else if (!gradual.length) {
    sigmaStatus = 'no_gradual_drift_in_clean_transitions'
    sigmaReason =
      'artifact and contamination transitions are excluded from sigma'
  }
  return {
    smoothing: 'retrospective_forward_backward',
    provider_semantics: semantics.id,
    anchor_family: semantics.anchorFamily,
    epochs: epochRows,
    drift: {
      sigma_status: sigmaStatus,
      sigma_reason: sigmaReason,
      sigma_pct_per_mtok_by_feature:
        sigmaStatus === 'estimated_from_gradual_transitions_only'
          ? sigma
          : null,
      transitions,
      gradual_transition_count: gradual.length,
      artifact_transition_count: transitions.filter(
        (transition) => transition.classification === 'reset_boundary_artifact'
      ).length,
      contamination_transition_count: transitions.filter(
        (transition) =>
          transition.classification === 'data_quality_contamination'
      ).length,
      clean_sigma_excludes: [
        'data_quality_contamination',
        'reset_boundary_artifact',
        'stable',
      ],
    },
  }
}

function classifyTransition({
  previous,
  next,
  previousBeta,
  nextBeta,
  featureNames,
}) {
  const innovationByFeature = {}
  let sumSquares = 0
  for (let index = 0; index < featureNames.length; index += 1) {
    const delta = (nextBeta[index] ?? 0) - (previousBeta[index] ?? 0)
    innovationByFeature[featureNames[index]] = delta
    sumSquares += delta * delta
  }
  const innovation = Math.sqrt(sumSquares)
  const reasons = unique([
    ...contaminationReasons(previous, previousBeta, featureNames),
    ...contaminationReasons(next, nextBeta, featureNames),
  ])
  const structural = reasons.filter((reason) => reason !== 'capped_window')
  let classification = 'stable'
  if (
    structural.length ||
    (reasons.includes('capped_window') && innovation >= DRIFT_L2_THRESHOLD)
  ) {
    classification = 'data_quality_contamination'
  } else if (next.openedAfterBoundary && innovation < DRIFT_L2_THRESHOLD) {
    classification = 'reset_boundary_artifact'
  } else if (innovation >= DRIFT_L2_THRESHOLD) {
    classification = 'gradual_drift'
  }
  return {
    from_epoch_index: previous.epochIndex,
    to_epoch_index: next.epochIndex,
    classification,
    innovation_l2: innovation,
    innovation_by_feature: innovationByFeature,
    reset_boundary_between: Boolean(next.openedAfterBoundary),
    contamination_reasons: reasons,
  }
}

function contaminationReasons(epoch, beta, featureNames) {
  const reasons = []
  if (isSonnetOnly(epoch)) {
    const sonnet = coefficientValue(beta, featureNames, 'sonnet:uncached_input')
    for (const family of ['haiku', 'opus']) {
      const feature = `${family}:uncached_input`
      const coefficient = coefficientValue(beta, featureNames, feature)
      const usage = featureUsage(epoch, featureNames, feature)
      if (usage > 0 && coefficient > Math.max(0.15, sonnet * 0.1)) {
        reasons.push(`${family}_on_sonnet_only_quota`)
      }
    }
  }
  const mass = epoch.observations.reduce(
    (sum, observation) =>
      sum + observation.increment.reduce((inner, value) => inner + value, 0),
    0
  )
  const distance =
    meanOf(
      epoch.observations.map(
        (observation) =>
          quotaPhase3BandDistance(
            predictLevel(epoch.openingDisplayed, observation.cum, beta),
            observation.band
          ) ?? 0
      )
    ) ?? 0
  if (mass < 1e-6 && distance > 0.5) {
    reasons.push('unexplained_burn_without_usage')
  }
  const capped = epoch.observations.filter((observation) => observation.capped)
  if (
    epoch.observations.length &&
    capped.length / epoch.observations.length > 0.5
  ) {
    reasons.push('capped_window')
  }
  return reasons
}

function coefficientRow({
  feature,
  featureIndex,
  beta,
  featureNames,
  epoch,
  semantics,
  status,
}) {
  const point = beta[featureIndex] ?? 0
  const bounds = profileBounds(epoch, featureNames, beta, featureIndex)
  const count = Math.max(epoch.observations.length, 1)
  const widen =
    status === 'high_confidence' ? 1 : status === 'directional_only' ? 2.5 : 6
  const mid = (bounds.low + bounds.high) / 2
  const half =
    Math.max((bounds.high - bounds.low) / 2, 0.5 / Math.sqrt(count)) * widen
  const [family, category] = feature.split(':')
  const anchorFeature = semantics.anchorFamily
    ? `${semantics.anchorFamily}:${category}`
    : null
  const anchor = anchorFeature
    ? coefficientValue(beta, featureNames, anchorFeature)
    : 0
  const sonnet = coefficientValue(beta, featureNames, `sonnet:${category}`)
  return {
    feature,
    model_family: family,
    token_category: category,
    coefficient_pct_per_mtok: point,
    confidence_low_pct_per_mtok: Math.max(0, mid - half),
    confidence_high_pct_per_mtok: mid + half,
    estimate_status: status,
    anchor_family: semantics.anchorFamily,
    anchor_semantics: semantics.id,
    relative_weight_vs_anchor: anchor > 1e-8 ? point / anchor : null,
    relative_weight_vs_sonnet:
      semantics.anchorFamily === 'sonnet' && sonnet > 1e-8
        ? point / sonnet
        : null,
  }
}

function profileBounds(epoch, featureNames, beta, featureIndex) {
  const base = censoredLoss(epoch, beta)
  const tolerance = base + 1e-4
  const point = Math.max(0, beta[featureIndex] ?? 0)
  const lossAt = (value) => {
    const next = beta.slice()
    next[featureIndex] = value
    return censoredLoss(epoch, next)
  }
  let low = point
  if (lossAt(0) <= tolerance) {
    low = 0
  } else {
    let left = 0
    let right = point
    for (let step = 0; step < 40; step += 1) {
      const mid = (left + right) / 2
      if (lossAt(mid) <= tolerance) right = mid
      else left = mid
    }
    low = right
  }
  let span = Math.max(point, 1)
  let high = point
  let guard = 0
  while (high < 1e6 && lossAt(high) <= tolerance && guard < 30) {
    high += span
    span *= 2
    guard += 1
  }
  let left = point
  let right = high
  for (let step = 0; step < 40; step += 1) {
    const mid = (left + right) / 2
    if (lossAt(mid) <= tolerance) left = mid
    else right = mid
  }
  return { low, high: Math.max(low, left) }
}

function censoredLoss(epoch, beta) {
  let loss = 0
  for (const observation of epoch.observations) {
    const distance = quotaPhase3BandDistance(
      predictLevel(epoch.openingDisplayed, observation.cum, beta),
      observation.band
    )
    loss += (distance ?? 0) ** 2
  }
  if (epoch.resetTarget) {
    const distance = quotaPhase3BandDistance(
      dot(epoch.resetTarget.total, beta),
      epoch.resetTarget.band
    )
    loss += (distance ?? 0) ** 2
  }
  return loss
}

function holdoutDistance(epoch, featureNames, semantics) {
  if (epoch.observations.length < HOLDOUT_MIN_OBSERVATIONS) return null
  const split = Math.max(
    MIN_OBSERVATIONS,
    Math.floor(epoch.observations.length * 0.7)
  )
  if (split >= epoch.observations.length) return null
  const train = {
    ...epoch,
    observations: epoch.observations.slice(0, split),
    resetTarget: null,
  }
  const beta = fitEpoch({
    epoch: train,
    featureNames,
    anchor: null,
    anchorWeight: 0,
    semantics,
  })
  const distances = epoch.observations.slice(split).map((observation) => {
    return (
      quotaPhase3BandDistance(
        predictLevel(epoch.openingDisplayed, observation.cum, beta),
        observation.band
      ) ?? 0
    )
  })
  return meanOf(distances)
}

function fitEpoch({ epoch, featureNames, anchor, anchorWeight, semantics }) {
  const featureCount = featureNames.length
  const beta = Array(featureCount)
    .fill(0)
    .map((_, index) => Math.max(0, anchor?.[index] ?? 0))
  const sonnetOnly = isSonnetOnly(epoch) || semantics?.sonnetOnly === true
  for (let iteration = 0; iteration < FIT_ITERATIONS; iteration += 1) {
    let maxChange = 0
    for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
      let numerator = 0
      let denominator = 1e-12
      for (const observation of epoch.observations) {
        const exposure = observation.cum[featureIndex] ?? 0
        if (exposure === 0) continue
        const prediction = predictLevel(
          epoch.openingDisplayed,
          observation.cum,
          beta
        )
        const { target, weight } = activeTarget(prediction, observation.band)
        numerator +=
          weight *
          exposure *
          (target - (prediction - beta[featureIndex] * exposure))
        denominator += weight * exposure * exposure
      }
      if (epoch.resetTarget) {
        const exposure = epoch.resetTarget.total[featureIndex] ?? 0
        if (exposure !== 0) {
          const prediction = dot(epoch.resetTarget.total, beta)
          const { target, weight } = activeTarget(
            prediction,
            epoch.resetTarget.band
          )
          numerator +=
            weight *
            exposure *
            (target - (prediction - beta[featureIndex] * exposure))
          denominator += weight * exposure * exposure
        }
      }
      if (anchor && anchorWeight > 0) {
        numerator += anchorWeight * (anchor[featureIndex] ?? 0)
        denominator += anchorWeight
      }
      const penalty = featurePenalty({
        featureNames,
        featureIndex,
        beta,
        sonnetOnly,
      })
      numerator += penalty.numerator
      denominator += penalty.denominator
      const next = Math.max(0, numerator / denominator)
      const change = next - beta[featureIndex]
      beta[featureIndex] = next
      maxChange = Math.max(maxChange, Math.abs(change))
    }
    if (maxChange < 1e-9) break
  }
  return beta
}

function featurePenalty({ featureNames, featureIndex, beta, sonnetOnly }) {
  const feature = featureNames[featureIndex]
  let numerator = 0
  let denominator = 0
  if (
    sonnetOnly &&
    (feature.startsWith('haiku:') || feature.startsWith('opus:'))
  ) {
    denominator += SONNET_ONLY_PRIOR_WEIGHT
  }
  if (feature.endsWith(':cache_read')) {
    const family = feature.split(':')[0]
    const uncachedIndex = featureNames.indexOf(`${family}:uncached_input`)
    if (uncachedIndex >= 0 && beta[featureIndex] > beta[uncachedIndex]) {
      numerator += CACHE_READ_PRIOR_WEIGHT * beta[uncachedIndex]
      denominator += CACHE_READ_PRIOR_WEIGHT
    }
  }
  return { numerator, denominator }
}

function activeTarget(prediction, band) {
  if (prediction < band.lower) {
    return { target: band.lower, weight: 1 }
  }
  if (Number.isFinite(band.upper) && prediction >= band.upper) {
    return { target: band.upper, weight: 1 }
  }
  const center = Number.isFinite(band.upper)
    ? (band.lower + band.upper) / 2
    : band.lower + 0.5
  return { target: center, weight: INTERIOR_TIE_BREAK_WEIGHT }
}

function applyRule(epoch, rule) {
  const observations = epoch.observations.map((observation) => ({
    ...observation,
    band: quotaPhase3DisplayBand(observation.displayed, rule, {
      capped: observation.capped,
    }),
  }))
  return {
    ...epoch,
    observations,
    resetTarget: resetTarget(epoch.openingDisplayed, observations),
  }
}

function resetTarget(opening, observations) {
  if (!observations.length) return null
  const last = observations[observations.length - 1]
  const displayedDelta = last.displayed - opening
  if (last.capped) {
    return {
      total: last.cum,
      displayedDelta,
      band: {
        lower: Math.max(0, Math.min(100, last.displayed) - opening - 1),
        upper: Number.POSITIVE_INFINITY,
        right_censored: true,
      },
    }
  }
  return {
    total: last.cum,
    displayedDelta,
    band: {
      lower: displayedDelta - 1,
      upper: displayedDelta + 1,
      right_censored: false,
    },
  }
}

function publicResetWindow(epoch, beta) {
  if (!epoch.resetTarget) return null
  const predicted = dot(epoch.resetTarget.total, beta)
  return {
    displayed_delta_pct: epoch.resetTarget.displayedDelta,
    predicted_burn_pct: predicted,
    band_distance_pct:
      quotaPhase3BandDistance(predicted, epoch.resetTarget.band) ?? 0,
    point_abs_error_pct: Math.abs(predicted - epoch.resetTarget.displayedDelta),
    inside_band:
      (quotaPhase3BandDistance(predicted, epoch.resetTarget.band) ?? 0) === 0,
  }
}

function compileEpochs(intervals) {
  const sorted = [...intervals].sort(compareIntervalTime)
  const usable = sorted.filter((interval) => !isBoundaryInterval(interval))
  const featureNames = collectFeatureNames(usable)
  const epochs = []
  let current = null
  let openedAfterBoundary = false
  let pendingBoundaries = []

  const flush = () => {
    if (current?.observations.length) {
      current.epochIndex = epochs.length
      epochs.push(current)
    }
    current = null
  }

  for (const interval of sorted) {
    const resetKey = String(interval.expectedResetAt ?? '')
    if (current && current.resetKey !== resetKey) {
      flush()
      openedAfterBoundary = false
      pendingBoundaries = []
    }
    if (isBoundaryInterval(interval)) {
      flush()
      openedAfterBoundary = true
      pendingBoundaries.push({
        interval_start_at: interval.intervalStartAt ?? null,
        interval_end_at: interval.intervalEndAt ?? null,
        previous_consumed_pct: finiteOrNull(interval.previousConsumedPct),
        current_consumed_pct: finiteOrNull(interval.currentConsumedPct),
        delta_pct: finiteOrNull(interval.deltaPct),
      })
      continue
    }
    const displayed = finiteOrNull(interval.currentConsumedPct)
    const previous = finiteOrNull(interval.previousConsumedPct)
    if (displayed === null || previous === null) continue
    if (!current) {
      current = {
        resetKey,
        expectedResetAt: interval.expectedResetAt ?? null,
        startAt: interval.intervalStartAt ?? null,
        endAt: interval.intervalEndAt ?? null,
        openingDisplayed: previous,
        openedAfterBoundary,
        boundaryIntervals: pendingBoundaries,
        observations: [],
        provider: interval.provider,
        quotaKey: interval.quotaKey,
        quotaType: interval.quotaType,
        quotaLane: interval.quotaLane,
      }
      openedAfterBoundary = false
      pendingBoundaries = []
    }
    const increment = featureVector(interval, featureNames)
    const previousCum = current.observations.length
      ? current.observations[current.observations.length - 1].cum
      : Array(featureNames.length).fill(0)
    current.observations.push({
      cum: previousCum.map((value, index) => value + increment[index]),
      increment,
      displayed,
      capped: Boolean(interval.isCappedAt100) || displayed >= 99.5,
      at: interval.intervalEndAt ?? null,
      source: interval,
    })
    current.endAt = interval.intervalEndAt ?? current.endAt
  }
  flush()
  return { featureNames, epochs }
}

function collectFeatureNames(intervals) {
  const families = new Set()
  const used = new Set()
  for (const interval of intervals) {
    for (const [family, totals] of Object.entries(
      interval.featureTotals ?? {}
    )) {
      families.add(family)
      for (const [category, field] of TOKEN_CATEGORIES) {
        if ((totals?.[field] ?? 0) > 0) used.add(`${family}:${category}`)
      }
    }
  }
  const names = []
  for (const family of [...families].sort()) {
    for (const [category] of TOKEN_CATEGORIES) {
      const name = `${family}:${category}`
      if (used.has(name)) names.push(name)
    }
  }
  return names
}

function featureVector(interval, featureNames) {
  return featureNames.map((name) => {
    const [family, category] = name.split(':')
    const field = TOKEN_CATEGORIES.find(([token]) => token === category)?.[1]
    return interval.featureTotals?.[family]?.[field] ?? 0
  })
}

function assessIdentifiability(epochs, featureNames) {
  const observations = epochs.flatMap((epoch) => epoch.observations)
  const count = observations.length
  const active = []
  for (let index = 0; index < featureNames.length; index += 1) {
    let sum = 0
    let sumSquares = 0
    for (const observation of observations) {
      const value = observation.increment[index] ?? 0
      sum += value
      sumSquares += value * value
    }
    if (sum > 1e-8 || sumSquares > 1e-10) active.push(index)
  }
  const maxCorrelation = maxFeatureCorrelation(observations, active)
  const families = new Set(
    active.map((index) => featureNames[index].split(':')[0])
  )
  let status = 'high_confidence'
  const risks = []
  if (count < MIN_OBSERVATIONS || active.length === 0) {
    status = 'not_identifiable'
    risks.push(
      count < MIN_OBSERVATIONS ? 'too_few_observations' : 'no_active_features'
    )
  }
  if (count > 0 && active.length >= count) {
    status = 'not_identifiable'
    risks.push('feature_count_exceeds_observations')
  }
  if (maxCorrelation >= 0.995) {
    status = 'not_identifiable'
    risks.push('features_not_separable')
  } else if (maxCorrelation >= 0.95) {
    if (status === 'high_confidence') status = 'directional_only'
    risks.push('high_feature_correlation')
  }
  if (count < HIGH_CONFIDENCE_OBSERVATIONS && status === 'high_confidence') {
    status = 'directional_only'
    risks.push('small_sample_window')
  }
  if (families.size < 2 && active.length > 0) {
    risks.push('single_model_family')
  }
  return {
    status,
    trainable_interval_count: count,
    effective_sample_size: count,
    active_feature_count: active.length,
    model_family_mix_count: families.size,
    max_feature_correlation: maxCorrelation,
    risks,
  }
}

function maxFeatureCorrelation(observations, activeIndexes) {
  if (observations.length < 3 || activeIndexes.length < 2) return 0
  let maxCorrelation = 0
  for (let left = 0; left < activeIndexes.length; left += 1) {
    for (let right = left + 1; right < activeIndexes.length; right += 1) {
      const a = observations.map(
        (observation) => observation.increment[activeIndexes[left]] ?? 0
      )
      const b = observations.map(
        (observation) => observation.increment[activeIndexes[right]] ?? 0
      )
      const correlation = Math.abs(pearson(a, b))
      if (Number.isFinite(correlation)) {
        maxCorrelation = Math.max(maxCorrelation, correlation)
      }
    }
  }
  return maxCorrelation
}

function pearson(left, right) {
  const count = left.length
  if (!count) return 0
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / count
  const meanRight = right.reduce((sum, value) => sum + value, 0) / count
  let covariance = 0
  let varianceLeft = 0
  let varianceRight = 0
  for (let index = 0; index < count; index += 1) {
    const deltaLeft = left[index] - meanLeft
    const deltaRight = right[index] - meanRight
    covariance += deltaLeft * deltaRight
    varianceLeft += deltaLeft * deltaLeft
    varianceRight += deltaRight * deltaRight
  }
  if (varianceLeft <= 1e-12 || varianceRight <= 1e-12) return 0
  return covariance / Math.sqrt(varianceLeft * varianceRight)
}

function collectDiagnostics(byRule, laneInterval, comparison) {
  const diagnostics = [
    {
      code: 'cache_write_duration_unavailable',
      severity: 'info',
      detail:
        'cache_creation_input_tokens stays one cache-create feature. 5-minute and 1-hour cache-write coefficients are not estimated.',
    },
    {
      code: 'live_phase2_comparison_unmet',
      severity: 'info',
      detail: QUOTA_PHASE3_LIVE_EVALUATION.reason,
    },
  ]
  if (comparison.tie) {
    diagnostics.push({
      code: 'display_rules_not_separable',
      severity: 'info',
      detail:
        'Rounded and floored censored losses are tied on this lane. Both histories are reported.',
    })
  }
  const source = byRule[comparison.preferred_rule] ?? byRule.rounded
  if (source.identifiability.status !== 'high_confidence') {
    diagnostics.push({
      code: 'limited_identifiability',
      severity:
        source.identifiability.status === 'not_identifiable'
          ? 'warning'
          : 'info',
      detail:
        source.identifiability.risks.join(', ') ||
        source.identifiability.status,
    })
  }
  const latest = source.history.epochs[source.history.epochs.length - 1]
  if (latest && isSonnetOnly(laneInterval)) {
    for (const family of ['haiku', 'opus']) {
      const row = latest.coefficients.find(
        (coefficient) => coefficient.feature === `${family}:uncached_input`
      )
      const sonnet = latest.coefficients.find(
        (coefficient) => coefficient.feature === 'sonnet:uncached_input'
      )
      if (
        row &&
        row.coefficient_pct_per_mtok >
          Math.max(0.15, (sonnet?.coefficient_pct_per_mtok ?? 0) * 0.1)
      ) {
        diagnostics.push({
          code: 'sonnet_only_non_sonnet_signal',
          severity: 'warning',
          detail: `${family} remains positive on an Anthropic lane. On the Sonnet-only quota this is contamination, lag, or mapping evidence, not a Sonnet policy weight.`,
        })
      }
    }
  }
  if (latest) {
    const families = new Set(
      latest.coefficients.map((coefficient) => coefficient.model_family)
    )
    for (const family of families) {
      const uncached = latest.coefficients.find(
        (coefficient) => coefficient.feature === `${family}:uncached_input`
      )
      const cacheRead = latest.coefficients.find(
        (coefficient) => coefficient.feature === `${family}:cache_read`
      )
      if (
        uncached &&
        cacheRead &&
        uncached.coefficient_pct_per_mtok > 0 &&
        cacheRead.coefficient_pct_per_mtok > uncached.coefficient_pct_per_mtok
      ) {
        diagnostics.push({
          code: 'cache_read_ratio_above_uncached',
          severity: 'warning',
          detail: `${family} cache-read coefficient is above uncached input. The weak prior expected the opposite; the interval stays wide until the categories vary separately.`,
        })
      }
    }
  }
  const drift = source.history.drift
  if (drift.contamination_transition_count > 0) {
    diagnostics.push({
      code: 'drift_separated_from_contamination',
      severity: 'warning',
      detail:
        'At least one coefficient jump is labeled data-quality contamination and is excluded from gradual-drift sigma.',
    })
  }
  if (drift.artifact_transition_count > 0) {
    diagnostics.push({
      code: 'drift_separated_from_reset_boundary',
      severity: 'info',
      detail:
        'A reset-boundary discontinuity is excluded from gradual-drift sigma.',
    })
  }
  if (drift.sigma_status === 'not_identifiable') {
    diagnostics.push({
      code: 'state_drift_not_identifiable',
      severity: 'info',
      detail: drift.sigma_reason ?? 'drift sigma is not identified',
    })
  }
  return diagnostics
}

const FORECAST_MIN_TRAIN = 4
const FORECAST_RIDGE = 1e-6
const FORECAST_SOLVE_ITERATIONS = 500
const FORECAST_HALF_LIFE_HOURS = {
  short: 5,
  short_special: 5,
  weekly: 72,
  special: 72,
  monthly: 168,
}

function forecastHalfLifeHours(quotaType) {
  return FORECAST_HALF_LIFE_HOURS[quotaType] ?? 72
}

function scaleVector(vector, factor) {
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] *= factor
  }
}

function scaleMatrix(matrix, factor) {
  for (const row of matrix) scaleVector(row, factor)
}

function rankOneUpdate(gram, xty, features, target, weight) {
  for (let left = 0; left < features.length; left += 1) {
    const leftValue = features[left] ?? 0
    if (leftValue === 0) continue
    xty[left] += weight * leftValue * target
    for (let right = 0; right < features.length; right += 1) {
      gram[left][right] += weight * leftValue * (features[right] ?? 0)
    }
  }
}

function solveNonNegativeNormal(gram, xty, warm) {
  const count = xty.length
  const beta = warm ? warm.slice() : Array(count).fill(0)
  for (
    let iteration = 0;
    iteration < FORECAST_SOLVE_ITERATIONS;
    iteration += 1
  ) {
    let maxChange = 0
    for (let featureIndex = 0; featureIndex < count; featureIndex += 1) {
      let adjustment = 0
      const row = gram[featureIndex]
      for (let other = 0; other < count; other += 1) {
        if (other === featureIndex) continue
        adjustment += (row?.[other] ?? 0) * (beta[other] ?? 0)
      }
      const denominator = (row?.[featureIndex] ?? 0) + FORECAST_RIDGE
      if (denominator <= 0) continue
      const next = Math.max(
        0,
        ((xty[featureIndex] ?? 0) - adjustment) / denominator
      )
      const change = next - beta[featureIndex]
      beta[featureIndex] = next
      maxChange = Math.max(maxChange, Math.abs(change))
    }
    if (maxChange < 1e-10) break
  }
  return beta
}

export function quotaPhase3OneStepDisplayedChangeResiduals(
  intervals,
  options = {}
) {
  const compiled = compileEpochs(intervals ?? [])
  const featureNames = [...(options.featureNames ?? compiled.featureNames)]
  if (!featureNames.length) return []
  const rule = options.displayRule ?? 'rounded'
  const epochs = compiled.epochs.map((epoch) => applyRule(epoch, rule))
  const semantics = providerSemantics(intervals?.[0] ?? {})
  return phase3OneStepDisplayedChangeResidualRows(
    epochs,
    featureNames,
    semantics,
    rule
  ).map((row) => row.residual_pct)
}

function groupIntervals(intervals, selectedLagByLane) {
  const byLane = new Map()
  for (const interval of intervals) {
    const key = laneKey(interval)
    const rows = byLane.get(key) ?? []
    rows.push(interval)
    byLane.set(key, rows)
  }
  const lanes = []
  for (const [key, rows] of byLane) {
    const lags = [...new Set(rows.map((interval) => lagOf(interval)))].sort(
      (left, right) => left - right
    )
    const requested = selectedLagByLane[key]
    const lag = lags.includes(requested)
      ? requested
      : lags.includes(0)
        ? 0
        : lags[0]
    lanes.push({
      key,
      lag,
      lagFallback: requested !== undefined && requested !== lag,
      intervals: rows.filter((interval) => lagOf(interval) === lag),
    })
  }
  lanes.sort((left, right) => left.key.localeCompare(right.key))
  return lanes
}

function providerSemantics(interval) {
  if (interval.provider === 'openai') {
    if (
      interval.quotaType === 'short_special' ||
      interval.quotaType === 'special'
    ) {
      return { id: 'openai_spark', anchorFamily: 'spark', sonnetOnly: false }
    }
    return { id: 'openai_codex', anchorFamily: 'codex', sonnetOnly: false }
  }
  if (interval.provider === 'anthropic') {
    return {
      id: 'anthropic_sonnet',
      anchorFamily: 'sonnet',
      sonnetOnly: isSonnetOnly(interval),
    }
  }
  return { id: 'unknown', anchorFamily: null, sonnetOnly: false }
}

function isSonnetOnly(interval) {
  return (
    interval?.provider === 'anthropic' &&
    (interval.quotaType === 'special' ||
      interval.quotaLane === 'anthropic_weekly_sonnet')
  )
}

function isBoundaryInterval(interval) {
  if (interval?.isResetBoundary) return true
  const previous = Number(interval?.previousConsumedPct)
  const current = Number(interval?.currentConsumedPct)
  return (
    Number.isFinite(previous) && Number.isFinite(current) && current < previous
  )
}

function epochEstimateStatus(laneStatus, count) {
  if (count < MIN_OBSERVATIONS) return 'not_identifiable'
  if (
    count < HIGH_CONFIDENCE_OBSERVATIONS &&
    laneStatus === 'high_confidence'
  ) {
    return 'directional_only'
  }
  return laneStatus
}

function featureStatus(epoch, featureIndex, epochStatus) {
  const usage = epoch.observations.reduce(
    (sum, observation) => sum + (observation.increment[featureIndex] ?? 0),
    0
  )
  if (usage <= 1e-8) return 'not_identifiable'
  return epochStatus
}

function featureUsage(epoch, featureNames, feature) {
  const index = featureNames.indexOf(feature)
  if (index < 0) return 0
  return epoch.observations.reduce(
    (sum, observation) => sum + (observation.increment[index] ?? 0),
    0
  )
}

function coefficientValue(beta, featureNames, feature) {
  const index = featureNames.indexOf(feature)
  if (index < 0) return 0
  return beta[index] ?? 0
}

function predictLevel(opening, cum, beta) {
  return opening + dot(cum, beta)
}

function dot(left, right) {
  let total = 0
  const count = Math.max(left?.length ?? 0, right?.length ?? 0)
  for (let index = 0; index < count; index += 1) {
    total += (left?.[index] ?? 0) * (right?.[index] ?? 0)
  }
  return total
}

function laneKey(interval) {
  return [
    interval.provider,
    interval.quotaKey,
    interval.quotaType,
    interval.quotaLane,
  ].join('|')
}

function lagOf(interval) {
  const lag = Number(interval.lagMinutes)
  return Number.isFinite(lag) ? lag : 0
}

function compareIntervalTime(left, right) {
  const leftTime = Date.parse(left.intervalEndAt ?? '')
  const rightTime = Date.parse(right.intervalEndAt ?? '')
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return leftTime - rightTime
  }
  return String(left.intervalEndAt ?? '').localeCompare(
    String(right.intervalEndAt ?? '')
  )
}

function meanOf(values) {
  const finite = (values ?? []).filter((value) => Number.isFinite(value))
  if (!finite.length) return null
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function finiteOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function unique(values) {
  return [...new Set(values)]
}
