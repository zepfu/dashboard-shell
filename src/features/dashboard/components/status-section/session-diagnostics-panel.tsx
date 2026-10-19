import { memo, useState, type ReactElement, type ReactNode } from 'react'
import type {
  RequestWaitCheckpointDiagnostics,
  UsageReportSessionDiagnosticsResponse,
  UsageReportSessionDiagnosticsRow,
} from '../../api/usage-report'
import { sessionDiagnosticsRequestIdentity } from '../../lib/session-diagnostics-zen-account'
import { displaySessionIdentityValue } from '../../lib/session-identity'
import {
  canonicalProvider,
  providerBrandHex,
} from '../../lib/usage-report-display'
import { STATUS_PILL_FALLBACK, StatusPanel, statusPill } from './section-chrome'
import { SessionDiagnosticsStreamBlock } from './session-diagnostics-stream-block'

const SESSION_DIAGNOSTICS_HEAD_PILL = {
  loaded: { label: 'loaded', className: 'is-healthy' },
} as const

type JsonRecord = Record<string, unknown>
type AliasRouteEvent = NonNullable<
  UsageReportSessionDiagnosticsRow['alias_route_events']
>[number]

function displayKey(key: string): string {
  return key.replace(/^usage_output_contract_/, '').replace(/^xai_/, '')
}

function trimmedNonEmptyString(
  value: string | null | undefined
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function sessionDiagnosticsHostAttribution(
  row: UsageReportSessionDiagnosticsRow
): { primary: string; secondaryClientIp: string | null } | null {
  const hostName = trimmedNonEmptyString(row.host_name)
  const clientIp = trimmedNonEmptyString(row.client_ip)
  const primary = hostName ?? clientIp
  if (primary === null) return null

  return {
    primary,
    secondaryClientIp:
      hostName !== null && clientIp !== null && clientIp !== hostName
        ? clientIp
        : null,
  }
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

const SESSION_IDENTITY_FIELDS = [
  'agent_name',
  'agent_id',
  'inbound_model_alias',
  'model',
] as const

function waitActivityLabel(
  checkpoint: RequestWaitCheckpointDiagnostics
): string {
  switch (checkpoint.activity) {
    case 'missing':
      return 'No current wait checkpoint'
    case 'active':
      return 'Current active waits'
    case 'stale':
      return 'Stale checkpoint'
    case 'completed_asgi':
      return checkpoint.checkpoint_status
        ? `Completed ASGI processing (${checkpoint.checkpoint_status})`
        : 'Completed ASGI processing'
    case 'recorded':
      return 'Checkpoint recorded'
  }
}

function waitAttributionLabel(
  checkpoint: RequestWaitCheckpointDiagnostics
): string {
  switch (checkpoint.record_attribution) {
    case 'missing':
      return checkpoint.missing_reason === 'no_litellm_call_id'
        ? 'Missing durable wait checkpoint: no request id to correlate'
        : 'Missing durable wait checkpoint'
    case 'checkpoint_only':
      return 'Checkpoint-only record'
    case 'correlated_session_history':
      return 'Correlated session history'
  }
}

function waitDurationLabels(
  checkpoint: RequestWaitCheckpointDiagnostics
): string[] {
  const labels: string[] = []
  const seen = new Set<string>()
  for (const [kind, duration] of Object.entries(checkpoint.durations_ms)) {
    seen.add(kind)
    const count = checkpoint.counts[kind]
    labels.push(`${kind}: ${duration} ms, count ${count ?? 'unavailable'}`)
  }
  for (const [kind, count] of Object.entries(checkpoint.counts)) {
    if (seen.has(kind)) continue
    labels.push(`${kind}: duration unavailable, count ${count}`)
  }
  return labels
}

function RequestWaitCheckpointBlock({
  checkpoint,
}: {
  checkpoint: RequestWaitCheckpointDiagnostics
}): ReactElement {
  const durationLabels = waitDurationLabels(checkpoint)
  const showActiveWaits =
    checkpoint.activity === 'active' || checkpoint.activity === 'stale'

  return (
    <div
      className='status-estimator-block'
      data-testid='request-wait-checkpoint'
      data-wait-attribution={checkpoint.record_attribution}
      data-wait-activity={checkpoint.activity}
      data-litellm-call-id={checkpoint.litellm_call_id ?? ''}
    >
      <strong>Request wait checkpoint</strong>
      <div className='status-diagnostics-chip-row'>
        <span className='status-diagnostics-chip'>
          {waitAttributionLabel(checkpoint)}
        </span>
        <span className='status-diagnostics-chip'>
          {waitActivityLabel(checkpoint)}
        </span>
      </div>
      {checkpoint.record_attribution === 'checkpoint_only' ? (
        <span>No qualifying session history row</span>
      ) : null}
      {checkpoint.record_attribution === 'correlated_session_history' ? (
        <span>Qualifying session history row is present</span>
      ) : null}
      {checkpoint.record_attribution === 'missing' ? (
        <span>
          {checkpoint.missing_reason === 'no_litellm_call_id'
            ? 'No request id to correlate a wait checkpoint.'
            : 'No durable checkpoint row for this request.'}
        </span>
      ) : null}
      <div className='status-estimator-meta-grid'>
        <span>
          freshness {checkpoint.freshness}
          {checkpoint.freshness_age_seconds != null
            ? ` (${checkpoint.freshness_age_seconds}s)`
            : ''}
          , threshold {checkpoint.freshness_threshold_seconds}s
        </span>
        <span>sequence {checkpoint.sequence ?? 'unavailable'}</span>
        <span>ASGI status {checkpoint.checkpoint_status ?? 'unavailable'}</span>
        <span>
          ASGI completion {checkpoint.asgi_completion_at ?? 'unavailable'}
        </span>
        <span>
          History completion{' '}
          {checkpoint.session_history_end_time ?? 'unavailable'}
        </span>
        <span>
          Provider content:{' '}
          <strong>
            {checkpoint.provider_content_outcome === 'empty_completion_recorded'
              ? 'empty completion recorded on session history'
              : 'not established'}
          </strong>
        </span>
        <span>
          Final delivery: <strong>not established</strong>
        </span>
      </div>
      {checkpoint.activity === 'stale' ? (
        <span>
          Stale checkpoint age is observation freshness, not a request timeout.
        </span>
      ) : null}
      <div>
        <strong>
          {showActiveWaits
            ? 'Last recorded active waits'
            : 'Recorded wait categories'}
        </strong>
        {checkpoint.active_wait_categories.length === 0 ? (
          <span> none</span>
        ) : (
          checkpoint.active_wait_categories.map((wait, index) => (
            <span key={`${wait.type}:${wait.started_at ?? ''}:${index}`}>
              {' '}
              {wait.type}
              {wait.started_at ? ` since ${wait.started_at}` : ''}
            </span>
          ))
        )}
      </div>
      <div>
        <strong>Recorded durations</strong>
        {durationLabels.length === 0 ? (
          <span> none</span>
        ) : (
          durationLabels.map((label) => <span key={label}> {label}</span>)
        )}
      </div>
      <span className='status-estimator-muted'>{checkpoint.outcome_note}</span>
    </div>
  )
}

function waitCheckpointCardKey(
  checkpoint: RequestWaitCheckpointDiagnostics
): string {
  return [
    'wait',
    checkpoint.litellm_call_id,
    checkpoint.session_id,
    checkpoint.sequence,
    checkpoint.checkpoint_updated_at,
  ]
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join('|')
}

function unattachedWaitCheckpoints(
  rows: UsageReportSessionDiagnosticsRow[],
  checkpoints: RequestWaitCheckpointDiagnostics[] | undefined
): RequestWaitCheckpointDiagnostics[] {
  if (!checkpoints?.length) return []
  const shown = new Set(
    rows
      .filter((row) => row.request_wait_checkpoint)
      .map((row) => row.request_wait_checkpoint?.litellm_call_id)
      .filter((callId): callId is string => Boolean(callId))
  )
  return checkpoints.filter((checkpoint) => {
    if (!checkpoint.litellm_call_id) return true
    return !shown.has(checkpoint.litellm_call_id)
  })
}

const WaitCheckpointCard = memo(function WaitCheckpointCard({
  checkpoint,
}: {
  checkpoint: RequestWaitCheckpointDiagnostics
}): ReactElement {
  const provider = checkpoint.provider ?? 'unknown'
  return (
    <article className='status-estimator-lane status-diagnostics-card'>
      <div className='status-estimator-lane-head'>
        <span style={{ color: providerBrandHex(provider) }}>
          {canonicalProvider(provider)}
        </span>
        <span>{checkpoint.model ?? 'unknown'}</span>
      </div>
      <div className='status-estimator-lane-key'>
        {checkpoint.repository ?? 'unknown'} · {checkpoint.client ?? 'unknown'}{' '}
        · {checkpoint.created_at ?? 'time unknown'}
      </div>
      <div className='status-estimator-lane-key'>
        {checkpoint.litellm_call_id ?? 'call id unavailable'} ·{' '}
        {checkpoint.session_id ?? 'session unavailable'}
      </div>
      <RequestWaitCheckpointBlock checkpoint={checkpoint} />
    </article>
  )
})

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
  const hostAttribution = sessionDiagnosticsHostAttribution(row)
  const requestIdentity = sessionDiagnosticsRequestIdentity(row)
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
      </div>
      <div
        className='status-diagnostics-identity'
        aria-label='Session identity'
      >
        {SESSION_IDENTITY_FIELDS.map((field) => (
          <span key={field}>
            {field}{' '}
            <strong data-identity={field}>
              {displaySessionIdentityValue(row[field])}
            </strong>
          </span>
        ))}
      </div>
      <div className='status-estimator-lane-key'>
        {row.repository ?? 'unknown'} · {row.client ?? 'unknown'} ·{' '}
        {row.created_at ?? 'time unknown'}
      </div>
      {hostAttribution ? (
        <div className='status-diagnostics-host'>
          <span>
            host: <strong>{hostAttribution.primary}</strong>
          </span>
          {hostAttribution.secondaryClientIp ? (
            <span>
              client_ip: <strong>{hostAttribution.secondaryClientIp}</strong>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className='status-diagnostics-request'>
        <span>
          session: <strong>{requestIdentity.sessionId}</strong>
        </span>
        <span>
          trace: <strong>{requestIdentity.traceId}</strong>
        </span>
        <span>
          request: <strong>{requestIdentity.requestId}</strong>
        </span>
        <span>
          zen account: <strong>{requestIdentity.zenAccountRef}</strong>
        </span>
      </div>
      <div className='status-diagnostics-chip-row'>
        {[...flags, ...categories].slice(0, 10).map((flag) => (
          <span key={flag} className='status-diagnostics-chip'>
            {flag}
          </span>
        ))}
      </div>
      <SessionDiagnosticsStreamBlock
        stream={row.stream_diagnostics}
        diagnosticFlags={flags}
      />

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

      {row.request_wait_checkpoint ? (
        <RequestWaitCheckpointBlock checkpoint={row.request_wait_checkpoint} />
      ) : null}
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
  const extraCheckpoints = unattachedWaitCheckpoints(
    rows,
    response?.requestWaitCheckpoints
  )

  if (loading && rows.length === 0 && extraCheckpoints.length === 0) {
    return (
      <div className='status-estimator-empty' role='status'>
        Loading session diagnostics...
      </div>
    )
  }

  if (!loading && rows.length === 0 && extraCheckpoints.length === 0) {
    return (
      <div className='status-estimator-empty' role='status'>
        No session diagnostics for the selected range.
      </div>
    )
  }

  const limitLabel = response?.metadata.limit?.toLocaleString() ?? 'unknown'
  const subLabel = response?.requestWaitCheckpoints
    ? `${rows.length.toLocaleString()} rows · ${response.requestWaitCheckpoints.length.toLocaleString()} wait checkpoints · limit ${limitLabel}`
    : `${rows.length.toLocaleString()} rows · limit ${limitLabel}`
  const headPill = statusPill(
    SESSION_DIAGNOSTICS_HEAD_PILL,
    'loaded',
    STATUS_PILL_FALLBACK
  )

  return (
    <StatusPanel
      className='status-estimator-panel status-diagnostics-panel'
      ariaLabel='Session diagnostics'
      title='Session diagnostics'
      subLabel={subLabel}
      headPill={headPill}
    >
      <div className='status-estimator-grid status-diagnostics-grid'>
        {rows.map((row) => (
          <SessionDiagnosticsCard
            key={sessionDiagnosticsCardKey(row)}
            row={row}
          />
        ))}
        {extraCheckpoints.map((checkpoint) => (
          <WaitCheckpointCard
            key={waitCheckpointCardKey(checkpoint)}
            checkpoint={checkpoint}
          />
        ))}
      </div>
    </StatusPanel>
  )
}
