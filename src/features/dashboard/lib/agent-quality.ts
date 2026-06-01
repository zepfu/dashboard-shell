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
  compactSummary?: AgentQualityCompactSummary
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

const FAMILY_KEYS = [
  'quality',
  'instruction',
  'tool',
  'contract',
  'progress',
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
  return {
    score: nullableScore(score),
    evaluated: finiteNumber(evaluated),
    possible: finiteNumber(possible),
    issueCount: finiteNumber(issueCount),
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
  const hasAdditionalEvaluatedScores =
    summary.discoveryInventoryCoverage.evaluated > 0 ||
    summary.discoveryInventoryCoverage.issueCount > 0 ||
    summary.discoveryInventoryMissingCount > 0 ||
    summary.terminalCompletion.evaluated > 0
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
    !hasAdditionalEvaluatedScores &&
    !hasFlags &&
    !hasHandoffSignals &&
    summary.reasons.length === 0
  ) {
    return undefined
  }
  return summary
}

function combineFamily(
  summaries: readonly AgentQualitySummary[],
  family: AgentQualityFamilyKey
): AgentQualityFamilySummary {
  let scoreNumerator = 0
  let scoreDenominator = 0
  let evaluated = 0
  let possible = 0
  let issueCount = 0

  for (const summary of summaries) {
    const item = summary[family]
    evaluated += item.evaluated
    possible += item.possible
    issueCount += item.issueCount
    if (item.score !== null && item.evaluated > 0) {
      scoreNumerator += item.score * item.evaluated
      scoreDenominator += item.evaluated
    }
  }

  return {
    score: scoreDenominator > 0 ? scoreNumerator / scoreDenominator : null,
    evaluated,
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
    evaluated: signals.reduce((sum, signal) => sum + signal.evaluated, 0),
    possible: signals.reduce((sum, signal) => sum + signal.possible, 0),
    violationCount: signals.reduce(
      (sum, signal) => sum + signal.violationCount,
      0
    ),
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
    attemptedEvaluated: signals.reduce(
      (sum, value) => sum + value.attemptedEvaluated,
      0
    ),
    attemptedIncidents: signals.reduce(
      (sum, value) => sum + value.attemptedIncidents,
      0
    ),
    incidentScore: weightedNullableScore(
      signals.map((value) => ({
        score: value.incidentScore,
        evaluated: value.incidentEvaluated,
      }))
    ),
    incidentEvaluated: signals.reduce(
      (sum, value) => sum + value.incidentEvaluated,
      0
    ),
    incidentIncidents: signals.reduce(
      (sum, value) => sum + value.incidentIncidents,
      0
    ),
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
    eventCount: signals.reduce((sum, value) => sum + value.eventCount, 0),
    threadCount: signals.reduce((sum, value) => sum + value.threadCount, 0),
    idCount: signals.reduce((sum, value) => sum + value.idCount, 0),
    resumeContextCount: signals.reduce(
      (sum, value) => sum + value.resumeContextCount,
      0
    ),
    verifyContextCount: signals.reduce(
      (sum, value) => sum + value.verifyContextCount,
      0
    ),
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
    totalRows: summaries.reduce((sum, summary) => sum + summary.totalRows, 0),
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
    discoveryInventoryMissingCount: summaries.reduce(
      (sum, summary) => sum + summary.discoveryInventoryMissingCount,
      0
    ),
    terminalCompletion: combineFamily(summaries, 'terminalCompletion'),
    emptyCompletionFailures: summaries.reduce(
      (sum, summary) => sum + summary.emptyCompletionFailures,
      0
    ),
    invalidToolCallErrors: summaries.reduce(
      (sum, summary) => sum + summary.invalidToolCallErrors,
      0
    ),
    destructiveCheckoutFailures: summaries.reduce(
      (sum, summary) => sum + summary.destructiveCheckoutFailures,
      0
    ),
    largePayloadRisks: summaries.reduce(
      (sum, summary) => sum + summary.largePayloadRisks,
      0
    ),
    readOnlyPolicyViolations: summaries.reduce(
      (sum, summary) => sum + summary.readOnlyPolicyViolations,
      0
    ),
    ignoredPathTracking: combinePolicySignals(summaries),
    baselineDeflection: {
      ...combineIncidentSignals(
        summaries.map((summary) => summary.baselineDeflection)
      ),
      attemptCount: summaries.reduce(
        (sum, summary) => sum + (summary.baselineDeflection?.attemptCount ?? 0),
        0
      ),
      toolCallCount: summaries.reduce(
        (sum, summary) =>
          sum + (summary.baselineDeflection?.toolCallCount ?? 0),
        0
      ),
      inputTokens: summaries.reduce(
        (sum, summary) => sum + (summary.baselineDeflection?.inputTokens ?? 0),
        0
      ),
      elapsedMs: summaries.reduce(
        (sum, summary) => sum + (summary.baselineDeflection?.elapsedMs ?? 0),
        0
      ),
      qualityGateTriggerCount: summaries.reduce(
        (sum, summary) =>
          sum + (summary.baselineDeflection?.qualityGateTriggerCount ?? 0),
        0
      ),
      qualityGateFixAttemptCount: summaries.reduce(
        (sum, summary) =>
          sum + (summary.baselineDeflection?.qualityGateFixAttemptCount ?? 0),
        0
      ),
      qualityGateRerunCount: summaries.reduce(
        (sum, summary) =>
          sum + (summary.baselineDeflection?.qualityGateRerunCount ?? 0),
        0
      ),
    },
    sleepWellnessInterruption: {
      ...combineIncidentSignals(
        summaries.map((summary) => summary.sleepWellnessInterruption)
      ),
      interruptionCount: summaries.reduce(
        (sum, summary) =>
          sum + (summary.sleepWellnessInterruption?.interruptionCount ?? 0),
        0
      ),
      outputTokens: summaries.reduce(
        (sum, summary) =>
          sum + (summary.sleepWellnessInterruption?.outputTokens ?? 0),
        0
      ),
      inputTokens: summaries.reduce(
        (sum, summary) =>
          sum + (summary.sleepWellnessInterruption?.inputTokens ?? 0),
        0
      ),
      elapsedMs: summaries.reduce(
        (sum, summary) =>
          sum + (summary.sleepWellnessInterruption?.elapsedMs ?? 0),
        0
      ),
      afterUserPushbackCount: summaries.reduce(
        (sum, summary) =>
          sum +
          (summary.sleepWellnessInterruption?.afterUserPushbackCount ?? 0),
        0
      ),
      repeatedCount: summaries.reduce(
        (sum, summary) =>
          sum + (summary.sleepWellnessInterruption?.repeatedCount ?? 0),
        0
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

export function agentQualityIssueSortValue(
  summary: AgentQualitySummary | undefined
): number {
  if (summary === undefined) return -1
  const passScores = [
    summary.quality,
    summary.instruction,
    summary.tool,
    summary.contract,
    summary.progress,
  ]
    .map((family) => family.score)
    .filter((score): score is number => score !== null)
  const worstPassScore = passScores.length > 0 ? Math.min(...passScores) : 1
  const riskScore = summary.risk.score ?? 0
  const handoffIssueCount =
    (summary.ignoredPathTracking?.violationCount ?? 0) +
    (summary.baselineDeflection?.incidentIncidents ?? 0) +
    (summary.sleepWellnessInterruption?.incidentIncidents ?? 0) +
    summary.discoveryInventoryCoverage.issueCount +
    summary.terminalCompletion.issueCount
  const discoveryIssueCount =
    summary.discoveryInventoryCoverage.issueCount +
    summary.discoveryInventoryMissingCount +
    summary.terminalCompletion.issueCount
  const handoffAttemptCount =
    (summary.baselineDeflection?.attemptedIncidents ?? 0) +
    (summary.sleepWellnessInterruption?.attemptedIncidents ?? 0)
  return (
    (1 - worstPassScore) * 100 +
    riskScore * 100 +
    discoveryIssueCount * 50 +
    handoffIssueCount * 50 +
    handoffAttemptCount * 10
  )
}
