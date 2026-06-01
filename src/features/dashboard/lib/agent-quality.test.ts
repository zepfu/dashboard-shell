import { expect, test } from 'vitest'
import {
  agentQualityFromFlatRow,
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
