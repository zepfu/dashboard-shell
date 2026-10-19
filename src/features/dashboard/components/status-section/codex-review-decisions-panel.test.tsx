import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import {
  type UsageReportCodexReviewDecision,
  type UsageReportCodexReviewDecisionsResponse,
} from '../../api/usage-report'
import { CodexReviewDecisionsPanel } from './codex-review-decisions-panel'

function decision(
  overrides: Partial<UsageReportCodexReviewDecision> = {}
): UsageReportCodexReviewDecision {
  return {
    created_at: '2026-05-20T15:04:00.000Z',
    decision_key: 'decision-allow-1',
    reviewer_litellm_call_id: 'reviewer-call-1',
    reviewer_session_id: 'reviewer-session-1',
    reviewer_trace_id: 'trace-1',
    reviewer_model: 'gpt-5.1',
    reviewer_agent_name: null,
    reviewer_agent_id: null,
    outcome: 'allow',
    rationale: 'The command stays inside the workspace.',
    rationale_truncated: false,
    risk_level: 'low',
    user_authorization: null,
    session_id: 'session-1',
    parent_litellm_call_id: 'parent-call-1',
    parent_session_id: 'parent-session-1',
    parent_thread_id: 'thread-1',
    parent_agent_name: null,
    parent_agent_id: 'parent-agent-1',
    correlation_status: 'attributed',
    parser_version: 'codex-review-parser/1',
    contract_version: 'd1-616-contract/1',
    review_attempt_number: 1,
    review_attempt_key: 'reviewer-call-1:codex-review:1',
    governed_tool_call_id: null,
    governed_tool_activity_key: null,
    governed_tool_attribution_status: 'unknown',
    metadata: {
      source: 'aawm_route_logging.record_aawm_route_rollup_turn',
      capture_source: 'codex_auto_review_success_callback',
    },
    ...overrides,
  }
}

function response(
  decisions: UsageReportCodexReviewDecision[]
): UsageReportCodexReviewDecisionsResponse {
  return {
    metadata: {
      from: '2026-05-01',
      to: '2026-05-08',
      limit: 100,
      decisionKey: null,
      detail: false,
    },
    decisions,
    decision: null,
  }
}

describe('CodexReviewDecisionsPanel', () => {
  test('shows an allow decision with correlation and detail', () => {
    render(
      <CodexReviewDecisionsPanel
        response={response([decision()])}
        loading={false}
      />
    )

    const card = screen.getByTestId('codex-review-decision')
    expect(card).toHaveAttribute('data-outcome', 'allow')
    expect(card).toHaveTextContent('Attribution: attributed')
    expect(card).toHaveTextContent('reviewer-call-1')
    expect(card).toHaveTextContent('reviewer-call-1:codex-review:1')
    expect(card).toHaveTextContent('session-1')
    expect(card).toHaveTextContent('parent-call-1')
    expect(card).toHaveTextContent('2026-05-20T15:04:00.000Z')
    expect(card).toHaveTextContent('The command stays inside the workspace.')

    fireEvent.click(screen.getByText('Decision detail'))
    expect(card).toHaveTextContent('thread-1')
    expect(card).toHaveTextContent('codex_auto_review_success_callback')
  })

  test('shows a denial with no tool activity as unpaired and unknown', () => {
    const deny = {
      ...decision({
        decision_key: 'decision-deny-1',
        outcome: 'deny',
        rationale: 'Denied before any tool ran.',
        correlation_status: 'attributed',
        governed_tool_call_id: null,
        governed_tool_activity_key: null,
        governed_tool_attribution_status: 'unknown',
      }),
      prompt: 'SECRET PROMPT TEXT',
      tool_payload: 'rm -rf /tmp/payload',
    } as UsageReportCodexReviewDecision

    render(
      <CodexReviewDecisionsPanel response={response([deny])} loading={false} />
    )

    const card = screen.getByTestId('codex-review-decision')
    expect(card).toHaveAttribute('data-outcome', 'deny')
    expect(card).toHaveAttribute('data-tool-attribution', 'unknown')
    expect(card).toHaveTextContent('Governed tool: unpaired / unknown')
    expect(card).toHaveTextContent('Denied before any tool ran.')
    expect(screen.queryByText(/SECRET PROMPT TEXT/)).not.toBeInTheDocument()
    expect(screen.queryByText(/rm -rf/)).not.toBeInTheDocument()
    expect(card).not.toHaveTextContent('executed')
  })

  test('shows unknown attribution without promoting it to attributed', () => {
    render(
      <CodexReviewDecisionsPanel
        response={response([
          decision({
            decision_key: 'decision-unknown-1',
            correlation_status: 'unknown',
            session_id: null,
            parent_litellm_call_id: null,
            parent_thread_id: null,
            governed_tool_attribution_status: 'unknown',
          }),
        ])}
        loading={false}
      />
    )

    const card = screen.getByTestId('codex-review-decision')
    expect(card).toHaveAttribute('data-correlation-status', 'unknown')
    expect(card).toHaveTextContent('Attribution: unknown')
    expect(card).not.toHaveTextContent('Attribution: attributed')
    expect(card).toHaveTextContent('Session')
    expect(card).toHaveTextContent('none')
  })

  test('shows repeated attempts as separate decisions', () => {
    render(
      <CodexReviewDecisionsPanel
        response={response([
          decision({
            decision_key: 'decision:attempt:1',
            reviewer_litellm_call_id: 'reviewer-call-repeat',
            review_attempt_number: 1,
            review_attempt_key: 'reviewer-call-repeat:codex-review:1',
            outcome: 'allow',
          }),
          decision({
            decision_key: 'decision:attempt:2',
            reviewer_litellm_call_id: 'reviewer-call-repeat',
            review_attempt_number: 2,
            review_attempt_key: 'reviewer-call-repeat:codex-review:2',
            outcome: 'deny',
            rationale: 'Second attempt denied.',
            governed_tool_call_id: null,
            governed_tool_activity_key: null,
          }),
        ])}
        loading={false}
      />
    )

    const cards = screen.getAllByTestId('codex-review-decision')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveAttribute(
      'data-attempt-key',
      'reviewer-call-repeat:codex-review:1'
    )
    expect(cards[1]).toHaveAttribute(
      'data-attempt-key',
      'reviewer-call-repeat:codex-review:2'
    )
    expect(cards[1]).toHaveAttribute('data-outcome', 'deny')
    expect(cards[1]).toHaveTextContent('Attempt 2')
  })

  test('redacts credentials and bounds rationale in the detail surface', () => {
    render(
      <CodexReviewDecisionsPanel
        response={response([
          decision({
            rationale: `Bearer bearer-secret-value api_key=plain-api-key ${'a'.repeat(500)}`,
            rationale_truncated: false,
          }),
        ])}
        loading={false}
      />
    )

    const rationale = screen.getByTestId('codex-review-rationale')
    expect(rationale.textContent?.length).toBeLessThanOrEqual(512)
    expect(rationale.textContent).not.toContain('bearer-secret-value')
    expect(rationale.textContent).not.toContain('plain-api-key')
    expect(rationale.textContent).toContain('[REDACTED]')
    expect(screen.getByText('Rationale truncated')).toBeInTheDocument()
  })
})
