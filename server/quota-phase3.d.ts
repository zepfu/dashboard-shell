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
  holdout_mean_band_distance: number | null
  selection_distance: number | null
  identifiability_status: string
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
  phase2_comparison: {
    live_evaluation_status: string
    acceptance: {
      better_reset_window_calibration: string
      lower_interval_residual_autocorrelation: string
    }
    metric_definitions?: {
      phase2_interval_residual: string
      phase3_interval_residual: string
    }
    metrics?: Record<string, number | null>
  }
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
    status: string
    better_reset_window_calibration: string
    lower_interval_residual_autocorrelation: string
    clear_uncertainty_intervals: string
    evidence_search: Record<string, string>
    reason: string
  }
  phase2_comparison: {
    scope: string
    live_evaluation_status: string
    acceptance: {
      better_reset_window_calibration: string
      lower_interval_residual_autocorrelation: string
      clear_uncertainty_intervals: string
    }
    metric_definitions: {
      phase2_interval_residual: string
      phase3_interval_residual: string
      phase2_reset: string
      phase3_reset: string
    }
    metrics: Record<string, number | null>
    note: string
  }
  estimates: QuotaPhase3Estimate[]
}

export interface QuotaPhase3Comparison {
  scope: string
  live_evaluation_status: string
  acceptance: {
    better_reset_window_calibration: string
    lower_interval_residual_autocorrelation: string
    clear_uncertainty_intervals: string
  }
  note: string
  metric_definitions: {
    phase2_interval_residual: string
    phase3_interval_residual: string
    phase2_reset: string
    phase3_reset: string
  }
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

export function quotaPhase3Lag1Autocorrelation(
  values: readonly number[]
): number | null

export function quotaPhase3OneStepDisplayedChangeResiduals(
  intervals: readonly object[],
  options?: { featureNames?: readonly string[] }
): number[]

export function compareQuotaPhase3ToPhase2(input?: {
  scope?: string
  phase2?: {
    reset_window_mae_pct?: number | null
    interval_residual_autocorrelation?: number | null
  }
  phase3?: {
    reset_window_mean_band_distance_pct?: number | null
    reset_window_point_mae_pct?: number | null
    interval_residual_autocorrelation?: number | null
  }
}): QuotaPhase3Comparison

export function buildQuotaPhase3Report(
  intervals: readonly object[],
  options?: {
    from?: string | null
    to?: string | null
    selectedLagByLane?: Record<string, number>
    phase2Estimates?: readonly object[]
    comparisonScope?: string
  }
): QuotaPhase3Report

export const QUOTA_PHASE3_CACHE_READ_PRIOR: QuotaPhase3Report['cache_read_prior']

export const QUOTA_PHASE3_LIVE_EVALUATION: QuotaPhase3Report['live_evaluation']

export const QUOTA_PHASE3_CACHE_WRITE_POLICY: QuotaPhase3Report['cache_write_policy']
