import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test } from 'vitest'
import { buildCodexReviewDecisionsQuery } from './codex-review-decisions-query.mjs'
import {
  __reportCacheInternals,
  __usageReportTestHelpers,
} from './report-service.mjs'

const {
  handleUsageCodexReviewDecisions,
  loadUsageCodexReviewDecisions,
  resetQueryReportDatabaseTestImpl,
  setQueryReportDatabaseTestImpl,
} = __usageReportTestHelpers

const FROM = '2026-05-01'
const TO = '2026-05-08'

function persistedRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    created_at: '2026-05-20T15:04:00.000Z',
    decision_key: 'decision-allow-1',
    reviewer_litellm_call_id: 'reviewer-call-repeat',
    reviewer_session_id: 'reviewer-session-1',
    reviewer_trace_id: null,
    reviewer_model: 'gpt-5.1',
    reviewer_agent_name: null,
    reviewer_agent_id: null,
    outcome: 'allow',
    rationale: 'Approved Bearer bearer-secret-value with api_key=plain-api-key',
    rationale_truncated: false,
    risk_level: 'low',
    user_authorization: 'low',
    session_id: 'session-1',
    parent_litellm_call_id: 'parent-call-1',
    parent_session_id: 'parent-session-1',
    parent_thread_id: 'thread-1',
    parent_agent_name: null,
    parent_agent_id: null,
    correlation_status: 'attributed',
    parser_version: 'codex-review-parser/1',
    contract_version: 'd1-616-contract/1',
    review_attempt_number: 1,
    review_attempt_key: 'reviewer-call-repeat:codex-review:1',
    governed_tool_call_id: null,
    governed_tool_activity_key: null,
    metadata: {
      source: 'aawm_route_logging.record_aawm_route_rollup_turn',
      capture_source: 'codex_auto_review_success_callback',
      prompt: 'SECRET PROMPT TEXT',
      tool_payload: 'rm -rf /tmp/payload',
    },
    ...overrides,
  }
}

function responseRecorder() {
  const writeHead = (status: number, headers: Record<string, string>): void => {
    recorded.status = status
    recorded.headers = headers
  }
  const end = (body: string | Uint8Array): void => {
    recorded.body =
      typeof body === 'string' ? body : Buffer.from(body).toString('utf8')
  }
  const recorded: {
    status: number
    headers: Record<string, string>
    body: string
  } = { status: 0, headers: {}, body: '' }
  return { res: { writeHead, end }, recorded }
}

afterEach(() => {
  resetQueryReportDatabaseTestImpl()
  __reportCacheInternals.resetReportCache()
})

describe('codex review decisions report API', () => {
  test('serves allow, denial without tool activity, unknown attribution, and repeated attempts', async () => {
    let capturedSql = ''
    let capturedValues: unknown[] = []
    setQueryReportDatabaseTestImpl(async (sql: string, values: unknown) => {
      capturedSql = sql
      capturedValues = Array.isArray(values) ? values : []
      return {
        rows: [
          persistedRow(),
          persistedRow({
            decision_key: 'decision-deny-2',
            outcome: 'deny',
            review_attempt_number: 2,
            review_attempt_key: 'reviewer-call-repeat:codex-review:2',
            rationale: 'Denied again with no tool activity.',
            governed_tool_call_id: null,
            governed_tool_activity_key: null,
          }),
          persistedRow({
            decision_key: 'decision-unknown-1',
            reviewer_litellm_call_id: 'reviewer-call-unknown',
            review_attempt_key: 'reviewer-call-unknown:codex-review:1',
            correlation_status: null,
            session_id: null,
            parent_litellm_call_id: null,
          }),
        ],
      }
    })

    const searchParams = new URLSearchParams({
      from: FROM,
      to: TO,
      limit: '100',
    })
    const expected = buildCodexReviewDecisionsQuery(searchParams, {
      from: FROM,
      to: TO,
    })
    const { res, recorded } = responseRecorder()
    await handleUsageCodexReviewDecisions(
      {
        url: `/api/shell/reports/usage/codex-review-decisions?${searchParams}`,
        headers: { host: 'localhost' },
      },
      res
    )

    expect(recorded.status).toBe(200)
    expect(capturedSql).toBe(expected.sql)
    expect(capturedValues).toEqual(expected.values)
    expect(capturedSql).not.toContain('session_history_tool_activity')
    expect(capturedSql).not.toMatch(/\bJOIN\b/i)
    expect(capturedSql).not.toContain('prompt')

    const payload = JSON.parse(recorded.body) as {
      decisions: Array<Record<string, unknown>>
      decision: unknown
    }
    expect(payload.decision).toBeNull()
    expect(payload.decisions.map((row) => row.outcome)).toEqual([
      'allow',
      'deny',
      'allow',
    ])
    const denial = payload.decisions[1]
    expect(denial?.governed_tool_call_id).toBeNull()
    expect(denial?.governed_tool_activity_key).toBeNull()
    expect(denial?.governed_tool_attribution_status).toBe('unknown')
    expect(payload.decisions[2]?.correlation_status).toBe('unknown')
    expect(
      payload.decisions
        .filter(
          (row) => row.reviewer_litellm_call_id === 'reviewer-call-repeat'
        )
        .map((row) => row.review_attempt_key)
    ).toEqual([
      'reviewer-call-repeat:codex-review:1',
      'reviewer-call-repeat:codex-review:2',
    ])
    expect(recorded.body).not.toContain('bearer-secret-value')
    expect(recorded.body).not.toContain('plain-api-key')
    expect(recorded.body).not.toContain('SECRET PROMPT TEXT')
    expect(recorded.body).not.toContain('rm -rf')
    expect(payload.decisions[0]?.parent_litellm_call_id).toBe('parent-call-1')
    expect(payload.decisions[0]?.session_id).toBe('session-1')
    expect(payload.decisions[0]?.created_at).toBe('2026-05-20T15:04:00.000Z')

    const loaded = (await loadUsageCodexReviewDecisions(searchParams)) as {
      decisions: Array<Record<string, unknown>>
    }
    expect(loaded.decisions).toHaveLength(3)
  })

  test('returns one denial detail without requiring tool activity', async () => {
    setQueryReportDatabaseTestImpl(async () => ({
      rows: [
        persistedRow({
          decision_key: 'decision-deny-only',
          outcome: 'deny',
          reviewer_litellm_call_id: 'reviewer-call-deny',
          review_attempt_key: 'reviewer-call-deny:codex-review:1',
          rationale: 'Denied with no tool row.',
          correlation_status: 'unattributed',
          session_id: null,
          parent_litellm_call_id: null,
          governed_tool_call_id: null,
          governed_tool_activity_key: null,
        }),
      ],
    }))
    const { res, recorded } = responseRecorder()
    await handleUsageCodexReviewDecisions(
      {
        url: '/api/shell/reports/usage/codex-review-decisions?from=2026-05-01&to=2026-05-08&decision_key=decision-deny-only',
        headers: { host: 'localhost' },
      },
      res
    )

    const payload = JSON.parse(recorded.body) as {
      metadata: { detail?: boolean; limit?: number }
      decisions: Array<Record<string, unknown>>
      decision: Record<string, unknown> | null
    }
    expect(payload.metadata.detail).toBe(true)
    expect(payload.metadata.limit).toBe(1)
    expect(payload.decisions).toHaveLength(1)
    expect(payload.decision?.outcome).toBe('deny')
    expect(payload.decision?.governed_tool_attribution_status).toBe('unknown')
    expect(payload.decision?.correlation_status).toBe('unattributed')
  })

  test('rejects an invalid outcome before querying', async () => {
    let queried = false
    setQueryReportDatabaseTestImpl(async () => {
      queried = true
      return { rows: [] }
    })
    const { res } = responseRecorder()
    await expect(
      handleUsageCodexReviewDecisions(
        {
          url: '/api/shell/reports/usage/codex-review-decisions?from=2026-05-01&to=2026-05-08&outcome=maybe',
          headers: { host: 'localhost' },
        },
        res
      )
    ).rejects.toMatchObject({ name: 'BadRequestError' })
    expect(queried).toBe(false)
  })

  test('diagnostics route imports the decision query module', () => {
    const source = readFileSync(
      new URL('./report-service.mjs', import.meta.url),
      'utf8'
    )
    expect(source).toContain("from './codex-review-decisions-query.mjs'")
    expect(source).toContain(
      "requestUrl.pathname === '/api/shell/reports/usage/codex-review-decisions'"
    )
    expect(source).toContain('loadUsageCodexReviewDecisions')
  })
})
