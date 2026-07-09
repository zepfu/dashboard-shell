import type { ReactElement } from 'react'
import type {
  UsageReportProviderAuthHealth,
  UsageReportProviderAuthHealthEntry,
} from '../../api/usage-report'
import {
  formatRemainingSeconds,
  formatStatusTimestamp,
} from '../../lib/status-formatters'
import { STATUS_PILL_FALLBACK, StatusPanel, statusPill } from './section-chrome'

const AUTH_HEALTH_STATE_PILL = {
  refreshed: { label: 'refreshed', className: 'is-healthy' },
  skipped_valid: { label: 'skipped (valid)', className: 'is-healthy' },
  skipped_expired: { label: 'skipped (expired)', className: 'is-warn' },
  attempted: { label: 'attempted', className: 'is-warn' },
  failed: { label: 'failed', className: 'is-bad' },
  expired: { label: 'expired', className: 'is-bad' },
  unknown: { label: 'unknown', className: 'is-unknown' },
} as const

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
  const pill = statusPill(
    AUTH_HEALTH_STATE_PILL,
    entry.auth_health_state,
    STATUS_PILL_FALLBACK
  )

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
        <span className={`status-pill ${pill.className}`}>{pill.label}</span>
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
  const subLabel =
    authHealth?.freshness_label ??
    'Current credential refresh state from provider_auth_current'
  const headPill =
    entries.length === 0
      ? statusPill(AUTH_HEALTH_STATE_PILL, 'refreshed', STATUS_PILL_FALLBACK)
      : undefined

  return (
    <StatusPanel
      className='provider-auth-health-panel'
      ariaLabel='Provider auth health'
      title='Provider auth'
      subLabel={subLabel}
      headPill={headPill}
      emptyMessage={entries.length === 0 ? 'not observed' : undefined}
    >
      {entries.length > 0 ? (
        <div className='provider-auth-grid'>
          {entries.map((entry) => (
            <ProviderAuthHealthCard
              key={authHealthEntryKey(entry)}
              entry={entry}
            />
          ))}
        </div>
      ) : undefined}
    </StatusPanel>
  )
}
