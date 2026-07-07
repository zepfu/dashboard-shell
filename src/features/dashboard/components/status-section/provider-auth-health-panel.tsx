import type { ReactElement } from 'react'
import type {
  UsageReportProviderAuthHealth,
  UsageReportProviderAuthHealthEntry,
} from '../../api/usage-report'

function formatRemainingSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return 'n/a'
  if (seconds <= 0) return 'expired'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes < 60) {
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const hourRemainder = minutes % 60
  return hourRemainder > 0 ? `${hours}h ${hourRemainder}m` : `${hours}h`
}

function formatAuthTimestamp(value: string | null | undefined): string {
  if (!value) return 'n/a'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').slice(0, 16)
}

function authStateLabel(
  state: UsageReportProviderAuthHealthEntry['auth_health_state']
): string {
  switch (state) {
    case 'refreshed':
      return 'refreshed'
    case 'skipped_valid':
      return 'skipped (valid)'
    case 'skipped_expired':
      return 'skipped (expired)'
    case 'failed':
      return 'failed'
    case 'attempted':
      return 'attempted'
    case 'expired':
      return 'expired'
    default:
      return 'unknown'
  }
}

function authStateClass(
  state: UsageReportProviderAuthHealthEntry['auth_health_state']
): string {
  switch (state) {
    case 'refreshed':
    case 'skipped_valid':
      return 'is-healthy'
    case 'skipped_expired':
    case 'attempted':
      return 'is-warn'
    case 'failed':
    case 'expired':
      return 'is-bad'
    default:
      return 'is-unknown'
  }
}

function entryHeadline(entry: UsageReportProviderAuthHealthEntry): string {
  const parts = [entry.provider, entry.auth_family].filter(Boolean)
  if (entry.credential_scope) parts.push(entry.credential_scope)
  return parts.join(' / ')
}

function ProviderAuthHealthCard({
  entry,
}: {
  entry: UsageReportProviderAuthHealthEntry
}): ReactElement {
  return (
    <article
      className={`provider-auth-card provider-auth-card--${entry.auth_health_state}`}
      data-provider={entry.provider}
      data-auth-family={entry.auth_family}
      data-auth-state={entry.auth_health_state}
    >
      <div className='provider-auth-card-head'>
        <div>
          <span className='provider-auth-environment'>{entry.environment}</span>
          <span className='provider-auth-headline'>{entryHeadline(entry)}</span>
        </div>
        <span
          className={`provider-auth-status-pill ${authStateClass(entry.auth_health_state)}`}
        >
          {authStateLabel(entry.auth_health_state)}
        </span>
      </div>
      <div className='provider-auth-detail-grid'>
        <span>observed</span>
        <strong>{formatAuthTimestamp(entry.observed_at)}</strong>
        <span>expires</span>
        <strong>
          {formatAuthTimestamp(entry.expires_at)} (
          {formatRemainingSeconds(entry.remaining_seconds)})
        </strong>
        <span>last success</span>
        <strong>{formatAuthTimestamp(entry.last_success_at)}</strong>
        <span>source</span>
        <strong>{entry.source_task ?? 'n/a'}</strong>
        {entry.auth_file_source ? (
          <>
            <span>auth source</span>
            <strong>{entry.auth_file_source}</strong>
          </>
        ) : null}
        {entry.auth_file_hash_short ? (
          <>
            <span>file hash</span>
            <strong>{entry.auth_file_hash_short}</strong>
          </>
        ) : null}
        {entry.error_class || entry.error_message ? (
          <>
            <span>error</span>
            <strong>
              {[entry.error_class, entry.error_message]
                .filter(Boolean)
                .join(': ') || 'n/a'}
            </strong>
          </>
        ) : null}
      </div>
    </article>
  )
}

export function ProviderAuthHealthPanel({
  authHealth,
}: {
  authHealth?: UsageReportProviderAuthHealth
}): ReactElement {
  const entries = authHealth?.entries ?? []

  return (
    <section
      className='provider-auth-health-panel'
      aria-label='Provider auth health'
    >
      <div className='provider-auth-panel-head'>
        <span>Provider auth</span>
        <span className='provider-auth-panel-sub'>
          {authHealth?.freshness_label ??
            'Current credential refresh state from provider_auth_current'}
        </span>
      </div>
      {entries.length > 0 ? (
        <div className='provider-auth-grid'>
          {entries.map((entry, index) => (
            <ProviderAuthHealthCard
              key={`${entry.environment}-${entry.provider}-${entry.auth_family}-${entry.credential_scope ?? ''}-${entry.observed_at}-${index.toString()}`}
              entry={entry}
            />
          ))}
        </div>
      ) : (
        <div className='provider-auth-empty'>not observed</div>
      )}
    </section>
  )
}
