import { memo, useState, type ReactElement, type ReactNode } from 'react'
import type {
  UsageReportSessionDiagnosticsResponse,
  UsageReportSessionDiagnosticsRow,
} from '../../api/usage-report'
import {
  canonicalProvider,
  providerBrandHex,
} from '../../lib/usage-report-display'

type JsonRecord = Record<string, unknown>
type AliasRouteEvent = NonNullable<
  UsageReportSessionDiagnosticsRow['alias_route_events']
>[number]

function displayKey(key: string): string {
  return key.replace(/^usage_output_contract_/, '').replace(/^xai_/, '')
}

function asRecord(value: unknown): JsonRecord | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function recordString(value: JsonRecord | null, key: string): string | null {
  const fieldValue = value?.[key]
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
    return null
  }
  if (typeof fieldValue === 'string') return fieldValue
  if (typeof fieldValue === 'number' || typeof fieldValue === 'boolean') {
    return String(fieldValue)
  }
  return null
}

function formatAnthropicContextWindowModeLabel(
  mode: string | null | undefined
): string {
  switch (mode) {
    case 'extended_1m':
      return '1M extended'
    case 'default_200k':
      return '200k default'
    default:
      return 'unknown'
  }
}

function anthropicContextWindowSummary(
  value: UsageReportSessionDiagnosticsRow['anthropic_context_window']
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  const hasRawValue =
    value.mode != null ||
    value.requested_tokens != null ||
    value.source != null ||
    value.beta != null ||
    value.classification != null
  if (!hasRawValue) return null
  const entries: Record<string, unknown> = {
    classified_mode: formatAnthropicContextWindowModeLabel(value.mode),
    mode: value.mode ?? null,
    requested_tokens: value.requested_tokens ?? null,
    source: value.source ?? null,
    beta: value.beta ?? null,
  }
  if (value.classification !== undefined && value.classification !== null) {
    entries.classification = value.classification
  }
  const hasValue = Object.values(entries).some(
    (field) => field !== null && field !== undefined && field !== ''
  )
  return hasValue ? entries : null
}

function formatDiagnosticValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? value : '—'
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value.map((item) => String(item)).join(', ')
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '{}'
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const field of Object.values(value as Record<string, unknown>)) {
      if (typeof field === 'string') {
        JSON.stringify(field)
      }
    }
  }
  return JSON.stringify(value, null, 2)
}

function diagnosticEntries(
  value: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): Array<[string, unknown]> {
  if (value === null || value === undefined) return []
  return keys
    .filter((key) => value[key] !== undefined && value[key] !== null)
    .map((key) => [key, value[key]])
}

function DiagnosticKeyValues({
  value,
  keys,
}: {
  value: Record<string, unknown> | null | undefined
  keys: readonly string[]
}): ReactElement | null {
  const entries = diagnosticEntries(value, keys)
  if (entries.length === 0) return null

  return (
    <div className='status-estimator-meta-grid'>
      {entries.map(([key, fieldValue]) => (
        <span key={key}>
          {displayKey(key)} <strong>{formatDiagnosticValue(fieldValue)}</strong>
        </span>
      ))}
    </div>
  )
}

function ObjectDiagnosticDetails({
  label,
  record,
  keys,
}: {
  label: string
  record: Record<string, unknown>
  keys: string[]
}): ReactElement {
  return (
    <details className='status-diagnostics-details'>
      <summary>{label}</summary>
      <DiagnosticKeyValues value={record} keys={keys} />
    </details>
  )
}

function DiagnosticDetails({
  label,
  value,
}: {
  label: string
  value: unknown
}): ReactElement | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value) && value.length === 0) return null
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return null
  }

  const record =
    typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null

  if (record !== null) {
    if (label === 'tool definition snapshot') {
      return <LazyJsonDetails label={label} value={value} />
    }
    const keys = Object.keys(record)
    return <ObjectDiagnosticDetails label={label} record={record} keys={keys} />
  }

  return <LazyJsonDetails label={label} value={value} />
}

function LazyJsonDetails({
  label,
  value,
}: {
  label: string
  value: unknown
}): ReactElement {
  const [json, setJson] = useState<string | null>(null)

  return (
    <details className='status-diagnostics-details'>
      <summary
        onClick={(event) => {
          const details = event.currentTarget.parentElement
          if (!(details instanceof HTMLDetailsElement)) return
          const willOpen = !details.open
          if (willOpen) {
            setJson(formatJson(value))
          } else {
            setJson(null)
          }
        }}
      >
        {label}
      </summary>
      <pre>{json}</pre>
    </details>
  )
}

function aliasRouteEventKey(event: AliasRouteEvent): string {
  return [
    event.observed_at,
    event.alias_model,
    event.provider,
    event.model,
    event.event_type,
    event.attempt_number,
  ]
    .filter((part) => part !== undefined && part !== null)
    .join('|')
}

function aliasTimelineEvents(
  events: UsageReportSessionDiagnosticsRow['alias_route_events']
): AliasRouteEvent[] {
  if (!Array.isArray(events)) return []
  return [...events].sort((left, right) =>
    String(left.observed_at ?? '').localeCompare(
      String(right.observed_at ?? '')
    )
  )
}

function AliasRouteTimeline({
  events,
}: {
  events: UsageReportSessionDiagnosticsRow['alias_route_events']
}): ReactElement | null {
  const timeline = aliasTimelineEvents(events)
  if (timeline.length === 0) return null

  return (
    <div className='status-diagnostics-timeline'>
      {timeline.map((event) => (
        <div
          key={aliasRouteEventKey(event)}
          className='status-diagnostics-timeline-row'
        >
          <div className='status-diagnostics-timeline-main'>
            <span>{event.observed_at ?? 'time unknown'}</span>
            <strong>{event.event_type ?? 'event'}</strong>
            <span>
              {[event.alias_model, event.provider, event.model]
                .filter(Boolean)
                .join(' -> ') || 'route unknown'}
            </span>
          </div>
          <div className='status-diagnostics-timeline-meta'>
            <span>
              attempt{' '}
              <strong>{formatDiagnosticValue(event.attempt_number)}</strong>
            </span>
            <span>
              cooldown{' '}
              <strong>{formatDiagnosticValue(event.cooldown_state)}</strong>
            </span>
            <span>
              redispatch{' '}
              <strong>
                {formatDiagnosticValue(event.redispatch_required)}
              </strong>
            </span>
            <span>
              last resort{' '}
              <strong>{formatDiagnosticValue(event.last_resort)}</strong>
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function sessionDiagnosticsCardKey(
  row: UsageReportSessionDiagnosticsRow
): string {
  return [
    row.session_id,
    row.trace_id,
    row.litellm_call_id,
    row.created_at,
    row.provider,
    row.model,
  ]
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join('|')
}

const SessionDiagnosticsCard = memo(function SessionDiagnosticsCard({
  row,
}: {
  row: UsageReportSessionDiagnosticsRow
}): ReactElement {
  const flags = row.diagnostic_flags ?? []
  const categories = row.diagnostic_categories ?? []
  const provider = row.provider ?? 'unknown'
  const transcriptDetail = asRecord(
    row.transcript_attribution?.session_history_transcript_attribution
  )
  const transcriptSummary = {
    ...row.transcript_attribution,
    model_attribution_state:
      row.transcript_attribution
        ?.session_history_transcript_attribution_status === 'unrecoverable'
        ? 'unknown model (unrecoverable)'
        : undefined,
    reason:
      row.transcript_attribution?.reason ??
      recordString(transcriptDetail, 'reason'),
    match_rule:
      row.transcript_attribution?.match_rule ??
      recordString(transcriptDetail, 'match_rule'),
    updated_at:
      row.transcript_attribution?.updated_at ??
      recordString(transcriptDetail, 'updated_at'),
  }
  const anthropicContextWindow = anthropicContextWindowSummary(
    row.anthropic_context_window
  )
  const hasGrokSideChannel =
    diagnosticEntries(row.grok_side_channel, [
      'endpoint_type',
      'endpoint_template',
      'content_type',
      'body_byte_length',
      'digest_source',
      'body_sha256',
      'json_container_type',
      'array_length',
      'top_level_key_types',
    ]).length > 0

  return (
    <article className='status-estimator-lane status-diagnostics-card'>
      <div className='status-estimator-lane-head'>
        <span style={{ color: providerBrandHex(provider) }}>
          {canonicalProvider(provider)}
        </span>
        <span>{row.model ?? 'unknown'}</span>
      </div>
      <div className='status-estimator-lane-key'>
        {row.repository ?? 'unknown'} · {row.client ?? 'unknown'} ·{' '}
        {row.created_at ?? 'time unknown'}
      </div>
      <div className='status-diagnostics-chip-row'>
        {[...flags, ...categories].slice(0, 10).map((flag) => (
          <span key={flag} className='status-diagnostics-chip'>
            {flag}
          </span>
        ))}
      </div>

      {row.grok_oauth ? (
        <div className='status-estimator-block'>
          <strong>Route identity</strong>
          <DiagnosticKeyValues
            value={row.grok_oauth}
            keys={[
              'credential_family',
              'grok_native_oauth_managed',
              'grok_native_entrypoint',
              'passthrough_route_family',
              'route_family',
              'auth_mode',
            ]}
          />
        </div>
      ) : null}

      {anthropicContextWindow ? (
        <div className='status-estimator-block'>
          <strong>Requested context window</strong>
          <DiagnosticKeyValues
            value={anthropicContextWindow}
            keys={[
              'classified_mode',
              'mode',
              'requested_tokens',
              'source',
              'beta',
            ]}
          />
          <DiagnosticDetails
            label='classification evidence'
            value={row.anthropic_context_window?.classification}
          />
        </div>
      ) : null}

      {hasGrokSideChannel ? (
        <div className='status-estimator-block'>
          <strong>Grok side-channel</strong>
          <DiagnosticKeyValues
            value={row.grok_side_channel}
            keys={[
              'endpoint_type',
              'endpoint_template',
              'content_type',
              'body_byte_length',
              'digest_source',
              'body_sha256',
              'json_container_type',
              'array_length',
              'top_level_key_types',
            ]}
          />
          <DiagnosticDetails
            label='top-level key types'
            value={row.grok_side_channel?.top_level_key_types}
          />
        </div>
      ) : null}

      <div className='status-estimator-block'>
        <strong>Output contract</strong>
        <DiagnosticKeyValues
          value={row.output_contract}
          keys={[
            'usage_output_contract_required_final_phrase_present',
            'usage_output_contract_failure_class',
            'usage_output_contract_setup_only_detected',
            'usage_output_contract_failure_count',
          ]}
        />
        <DiagnosticDetails
          label='output-contract evidence'
          value={row.output_contract}
        />
      </div>

      <div className='status-estimator-block'>
        <strong>xAI sanitizer</strong>
        <DiagnosticKeyValues
          value={row.xai_sanitizer}
          keys={[
            'xai_responses_request_sanitized',
            'xai_responses_sanitized_removed_params',
            'xai_responses_sanitized_tool_count',
            'xai_responses_sanitized_tool_types',
            'xai_tool_choice_without_tools_removed',
            'xai_tool_choice_without_tools_removed_reason',
            'request_tags',
            'passthrough_route_family',
          ]}
        />
        <DiagnosticDetails
          label='sanitized tools'
          value={row.xai_sanitizer?.xai_responses_sanitized_tools}
        />
        <DiagnosticDetails
          label='removed tool choice'
          value={row.xai_sanitizer?.xai_tool_choice_without_tools_removed}
        />
        <DiagnosticDetails
          label='sanitized request detail'
          value={row.xai_sanitizer}
        />
      </div>

      <div className='status-estimator-block'>
        <strong>Tool definitions</strong>
        <DiagnosticKeyValues
          value={row.tool_definitions}
          keys={[
            'aawm_tool_definition_capture_version',
            'aawm_tool_definition_count',
            'aawm_tool_definition_captured_count',
            'aawm_tool_definition_names',
            'aawm_tool_definition_types',
            'snapshot_hash',
            'aawm_tool_definition_snapshot_truncated',
            'aawm_tool_definition_snapshot_storage',
          ]}
        />
        <DiagnosticDetails
          label='tool definition snapshot'
          value={row.tool_definitions?.tool_definition_snapshot}
        />
      </div>

      <div className='status-estimator-block'>
        <strong>Alias routing</strong>
        <span className='status-estimator-muted'>
          {(row.alias_route_events ?? []).length.toLocaleString()} audit events
        </span>
        <AliasRouteTimeline events={row.alias_route_events} />
        <DiagnosticDetails
          label='alias route events'
          value={row.alias_route_events}
        />
      </div>

      <div className='status-estimator-block'>
        <strong>Transcript attribution</strong>
        <DiagnosticKeyValues
          value={transcriptSummary}
          keys={[
            'session_history_transcript_attribution_status',
            'session_history_transcript_attribution_source',
            'model_attribution_state',
            'reason',
            'match_rule',
            'updated_at',
          ]}
        />
        <DiagnosticDetails
          label='transcript attribution detail'
          value={
            row.transcript_attribution?.session_history_transcript_attribution
          }
        />
      </div>
    </article>
  )
})

export function SessionDiagnosticsPanel({
  response,
  loading,
}: {
  response: UsageReportSessionDiagnosticsResponse | undefined
  loading: boolean
}): ReactElement {
  const rows = response?.sessionDiagnostics ?? []

  if (loading && rows.length === 0) {
    return (
      <div className='status-estimator-empty' role='status'>
        Loading session diagnostics...
      </div>
    )
  }

  if (!loading && rows.length === 0) {
    return (
      <div className='status-estimator-empty' role='status'>
        No session diagnostics for the selected range.
      </div>
    )
  }

  return (
    <div className='status-estimator-panel status-diagnostics-panel'>
      <header className='status-estimator-header'>
        <strong>Session diagnostics</strong>
        <span>
          {rows.length.toLocaleString()} rows · limit{' '}
          {response?.metadata.limit?.toLocaleString() ?? 'unknown'}
        </span>
      </header>
      <div className='status-estimator-grid status-diagnostics-grid'>
        {rows.map((row) => (
          <SessionDiagnosticsCard
            key={sessionDiagnosticsCardKey(row)}
            row={row}
          />
        ))}
      </div>
    </div>
  )
}
