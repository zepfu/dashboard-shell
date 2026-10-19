import { type ReactElement } from 'react'
import {
  type UsageReportCodexReviewDecision,
  type UsageReportCodexReviewDecisionsResponse,
} from '../../api/usage-report'
import { sanitizeCodexReviewDecisionRationale } from '../../lib/codex-review-decision-text'
import { STATUS_PILL_FALLBACK, StatusPanel, statusPill } from './section-chrome'

const HEAD_PILL = {
  loaded: { label: 'loaded', className: 'is-healthy' },
} as const

function displayText(value: string | null | undefined): string {
  if (value == null || value.trim() === '') return 'none'
  return value
}

function correlationLabel(
  status: UsageReportCodexReviewDecision['correlation_status'] | undefined
): 'attributed' | 'unattributed' | 'unknown' {
  if (status === 'attributed' || status === 'unattributed') return status
  return 'unknown'
}

function toolAttribution(
  decision: UsageReportCodexReviewDecision
): 'unknown' | 'producer_supplied' {
  if (
    decision.governed_tool_call_id == null &&
    decision.governed_tool_activity_key == null
  ) {
    return 'unknown'
  }
  return 'producer_supplied'
}

function rationaleDisplay(decision: UsageReportCodexReviewDecision): {
  text: string | null
  truncated: boolean
} {
  const sanitized = sanitizeCodexReviewDecisionRationale(decision.rationale)
  return {
    text: sanitized.text,
    truncated: decision.rationale_truncated || sanitized.truncated,
  }
}

function DecisionDetail({
  decision,
}: {
  decision: UsageReportCodexReviewDecision
}): ReactElement {
  const attribution = correlationLabel(decision.correlation_status)
  const governed = toolAttribution(decision)
  const rationale = rationaleDisplay(decision)

  return (
    <article
      className='status-estimator-lane status-diagnostics-card'
      data-testid='codex-review-decision'
      data-outcome={decision.outcome}
      data-correlation-status={attribution}
      data-tool-attribution={governed}
      data-attempt-key={decision.review_attempt_key ?? ''}
      aria-label={`Codex review ${decision.outcome}`}
    >
      <div className='status-diagnostics-chip-row'>
        <span className='status-diagnostics-chip'>{decision.outcome}</span>
        <span className='status-diagnostics-chip'>
          Attribution: {attribution}
        </span>
        <span className='status-diagnostics-chip'>
          {governed === 'unknown'
            ? 'Governed tool: unpaired / unknown'
            : 'Governed tool: producer-supplied id'}
        </span>
        <span className='status-diagnostics-chip'>
          Attempt {decision.review_attempt_number ?? 'none'}
        </span>
      </div>
      <div className='status-estimator-meta-grid'>
        <span>
          Reviewer{' '}
          <strong>{displayText(decision.reviewer_litellm_call_id)}</strong>
        </span>
        <span>
          Attempt key{' '}
          <strong>{displayText(decision.review_attempt_key)}</strong>
        </span>
        <span>
          Session <strong>{displayText(decision.session_id)}</strong>
        </span>
        <span>
          Parent request{' '}
          <strong>{displayText(decision.parent_litellm_call_id)}</strong>
        </span>
        <span>
          Recorded <strong>{displayText(decision.created_at)}</strong>
        </span>
      </div>
      <p data-testid='codex-review-rationale'>
        {rationale.text ?? 'No rationale recorded.'}
      </p>
      {rationale.truncated ? (
        <span className='status-estimator-muted'>Rationale truncated</span>
      ) : null}
      {governed === 'producer_supplied' ? (
        <p className='status-estimator-muted'>
          Execution was not inferred. Call{' '}
          {displayText(decision.governed_tool_call_id)}, activity{' '}
          {displayText(decision.governed_tool_activity_key)}.
        </p>
      ) : null}
      <details className='status-diagnostics-details'>
        <summary>Decision detail</summary>
        <div className='status-estimator-meta-grid'>
          <span>
            Reviewer session{' '}
            <strong>{displayText(decision.reviewer_session_id)}</strong>
          </span>
          <span>
            Reviewer trace{' '}
            <strong>{displayText(decision.reviewer_trace_id)}</strong>
          </span>
          <span>
            Reviewer model{' '}
            <strong>{displayText(decision.reviewer_model)}</strong>
          </span>
          <span>
            Parent session{' '}
            <strong>{displayText(decision.parent_session_id)}</strong>
          </span>
          <span>
            Parent thread{' '}
            <strong>{displayText(decision.parent_thread_id)}</strong>
          </span>
          <span>
            Parent agent{' '}
            <strong>{displayText(decision.parent_agent_id)}</strong>
          </span>
          <span>
            Risk <strong>{displayText(decision.risk_level)}</strong>
          </span>
          <span>
            User authorization{' '}
            <strong>{displayText(decision.user_authorization)}</strong>
          </span>
          <span>
            Parser <strong>{displayText(decision.parser_version)}</strong>
          </span>
          <span>
            Contract <strong>{displayText(decision.contract_version)}</strong>
          </span>
          <span>
            Capture{' '}
            <strong>
              {displayText(decision.metadata?.capture_source ?? null)}
            </strong>
          </span>
        </div>
      </details>
    </article>
  )
}

export function CodexReviewDecisionsPanel({
  response,
  loading,
}: {
  response: UsageReportCodexReviewDecisionsResponse | undefined
  loading: boolean
}): ReactElement {
  const decisions = response?.decisions ?? []

  if (loading && decisions.length === 0) {
    return (
      <div className='status-estimator-empty' role='status'>
        Loading Codex review decisions...
      </div>
    )
  }

  if (!loading && decisions.length === 0) {
    return (
      <div className='status-estimator-empty' role='status'>
        No Codex review decisions for the selected range.
      </div>
    )
  }

  const headPill = statusPill(HEAD_PILL, 'loaded', STATUS_PILL_FALLBACK)
  const subLabel = `${decisions.length.toLocaleString()} decisions · limit ${
    response?.metadata.limit?.toLocaleString() ?? 'unknown'
  }`

  return (
    <StatusPanel
      className='status-estimator-panel status-diagnostics-panel'
      ariaLabel='Codex review decisions'
      title='Codex review decisions'
      subLabel={subLabel}
      headPill={headPill}
    >
      <div className='status-estimator-grid status-diagnostics-grid'>
        {decisions.map((decision) => (
          <DecisionDetail key={decision.decision_key} decision={decision} />
        ))}
      </div>
    </StatusPanel>
  )
}
