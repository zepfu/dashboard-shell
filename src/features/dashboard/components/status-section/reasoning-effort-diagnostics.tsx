import { type ReactElement } from 'react'
import {
  REASONING_EFFORT_DISPLAY_FIELDS,
  REASONING_EFFORT_RECONCILIATION_NOTE,
  REASONING_EFFORT_SCOPE_NOTE,
  formatReasoningEffortScalar,
  normalizeReasoningEffortDiagnostics,
} from '../../../../../server/reasoning-effort-diagnostics.mjs'

export function ReasoningEffortMapping({
  value,
}: {
  value: unknown
}): ReactElement | null {
  const mapping = normalizeReasoningEffortDiagnostics(value)
  if (mapping === null) return null

  return (
    <div
      className='status-estimator-block'
      data-testid='reasoning-effort-mapping'
    >
      <strong>Reasoning effort mapping</strong>
      <p className='status-estimator-muted'>
        {REASONING_EFFORT_RECONCILIATION_NOTE}
      </p>
      <p className='status-estimator-muted'>{REASONING_EFFORT_SCOPE_NOTE}</p>
      <div className='status-estimator-meta-grid'>
        {REASONING_EFFORT_DISPLAY_FIELDS.map((field) => (
          <span key={field.key} data-testid={`reasoning-effort-${field.key}`}>
            {field.label}{' '}
            <strong>{formatReasoningEffortScalar(mapping[field.key])}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}
