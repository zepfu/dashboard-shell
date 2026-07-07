import type { ReactElement } from 'react'
import type {
  UsageReportProviderAliasRouting,
  UsageReportProviderAliasRoutingEntry,
} from '../../api/usage-report'

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

function formatRemainingSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (seconds <= 0) return 'expired'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`
}

function formatAliasRoutingTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').slice(0, 16)
}

function entryHeadline(entry: UsageReportProviderAliasRoutingEntry): string {
  const route = [entry.provider, entry.model].filter(Boolean).join(' / ')
  const kind = entry.state_kind === 'affinity' ? 'Affinity' : 'Cooldown'
  return `${kind}: ${route || 'unknown route'}`
}

function AliasRoutingEntryCard({
  entry,
}: {
  entry: UsageReportProviderAliasRoutingEntry
}): ReactElement {
  const activeLabel = entry.is_active ? 'active' : 'observed'
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
        <span className='alias-routing-status-pill'>{activeLabel}</span>
      </div>
      <div className='alias-routing-detail-grid'>
        <span>alias</span>
        <strong>{entry.alias_label ?? '—'}</strong>
        <span>route family</span>
        <strong>{entry.route_family ?? '—'}</strong>
        <span>state source</span>
        <strong>{stateSourceLabel(entry.state_source)}</strong>
        <span>observed</span>
        <strong>{formatAliasRoutingTimestamp(entry.observed_at)}</strong>
        <span>expires</span>
        <strong>
          {formatAliasRoutingTimestamp(
            entry.expires_at ?? entry.cooldown_until
          )}{' '}
          ({formatRemainingSeconds(entry.remaining_seconds)})
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
          {entry.skipped_candidates.slice(0, 4).map((candidate, index) => (
            <div
              className='alias-routing-skipped-row'
              key={`${entry.family}-${candidate.provider ?? 'p'}-${candidate.model ?? 'm'}-${index.toString()}`}
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

  return (
    <section
      className='alias-routing-health-panel'
      aria-label='AAWM alias routing health'
    >
      <div className='alias-routing-panel-head'>
        <span>AAWM alias routing</span>
        <span className='alias-routing-panel-sub'>
          {routing?.freshness_label ??
            'Recent observed routing from session history (not live Redis/DualCache)'}
        </span>
      </div>
      <div className='alias-routing-families'>
        <div className='alias-routing-family-block'>
          <div className='alias-routing-family-title'>codex</div>
          <div className='alias-routing-grid'>
            {codexEntries.length > 0 ? (
              codexEntries.map((entry, index) => (
                <AliasRoutingEntryCard
                  key={`codex-${entry.state_kind}-${entry.observed_at}-${index.toString()}`}
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
              anthropicEntries.map((entry, index) => (
                <AliasRoutingEntryCard
                  key={`anthropic-${entry.state_kind}-${entry.observed_at}-${index.toString()}`}
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
    </section>
  )
}
