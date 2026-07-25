/**
 * Quota interval tooltip body for ProviderCard (S2-21).
 */
import type { ReactElement } from 'react'
import { formatResetDistance, modelBrandHex } from '../lib/usage-report-display'
import {
  fmtRequestCount,
  quotaConsumedPctDisplay,
} from './provider-card-helpers'
import type { QuotaBarGroup } from './provider-card-types'

function renderQuotaRequestTotals(
  quotaBar: QuotaBarGroup
): ReactElement | null {
  if (
    quotaBar.tipRequestTotal === undefined &&
    quotaBar.tipRecentRequestTotal90m === undefined
  ) {
    return null
  }

  return (
    <>
      {quotaBar.tipRequestTotal !== undefined && (
        <div
          className='v9-tip-row quota-tip-total'
          style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}
        >
          <span className='t-model'>requests</span>
          <span className='t-count'>
            {fmtRequestCount(quotaBar.tipRequestTotal)}
          </span>
        </div>
      )}
      {quotaBar.tipRecentRequestTotal90m !== undefined && (
        <div
          className='v9-tip-row quota-tip-total'
          style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}
        >
          <span className='t-model'>requests 90m</span>
          <span className='t-count'>
            {fmtRequestCount(quotaBar.tipRecentRequestTotal90m)}
          </span>
        </div>
      )}
    </>
  )
}

/** Formats an ISO timestamp as a relative freshness label, e.g. "observed 3m ago". */
function formatObservedFreshness(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'observed —'
  const diffMs = Date.now() - date.getTime()
  const totalMins = Math.floor(Math.abs(diffMs) / 60_000)
  const hours = Math.floor(totalMins / 60)
  const days = Math.floor(hours / 24)
  let core: string
  if (totalMins < 1) core = 'just now'
  else if (totalMins < 60) core = `${totalMins.toString()}m ago`
  else if (hours < 24) core = `${hours.toString()}h ago`
  else core = `${days.toString()}d ago`
  return `observed ${core}`
}

/** Shared v9-tip-head / v9-tip-sub / v9-tip-row tooltip body (S2-21/S2-22). */
export function buildQuotaTooltip(quotaBar: QuotaBarGroup): ReactElement {
  const tipWindowStr = quotaBar.tipWindow ?? '—'
  const consumedDisplay = quotaConsumedPctDisplay(quotaBar)
  const tipHeadLabel =
    quotaBar.showSubPercentPrecision === true
      ? `${tipWindowStr} · ${consumedDisplay} used · ${quotaBar.remainingPct.toFixed(2)}% remaining`
      : `${tipWindowStr} · ${consumedDisplay} used`
  const tipVelocity = quotaBar.tipVelocity
  const tipModelRows =
    quotaBar.tipModels !== undefined && quotaBar.tipModels.length > 0
      ? quotaBar.tipModels.slice(0, 3)
      : []

  return (
    <>
      <div className='v9-tip-head'>{tipHeadLabel}</div>
      {tipVelocity !== undefined && (
        <div className='v9-tip-sub'>{tipVelocity}</div>
      )}
      {quotaBar.tipIdentity?.map((identity) => (
        <div key={identity} className='v9-tip-sub quota-tip-identity'>
          {identity}
        </div>
      ))}
      {quotaBar.tipAbsolutesUnavailable === true && (
        <div className='v9-tip-sub quota-tip-absolutes'>
          credits: unavailable
        </div>
      )}
      {quotaBar.resetAt !== undefined && (
        <div className='v9-tip-sub quota-tip-reset'>
          resets {formatResetDistance(quotaBar.resetAt)}
        </div>
      )}
      {quotaBar.tipObservedAt !== undefined && (
        <div className='v9-tip-sub quota-tip-freshness'>
          {formatObservedFreshness(quotaBar.tipObservedAt)}
        </div>
      )}
      {renderQuotaRequestTotals(quotaBar)}
      {tipModelRows.map((tm) => (
        <div key={tm.model} className='v9-tip-row'>
          <span className='t-model' style={{ color: modelBrandHex(tm.model) }}>
            {tm.model}
          </span>
          <span className='t-count'>
            {fmtRequestCount(tm.requests)} req
            {tm.recentRequests90m !== undefined
              ? ` · ${fmtRequestCount(tm.recentRequests90m)} 90m`
              : ''}
          </span>
          <span className='t-count'>{tm.costDelta}</span>
        </div>
      ))}
      {tipModelRows.length === 0 && (
        <div className='v9-tip-row'>
          <span className='t-model'>—</span>
          <span className='t-count'>—</span>
        </div>
      )}
    </>
  )
}
