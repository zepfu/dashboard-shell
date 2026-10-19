import { type ReactElement } from 'react'
import { referencePricingDisplayFields } from '../../../../server/reference-pricing-projection.mjs'
import { formatUsd } from '../lib/usage-report-display'

function displayFieldText(field: {
  value: string | null
  coverage: string
  truncated: boolean
}): string {
  const base = field.value ?? field.coverage
  const withCoverage =
    field.value && field.coverage !== 'known' && field.coverage !== 'present'
      ? `${base} (${field.coverage})`
      : base
  return field.truncated ? `${withCoverage} (truncated)` : withCoverage
}

export function ReferencePricingDetail({
  detail,
  recordedResponseCostUsd,
}: {
  detail: unknown
  recordedResponseCostUsd?: number | null
}): ReactElement | null {
  const display = referencePricingDisplayFields(detail)
  if (!display) return null

  return (
    <div
      className='status-estimator-block'
      data-testid='reference-pricing-detail'
    >
      <strong>Reference pricing</strong>
      <p className='status-estimator-muted'>{display.note}</p>
      {recordedResponseCostUsd !== undefined ? (
        <span data-testid='reference-pricing-recorded-response-cost'>
          Recorded response cost{' '}
          <strong>
            {recordedResponseCostUsd === null
              ? 'unknown'
              : formatUsd(recordedResponseCostUsd)}
          </strong>
        </span>
      ) : null}
      <div className='status-estimator-meta-grid'>
        {display.fields.map((field) => (
          <span
            key={field.key}
            data-testid={`reference-pricing-${field.key}`}
            data-coverage={field.coverage}
          >
            {field.label} <strong>{displayFieldText(field)}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}

export function LedgerRecordedCost({
  recordedCostUsd,
  referencePricing,
}: {
  recordedCostUsd: number | null
  referencePricing?: unknown
}): ReactElement {
  const recorded = formatUsd(recordedCostUsd)
  if (!referencePricingDisplayFields(referencePricing)) {
    return <>{recorded}</>
  }
  return (
    <>
      <span data-testid='ledger-recorded-cost'>{recorded}</span>
      <ReferencePricingDetail detail={referencePricing} />
    </>
  )
}
