import { describe, expect, test } from 'vitest'
import {
  CODEX_REVIEW_DECISION_RATIONALE_MAX_CHARS,
  CODEX_REVIEW_DECISIONS_MAX_LIMIT,
  CODEX_REVIEW_DECISIONS_TABLE,
  buildCodexReviewDecisionsQuery,
  normalizeCodexReviewDecisionRow,
  normalizeCodexReviewDecisionRows,
} from './codex-review-decisions-query.mjs'

const FROM = '2026-05-01'
const TO = '2026-05-08'

function search(params: Record<string, string>) {
  return new URLSearchParams({ from: FROM, to: TO, ...params })
}

function persistedRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    created_at: '2026-05-20T15:04:00.000Z',
    decision_key: 'decision-allow-1',
    reviewer_litellm_call_id: 'reviewer-call-1',
    reviewer_session_id: 'reviewer-session-1',
    reviewer_trace_id: 'trace-1',
    reviewer_model: 'gpt-5.1',
    reviewer_agent_name: 'codex-review',
    reviewer_agent_id: 'reviewer-agent-1',
    outcome: 'allow',
    rationale: 'The command stays inside the workspace.',
    rationale_truncated: false,
    risk_level: 'low',
    user_authorization: 'low',
    session_id: 'session-1',
    parent_litellm_call_id: 'parent-call-1',
    parent_session_id: 'parent-session-1',
    parent_thread_id: 'thread-1',
    parent_agent_name: 'parent-agent',
    parent_agent_id: 'parent-agent-1',
    correlation_status: 'attributed',
    parser_version: 'codex-review-parser/1',
    contract_version: 'd1-616-contract/1',
    review_attempt_number: 1,
    review_attempt_key: 'reviewer-call-1:codex-review:1',
    governed_tool_call_id: null,
    governed_tool_activity_key: null,
    metadata: {
      source: 'aawm_route_logging.record_aawm_route_rollup_turn',
      capture_source: 'codex_auto_review_success_callback',
    },
    ...overrides,
  }
}

describe('codex review decision query', () => {
  test('reads persisted decisions without tool activity or prompt columns', () => {
    const query = buildCodexReviewDecisionsQuery(search({ limit: '25' }))

    expect(query.metadata).toEqual({
      from: FROM,
      to: TO,
      limit: 25,
      decisionKey: null,
      detail: false,
    })
    expect(query.values).toEqual([FROM, TO, 25])
    expect(query.sql).toContain(`FROM ${CODEX_REVIEW_DECISIONS_TABLE} d`)
    expect(query.sql).toContain('d.created_at >=')
    expect(query.sql).toContain('d.created_at <')
    expect(query.sql).toContain('d.outcome')
    expect(query.sql).toContain(
      `LEFT(d.rationale, ${CODEX_REVIEW_DECISION_RATIONALE_MAX_CHARS})`
    )
    expect(query.sql).toContain('d.correlation_status')
    expect(query.sql).toContain('d.reviewer_litellm_call_id')
    expect(query.sql).toContain('d.review_attempt_key')
    expect(query.sql).toContain('d.review_attempt_number')
    expect(query.sql).toContain('d.session_id')
    expect(query.sql).toContain('d.parent_litellm_call_id')
    expect(query.sql).toContain('d.governed_tool_call_id')
    expect(query.sql).toContain('d.governed_tool_activity_key')
    expect(query.sql).not.toMatch(/\bJOIN\b/i)
    expect(query.sql).not.toMatch(/distinct\s+on/i)
    expect(query.sql).not.toContain('session_history_tool_activity')
    expect(query.sql).not.toContain('public.session_history_tool')
    expect(query.sql).not.toContain('prompt')
    expect(query.sql).not.toContain('payload')
    expect(query.sql).not.toContain('messages')
    expect(query.sql.toLowerCase()).not.toContain('epoch')
    expect(query.sql).not.toContain('public.session_history ')
    expect(query.sql).not.toContain('d.metadata AS')
    expect(query.sql).toContain("d.metadata->>'source'")
    expect(query.sql).not.toContain("d.metadata->>'prompt'")
  })

  test('keeps denial and unknown tool attribution on exact stored columns', () => {
    const query = buildCodexReviewDecisionsQuery(
      search({
        outcome: 'deny',
        tool_attribution: 'unknown',
        session_id: 'session-deny',
      })
    )

    expect(query.values).toEqual([FROM, TO, ['session-deny'], 'deny', 100])
    expect(query.sql).toContain('d.outcome = $4')
    expect(query.sql).toContain('d.session_id = ANY($3::text[])')
    expect(query.sql).toContain('NULLIF(d.governed_tool_call_id')
    expect(query.sql).toContain('NULLIF(d.governed_tool_activity_key')
    expect(query.sql).not.toMatch(/\bJOIN\b/i)
    expect(query.sql.toLowerCase()).not.toContain('epoch')
  })

  test('binds a decision detail key and repeated attempt filters', () => {
    const decisionKey = "abc' OR '1'='1"
    const query = buildCodexReviewDecisionsQuery(
      search({
        decision_key: decisionKey,
        review_attempt_key: 'reviewer-call-repeat:codex-review:2',
        limit: '9999',
      })
    )

    expect(query.metadata.detail).toBe(true)
    expect(query.metadata.limit).toBe(1)
    expect(query.metadata.decisionKey).toBe(decisionKey)
    expect(query.values).toContain(decisionKey)
    expect(query.values[query.values.length - 1]).toBe(1)
    expect(query.sql).toContain('d.decision_key = $')
    expect(query.sql).toContain('d.review_attempt_key = ANY(')
    expect(query.sql).not.toContain(decisionKey)
  })

  test('clamps the report limit and rejects an invalid outcome', () => {
    const query = buildCodexReviewDecisionsQuery(
      search({ limit: String(CODEX_REVIEW_DECISIONS_MAX_LIMIT + 50) })
    )
    expect(query.metadata.limit).toBe(CODEX_REVIEW_DECISIONS_MAX_LIMIT)
    expect(query.values[query.values.length - 1]).toBe(
      CODEX_REVIEW_DECISIONS_MAX_LIMIT
    )

    expect(() =>
      buildCodexReviewDecisionsQuery(search({ outcome: 'maybe' }))
    ).toThrowError(/Unsupported outcome/)
  })
})

describe('codex review decision rows', () => {
  test('keeps allow, a denial without tool ids, unknown attribution, and both attempts', () => {
    const secretRationale = [
      'Approved Bearer bearer-secret-value',
      'api_key=plain-api-key',
      'postgresql://db-user:db-password@localhost/db',
    ].join(' ')
    const decisions = normalizeCodexReviewDecisionRows([
      persistedRow({
        rationale: secretRationale,
        metadata: {
          source: 'aawm_route_logging.record_aawm_route_rollup_turn',
          capture_source: 'codex_auto_review_success_callback',
          prompt: 'SECRET PROMPT TEXT',
          tool_payload: 'rm -rf /tmp/payload',
        },
      }),
      persistedRow({
        decision_key: 'decision-deny-1',
        outcome: 'deny',
        reviewer_litellm_call_id: 'reviewer-call-repeat',
        review_attempt_number: 1,
        review_attempt_key: 'reviewer-call-repeat:codex-review:1',
        rationale: 'Denied before any tool ran.',
        governed_tool_call_id: null,
        governed_tool_activity_key: '',
      }),
      persistedRow({
        decision_key: 'decision-deny-2',
        outcome: 'deny',
        reviewer_litellm_call_id: 'reviewer-call-repeat',
        review_attempt_number: 2,
        review_attempt_key: 'reviewer-call-repeat:codex-review:2',
        rationale: 'Denied again.',
        governed_tool_call_id: null,
        governed_tool_activity_key: null,
      }),
      persistedRow({
        decision_key: 'decision-unknown-1',
        reviewer_litellm_call_id: 'reviewer-call-unknown',
        correlation_status: 'nearby-timestamp',
        session_id: null,
        parent_litellm_call_id: null,
        parent_thread_id: null,
        parent_agent_id: null,
      }),
      persistedRow({
        decision_key: '',
        reviewer_litellm_call_id: 'reviewer-call-dropped',
      }),
    ])

    expect(decisions.map((row) => row.decision_key)).toEqual([
      'decision-allow-1',
      'decision-deny-1',
      'decision-deny-2',
      'decision-unknown-1',
    ])
    const allow = decisions[0]
    expect(allow?.outcome).toBe('allow')
    expect(allow?.session_id).toBe('session-1')
    expect(allow?.parent_litellm_call_id).toBe('parent-call-1')
    expect(allow?.created_at).toBe('2026-05-20T15:04:00.000Z')
    expect(allow?.reviewer_litellm_call_id).toBe('reviewer-call-1')
    expect(allow?.review_attempt_key).toBe('reviewer-call-1:codex-review:1')
    expect(String(allow?.rationale)).not.toContain('bearer-secret-value')
    expect(String(allow?.rationale)).not.toContain('plain-api-key')
    expect(String(allow?.rationale)).not.toContain('db-password')
    expect(String(allow?.rationale)).toContain('[REDACTED]')
    expect(allow?.metadata).toEqual({
      source: 'aawm_route_logging.record_aawm_route_rollup_turn',
      capture_source: 'codex_auto_review_success_callback',
    })
    expect(JSON.stringify(allow)).not.toContain('SECRET PROMPT TEXT')
    expect(JSON.stringify(allow)).not.toContain('rm -rf')

    const denial = decisions[1]
    expect(denial?.outcome).toBe('deny')
    expect(denial?.governed_tool_call_id).toBeNull()
    expect(denial?.governed_tool_activity_key).toBeNull()
    expect(denial?.governed_tool_attribution_status).toBe('unknown')

    const repeated = decisions.filter(
      (row) => row.reviewer_litellm_call_id === 'reviewer-call-repeat'
    )
    expect(repeated.map((row) => row.review_attempt_key)).toEqual([
      'reviewer-call-repeat:codex-review:1',
      'reviewer-call-repeat:codex-review:2',
    ])
    expect(repeated.map((row) => row.review_attempt_number)).toEqual([1, 2])

    expect(decisions[3]?.correlation_status).toBe('unknown')
    expect(decisions[3]?.governed_tool_attribution_status).toBe('unknown')
  })

  test('bounds rationale and preserves a producer-supplied tool id without inventing execution', () => {
    const decision = normalizeCodexReviewDecisionRow(
      persistedRow({
        rationale: 'x'.repeat(CODEX_REVIEW_DECISION_RATIONALE_MAX_CHARS + 40),
        rationale_truncated: false,
        governed_tool_call_id: 'governed-call-1',
        governed_tool_activity_key: null,
      })
    )

    expect(decision?.rationale_truncated).toBe(true)
    expect(String(decision?.rationale)).toHaveLength(
      CODEX_REVIEW_DECISION_RATIONALE_MAX_CHARS
    )
    expect(decision?.governed_tool_call_id).toBe('governed-call-1')
    expect(decision?.governed_tool_activity_key).toBeNull()
    expect(decision?.governed_tool_attribution_status).toBe('producer_supplied')
    expect(decision).not.toHaveProperty('tool_name')
    expect(decision).not.toHaveProperty('executed')
  })
})
