import { type ReactElement } from 'react'
import { fmtCompact } from '../../lib/format-utils'
import { HoverTooltip } from './hover-tooltip'

interface ReasoningTokenValueProps {
  reported?: number | null
  estimated?: number | null
}

function hasReasoningValue(value: number | null | undefined): boolean {
  return value !== null && value !== undefined
}

function reasoningTooltip(reported: number, estimated: number): ReactElement {
  return (
    <div>
      <div className='v9-tip-head'>Reasoning tokens</div>
      <div
        className='v9-tip-row'
        style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
      >
        <span className='t-model'>reported</span>
        <span className='t-count'>{fmtCompact(reported)}</span>
      </div>
      <div
        className='v9-tip-row'
        style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
      >
        <span className='t-model'>estimated</span>
        <span className='t-count'>{fmtCompact(estimated)}</span>
      </div>
    </div>
  )
}

export function ReasoningTokenValue({
  reported,
  estimated,
}: ReasoningTokenValueProps): ReactElement {
  if (!hasReasoningValue(reported) && !hasReasoningValue(estimated)) {
    return <span>—</span>
  }

  const reportedValue = reported ?? 0
  const estimatedValue = estimated ?? 0
  const total = reportedValue + estimatedValue
  const content = (
    <span className='reasoning-token-value'>
      {fmtCompact(total)}
      {estimatedValue > 0 && <span className='est-mark'>*</span>}
    </span>
  )

  if (estimatedValue <= 0) return content

  return (
    <HoverTooltip content={reasoningTooltip(reportedValue, estimatedValue)}>
      {content}
    </HoverTooltip>
  )
}
