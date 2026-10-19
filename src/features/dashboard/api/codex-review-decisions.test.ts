import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import { server } from '../../../test/setup'
import { fetchUsageReportCodexReviewDecisions } from './usage-report'

describe('fetchUsageReportCodexReviewDecisions', () => {
  test('normalizes allow, denial, unknown attribution, and repeated attempts', async () => {
    let seen: URL | null = null
    server.use(
      http.get(
        '/api/shell/reports/usage/codex-review-decisions',
        ({ request }) => {
          seen = new URL(request.url)
          return HttpResponse.json({
            metadata: {
              from: '2026-05-01',
              to: '2026-05-08',
              limit: 100,
              decisionKey: null,
              detail: false,
            },
            decisions: [
              {
                created_at: '2026-05-20T15:04:00.000Z',
                decision_key: 'decision-allow-1',
                reviewer_litellm_call_id: 'reviewer-call-repeat',
                reviewer_session_id: 'reviewer-session-1',
                outcome: 'allow',
                rationale:
                  'Approved Bearer bearer-secret-value with api_key=plain-api-key',
                rationale_truncated: false,
                session_id: 'session-1',
                parent_litellm_call_id: 'parent-call-1',
                correlation_status: 'attributed',
                review_attempt_number: 1,
                review_attempt_key: 'reviewer-call-repeat:codex-review:1',
                governed_tool_call_id: null,
                governed_tool_activity_key: null,
                governed_tool_attribution_status: 'producer_supplied',
                prompt: 'SECRET PROMPT TEXT',
                metadata: {
                  source: 'aawm_route_logging.record_aawm_route_rollup_turn',
                  prompt: 'SECRET PROMPT TEXT',
                  tool_payload: 'rm -rf /tmp/payload',
                },
              },
              {
                created_at: '2026-05-20T15:05:00.000Z',
                decision_key: 'decision-deny-2',
                reviewer_litellm_call_id: 'reviewer-call-repeat',
                outcome: 'deny',
                rationale: 'Denied with no tool activity.',
                rationale_truncated: false,
                correlation_status: 'attributed',
                review_attempt_number: 2,
                review_attempt_key: 'reviewer-call-repeat:codex-review:2',
                governed_tool_call_id: null,
                governed_tool_activity_key: null,
              },
              {
                created_at: '2026-05-20T15:06:00.000Z',
                decision_key: 'decision-unknown-1',
                reviewer_litellm_call_id: 'reviewer-call-unknown',
                outcome: 'deny',
                rationale: 'No parent identity.',
                correlation_status: 'nearby-timestamp',
                review_attempt_number: 1,
                review_attempt_key: 'reviewer-call-unknown:codex-review:1',
                governed_tool_call_id: '',
                governed_tool_activity_key: null,
              },
            ],
            decision: null,
          })
        }
      )
    )

    const report = await fetchUsageReportCodexReviewDecisions({
      from: '2026-05-01',
      to: '2026-05-08',
      limit: 100,
      outcome: 'deny',
      tool_attribution: 'unknown',
    })

    expect(seen?.pathname).toBe(
      '/api/shell/reports/usage/codex-review-decisions'
    )
    expect(seen?.searchParams.get('from')).toBe('2026-05-01')
    expect(seen?.searchParams.get('to')).toBe('2026-05-08')
    expect(seen?.searchParams.get('outcome')).toBe('deny')
    expect(seen?.searchParams.get('tool_attribution')).toBe('unknown')
    expect(report.decisions.map((row) => row.decision_key)).toEqual([
      'decision-allow-1',
      'decision-deny-2',
      'decision-unknown-1',
    ])
    expect(report.decisions[0]?.rationale).not.toContain('bearer-secret-value')
    expect(report.decisions[0]?.rationale).not.toContain('plain-api-key')
    expect(report.decisions[0]).not.toHaveProperty('prompt')
    expect(JSON.stringify(report.decisions[0]?.metadata)).not.toContain(
      'SECRET PROMPT TEXT'
    )
    expect(JSON.stringify(report)).not.toContain('rm -rf')
    expect(report.decisions[0]?.governed_tool_attribution_status).toBe(
      'unknown'
    )
    expect(report.decisions[1]?.outcome).toBe('deny')
    expect(report.decisions[1]?.governed_tool_call_id).toBeNull()
    expect(report.decisions[2]?.correlation_status).toBe('unknown')
    expect(
      report.decisions
        .filter(
          (row) => row.reviewer_litellm_call_id === 'reviewer-call-repeat'
        )
        .map((row) => row.review_attempt_number)
    ).toEqual([1, 2])
    expect(report.decision).toBeNull()
  })

  test('forwards a decision detail key', async () => {
    let seen: URL | null = null
    server.use(
      http.get(
        '/api/shell/reports/usage/codex-review-decisions',
        ({ request }) => {
          seen = new URL(request.url)
          return HttpResponse.json({
            metadata: {
              from: '2026-05-01',
              to: '2026-05-08',
              limit: 1,
              decisionKey: 'decision-deny-only',
              detail: true,
            },
            decisions: [
              {
                created_at: '2026-05-20T15:05:00.000Z',
                decision_key: 'decision-deny-only',
                reviewer_litellm_call_id: 'reviewer-call-deny',
                outcome: 'deny',
                rationale: 'Denied with no tool activity.',
                correlation_status: 'unattributed',
                review_attempt_number: 1,
                review_attempt_key: 'reviewer-call-deny:codex-review:1',
                governed_tool_call_id: null,
                governed_tool_activity_key: null,
              },
            ],
            decision: {
              created_at: '2026-05-20T15:05:00.000Z',
              decision_key: 'decision-deny-only',
              reviewer_litellm_call_id: 'reviewer-call-deny',
              outcome: 'deny',
              rationale: 'Denied with no tool activity.',
              correlation_status: 'unattributed',
              review_attempt_number: 1,
              review_attempt_key: 'reviewer-call-deny:codex-review:1',
              governed_tool_call_id: null,
              governed_tool_activity_key: null,
            },
          })
        }
      )
    )

    const report = await fetchUsageReportCodexReviewDecisions({
      from: '2026-05-01',
      to: '2026-05-08',
      decision_key: 'decision-deny-only',
    })

    expect(seen?.searchParams.get('decision_key')).toBe('decision-deny-only')
    expect(report.metadata.detail).toBe(true)
    expect(report.decision?.outcome).toBe('deny')
    expect(report.decision?.governed_tool_attribution_status).toBe('unknown')
    expect(report.decision?.correlation_status).toBe('unattributed')
  })
})
