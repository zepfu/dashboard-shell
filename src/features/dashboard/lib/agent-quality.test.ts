import { describe, expect, test } from 'vitest'
import {
  agentQualityFromFlatRow,
  agentQualityIssueSortValue,
  combineAgentQualitySummaries,
} from './agent-quality'

test('agent_quality_from_flat_row_preserves_discovery_and_terminal_scores', () => {
  const summary = agentQualityFromFlatRow({
    traces: 3,
    agent_score_rows: 3,
    agent_quality_score: 1,
    agent_quality_evaluated: 3,
    agent_quality_possible: 3,
    agent_quality_failures: 0,
    agent_discovery_inventory_coverage_score: null,
    agent_discovery_inventory_coverage_evaluated: 2,
    agent_discovery_inventory_coverage_possible: 4,
    agent_discovery_inventory_coverage_failures: 1,
    agent_discovery_inventory_missing_count: 5,
    agent_terminal_completion_score: 0,
    agent_terminal_completion_evaluated: 2,
    agent_terminal_completion_possible: 2,
    agent_terminal_completion_failures: 1,
  })

  expect(summary).toBeDefined()
  expect(summary?.discoveryInventoryCoverage.score).toBeNull()
  expect(summary?.discoveryInventoryCoverage.evaluated).toBe(2)
  expect(summary?.discoveryInventoryCoverage.issueCount).toBe(1)
  expect(summary?.discoveryInventoryMissingCount).toBe(5)
  expect(summary?.terminalCompletion?.score).toBe(0)
  expect(summary?.terminalCompletion?.evaluated).toBe(2)
  expect(summary?.terminalCompletion?.issueCount).toBe(1)
})

test('combine_agent_quality_summaries_keeps_null_discovery_scores_out_of_failures', () => {
  const base = {
    totalRows: 1,
    quality: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    instruction: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    tool: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    contract: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    progress: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    risk: { score: 0, evaluated: 1, possible: 1, issueCount: 0 },
    discoveryInventoryCoverage: {
      score: null,
      evaluated: 2,
      possible: 4,
      issueCount: 1,
    },
    discoveryInventoryMissingCount: 3,
    terminalCompletion: {
      score: null,
      evaluated: 0,
      possible: 0,
      issueCount: 0,
    },
    emptyCompletionFailures: 0,
    invalidToolCallErrors: 0,
    destructiveCheckoutFailures: 0,
    largePayloadRisks: 0,
    readOnlyPolicyViolations: 0,
    ignoredPathTracking: {
      score: null,
      evaluated: 0,
      possible: 0,
      violationCount: 0,
    },
    baselineDeflection: {
      attemptedScore: null,
      attemptedEvaluated: 0,
      attemptedIncidents: 0,
      incidentScore: null,
      incidentEvaluated: 0,
      incidentIncidents: 0,
      attemptCount: 0,
      toolCallCount: 0,
      inputTokens: 0,
      elapsedMs: 0,
      qualityGateTriggerCount: 0,
      qualityGateFixAttemptCount: 0,
      qualityGateRerunCount: 0,
    },
    sleepWellnessInterruption: {
      attemptedScore: null,
      attemptedEvaluated: 0,
      attemptedIncidents: 0,
      incidentScore: null,
      incidentEvaluated: 0,
      incidentIncidents: 0,
      interruptionCount: 0,
      outputTokens: 0,
      inputTokens: 0,
      elapsedMs: 0,
      afterUserPushbackCount: 0,
      repeatedCount: 0,
    },
    reasons: [],
  } as const

  const combined = combineAgentQualitySummaries([
    base,
    {
      ...base,
      discoveryInventoryCoverage: {
        score: 0.5,
        evaluated: 2,
        possible: 2,
        issueCount: 0,
      },
      discoveryInventoryMissingCount: 1,
      terminalCompletion: {
        score: 1,
        evaluated: 2,
        possible: 2,
        issueCount: 0,
      },
    },
  ])

  expect(combined).toBeDefined()
  expect(combined?.discoveryInventoryCoverage.score).toBe(0.5)
  expect(combined?.discoveryInventoryCoverage.evaluated).toBe(4)
  expect(combined?.discoveryInventoryCoverage.issueCount).toBe(1)
  expect(combined?.discoveryInventoryMissingCount).toBe(4)
  expect(combined?.terminalCompletion?.score).toBe(1)
  expect(combined?.terminalCompletion?.evaluated).toBe(2)
})

test('agent_quality_from_flat_row_preserves_compact_summary_counts', () => {
  const summary = agentQualityFromFlatRow({
    traces: 4,
    agent_compact_summary_events: 2,
    agent_compact_summary_thread_count: 1,
    agent_compact_summary_id_count: 2,
    agent_compact_summary_resume_contexts: 3,
    agent_compact_summary_verify_contexts: 1,
    agent_compact_summary_source_counts:
      '{"codex":2,"gemini-cli":1,"claude-code":0}',
  })

  expect(summary).toBeDefined()
  expect(summary?.compactSummary).toEqual({
    eventCount: 2,
    threadCount: 1,
    idCount: 2,
    resumeContextCount: 3,
    verifyContextCount: 1,
    sourceCounts: {
      codex: 2,
      'gemini-cli': 1,
    },
  })
})

test('combine_agent_quality_summaries_sums_compact_source_counts', () => {
  const base = {
    totalRows: 1,
    quality: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    instruction: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    tool: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    contract: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    progress: { score: 1, evaluated: 1, possible: 1, issueCount: 0 },
    risk: { score: 0, evaluated: 1, possible: 1, issueCount: 0 },
    discoveryInventoryCoverage: {
      score: null,
      evaluated: 0,
      possible: 0,
      issueCount: 0,
    },
    discoveryInventoryMissingCount: 0,
    terminalCompletion: {
      score: null,
      evaluated: 0,
      possible: 0,
      issueCount: 0,
    },
    emptyCompletionFailures: 0,
    invalidToolCallErrors: 0,
    destructiveCheckoutFailures: 0,
    largePayloadRisks: 0,
    readOnlyPolicyViolations: 0,
    ignoredPathTracking: {
      score: null,
      evaluated: 0,
      possible: 0,
      violationCount: 0,
    },
    baselineDeflection: {
      attemptedScore: null,
      attemptedEvaluated: 0,
      attemptedIncidents: 0,
      incidentScore: null,
      incidentEvaluated: 0,
      incidentIncidents: 0,
      attemptCount: 0,
      toolCallCount: 0,
      inputTokens: 0,
      elapsedMs: 0,
      qualityGateTriggerCount: 0,
      qualityGateFixAttemptCount: 0,
      qualityGateRerunCount: 0,
    },
    sleepWellnessInterruption: {
      attemptedScore: null,
      attemptedEvaluated: 0,
      attemptedIncidents: 0,
      incidentScore: null,
      incidentEvaluated: 0,
      incidentIncidents: 0,
      interruptionCount: 0,
      outputTokens: 0,
      inputTokens: 0,
      elapsedMs: 0,
      afterUserPushbackCount: 0,
      repeatedCount: 0,
    },
    compactSummary: {
      eventCount: 1,
      threadCount: 1,
      idCount: 1,
      resumeContextCount: 2,
      verifyContextCount: 0,
      sourceCounts: { codex: 1 },
    },
    reasons: [],
  } as const

  const combined = combineAgentQualitySummaries([
    base,
    {
      ...base,
      compactSummary: {
        eventCount: 2,
        threadCount: 1,
        idCount: 2,
        resumeContextCount: 0,
        verifyContextCount: 1,
        sourceCounts: { codex: 1, 'gemini-cli': 1 },
      },
    },
  ])

  expect(combined?.compactSummary).toEqual({
    eventCount: 3,
    threadCount: 2,
    idCount: 3,
    resumeContextCount: 2,
    verifyContextCount: 1,
    sourceCounts: {
      codex: 2,
      'gemini-cli': 1,
    },
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-13: scoredEvaluated honest denominator (net-new field)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-13: The existing `evaluated` field counts ALL observations (scored +
 * unscored), which inflates the denominator when computing coverage ratios.
 * The engineer must add a `scoredEvaluated` field to `AgentQualityFamilySummary`
 * that counts only observations that actually produced a score (score !== null).
 *
 * Regression contract: `scoredEvaluated` on `AgentQualityFamilySummary` counts
 * only rows with a non-null score (`familyFromFlat` / `combineFamily`).
 */

describe('agent-quality scoredEvaluated honest denominator (S4-13)', () => {
  test('test_agent_quality_scoredEvaluated_only_counts_scored_rows', () => {
    // Mix: 3 rows evaluated, but only 2 have a real score
    const summary = agentQualityFromFlatRow({
      traces: 3,
      agent_score_rows: 3,
      // quality: 2 rows scored (score=0.9), 1 row with null score
      // The flat row represents the aggregate from the server.
      // We simulate: evaluated=3, score covers 2 rows (score=0.9*(2/3) ≈ 0.6)
      agent_quality_score: 0.6,
      agent_quality_evaluated: 3,
      agent_quality_possible: 3,
      agent_quality_failures: 1,
    })

    expect(summary).toBeDefined()
    // `evaluated` must still be 3 (total rows processed)
    expect(summary?.quality.evaluated).toBe(3)

    // `scoredEvaluated` must be ≤ evaluated and reflect only scored rows.
    // This field does not exist yet — the test will fail with a type error
    // and/or `undefined` until the engineer adds it.
    const scoredEvaluated = (
      summary?.quality as unknown as { scoredEvaluated?: number }
    )?.scoredEvaluated

    expect(typeof scoredEvaluated).toBe('number')
    expect(scoredEvaluated).toBeLessThanOrEqual(summary?.quality.evaluated ?? 0)
  })

  test('test_agent_quality_scoredEvaluated_equals_evaluated_when_all_scored', () => {
    // All rows have a real score → scoredEvaluated == evaluated
    const summary = agentQualityFromFlatRow({
      traces: 5,
      agent_score_rows: 5,
      agent_quality_score: 1.0,
      agent_quality_evaluated: 5,
      agent_quality_possible: 5,
      agent_quality_failures: 0,
    })

    const scoredEvaluated = (
      summary?.quality as unknown as { scoredEvaluated?: number }
    )?.scoredEvaluated

    // When score is non-null for all rows, scoredEvaluated should equal evaluated
    expect(scoredEvaluated).toBe(summary?.quality.evaluated)
  })

  test('test_agent_quality_scoredEvaluated_zero_when_no_rows_scored', () => {
    // No rows were scored (score=null, evaluated=0)
    const summary = agentQualityFromFlatRow({
      traces: 2,
      agent_score_rows: 2,
      agent_quality_score: null,
      agent_quality_evaluated: 0,
      agent_quality_possible: 0,
      agent_quality_failures: 0,
    })

    const scoredEvaluated = (
      summary?.quality as unknown as { scoredEvaluated?: number }
    )?.scoredEvaluated

    expect(scoredEvaluated).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 10 / S4-T4: agentQualityIssueSortValue expected-value test (prior #59)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-T4: The current `agentQualityIssueSortValue` double-counts
 * `discoveryInventoryCoverage.issueCount` and `terminalCompletion.issueCount`
 * because they appear in BOTH `discoveryIssueCount` (×50) AND `handoffIssueCount`
 * (×50), yielding an effective weight of ×100 for these two signals.
 *
 * DECISION (W10 tester, 2026-06-15): The intended weighting is ×50 for
 * discovery/terminal issues (not ×100). `handoffIssueCount` should comprise
 * only the behavioral-policy incident counts:
 *   - `ignoredPathTracking.violationCount`
 *   - `baselineDeflection.incidentIncidents`
 *   - `sleepWellnessInterruption.incidentIncidents`
 *
 * Removing `discoveryInventoryCoverage.issueCount` and `terminalCompletion.issueCount`
 * from `handoffIssueCount` eliminates the double-count and makes the sort value
 * correctly proportional: discovery/terminal issues → ×50; behavioral incidents → ×50.
 *
 * Regression contract: discovery/terminal issues contribute ×50 via
 * `discoveryIssueCount` only; behavioral policy incidents use `handoffIssueCount`.
 *
 * Concrete example:
 *   worstPassScore = 0.8  → (1 - 0.8) * 100 = 20
 *   riskScore      = 0.3  → 0.3 * 100        = 30
 *   discoveryInventoryCoverage.issueCount = 2
 *   terminalCompletion.issueCount         = 1
 *   discoveryInventoryMissingCount        = 3
 *   discoveryIssueCount = 2 + 3 + 1 = 6  → 6 * 50 = 300
 *   handoffIssueCount (intended) = 0 (no policy incidents) → 0 * 50 = 0
 *   handoffAttemptCount = 0  → 0 * 10 = 0
 *
 *   INTENDED total = 20 + 30 + 300 + 0 + 0 = 350
 *   CURRENT  total = 20 + 30 + 300 + 150 + 0 = 500  (double-count: +3 * 50 = 150)
 */
test('test_agentQualityIssueSortValue_discovery_terminal_not_double_counted', () => {
  const summary = agentQualityFromFlatRow({
    traces: 5,
    agent_score_rows: 5,
    // Pass-scores: quality=0.8, instruction=1, tool=1, contract=1, progress=1
    // → worstPassScore=0.8 → (1-0.8)*100 = 20
    agent_quality_score: 0.8,
    agent_quality_evaluated: 5,
    agent_quality_possible: 5,
    agent_quality_failures: 1,
    agent_instruction_score: 1,
    agent_instruction_evaluated: 5,
    agent_instruction_possible: 5,
    agent_instruction_failures: 0,
    agent_tool_score: 1,
    agent_tool_evaluated: 5,
    agent_tool_possible: 5,
    agent_tool_failures: 0,
    agent_contract_score: 1,
    agent_contract_evaluated: 5,
    agent_contract_possible: 5,
    agent_contract_failures: 0,
    agent_progress_score: 1,
    agent_progress_evaluated: 5,
    agent_progress_possible: 5,
    agent_progress_failures: 0,
    // riskScore=0.3 → 0.3*100 = 30
    agent_risk_score: 0.3,
    agent_risk_evaluated: 5,
    agent_risk_possible: 5,
    agent_risk_events: 0,
    // discovery: issueCount=2, missingCount=3
    agent_discovery_inventory_coverage_score: 0.5,
    agent_discovery_inventory_coverage_evaluated: 4,
    agent_discovery_inventory_coverage_possible: 4,
    agent_discovery_inventory_coverage_failures: 2, // issueCount=2
    agent_discovery_inventory_missing_count: 3, // missingCount=3
    // terminal: issueCount=1
    agent_terminal_completion_score: 0.75,
    agent_terminal_completion_evaluated: 4,
    agent_terminal_completion_possible: 4,
    agent_terminal_completion_failures: 1, // issueCount=1
    // No policy incidents (handoffIssueCount behavioral portion = 0)
    agent_ignored_path_tracking_policy_score: null,
    agent_ignored_path_tracking_policy_evaluated: 0,
    agent_ignored_path_tracking_policy_possible: 0,
    agent_ignored_path_tracking_violation_count: 0,
    agent_baseline_deflection_attempted_score: null,
    agent_baseline_deflection_attempted_evaluated: 0,
    agent_baseline_deflection_attempted_incidents: 0,
    agent_baseline_deflection_incident_score: null,
    agent_baseline_deflection_incident_evaluated: 0,
    agent_baseline_deflection_incidents: 0,
    agent_sleep_wellness_interruption_attempted_score: null,
    agent_sleep_wellness_interruption_attempted_evaluated: 0,
    agent_sleep_wellness_interruption_attempted_incidents: 0,
    agent_sleep_wellness_interruption_incident_score: null,
    agent_sleep_wellness_interruption_incident_evaluated: 0,
    agent_sleep_wellness_interruption_incidents: 0,
  })

  expect(summary).toBeDefined()

  const sortValue = agentQualityIssueSortValue(summary!)

  // discoveryIssueCount = 2 + 3 + 1 = 6  → 6 * 50 = 300
  // handoffIssueCount (intended) = 0 (no behavioral incidents) → 0
  // handoffAttemptCount = 0 → 0
  // worstPassScore-penalty = (1 - 0.8) * 100 = 20
  // riskScore-penalty = 0.3 * 100 = 30
  // INTENDED total = 20 + 30 + 300 + 0 + 0 = 350
  //
  expect(sortValue).toBe(350)
})

// ─────────────────────────────────────────────────────────────────────────────
// D1-450 C3: combineFamily weights combined score by scoredEvaluated
// ─────────────────────────────────────────────────────────────────────────────

test('combine_agent_quality_summaries_weights_family_score_by_scoredEvaluated_not_evaluated', () => {
  const family = (
    score: number | null,
    evaluated: number,
    scoredEvaluated: number
  ) => ({
    score,
    evaluated,
    scoredEvaluated,
    possible: evaluated,
    issueCount: 0,
  })

  const lowCoverage = {
    totalRows: 10,
    quality: family(1, 10, 2),
    instruction: family(1, 1, 1),
    tool: family(1, 1, 1),
    contract: family(1, 1, 1),
    progress: family(1, 1, 1),
    risk: family(0, 1, 1),
    discoveryInventoryCoverage: family(null, 0, 0),
    discoveryInventoryMissingCount: 0,
    terminalCompletion: family(null, 0, 0),
    emptyCompletionFailures: 0,
    invalidToolCallErrors: 0,
    destructiveCheckoutFailures: 0,
    largePayloadRisks: 0,
    readOnlyPolicyViolations: 0,
    ignoredPathTracking: {
      score: null,
      evaluated: 0,
      possible: 0,
      violationCount: 0,
    },
    baselineDeflection: {
      attemptedScore: null,
      attemptedEvaluated: 0,
      attemptedIncidents: 0,
      incidentScore: null,
      incidentEvaluated: 0,
      incidentIncidents: 0,
      attemptCount: 0,
      toolCallCount: 0,
      inputTokens: 0,
      elapsedMs: 0,
      qualityGateTriggerCount: 0,
      qualityGateFixAttemptCount: 0,
      qualityGateRerunCount: 0,
    },
    sleepWellnessInterruption: {
      attemptedScore: null,
      attemptedEvaluated: 0,
      attemptedIncidents: 0,
      incidentScore: null,
      incidentEvaluated: 0,
      incidentIncidents: 0,
      interruptionCount: 0,
      outputTokens: 0,
      inputTokens: 0,
      elapsedMs: 0,
      afterUserPushbackCount: 0,
      repeatedCount: 0,
    },
    reasons: [],
  }

  const highWeightSession = {
    ...lowCoverage,
    totalRows: 4,
    quality: family(0, 4, 4),
  }

  const combined = combineAgentQualitySummaries([
    lowCoverage,
    highWeightSession,
  ])

  // Honest weighting (scoredEvaluated): (1*2 + 0*4) / (2+4) = 2/6 ≈ 0.333
  // Buggy weighting (evaluated):       (1*10 + 0*4) / (10+4) = 10/14 ≈ 0.714
  expect(combined?.quality.score).toBeCloseTo(2 / 6, 5)
  expect(combined?.quality.scoredEvaluated).toBe(6)
  expect(combined?.quality.evaluated).toBe(14)
})

/** Wave 8 / P10-F01,F02: fully failed session must contribute evaluated weight, not drop to zero. */
test('test_fully_failed_session_not_dropped_from_combined_score', () => {
  const family = (
    score: number | null,
    evaluated: number,
    issueCount: number,
    scoredEvaluated: number
  ) => ({
    score,
    evaluated,
    scoredEvaluated,
    possible: evaluated,
    issueCount,
  })

  const emptyTail = {
    discoveryInventoryCoverage: family(null, 0, 0, 0),
    discoveryInventoryMissingCount: 0,
    terminalCompletion: family(null, 0, 0, 0),
    emptyCompletionFailures: 0,
    invalidToolCallErrors: 0,
    destructiveCheckoutFailures: 0,
    largePayloadRisks: 0,
    readOnlyPolicyViolations: 0,
    ignoredPathTracking: {
      score: null,
      evaluated: 0,
      possible: 0,
      violationCount: 0,
    },
    baselineDeflection: {
      attemptedScore: null,
      attemptedEvaluated: 0,
      attemptedIncidents: 0,
      incidentScore: null,
      incidentEvaluated: 0,
      incidentIncidents: 0,
      attemptCount: 0,
      toolCallCount: 0,
      inputTokens: 0,
      elapsedMs: 0,
      qualityGateTriggerCount: 0,
      qualityGateFixAttemptCount: 0,
      qualityGateRerunCount: 0,
    },
    sleepWellnessInterruption: {
      attemptedScore: null,
      attemptedEvaluated: 0,
      attemptedIncidents: 0,
      incidentScore: null,
      incidentEvaluated: 0,
      incidentIncidents: 0,
      interruptionCount: 0,
      outputTokens: 0,
      inputTokens: 0,
      elapsedMs: 0,
      afterUserPushbackCount: 0,
      repeatedCount: 0,
    },
    reasons: [] as const,
  }

  const perfectSession = {
    totalRows: 10,
    quality: family(1, 10, 0, 10),
    instruction: family(1, 1, 0, 1),
    tool: family(1, 1, 0, 1),
    contract: family(1, 1, 0, 1),
    progress: family(1, 1, 0, 1),
    risk: family(0, 1, 0, 1),
    ...emptyTail,
  }

  const fullyFailedSession = {
    totalRows: 10,
    quality: family(0, 10, 10, 0),
    instruction: family(1, 1, 0, 1),
    tool: family(1, 1, 0, 1),
    contract: family(1, 1, 0, 1),
    progress: family(1, 1, 0, 1),
    risk: family(0, 1, 0, 1),
    ...emptyTail,
  }

  const combined = combineAgentQualitySummaries([
    perfectSession,
    fullyFailedSession,
  ])

  expect(combined?.quality.score).toBeCloseTo(0.5, 5)
  expect(combined?.quality.evaluated).toBe(20)
})

test('test_agentQualityIssueSortValue_undefined_returns_minus_one', () => {
  expect(agentQualityIssueSortValue(undefined)).toBe(-1)
})

test('test_agentQualityIssueSortValue_clean_session_returns_zero', () => {
  const summary = agentQualityFromFlatRow({
    traces: 3,
    agent_score_rows: 3,
    agent_quality_score: 1,
    agent_quality_evaluated: 3,
    agent_quality_possible: 3,
    agent_quality_failures: 0,
    agent_instruction_score: 1,
    agent_instruction_evaluated: 3,
    agent_instruction_possible: 3,
    agent_instruction_failures: 0,
    agent_tool_score: 1,
    agent_tool_evaluated: 3,
    agent_tool_possible: 3,
    agent_tool_failures: 0,
    agent_contract_score: 1,
    agent_contract_evaluated: 3,
    agent_contract_possible: 3,
    agent_contract_failures: 0,
    agent_progress_score: 1,
    agent_progress_evaluated: 3,
    agent_progress_possible: 3,
    agent_progress_failures: 0,
    agent_risk_score: 0,
    agent_risk_evaluated: 3,
    agent_risk_possible: 3,
    agent_risk_events: 0,
    agent_discovery_inventory_coverage_score: 1,
    agent_discovery_inventory_coverage_evaluated: 3,
    agent_discovery_inventory_coverage_possible: 3,
    agent_discovery_inventory_coverage_failures: 0,
    agent_discovery_inventory_missing_count: 0,
    agent_terminal_completion_score: 1,
    agent_terminal_completion_evaluated: 3,
    agent_terminal_completion_possible: 3,
    agent_terminal_completion_failures: 0,
  })

  expect(summary).toBeDefined()
  // All pass scores = 1 → penalty = 0; risk = 0; no issues → sort value = 0
  expect(agentQualityIssueSortValue(summary!)).toBe(0)
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 10 / S4-T4: parseReasonRows coverage (tested indirectly via agentQualityFromFlatRow)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-T4: parseReasonRows is not exported but is exercised via
 * `agentQualityFromFlatRow` through the `agent_score_reasons_top` field.
 * We test all edge-cases indirectly:
 *   - malformed JSON string → empty reasons array
 *   - non-array JSON → empty reasons array
 *   - missing required fields (family/reason) → entry skipped
 *   - NaN count → coerced to 0 via finiteNumber
 *   - valid entries → parsed correctly
 */
test('test_parseReasonRows_malformed_json_returns_empty_array', () => {
  const summary = agentQualityFromFlatRow({
    traces: 1,
    agent_score_rows: 1,
    agent_score_reasons_top: 'this is not json{{{', // malformed JSON
  })

  expect(summary).toBeDefined()
  expect(summary?.reasons).toEqual([])
})

test('test_parseReasonRows_non_array_json_returns_empty_array', () => {
  const summary = agentQualityFromFlatRow({
    traces: 1,
    agent_score_rows: 1,
    agent_score_reasons_top: JSON.stringify({
      family: 'quality',
      reason: 'test',
      count: 1,
    }), // object, not array
  })

  expect(summary).toBeDefined()
  expect(summary?.reasons).toEqual([])
})

test('test_parseReasonRows_skips_entries_with_missing_family_or_reason', () => {
  const raw = [
    { family: 'quality', reason: 'score low', count: 3 }, // valid
    { reason: 'missing family', count: 1 }, // missing family → skipped
    { family: 'tool', count: 2 }, // missing reason → skipped
    { family: 'contract', reason: 'schema mismatch', count: 5 }, // valid
    null, // null → skipped
    42, // not an object → skipped
  ]

  const summary = agentQualityFromFlatRow({
    traces: 1,
    agent_score_rows: 1,
    agent_score_reasons_top: JSON.stringify(raw),
  })

  expect(summary).toBeDefined()
  expect(summary?.reasons).toHaveLength(2)
  expect(summary?.reasons[0]).toEqual({
    family: 'quality',
    reason: 'score low',
    count: 3,
  })
  expect(summary?.reasons[1]).toEqual({
    family: 'contract',
    reason: 'schema mismatch',
    count: 5,
  })
})

test('test_parseReasonRows_nan_count_coerced_to_zero', () => {
  const raw = [
    { family: 'quality', reason: 'score low', count: null }, // null count
    { family: 'tool', reason: 'bad call', count: 'not-a-number' }, // string count
    { family: 'contract', reason: 'mismatch', count: NaN }, // NaN count
  ]

  const summary = agentQualityFromFlatRow({
    traces: 1,
    agent_score_rows: 1,
    agent_score_reasons_top: JSON.stringify(raw),
  })

  expect(summary).toBeDefined()
  expect(summary?.reasons).toHaveLength(3)
  // finiteNumber coerces NaN/null/non-numeric to 0
  for (const reason of summary?.reasons ?? []) {
    expect(reason.count).toBe(0)
  }
})

test('test_parseReasonRows_valid_array_parsed_correctly', () => {
  const raw = [
    { family: 'quality', reason: 'instruction not followed', count: 7 },
    { family: 'tool', reason: 'invalid tool call', count: 2 },
  ]

  const summary = agentQualityFromFlatRow({
    traces: 1,
    agent_score_rows: 1,
    agent_score_reasons_top: JSON.stringify(raw),
  })

  expect(summary).toBeDefined()
  expect(summary?.reasons).toHaveLength(2)
  expect(summary?.reasons[0]).toEqual({
    family: 'quality',
    reason: 'instruction not followed',
    count: 7,
  })
  expect(summary?.reasons[1]).toEqual({
    family: 'tool',
    reason: 'invalid tool call',
    count: 2,
  })
})

test('test_parseReasonRows_already_parsed_array_accepted', () => {
  // When agent_score_reasons_top is already a parsed array (not a string),
  // parseReasonRows must handle it without double-parsing.
  const raw = [{ family: 'progress', reason: 'task incomplete', count: 1 }]

  const summary = agentQualityFromFlatRow({
    traces: 1,
    agent_score_rows: 1,
    agent_score_reasons_top: raw, // not a string — already parsed
  })

  expect(summary).toBeDefined()
  expect(summary?.reasons).toHaveLength(1)
  expect(summary?.reasons[0]).toEqual({
    family: 'progress',
    reason: 'task incomplete',
    count: 1,
  })
})
