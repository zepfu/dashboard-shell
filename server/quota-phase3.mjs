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
  better_reset_window_calibration: 'unmet',
  lower_interval_residual_autocorrelation: 'unmet',
  clear_uncertainty_intervals: 'met',
  evidence_search: {
    phase_0_2_residual_reports: 'not_found_in_repository',
    lag_sensitivity_artifacts: 'not_found_in_repository',
    identifiability_score_artifacts: 'not_found_in_repository',
    rolling_vs_static_backtests: 'not_found_in_repository',
    d1_092_todo_record: 'not_in_todo_store',
  },
  reason:
    'No verified Phase 0-2 residual report, lag-sensitivity result, identifiability score, or rolling-versus-static backtest is stored in this repository. D1-092 is not in the TODO store. Fixture and in-request comparisons are descriptive and do not establish live calibration.',
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
} = {}) {
  return {
    scope,
    live_evaluation_status: QUOTA_PHASE3_LIVE_EVALUATION.status,
    acceptance: {
      better_reset_window_calibration: 'unmet',
      lower_interval_residual_autocorrelation: 'unmet',
      clear_uncertainty_intervals: 'met',
    },
    note: QUOTA_PHASE3_LIVE_EVALUATION.reason,
    metric_definitions: {
      phase2_interval_residual:
        'displayed_delta_minus_phase2_rolling_prediction',
      phase3_interval_residual:
        'displayed_delta_minus_phase3_one_step_forecast',
      phase2_reset: 'mean_absolute_error_of_summed_trainable_deltas',
      phase3_reset: 'mean_distance_outside_the_censored_reset_band',
    },
    metrics: {
      phase2_reset_window_mae_pct: finiteOrNull(phase2.reset_window_mae_pct),
      phase3_reset_window_mean_band_distance_pct: finiteOrNull(
        phase3.reset_window_mean_band_distance_pct
      ),
      phase3_reset_window_point_mae_pct: finiteOrNull(
        phase3.reset_window_point_mae_pct
      ),
      phase2_interval_residual_autocorrelation: finiteOrNull(
        phase2.interval_residual_autocorrelation
      ),
      phase3_interval_residual_autocorrelation: finiteOrNull(
        phase3.interval_residual_autocorrelation
      ),
    },
  }
}

export function buildQuotaPhase3Report(intervals, options = {}) {
  const lanes = groupIntervals(intervals ?? [], options.selectedLagByLane ?? {})
  const phase2ByLane = phase2CoefficientsByLane(options.phase2Estimates)
  const estimates = lanes.map((lane) =>
    buildLaneEstimate(lane, phase2ByLane.get(lane.key))
  )
  const comparison = compareQuotaPhase3ToPhase2({
    scope: options.comparisonScope ?? 'in_request',
    phase2: {
      reset_window_mae_pct: meanOf(
        estimates.map(
          (estimate) =>
            estimate.phase2_comparison.metrics.phase2_reset_window_mae_pct
        )
      ),
      interval_residual_autocorrelation: meanOf(
        estimates.map(
          (estimate) =>
            estimate.phase2_comparison.metrics
              .phase2_interval_residual_autocorrelation
        )
      ),
    },
    phase3: {
      reset_window_mean_band_distance_pct: meanOf(
        estimates.map(
          (estimate) =>
            estimate.phase2_comparison.metrics
              .phase3_reset_window_mean_band_distance_pct
        )
      ),
      reset_window_point_mae_pct: meanOf(
        estimates.map(
          (estimate) =>
            estimate.phase2_comparison.metrics.phase3_reset_window_point_mae_pct
        )
      ),
      interval_residual_autocorrelation: meanOf(
        estimates.map(
          (estimate) =>
            estimate.phase2_comparison.metrics
              .phase3_interval_residual_autocorrelation
        )
      ),
    },
  })

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
    live_evaluation: QUOTA_PHASE3_LIVE_EVALUATION,
    phase2_comparison: comparison,
    estimates,
    from: options.from ?? null,
    to: options.to ?? null,
  }
}

function buildLaneEstimate(lane, phase2Coefficients) {
  const compiled = compileEpochs(lane.intervals)
  const semantics = providerSemantics(lane.intervals[0] ?? {})
  const byRule = {}
  for (const rule of DISPLAY_RULES) {
    byRule[rule] = fitDisplayRule(compiled, rule, semantics)
  }
  const forecastAutocorrelation = quotaPhase3Lag1Autocorrelation(
    quotaPhase3OneStepDisplayedChangeResiduals(lane.intervals, {
      featureNames: compiled.featureNames,
    })
  )
  for (const rule of DISPLAY_RULES) {
    byRule[rule].interval_residual_autocorrelation = forecastAutocorrelation
  }
  const comparison = compareDisplayRules(byRule)
  const phase2Summary = summarizePhase2(lane.intervals, phase2Coefficients)
  const summarySource = comparison.preferred_rule
    ? byRule[comparison.preferred_rule]
    : null
  const phase3Summary = {
    reset_window_mean_band_distance_pct: summarySource
      ? summarySource.mean_reset_window_band_distance
      : meanOf([
          byRule.rounded.mean_reset_window_band_distance,
          byRule.floored.mean_reset_window_band_distance,
        ]),
    reset_window_point_mae_pct: summarySource
      ? summarySource.mean_reset_window_point_abs_error
      : meanOf([
          byRule.rounded.mean_reset_window_point_abs_error,
          byRule.floored.mean_reset_window_point_abs_error,
        ]),
    interval_residual_autocorrelation: summarySource
      ? summarySource.interval_residual_autocorrelation
      : meanOf([
          byRule.rounded.interval_residual_autocorrelation,
          byRule.floored.interval_residual_autocorrelation,
        ]),
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
      scope: 'in_request',
      phase2: phase2Summary,
      phase3: phase3Summary,
    }),
  }
}

function fitDisplayRule(compiled, rule, semantics) {
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
    interval_residual_autocorrelation: null,
    holdout_mean_band_distance: holdout,
    selection_distance:
      holdout === null ? meanOf(observationDistances) : holdout,
    selection_basis:
      holdout === null
        ? 'in_sample_censored_loss'
        : 'heldout_tail_censored_loss',
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
const FORECAST_SOLVE_ITERATIONS = 80
const FORECAST_PHI_PRIOR = 12
const FORECAST_PHI_LIMIT = 0.95
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

function shrunkChangePersistence(residuals) {
  const raw = quotaPhase3Lag1Autocorrelation(residuals)
  if (raw === null) return 0
  const shrunk =
    raw * (residuals.length / (residuals.length + FORECAST_PHI_PRIOR))
  return Math.max(-FORECAST_PHI_LIMIT, Math.min(FORECAST_PHI_LIMIT, shrunk))
}

export function quotaPhase3OneStepDisplayedChangeResiduals(
  intervals,
  options = {}
) {
  const trainable = [...(intervals ?? [])]
    .filter(
      (interval) =>
        interval.trainable &&
        !isBoundaryInterval(interval) &&
        Number.isFinite(Number(interval.deltaPct))
    )
    .sort(compareIntervalTime)
  const featureNames = [
    ...(options.featureNames ??
      collectFeatureNames(
        trainable.filter((interval) => !isBoundaryInterval(interval))
      )),
  ]
  if (!featureNames.length || trainable.length <= FORECAST_MIN_TRAIN) return []

  const featureCount = featureNames.length
  const gram = Array.from({ length: featureCount }, () =>
    Array(featureCount).fill(0)
  )
  const xty = Array(featureCount).fill(0)
  let beta = Array(featureCount).fill(0)
  let trained = 0
  let lastTime = null
  const halfLife = forecastHalfLifeHours(trainable[0]?.quotaType)
  const regressionResiduals = []
  const innovations = []

  for (const interval of trainable) {
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
    const features = featureVector(interval, featureNames)
    const displayedDelta = Number(interval.deltaPct)
    if (trained >= FORECAST_MIN_TRAIN) {
      beta = solveNonNegativeNormal(gram, xty, beta)
      const regressionResidual = displayedDelta - dot(features, beta)
      const persistence =
        regressionResiduals.length === 0
          ? 0
          : shrunkChangePersistence(regressionResiduals) *
            regressionResiduals[regressionResiduals.length - 1]
      innovations.push(regressionResidual - persistence)
      regressionResiduals.push(regressionResidual)
    }
    rankOneUpdate(gram, xty, features, displayedDelta, 1)
    trained += 1
    if (finiteTime !== null) lastTime = finiteTime
  }
  return innovations
}

function summarizePhase2(intervals, coefficients) {
  if (!coefficients || !Object.keys(coefficients).length) {
    return {
      reset_window_mae_pct: null,
      interval_residual_autocorrelation: null,
    }
  }
  const trainable = intervals.filter(
    (interval) =>
      interval.trainable &&
      !isBoundaryInterval(interval) &&
      Number.isFinite(Number(interval.deltaPct))
  )
  const residuals = trainable.map(
    (interval) =>
      Number(interval.deltaPct) - predictPhase2Delta(interval, coefficients)
  )
  const windows = new Map()
  for (const interval of trainable) {
    const key = String(interval.expectedResetAt ?? '')
    const window = windows.get(key) ?? { predicted: 0, observed: 0 }
    window.predicted += predictPhase2Delta(interval, coefficients)
    window.observed += Number(interval.deltaPct)
    windows.set(key, window)
  }
  const errors = [...windows.values()].map((window) =>
    Math.abs(window.predicted - window.observed)
  )
  return {
    reset_window_mae_pct: meanOf(errors),
    interval_residual_autocorrelation:
      quotaPhase3Lag1Autocorrelation(residuals),
  }
}

function predictPhase2Delta(interval, coefficients) {
  let total = 0
  for (const [family, totals] of Object.entries(interval.featureTotals ?? {})) {
    const workload =
      (totals.uncachedInputMtok ?? 0) +
      (totals.outputMtok ?? 0) +
      (totals.cacheCreateMtok ?? 0) +
      (totals.reasoningMtok ?? 0)
    total += workload * (coefficients[`${family}:workload`] ?? 0)
    total +=
      (totals.cacheReadMtok ?? 0) * (coefficients[`${family}:cache_read`] ?? 0)
  }
  return total
}

function phase2CoefficientsByLane(estimates) {
  const map = new Map()
  for (const estimate of estimates ?? []) {
    const key = [
      estimate.provider,
      estimate.quota_key,
      estimate.quota_type,
      estimate.quota_lane,
    ].join('|')
    const coefficients = {}
    for (const row of estimate.coefficients ?? []) {
      if (row.estimate_kind === 'rolling_exponential') {
        coefficients[row.feature] = row.coefficient_pct_per_mtok
      }
    }
    map.set(key, coefficients)
  }
  return map
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
