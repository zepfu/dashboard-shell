export interface QuotaPhase3Band {
  lower: number
  upper: number
  right_censored: boolean
}

export interface QuotaPhase3Coefficient {
  feature: string
  model_family: string
  token_category: string
  coefficient_pct_per_mtok: number
  confidence_low_pct_per_mtok: number
  confidence_high_pct_per_mtok: number
  estimate_status: 'high_confidence' | 'directional_only' | 'not_identifiable'
  anchor_family: string | null
  anchor_semantics: string
  relative_weight_vs_anchor: number | null
  relative_weight_vs_sonnet: number | null
}

export interface QuotaPhase3Epoch {
  epoch_index: number
  observation_count: number
  opened_after_reset_boundary: boolean
  coefficients: QuotaPhase3Coefficient[]
  reset_window: {
    displayed_delta_pct: number
    predicted_burn_pct: number
    band_distance_pct: number
    point_abs_error_pct: number
    inside_band: boolean
  } | null
}

export interface QuotaPhase3Transition {
  classification:
    | 'stable'
    | 'gradual_drift'
    | 'data_quality_contamination'
    | 'reset_boundary_artifact'
  innovation_l2: number
  reset_boundary_between: boolean
  contamination_reasons: string[]
}

export interface QuotaPhase3History {
  provider_semantics: string
  anchor_family: string | null
  epochs: QuotaPhase3Epoch[]
  drift: {
    sigma_status: string
    sigma_reason: string | null
    sigma_pct_per_mtok_by_feature: Record<string, number | null> | null
    transitions: QuotaPhase3Transition[]
    gradual_transition_count: number
    artifact_transition_count: number
    contamination_transition_count: number
  }
}

export interface QuotaPhase3RuleScore {
  mean_observation_band_distance: number | null
  mean_reset_window_band_distance: number | null
  mean_reset_window_point_abs_error: number | null
  interval_residual_autocorrelation: number | null
  interval_residual_abs_autocorrelation: number | null
  phase2_interval_residual_autocorrelation: number | null
  phase2_interval_residual_abs_autocorrelation: number | null
  phase2_reset_window_one_step_sum_mae_pct: number | null
  phase3_reset_window_one_step_sum_mae_pct: number | null
  partial_phase2_reset_window_one_step_sum_mae_pct: number | null
  partial_phase3_reset_window_one_step_sum_mae_pct: number | null
  phase3_reset_window_mean_band_distance_pct: number | null
  reset_window_count: number
  partial_reset_window_count: number
  diagnostic_reset_window_count: number
  interval_forecast_count: number
  paired_plateau_interval_count: number
  same_interval_cohort: boolean
  reset_window_id_sha256: string | null
  phase2_interval_id_sha256: string | null
  unmatched_phase2_interval_count: number
  unmatched_phase3_interval_count: number
  unmatched_phase2_reset_window_count: number
  unmatched_phase3_reset_window_count: number
  paired_autocorrelation_interval_count: number
  paired_autocorrelation_series_count: number
  clear_uncertainty_intervals: boolean
  holdout_mean_band_distance: number | null
  selection_distance: number | null
  identifiability_status: string
}

export interface QuotaPhase3EvaluationInterval {
  interval_id: string
  lane_id: string
  series_id: string
  reset_window_id: string
  interval_start_at: string
  interval_end_at: string
  observed_pct: number
  predicted_pct: number
  residual_pct: number
  predicted_latent_increment_pct?: number
  display_rule?: 'rounded' | 'floored'
  model?: string
}

export interface QuotaPhase3Estimate {
  provider: string
  quota_key: string
  quota_type: string
  quota_lane: string
  provider_semantics: string
  anchor_family: string | null
  observation_count: number
  identifiability: {
    status: 'high_confidence' | 'directional_only' | 'not_identifiable'
    risks: string[]
    trainable_interval_count: number
    active_feature_count: number
    max_feature_correlation: number
  }
  display_rule_comparison: {
    basis: string
    preferred_rule: 'rounded' | 'floored' | null
    tie: boolean
    live_backtest: boolean
    rounded: QuotaPhase3RuleScore
    floored: QuotaPhase3RuleScore
  }
  coefficient_history_by_rule: {
    rounded: QuotaPhase3History
    floored: QuotaPhase3History
  }
  diagnostics: Array<{ code: string; severity: string; detail: string }>
  phase2_comparison: QuotaPhase3Comparison
}

export interface QuotaPhase3Report {
  phase: '3'
  estimator_version: string
  model: string
  cache_read_prior: {
    numeric_ratio: null
    strength: string
    evidence: string
  }
  cache_write_policy: {
    duration_split: 'unavailable'
    generic_feature: string
    coefficients_not_estimated: string[]
  }
  live_evaluation: {
    status: 'met' | 'unmet'
    evidence_status:
      | 'retained_live_verified'
      | 'retained_live_unverified'
      | 'provided_unverified'
      | 'not_retained'
    better_reset_window_calibration: 'met' | 'unmet'
    lower_interval_residual_autocorrelation: 'met' | 'unmet'
    clear_uncertainty_intervals: 'met' | 'unmet'
    evidence_search: Record<string, string>
    reason: string
  }
  phase2_comparison: QuotaPhase3Comparison
  estimates: QuotaPhase3Estimate[]
}

export interface QuotaPhase3Comparison {
  scope: string
  live_evaluation_status: 'met' | 'unmet'
  evidence_status:
    | 'retained_live_verified'
    | 'retained_live_unverified'
    | 'provided_unverified'
    | 'not_retained'
  phase0_2_prerequisite_status: 'met' | 'incomplete'
  acceptance: {
    better_reset_window_calibration: 'met' | 'unmet'
    lower_interval_residual_autocorrelation: 'met' | 'unmet'
    clear_uncertainty_intervals: 'met' | 'unmet'
  }
  metric_outcomes: {
    better_reset_window_calibration: 'better' | 'worse' | 'tie' | 'unavailable'
    lower_interval_residual_autocorrelation:
      | 'better'
      | 'worse'
      | 'tie'
      | 'unavailable'
    clear_uncertainty_intervals: 'available' | 'unavailable'
  }
  cohort: Record<string, number | boolean | string | null>
  phase0_2_prerequisites: Record<string, unknown>
  evidence: Record<string, unknown>
  note: string
  metric_definitions: Record<string, string>
  metrics: Record<string, number | null>
}

export function quotaPhase3DisplayBand(
  displayedPct: number,
  rule: 'rounded' | 'floored',
  options?: { capped?: boolean }
): QuotaPhase3Band | null

export function quotaPhase3BandDistance(
  prediction: number,
  band: QuotaPhase3Band | null
): number | null

export function quotaPhase3ProjectDisplayedChange(input: {
  latentPreviousPct: number
  previousDisplayedPct: number
  previousDisplayBandCenterPct?: number
  latentIncrementPct: number
  displayRule: 'rounded' | 'floored'
}): number

export function quotaPhase3Lag1Autocorrelation(
  values: readonly number[]
): number | null

export function quotaPhase3OneStepDisplayedChangeResiduals(
  intervals: readonly object[],
  options?: {
    featureNames?: readonly string[]
    displayRule?: 'rounded' | 'floored'
  }
): number[]

export function compareQuotaPhase3ToPhase2(input?: {
  scope?: string
  phase2?: {
    interval_residuals?: readonly QuotaPhase3EvaluationInterval[]
  }
  phase3?: {
    interval_residuals?: readonly QuotaPhase3EvaluationInterval[]
    reset_band_distances?: ReadonlyArray<{
      reset_window_id: string
      band_distance_pct: number | null
    }>
    uncertainty_intervals?: ReadonlyArray<{
      confidence_low_pct_per_mtok: number | null
      confidence_high_pct_per_mtok: number | null
      estimate_status:
        | 'high_confidence'
        | 'directional_only'
        | 'not_identifiable'
    }>
  }
  expectedIntervalManifest?: ReadonlyArray<{
    interval_id: string
    reset_window_id: string
  }>
  phase0_2Prerequisites?: Record<string, unknown>
  evidence?: Record<string, unknown>
}): QuotaPhase3Comparison

export function buildQuotaPhase3Report(
  intervals: readonly object[],
  options?: {
    from?: string | null
    to?: string | null
    selectedLagByLane?: Record<string, number>
    phase2Estimates?: readonly object[]
    comparisonScope?: string
    evaluationEvidence?: Record<string, unknown>
  }
): QuotaPhase3Report

export interface QuotaPhase3ArtifactValidation {
  status: 'verified' | 'unverified'
  validation: string
  sha256: string
  source_revision: string | null
  failures: string[]
  [key: string]: unknown
}

export function validateQuotaPhase3RetainedCohort(input?: {
  artifactText?: string
  expectedSha256?: string
  expectedSourceRevision?: string
}): QuotaPhase3ArtifactValidation

export function validateQuotaPhase3Phase2Baseline(input?: {
  artifactText?: string
  expectedSha256?: string
  expectedSourceRevision?: string
  expectedCohortSha256?: string
}): QuotaPhase3ArtifactValidation

export const QUOTA_PHASE3_CACHE_READ_PRIOR: QuotaPhase3Report['cache_read_prior']

export const QUOTA_PHASE3_LIVE_EVALUATION: QuotaPhase3Report['live_evaluation']

export const QUOTA_PHASE3_CACHE_WRITE_POLICY: QuotaPhase3Report['cache_write_policy']
