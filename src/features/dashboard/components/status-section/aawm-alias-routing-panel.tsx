import type { ReactElement } from 'react'
import type {
  UsageReportProviderAliasRouting,
  UsageReportProviderAliasRoutingEntry,
} from '../../api/usage-report'
import {
  formatRemainingSeconds,
  formatStatusTimestamp,
} from '../../lib/status-formatters'
import { STATUS_PILL_FALLBACK, StatusPanel, statusPill } from './section-chrome'

const ALIAS_ROUTING_HEAD_PILL_MAP = {
  observed: { label: 'observed', className: 'is-warn' },
  active: { label: 'active', className: 'is-healthy' },
} as const

function stateSourceLabel(
  source: UsageReportProviderAliasRoutingEntry['state_source']
): string {
  switch (source) {
    case 'memory':
      return 'process memory'
    case 'durable_cache':
      return 'durable cache'
    case 'local_fallback':
      return 'local fallback'
    default:
      return 'unknown'
  }
}

function entryHeadline(entry: UsageReportProviderAliasRoutingEntry): string {
  const route = [entry.provider, entry.model].filter(Boolean).join(' / ')
  const kind = entry.state_kind === 'affinity' ? 'Affinity' : 'Cooldown'
  return `${kind}: ${route || 'unknown route'}`
}

function aliasRoutingEntryKey(
  entry: UsageReportProviderAliasRoutingEntry
): string {
  return [
    entry.family,
    entry.state_kind,
    entry.observed_at,
    entry.provider ?? '',
    entry.model ?? '',
    entry.alias_label ?? '',
  ].join('|')
}

function AliasRoutingEntryCard({
  entry,
}: {
  entry: UsageReportProviderAliasRoutingEntry
}): ReactElement {
  const activeKey = entry.is_active ? 'active' : 'observed'
  const pill = statusPill(
    ALIAS_ROUTING_HEAD_PILL_MAP,
    activeKey,
    STATUS_PILL_FALLBACK
  )
  return (
    <article
      className={`alias-routing-card alias-routing-card--${entry.state_kind}`}
      data-family={entry.family}
      data-state-kind={entry.state_kind}
    >
      <div className='alias-routing-card-head'>
        <div>
          <span className='alias-routing-family'>{entry.family}</span>
          <span className='alias-routing-headline'>{entryHeadline(entry)}</span>
        </div>
        <span className={`status-pill ${pill.className}`}>{pill.label}</span>
      </div>
      <div className='alias-routing-detail-grid'>
        <span>alias</span>
        <strong>{entry.alias_label ?? '—'}</strong>
        <span>route family</span>
        <strong>{entry.route_family ?? '—'}</strong>
        <span>state source</span>
        <strong>{stateSourceLabel(entry.state_source)}</strong>
        <span>observed</span>
        <strong>{formatStatusTimestamp(entry.observed_at)}</strong>
        <span>expires</span>
        <strong>
          {formatStatusTimestamp(entry.expires_at ?? entry.cooldown_until)} (
          {formatRemainingSeconds(entry.remaining_seconds)})
        </strong>
        {entry.selection_reason ? (
          <>
            <span>selection</span>
            <strong>{entry.selection_reason}</strong>
          </>
        ) : null}
      </div>
      {entry.skipped_candidates && entry.skipped_candidates.length > 0 ? (
        <div className='alias-routing-skipped' aria-label='Skipped candidates'>
          {entry.skipped_candidates.slice(0, 4).map((candidate) => (
            <div
              className='alias-routing-skipped-row'
              key={`${entry.family}-${candidate.provider ?? 'p'}-${candidate.model ?? 'm'}-${candidate.reason ?? 'skip'}`}
            >
              <span>
                {[candidate.provider, candidate.model]
                  .filter(Boolean)
                  .join(' / ') || 'candidate'}
              </span>
              <span>{candidate.reason ?? 'skipped'}</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function AawmAliasRoutingPanel({
  routing,
}: {
  routing?: UsageReportProviderAliasRouting
}): ReactElement {
  const entries = routing?.entries ?? []
  const codexEntries = entries.filter((entry) => entry.family === 'codex')
  const anthropicEntries = entries.filter(
    (entry) => entry.family === 'anthropic'
  )
  const headPill = statusPill(
    ALIAS_ROUTING_HEAD_PILL_MAP,
    entries.length > 0 ? 'active' : 'observed',
    STATUS_PILL_FALLBACK
  )

  return (
    <StatusPanel
      className='alias-routing-health-panel'
      ariaLabel='AAWM alias routing health'
      title='AAWM alias routing'
      subLabel={
        routing?.freshness_label ??
        'Recent observed routing from session history (not live Redis/DualCache)'
      }
      headPill={headPill}
    >
      <div className='alias-routing-families'>
        <div className='alias-routing-family-block'>
          <div className='alias-routing-family-title'>codex</div>
          <div className='alias-routing-grid'>
            {codexEntries.length > 0 ? (
              codexEntries.map((entry) => (
                <AliasRoutingEntryCard
                  key={`codex-${aliasRoutingEntryKey(entry)}`}
                  entry={entry}
                />
              ))
            ) : (
              <div className='alias-routing-empty'>
                no recent codex routing state
              </div>
            )}
          </div>
        </div>
        <div className='alias-routing-family-block'>
          <div className='alias-routing-family-title'>anthropic</div>
          <div className='alias-routing-grid'>
            {anthropicEntries.length > 0 ? (
              anthropicEntries.map((entry) => (
                <AliasRoutingEntryCard
                  key={`anthropic-${aliasRoutingEntryKey(entry)}`}
                  entry={entry}
                />
              ))
            ) : (
              <div className='alias-routing-empty'>
                no recent anthropic routing state
              </div>
            )}
          </div>
        </div>
      </div>
    </StatusPanel>
  )
}
