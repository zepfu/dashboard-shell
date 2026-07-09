import type { ReactElement } from 'react'
import type {
  UsageReportProviderCreditLifecycle,
  UsageReportProviderCreditLifecycleEntry,
} from '../../api/usage-report'
import { formatStatusTimestamp } from '../../lib/status-formatters'
import { STATUS_PILL_FALLBACK, StatusPanel, statusPill } from './section-chrome'

const CREDIT_STATUS_PILL = {
  available: { label: 'available', className: 'is-healthy' },
  used: { label: 'used', className: 'is-warn' },
  expired: { label: 'expired', className: 'is-bad' },
} as const

function codexSummaryHeadlines(
  lifecycle?: UsageReportProviderCreditLifecycle
): string[] {
  const summaries = lifecycle?.summaries ?? []
  const codexSummaries = summaries.filter(
    (row) =>
      row.provider === 'openai' &&
      row.credit_family === 'codex_rate_limit_reset'
  )
  if (codexSummaries.length > 0) {
    const totalAvailable = codexSummaries.reduce(
      (sum, row) => sum + row.available_count,
      0
    )
    const headlines = [
      `OpenAI Codex reset credits: ${totalAvailable} available`,
    ]
    if (codexSummaries.length > 1) {
      for (const row of codexSummaries) {
        headlines.push(`${row.environment}: ${row.available_count} available`)
      }
    }
    return headlines
  }
  if (summaries.length === 1) {
    return [`${summaries[0].label}: ${summaries[0].available_count} available`]
  }
  if (summaries.length > 1) {
    return summaries.map(
      (row) => `${row.label}: ${row.available_count} available`
    )
  }
  return []
}

function creditTableCaption(
  entries: UsageReportProviderCreditLifecycleEntry[]
): string {
  const providers = new Set(entries.map((e) => e.provider))
  const families = new Set(entries.map((e) => e.credit_family))
  if (
    providers.size === 1 &&
    providers.has('openai') &&
    families.size === 1 &&
    families.has('codex_rate_limit_reset')
  ) {
    return 'Current OpenAI Codex rate-limit reset credits by environment and credit identity'
  }
  return 'Current provider credits by environment, family, and credit identity'
}

function creditRowAccessibleLabel(
  entry: UsageReportProviderCreditLifecycleEntry
): string {
  const identity = entry.credit_identity ?? 'aggregate credit'
  return `${entry.provider} ${entry.credit_family} ${identity}`
}

function creditLifecycleEntryKey(
  entry: UsageReportProviderCreditLifecycleEntry
): string {
  return [
    entry.environment,
    entry.provider,
    entry.credit_family,
    entry.credit_identity ?? 'agg',
    entry.observed_at,
    entry.granted_at ?? '',
  ].join('|')
}

function CreditLifecycleRow({
  entry,
}: {
  entry: UsageReportProviderCreditLifecycleEntry
}): ReactElement {
  const rowLabel = creditRowAccessibleLabel(entry)
  const pill = statusPill(
    CREDIT_STATUS_PILL,
    entry.status,
    STATUS_PILL_FALLBACK
  )

  return (
    <tr
      data-provider={entry.provider}
      data-credit-family={entry.credit_family}
      data-credit-status={entry.status}
    >
      <td>{entry.provider}</td>
      <td>{entry.environment}</td>
      <td>{entry.credit_family}</td>
      <th scope='row'>{entry.credit_identity ?? 'aggregate'}</th>
      <td>
        <span className={`status-pill ${pill.className}`}>{pill.label}</span>
      </td>
      <td>{formatStatusTimestamp(entry.granted_at)}</td>
      <td>{formatStatusTimestamp(entry.expires_at)}</td>
      <td>{formatStatusTimestamp(entry.observed_at)}</td>
      <td className='provider-credit-annotation'>
        {entry.operator_annotation ?? 'n/a'}
        {entry.source_url ? (
          <>
            {' '}
            <a
              className='provider-credit-source-link'
              href={entry.source_url}
              rel='noreferrer noopener'
              target='_blank'
              aria-label={`Source for ${rowLabel}`}
            >
              source
            </a>
          </>
        ) : null}
      </td>
    </tr>
  )
}

export function ProviderCreditLifecyclePanel({
  creditLifecycle,
}: {
  creditLifecycle?: UsageReportProviderCreditLifecycle
}): ReactElement {
  const entries = creditLifecycle?.entries ?? []
  const summaryLines = codexSummaryHeadlines(creditLifecycle)
  const subLabel =
    creditLifecycle?.freshness_label ??
    'Current provider credit lifecycle from provider_credit_current'
  const headPill =
    entries.length > 0
      ? statusPill(CREDIT_STATUS_PILL, entries[0].status, STATUS_PILL_FALLBACK)
      : statusPill(CREDIT_STATUS_PILL, 'available', STATUS_PILL_FALLBACK)

  return (
    <StatusPanel
      className='provider-credit-lifecycle-panel'
      ariaLabel='Provider credit lifecycle'
      title='Provider credit'
      subLabel={subLabel}
      headPill={headPill}
      emptyMessage={entries.length === 0 ? 'not observed' : undefined}
    >
      {summaryLines.length > 0 ? (
        <div className='provider-credit-summary-block'>
          {summaryLines.map((line) => (
            <div className='provider-credit-summary-line' key={line}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
      {entries.length > 0 ? (
        <div className='provider-credit-table-wrap'>
          <table
            className='provider-credit-table'
            aria-label='Provider credit lifecycle entries'
          >
            <caption className='provider-credit-table-caption'>
              {creditTableCaption(entries)}
            </caption>
            <thead>
              <tr>
                <th>provider</th>
                <th>environment</th>
                <th>family</th>
                <th>credit</th>
                <th>status</th>
                <th>granted</th>
                <th>expires</th>
                <th>observed</th>
                <th>notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <CreditLifecycleRow
                  key={creditLifecycleEntryKey(entry)}
                  entry={entry}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : undefined}
    </StatusPanel>
  )
}
