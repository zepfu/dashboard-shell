/**
 * Locally counted Cohere accepted-call usage.
 * Monthly bars use the local trial cap. RPM rows keep a missing limit visible
 * and do not draw a percent meter for that unknown cap.
 */
import type { ReactElement } from 'react'
import type {
  CohereLocalUsageReport,
  CohereLocalUsageRoute,
  CohereLocalUsageWindow,
} from '../api/usage-report'
import { formatQuotaAccountSuffix } from '../lib/quota-bars/fields'
import {
  buildCohereLocalUsageLanes,
  type CohereLocalUsageLane,
} from '../lib/quota-bars/lanes'

export interface CohereLocalUsagePanelProps {
  report: CohereLocalUsageReport
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

function routeLabel(route: CohereLocalUsageRoute): string | null {
  const parts = [route.lane, route.source].filter(
    (part): part is string => part !== null && part.length > 0
  )
  return parts.length > 0 ? parts.join(' · ') : null
}

function freshnessLabel(
  freshness: CohereLocalUsageReport['sourceFreshness']
): string {
  if (freshness === 'fresh') return 'Source fresh'
  if (freshness === 'stale') return 'Source stale'
  if (freshness === 'unknown') return 'Source freshness unknown'
  return 'Source unavailable'
}

function KnownLane({ lane }: { lane: CohereLocalUsageLane }): ReactElement {
  const routes = lane.routes
    .map(routeLabel)
    .filter((label): label is string => label !== null)
  const knownLimit =
    lane.limitState === 'known' && lane.limit !== null && lane.limit > 0
      ? lane.limit
      : null
  const showMeter = knownLimit !== null && lane.remaining !== null
  const consumedPct =
    showMeter && knownLimit !== null
      ? Math.min(100, Math.round((lane.used / knownLimit) * 1000) / 10)
      : null

  return (
    <div className='cohere-local-usage-lane'>
      <div className='cohere-local-usage-lane-label'>{lane.laneLabel}</div>
      <div className='cohere-local-usage-counts'>
        <span className='cohere-local-usage-used'>
          {formatCount(lane.used)} requests
        </span>
        {lane.limitState === 'known' && lane.limit !== null ? (
          <span className='cohere-local-usage-limit'>
            Local cap {formatCount(lane.limit)}
          </span>
        ) : (
          <span className='cohere-local-usage-limit-state'>
            RPM limit unavailable
          </span>
        )}
        {lane.limitState === 'known' && lane.remaining !== null ? (
          <span className='cohere-local-usage-remaining'>
            Local cap remaining {formatCount(lane.remaining)}
          </span>
        ) : null}
      </div>
      {consumedPct !== null ? (
        <div
          className='cohere-local-usage-meter'
          role='meter'
          aria-label={lane.laneLabel}
          aria-valuemin={0}
          aria-valuemax={knownLimit ?? 0}
          aria-valuenow={lane.used}
        >
          <div
            className='cohere-local-usage-meter-fill'
            style={{ width: `${consumedPct.toString()}%` }}
          />
        </div>
      ) : null}
      <div className='cohere-local-usage-account'>
        account {formatQuotaAccountSuffix(lane.accountRef)}
      </div>
      {routes.map((route) => (
        <div key={route} className='cohere-local-usage-route'>
          route {route}
        </div>
      ))}
    </div>
  )
}

function UnknownWindow({
  window,
  accountRef,
}: {
  window: CohereLocalUsageWindow
  accountRef: string
}): ReactElement {
  const label =
    window.window === 'monthly'
      ? 'UTC month usage unavailable'
      : 'RPM usage unavailable'
  return (
    <div className='cohere-local-usage-unknown'>
      <span>{label}</span>
      <span>account {formatQuotaAccountSuffix(accountRef)}</span>
    </div>
  )
}

export function CohereLocalUsagePanel({
  report,
}: CohereLocalUsagePanelProps): ReactElement {
  const lanes = buildCohereLocalUsageLanes(report)
  const unknownWindows = report.scopes.flatMap((scope) =>
    scope.windows
      .filter((window) => window.dataState === 'unknown')
      .map((window) => ({ window, accountRef: scope.accountRef }))
  )

  return (
    <section
      className='cohere-local-usage'
      aria-label='Cohere locally counted usage'
    >
      <div className='cohere-local-usage-heading'>Locally counted</div>
      <div className='cohere-local-usage-source'>
        {report.observationSource}
      </div>
      <div className='cohere-local-usage-accounting'>
        Accepted-call accounting
      </div>
      <div className='cohere-local-usage-freshness'>
        {freshnessLabel(report.sourceFreshness)}
      </div>
      <div className='cohere-local-usage-monthly-cap'>
        Configured local monthly cap {formatCount(report.monthlyLimit)} requests
      </div>
      {report.rpmLimitState === 'missing' ? (
        <div className='cohere-local-usage-rpm-contract'>
          Configured RPM limit missing
        </div>
      ) : null}
      {report.readStatus === 'unavailable' ? (
        <div className='cohere-local-usage-unavailable'>
          Locally counted ledger unavailable
        </div>
      ) : null}
      {report.readStatus === 'ok' &&
      report.scopes.length === 0 &&
      lanes.length === 0 ? (
        <div className='cohere-local-usage-empty'>
          No credential-scoped accepted calls in the current UTC month
        </div>
      ) : null}
      {lanes.map((lane) => (
        <KnownLane key={lane.laneKey} lane={lane} />
      ))}
      {unknownWindows.map(({ window, accountRef }) => (
        <UnknownWindow
          key={`${accountRef}:${window.window}:${window.model ?? 'model-unavailable'}`}
          window={window}
          accountRef={accountRef}
        />
      ))}
      {report.scopesTruncated ? (
        <div className='cohere-local-usage-truncated'>
          Additional credential scopes omitted by the bounded read
        </div>
      ) : null}
    </section>
  )
}
