import type { ReactElement } from 'react'
import type {
  UsageReportProviderAuthHealth,
  UsageReportProviderAuthHealthEntry,
} from '../../api/usage-report'
import {
  formatRemainingSeconds,
  formatStatusTimestamp,
} from '../../lib/status-formatters'

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

function authHealthEntryKey(entry: UsageReportProviderAuthHealthEntry): string {
  return [
    entry.environment,
    entry.provider,
    entry.auth_family,
    entry.credential_scope ?? '',
    entry.observed_at,
  ].join('|')
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
        <strong>{formatStatusTimestamp(entry.observed_at)}</strong>
        <span>expires</span>
        <strong>
          {formatStatusTimestamp(entry.expires_at)} (
          {formatRemainingSeconds(entry.remaining_seconds)})
        </strong>
        <span>last success</span>
        <strong>{formatStatusTimestamp(entry.last_success_at)}</strong>
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
          {entries.map((entry) => (
            <ProviderAuthHealthCard
              key={authHealthEntryKey(entry)}
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
