export type AgentQualityFamilyKey =
  | 'quality'
  | 'instruction'
  | 'tool'
  | 'contract'
  | 'progress'
  | 'risk'
  | 'discoveryInventoryCoverage'
  | 'terminalCompletion'

export interface AgentQualityFamilySummary {
  score: number | null
  evaluated: number
  /** Rows that contributed a numeric score (honest coverage denominator). */
  scoredEvaluated: number
  possible: number
  issueCount: number
}

export interface AgentQualityReason {
  family: string
  reason: string
  count: number
}

export interface AgentQualityPolicySignal {
  score: number | null
  evaluated: number
  possible: number
  violationCount: number
}

export interface AgentQualityIncidentSignal {
  attemptedScore: number | null
  attemptedEvaluated: number
  attemptedIncidents: number
  incidentScore: number | null
  incidentEvaluated: number
  incidentIncidents: number
}

export interface AgentQualityBaselineDeflectionSummary extends AgentQualityIncidentSignal {
  attemptCount: number
  toolCallCount: number
  inputTokens: number
  elapsedMs: number
  qualityGateTriggerCount: number
  qualityGateFixAttemptCount: number
  qualityGateRerunCount: number
}

export interface AgentQualitySleepWellnessSummary extends AgentQualityIncidentSignal {
  interruptionCount: number
  outputTokens: number
  inputTokens: number
  elapsedMs: number
  afterUserPushbackCount: number
  repeatedCount: number
}

export interface AgentQualityCompactSummary {
  eventCount: number
  threadCount: number
  idCount: number
  resumeContextCount: number
  verifyContextCount: number
  sourceCounts: Record<string, number>
}

export interface AgentQualitySummary {
  totalRows: number
  quality: AgentQualityFamilySummary
  instruction: AgentQualityFamilySummary
  tool: AgentQualityFamilySummary
  contract: AgentQualityFamilySummary
  progress: AgentQualityFamilySummary
  risk: AgentQualityFamilySummary
  emptyCompletionFailures: number
  invalidToolCallErrors: number
  destructiveCheckoutFailures: number
  largePayloadRisks: number
  readOnlyPolicyViolations: number
  ignoredPathTracking: AgentQualityPolicySignal
  baselineDeflection: AgentQualityBaselineDeflectionSummary
  sleepWellnessInterruption: AgentQualitySleepWellnessSummary
  discoveryInventoryCoverage: AgentQualityFamilySummary
  discoveryInventoryMissingCount: number
  terminalCompletion: AgentQualityFamilySummary
  compactSummary: AgentQualityCompactSummary
  reasons: AgentQualityReason[]
}

export interface AgentQualityFlatFields {
  traces?: number | null
  agent_score_rows?: number | null
  agent_quality_score?: number | null
  agent_quality_evaluated?: number | null
  agent_quality_possible?: number | null
  agent_quality_failures?: number | null
  agent_instruction_score?: number | null
  agent_instruction_evaluated?: number | null
  agent_instruction_possible?: number | null
  agent_instruction_failures?: number | null
  agent_tool_score?: number | null
  agent_tool_evaluated?: number | null
  agent_tool_possible?: number | null
  agent_tool_failures?: number | null
  agent_contract_score?: number | null
  agent_contract_evaluated?: number | null
  agent_contract_possible?: number | null
  agent_contract_failures?: number | null
  agent_progress_score?: number | null
  agent_progress_evaluated?: number | null
  agent_progress_possible?: number | null
  agent_progress_failures?: number | null
  agent_risk_score?: number | null
  agent_risk_evaluated?: number | null
  agent_risk_possible?: number | null
  agent_risk_events?: number | null
  agent_empty_completion_failures?: number | null
  agent_invalid_tool_call_errors?: number | null
  agent_destructive_checkout_failures?: number | null
  agent_large_payload_risks?: number | null
  agent_read_only_policy_violations?: number | null
  agent_ignored_path_tracking_policy_score?: number | null
  agent_ignored_path_tracking_policy_evaluated?: number | null
  agent_ignored_path_tracking_policy_possible?: number | null
  agent_ignored_path_tracking_violation_count?: number | null
  agent_baseline_deflection_attempted_score?: number | null
  agent_baseline_deflection_attempted_evaluated?: number | null
  agent_baseline_deflection_attempted_incidents?: number | null
  agent_baseline_deflection_incident_score?: number | null
  agent_baseline_deflection_incident_evaluated?: number | null
  agent_baseline_deflection_incidents?: number | null
  agent_baseline_deflection_attempt_count?: number | null
  agent_baseline_deflection_tool_call_count?: number | null
  agent_baseline_deflection_input_tokens?: number | null
  agent_baseline_deflection_elapsed_ms?: number | null
  agent_quality_gate_trigger_count?: number | null
  agent_quality_gate_fix_attempt_count?: number | null
  agent_quality_gate_rerun_count?: number | null
  agent_sleep_wellness_interruption_attempted_score?: number | null
  agent_sleep_wellness_interruption_attempted_evaluated?: number | null
  agent_sleep_wellness_interruption_attempted_incidents?: number | null
  agent_sleep_wellness_interruption_incident_score?: number | null
  agent_sleep_wellness_interruption_incident_evaluated?: number | null
  agent_sleep_wellness_interruption_incidents?: number | null
  agent_sleep_wellness_interruption_count?: number | null
  agent_sleep_wellness_interruption_output_tokens?: number | null
  agent_sleep_wellness_interruption_input_tokens?: number | null
  agent_sleep_wellness_interruption_elapsed_ms?: number | null
  agent_sleep_wellness_interruption_after_user_pushback_count?: number | null
  agent_sleep_wellness_interruption_repeated_count?: number | null
  agent_discovery_inventory_coverage_score?: number | null
  agent_discovery_inventory_coverage_evaluated?: number | null
  agent_discovery_inventory_coverage_possible?: number | null
  agent_discovery_inventory_coverage_failures?: number | null
  agent_discovery_inventory_missing_count?: number | null
  agent_terminal_completion_score?: number | null
  agent_terminal_completion_evaluated?: number | null
  agent_terminal_completion_possible?: number | null
  agent_terminal_completion_failures?: number | null
  agent_compact_summary_events?: number | null
  agent_compact_summary_thread_count?: number | null
  agent_compact_summary_id_count?: number | null
  agent_compact_summary_resume_contexts?: number | null
  agent_compact_summary_verify_contexts?: number | null
  agent_compact_summary_source_counts?: unknown
  agent_score_reasons_top?: unknown
}

export const AGENT_QUALITY_PASS_FAMILY_KEYS = [
  'quality',
  'instruction',
  'tool',
  'contract',
  'progress',
] as const satisfies readonly AgentQualityFamilyKey[]

const AGENT_QUALITY_DISPLAY_SCORE_FAMILY_KEYS = [
  ...AGENT_QUALITY_PASS_FAMILY_KEYS,
  'discoveryInventoryCoverage',
  'terminalCompletion',
] as const satisfies readonly AgentQualityFamilyKey[]

const FAMILY_KEYS = [
  ...AGENT_QUALITY_PASS_FAMILY_KEYS,
  'risk',
  'discoveryInventoryCoverage',
  'terminalCompletion',
] as const satisfies readonly AgentQualityFamilyKey[]

const EMPTY_POLICY_SIGNAL: AgentQualityPolicySignal = {
  score: null,
  evaluated: 0,
  possible: 0,
  violationCount: 0,
}

const EMPTY_INCIDENT_SIGNAL: AgentQualityIncidentSignal = {
  attemptedScore: null,
  attemptedEvaluated: 0,
  attemptedIncidents: 0,
  incidentScore: null,
  incidentEvaluated: 0,
  incidentIncidents: 0,
}

const EMPTY_COMPACT_SUMMARY: AgentQualityCompactSummary = {
  eventCount: 0,
  threadCount: 0,
  idCount: 0,
  resumeContextCount: 0,
  verifyContextCount: 0,
  sourceCounts: {},
}

function finiteNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function nullableScore(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function familyFromFlat(
  score: unknown,
  evaluated: unknown,
  possible: unknown,
  issueCount: unknown
): AgentQualityFamilySummary {
  const evaluatedN = finiteNumber(evaluated)
  const issueN = finiteNumber(issueCount)
  const scoreN = nullableScore(score)
  /**
   * `scoredEvaluated`: rows that contributed a numeric score (evaluated minus issues).
   * When every row failed (`scoredEvaluated === 0`) but `score !== null`, `combineFamily`
   * falls back to weighting by `evaluated` so fully-failed sessions still affect the blend (P10-F02).
   */
  const scoredEvaluated =
    scoreN === null ? 0 : Math.max(0, Math.min(evaluatedN, evaluatedN - issueN))
  return {
    score: scoreN,
    evaluated: evaluatedN,
    scoredEvaluated,
    possible: finiteNumber(possible),
    issueCount: issueN,
  }
}

function policySignalFromFlat(
  score: unknown,
  evaluated: unknown,
  possible: unknown,
  violationCount: unknown
): AgentQualityPolicySignal {
  return {
    score: nullableScore(score),
    evaluated: finiteNumber(evaluated),
    possible: finiteNumber(possible),
    violationCount: finiteNumber(violationCount),
  }
}

function incidentSignalFromFlat(
  attemptedScore: unknown,
  attemptedEvaluated: unknown,
  attemptedIncidents: unknown,
  incidentScore: unknown,
  incidentEvaluated: unknown,
  incidentIncidents: unknown
): AgentQualityIncidentSignal {
  return {
    attemptedScore: nullableScore(attemptedScore),
    attemptedEvaluated: finiteNumber(attemptedEvaluated),
    attemptedIncidents: finiteNumber(attemptedIncidents),
    incidentScore: nullableScore(incidentScore),
    incidentEvaluated: finiteNumber(incidentEvaluated),
    incidentIncidents: finiteNumber(incidentIncidents),
  }
}

function parseReasonRows(value: unknown): AgentQualityReason[] {
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown
          } catch {
            return []
          }
        })()
      : value

  if (!Array.isArray(parsed)) return []
  return parsed
    .map((entry): AgentQualityReason | null => {
      if (entry === null || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const family = record.family
      const reason = record.reason
      if (typeof family !== 'string' || typeof reason !== 'string') {
        return null
      }
      return {
        family,
        reason,
        count: finiteNumber(record.count),
      }
    })
    .filter((entry): entry is AgentQualityReason => entry !== null)
}

function parseCompactSourceCounts(value: unknown): Record<string, number> {
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown
          } catch {
            return {}
          }
        })()
      : value

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }

  const counts: Record<string, number> = {}
  for (const [key, rawCount] of Object.entries(parsed)) {
    const count = finiteNumber(rawCount)
    if (count > 0) counts[key] = count
  }
  return counts
}

export function agentQualityFromFlatRow(
  row: AgentQualityFlatFields
): AgentQualitySummary | undefined {
  const summary: AgentQualitySummary = {
    totalRows: finiteNumber(row.agent_score_rows ?? row.traces),
    quality: familyFromFlat(
      row.agent_quality_score,
      row.agent_quality_evaluated,
      row.agent_quality_possible,
      row.agent_quality_failures
    ),
    instruction: familyFromFlat(
      row.agent_instruction_score,
      row.agent_instruction_evaluated,
      row.agent_instruction_possible,
      row.agent_instruction_failures
    ),
    tool: familyFromFlat(
      row.agent_tool_score,
      row.agent_tool_evaluated,
      row.agent_tool_possible,
      row.agent_tool_failures
    ),
    contract: familyFromFlat(
      row.agent_contract_score,
      row.agent_contract_evaluated,
      row.agent_contract_possible,
      row.agent_contract_failures
    ),
    progress: familyFromFlat(
      row.agent_progress_score,
      row.agent_progress_evaluated,
      row.agent_progress_possible,
      row.agent_progress_failures
    ),
    risk: familyFromFlat(
      row.agent_risk_score,
      row.agent_risk_evaluated,
      row.agent_risk_possible,
      row.agent_risk_events
    ),
    discoveryInventoryCoverage: familyFromFlat(
      row.agent_discovery_inventory_coverage_score,
      row.agent_discovery_inventory_coverage_evaluated,
      row.agent_discovery_inventory_coverage_possible,
      row.agent_discovery_inventory_coverage_failures
    ),
    discoveryInventoryMissingCount: finiteNumber(
      row.agent_discovery_inventory_missing_count
    ),
    terminalCompletion: familyFromFlat(
      row.agent_terminal_completion_score,
      row.agent_terminal_completion_evaluated,
      row.agent_terminal_completion_possible,
      row.agent_terminal_completion_failures
    ),
    emptyCompletionFailures: finiteNumber(row.agent_empty_completion_failures),
    invalidToolCallErrors: finiteNumber(row.agent_invalid_tool_call_errors),
    destructiveCheckoutFailures: finiteNumber(
      row.agent_destructive_checkout_failures
    ),
    largePayloadRisks: finiteNumber(row.agent_large_payload_risks),
    readOnlyPolicyViolations: finiteNumber(
      row.agent_read_only_policy_violations
    ),
    ignoredPathTracking: policySignalFromFlat(
      row.agent_ignored_path_tracking_policy_score,
      row.agent_ignored_path_tracking_policy_evaluated,
      row.agent_ignored_path_tracking_policy_possible,
      row.agent_ignored_path_tracking_violation_count
    ),
    baselineDeflection: {
      ...incidentSignalFromFlat(
        row.agent_baseline_deflection_attempted_score,
        row.agent_baseline_deflection_attempted_evaluated,
        row.agent_baseline_deflection_attempted_incidents,
        row.agent_baseline_deflection_incident_score,
        row.agent_baseline_deflection_incident_evaluated,
        row.agent_baseline_deflection_incidents
      ),
      attemptCount: finiteNumber(row.agent_baseline_deflection_attempt_count),
      toolCallCount: finiteNumber(
        row.agent_baseline_deflection_tool_call_count
      ),
      inputTokens: finiteNumber(row.agent_baseline_deflection_input_tokens),
      elapsedMs: finiteNumber(row.agent_baseline_deflection_elapsed_ms),
      qualityGateTriggerCount: finiteNumber(
        row.agent_quality_gate_trigger_count
      ),
      qualityGateFixAttemptCount: finiteNumber(
        row.agent_quality_gate_fix_attempt_count
      ),
      qualityGateRerunCount: finiteNumber(row.agent_quality_gate_rerun_count),
    },
    sleepWellnessInterruption: {
      ...incidentSignalFromFlat(
        row.agent_sleep_wellness_interruption_attempted_score,
        row.agent_sleep_wellness_interruption_attempted_evaluated,
        row.agent_sleep_wellness_interruption_attempted_incidents,
        row.agent_sleep_wellness_interruption_incident_score,
        row.agent_sleep_wellness_interruption_incident_evaluated,
        row.agent_sleep_wellness_interruption_incidents
      ),
      interruptionCount: finiteNumber(
        row.agent_sleep_wellness_interruption_count
      ),
      outputTokens: finiteNumber(
        row.agent_sleep_wellness_interruption_output_tokens
      ),
      inputTokens: finiteNumber(
        row.agent_sleep_wellness_interruption_input_tokens
      ),
      elapsedMs: finiteNumber(row.agent_sleep_wellness_interruption_elapsed_ms),
      afterUserPushbackCount: finiteNumber(
        row.agent_sleep_wellness_interruption_after_user_pushback_count
      ),
      repeatedCount: finiteNumber(
        row.agent_sleep_wellness_interruption_repeated_count
      ),
    },
    compactSummary: {
      eventCount: finiteNumber(row.agent_compact_summary_events),
      threadCount: finiteNumber(row.agent_compact_summary_thread_count),
      idCount: finiteNumber(row.agent_compact_summary_id_count),
      resumeContextCount: finiteNumber(
        row.agent_compact_summary_resume_contexts
      ),
      verifyContextCount: finiteNumber(
        row.agent_compact_summary_verify_contexts
      ),
      sourceCounts: parseCompactSourceCounts(
        row.agent_compact_summary_source_counts
      ),
    },
    reasons: parseReasonRows(row.agent_score_reasons_top),
  }

  const hasEvaluatedScores = FAMILY_KEYS.some(
    (family) => summary[family].evaluated > 0
  )
  const hasFlags =
    summary.discoveryInventoryCoverage.issueCount > 0 ||
    summary.discoveryInventoryMissingCount > 0 ||
    summary.terminalCompletion.issueCount > 0 ||
    summary.emptyCompletionFailures > 0 ||
    summary.invalidToolCallErrors > 0 ||
    summary.destructiveCheckoutFailures > 0 ||
    summary.largePayloadRisks > 0 ||
    summary.readOnlyPolicyViolations > 0
  const hasHandoffSignals =
    summary.ignoredPathTracking.evaluated > 0 ||
    summary.ignoredPathTracking.violationCount > 0 ||
    summary.baselineDeflection.attemptedEvaluated > 0 ||
    summary.baselineDeflection.incidentEvaluated > 0 ||
    summary.baselineDeflection.attemptCount > 0 ||
    summary.sleepWellnessInterruption.attemptedEvaluated > 0 ||
    summary.sleepWellnessInterruption.incidentEvaluated > 0 ||
    summary.sleepWellnessInterruption.interruptionCount > 0 ||
    summary.discoveryInventoryCoverage.evaluated > 0 ||
    summary.discoveryInventoryMissingCount > 0 ||
    summary.terminalCompletion.evaluated > 0 ||
    (summary.compactSummary?.eventCount ?? 0) > 0 ||
    (summary.compactSummary?.resumeContextCount ?? 0) > 0 ||
    (summary.compactSummary?.verifyContextCount ?? 0) > 0

  if (
    !hasEvaluatedScores &&
    !hasFlags &&
    !hasHandoffSignals &&
    summary.reasons.length === 0
  ) {
    if (finiteNumber(row.agent_score_rows ?? row.traces) <= 0) {
      return undefined
    }
  }
  return summary
}

function sumBy<T>(
  values: readonly T[],
  select: (value: T) => number | undefined
): number {
  let total = 0
  for (const value of values) {
    total += select(value) ?? 0
  }
  return total
}

function combineFamily(
  summaries: readonly AgentQualitySummary[],
  family: AgentQualityFamilyKey
): AgentQualityFamilySummary {
  let evaluated = 0
  let possible = 0
  let issueCount = 0
  let scoredEvaluated = 0

  const scoreInputs: { score: number | null; evaluated: number }[] = []

  for (const summary of summaries) {
    const item = summary[family]
    const weight =
      item.scoredEvaluated > 0
        ? item.scoredEvaluated
        : item.score !== null && item.evaluated > 0
          ? item.evaluated
          : 0
    evaluated += item.evaluated
    possible += item.possible
    issueCount += item.issueCount
    scoredEvaluated += weight
    scoreInputs.push({
      score: item.score,
      evaluated: weight,
    })
  }

  return {
    score: weightedNullableScore(scoreInputs),
    evaluated,
    scoredEvaluated,
    possible,
    issueCount,
  }
}

function weightedNullableScore(
  values: readonly {
    score: number | null
    evaluated: number
  }[]
): number | null {
  let numerator = 0
  let denominator = 0
  for (const value of values) {
    if (value.score !== null && value.evaluated > 0) {
      numerator += value.score * value.evaluated
      denominator += value.evaluated
    }
  }
  return denominator > 0 ? numerator / denominator : null
}

function combinePolicySignals(
  summaries: readonly AgentQualitySummary[]
): AgentQualityPolicySignal {
  const signals = summaries.map(
    (summary) => summary.ignoredPathTracking ?? EMPTY_POLICY_SIGNAL
  )
  return {
    score: weightedNullableScore(
      signals.map((signal) => ({
        score: signal.score,
        evaluated: signal.evaluated,
      }))
    ),
    evaluated: sumBy(signals, (signal) => signal.evaluated),
    possible: sumBy(signals, (signal) => signal.possible),
    violationCount: sumBy(signals, (signal) => signal.violationCount),
  }
}

function combineIncidentSignals(
  values: readonly (AgentQualityIncidentSignal | undefined)[]
): AgentQualityIncidentSignal {
  const signals = values.map((value) => value ?? EMPTY_INCIDENT_SIGNAL)
  return {
    attemptedScore: weightedNullableScore(
      signals.map((value) => ({
        score: value.attemptedScore,
        evaluated: value.attemptedEvaluated,
      }))
    ),
    attemptedEvaluated: sumBy(signals, (value) => value.attemptedEvaluated),
    attemptedIncidents: sumBy(signals, (value) => value.attemptedIncidents),
    incidentScore: weightedNullableScore(
      signals.map((value) => ({
        score: value.incidentScore,
        evaluated: value.incidentEvaluated,
      }))
    ),
    incidentEvaluated: sumBy(signals, (value) => value.incidentEvaluated),
    incidentIncidents: sumBy(signals, (value) => value.incidentIncidents),
  }
}

function combineCompactSummarySignals(
  values: readonly (AgentQualityCompactSummary | undefined)[]
): AgentQualityCompactSummary {
  const signals = values.map((value) => value ?? EMPTY_COMPACT_SUMMARY)
  const sourceCounts: Record<string, number> = {}

  for (const signal of signals) {
    for (const [source, count] of Object.entries(signal.sourceCounts)) {
      sourceCounts[source] = (sourceCounts[source] ?? 0) + count
    }
  }

  return {
    eventCount: sumBy(signals, (value) => value.eventCount),
    threadCount: sumBy(signals, (value) => value.threadCount),
    idCount: sumBy(signals, (value) => value.idCount),
    resumeContextCount: sumBy(signals, (value) => value.resumeContextCount),
    verifyContextCount: sumBy(signals, (value) => value.verifyContextCount),
    sourceCounts,
  }
}

export function combineAgentQualitySummaries(
  values: readonly (AgentQualitySummary | undefined)[]
): AgentQualitySummary | undefined {
  const summaries = values.filter(
    (value): value is AgentQualitySummary => value !== undefined
  )
  if (summaries.length === 0) return undefined

  const reasonCounts = new Map<string, AgentQualityReason>()
  for (const summary of summaries) {
    for (const reason of summary.reasons) {
      const key = `${reason.family}\u0000${reason.reason}`
      const existing = reasonCounts.get(key)
      if (existing === undefined) {
        reasonCounts.set(key, { ...reason })
      } else {
        existing.count += reason.count
      }
    }
  }

  return {
    totalRows: sumBy(summaries, (summary) => summary.totalRows),
    quality: combineFamily(summaries, 'quality'),
    instruction: combineFamily(summaries, 'instruction'),
    tool: combineFamily(summaries, 'tool'),
    contract: combineFamily(summaries, 'contract'),
    progress: combineFamily(summaries, 'progress'),
    risk: combineFamily(summaries, 'risk'),
    discoveryInventoryCoverage: combineFamily(
      summaries,
      'discoveryInventoryCoverage'
    ),
    discoveryInventoryMissingCount: sumBy(
      summaries,
      (summary) => summary.discoveryInventoryMissingCount
    ),
    terminalCompletion: combineFamily(summaries, 'terminalCompletion'),
    emptyCompletionFailures: sumBy(
      summaries,
      (summary) => summary.emptyCompletionFailures
    ),
    invalidToolCallErrors: sumBy(
      summaries,
      (summary) => summary.invalidToolCallErrors
    ),
    destructiveCheckoutFailures: sumBy(
      summaries,
      (summary) => summary.destructiveCheckoutFailures
    ),
    largePayloadRisks: sumBy(summaries, (summary) => summary.largePayloadRisks),
    readOnlyPolicyViolations: sumBy(
      summaries,
      (summary) => summary.readOnlyPolicyViolations
    ),
    ignoredPathTracking: combinePolicySignals(summaries),
    baselineDeflection: {
      ...combineIncidentSignals(
        summaries.map((summary) => summary.baselineDeflection)
      ),
      attemptCount: sumBy(
        summaries,
        (summary) => summary.baselineDeflection?.attemptCount
      ),
      toolCallCount: sumBy(
        summaries,
        (summary) => summary.baselineDeflection?.toolCallCount
      ),
      inputTokens: sumBy(
        summaries,
        (summary) => summary.baselineDeflection?.inputTokens
      ),
      elapsedMs: sumBy(
        summaries,
        (summary) => summary.baselineDeflection?.elapsedMs
      ),
      qualityGateTriggerCount: sumBy(
        summaries,
        (summary) => summary.baselineDeflection?.qualityGateTriggerCount
      ),
      qualityGateFixAttemptCount: sumBy(
        summaries,
        (summary) => summary.baselineDeflection?.qualityGateFixAttemptCount
      ),
      qualityGateRerunCount: sumBy(
        summaries,
        (summary) => summary.baselineDeflection?.qualityGateRerunCount
      ),
    },
    sleepWellnessInterruption: {
      ...combineIncidentSignals(
        summaries.map((summary) => summary.sleepWellnessInterruption)
      ),
      interruptionCount: sumBy(
        summaries,
        (summary) => summary.sleepWellnessInterruption?.interruptionCount
      ),
      outputTokens: sumBy(
        summaries,
        (summary) => summary.sleepWellnessInterruption?.outputTokens
      ),
      inputTokens: sumBy(
        summaries,
        (summary) => summary.sleepWellnessInterruption?.inputTokens
      ),
      elapsedMs: sumBy(
        summaries,
        (summary) => summary.sleepWellnessInterruption?.elapsedMs
      ),
      afterUserPushbackCount: sumBy(
        summaries,
        (summary) => summary.sleepWellnessInterruption?.afterUserPushbackCount
      ),
      repeatedCount: sumBy(
        summaries,
        (summary) => summary.sleepWellnessInterruption?.repeatedCount
      ),
    },
    compactSummary: combineCompactSummarySignals(
      summaries.map((summary) => summary.compactSummary)
    ),
    reasons: [...reasonCounts.values()]
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.family.localeCompare(right.family) ||
          left.reason.localeCompare(right.reason)
      )
      .slice(0, 8),
  }
}

export interface AgentQualitySeverityMetrics {
  sortWorstPassScore: number | null
  displayWorstPassScore: number | null
  riskScore: number
  discoveryIssueCount: number
  handoffIssueCount: number
  handoffAttemptCount: number
  totalIssueCount: number
}

function minimumFamilyScore(
  summary: AgentQualitySummary,
  familyKeys: readonly AgentQualityFamilyKey[]
): number | null {
  const scores = familyKeys
    .map((family) => summary[family].score)
    .filter((score): score is number => score !== null)
  return scores.length > 0 ? Math.min(...scores) : null
}

/**
 * Keep each signal in one bucket. Discovery coverage, missing inventory, and
 * terminal completion use the discovery bucket; handoff contains only
 * behavioral incidents. Ordering keeps the documented 50/50/10 weights.
 */
export function agentQualitySeverityMetrics(
  summary: AgentQualitySummary
): AgentQualitySeverityMetrics {
  const discoveryIssueCount =
    summary.discoveryInventoryCoverage.issueCount +
    summary.discoveryInventoryMissingCount +
    summary.terminalCompletion.issueCount
  const handoffIssueCount =
    (summary.ignoredPathTracking?.violationCount ?? 0) +
    (summary.baselineDeflection?.incidentIncidents ?? 0) +
    (summary.sleepWellnessInterruption?.incidentIncidents ?? 0)
  const handoffAttemptCount =
    (summary.baselineDeflection?.attemptedIncidents ?? 0) +
    (summary.sleepWellnessInterruption?.attemptedIncidents ?? 0)
  const passIssueCount = AGENT_QUALITY_PASS_FAMILY_KEYS.reduce(
    (sum, family) => sum + summary[family].issueCount,
    0
  )
  const failureFlagCount =
    summary.emptyCompletionFailures +
    summary.invalidToolCallErrors +
    summary.destructiveCheckoutFailures +
    summary.largePayloadRisks +
    summary.readOnlyPolicyViolations

  return {
    sortWorstPassScore: minimumFamilyScore(
      summary,
      AGENT_QUALITY_PASS_FAMILY_KEYS
    ),
    displayWorstPassScore: minimumFamilyScore(
      summary,
      AGENT_QUALITY_DISPLAY_SCORE_FAMILY_KEYS
    ),
    riskScore: summary.risk.score ?? 0,
    discoveryIssueCount,
    handoffIssueCount,
    handoffAttemptCount,
    totalIssueCount:
      passIssueCount +
      summary.risk.issueCount +
      discoveryIssueCount +
      failureFlagCount +
      handoffIssueCount +
      handoffAttemptCount,
  }
}

export function agentQualityIssueSortValue(
  summary: AgentQualitySummary | undefined
): number {
  if (summary === undefined) return -1
  const metrics = agentQualitySeverityMetrics(summary)
  return (
    (1 - (metrics.sortWorstPassScore ?? 1)) * 100 +
    metrics.riskScore * 100 +
    metrics.discoveryIssueCount * 50 +
    metrics.handoffIssueCount * 50 +
    metrics.handoffAttemptCount * 10
  )
}
