/**
 * Read model for durable request wait checkpoints stored on session_history.
 *
 * LiteLLM's sequence-guarded upsert keeps one current snapshot per call id.
 * This module only reads that snapshot. It does not write accounting, sum
 * overlapping wait categories, or treat an accounting duration as a timeout.
 * ASGI checkpoint completion is not provider content success or final delivery.
 */

export const REQUEST_WAIT_CHECKPOINT_FRESHNESS_SECONDS = 60
export const MAX_REQUEST_WAIT_CHECKPOINT_ROWS = 500
export const REQUEST_WAIT_CHECKPOINT_OUTCOME_NOTE =
  'Recorded wait categories overlap and are not disjoint elapsed time. An accounting duration is not a timeout. ASGI checkpoint completion does not establish provider content success or final delivery.'

const DASHBOARD_TIME_ZONE_SQL = "'America/New_York'"
const ASGI_TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'canceled',
  'disconnected',
])

export class BadRequestError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BadRequestError'
  }
}

function dashboardDateBoundary(index) {
  return `($${index}::date::timestamp AT TIME ZONE ${DASHBOARD_TIME_ZONE_SQL})`
}

function providerDimensionSql(columnExpression) {
  return `
CASE
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) IN ('google', 'gemini') THEN 'google'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'xai/%' THEN 'xai'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'local/%' THEN 'local'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'local_%' THEN 'local'
    ELSE COALESCE(${columnExpression}, 'unknown')
END`
}

function parseCsv(value) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => {
      const trimmed = item.trim()
      if (!trimmed) return ''
      try {
        return decodeURIComponent(trimmed)
      } catch {
        return trimmed
      }
    })
    .filter(Boolean)
}

function resolveDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(
      `A valid ${label}=YYYY-MM-DD parameter is required.`
    )
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestError(`Invalid date: ${value}`)
  }
  return value
}

function parseCheckpointLimit(value) {
  if (value == null || String(value).trim() === '') return 100
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return 100
  return Math.min(Math.floor(parsed), MAX_REQUEST_WAIT_CHECKPOINT_ROWS)
}

function appendAnyFilter(whereParts, values, expression, selected) {
  if (!selected.length) return
  values.push(selected)
  whereParts.push(`${expression} = ANY($${values.length}::text[])`)
}

export function buildRequestWaitCheckpointQuery(searchParams, options = {}) {
  const from = resolveDate(options.from ?? searchParams.get('from'), 'from')
  const to = resolveDate(options.to ?? searchParams.get('to'), 'to')
  const limit = parseCheckpointLimit(options.limit ?? searchParams.get('limit'))
  const values = [from, to]
  const whereParts = [
    "sh.metadata ? 'wait_accounting'",
    `sh.created_at >= ${dashboardDateBoundary(1)}`,
    `sh.created_at < ${dashboardDateBoundary(2)}`,
  ]
  const providerSql = providerDimensionSql('sh.provider')

  appendAnyFilter(
    whereParts,
    values,
    `(${providerSql})`,
    parseCsv(searchParams.get('provider'))
  )
  appendAnyFilter(
    whereParts,
    values,
    "COALESCE(sh.model, 'unknown')",
    parseCsv(searchParams.get('model'))
  )
  appendAnyFilter(
    whereParts,
    values,
    "COALESCE(sh.tenant_id, 'unknown')",
    parseCsv(searchParams.get('repository'))
  )
  appendAnyFilter(
    whereParts,
    values,
    "COALESCE(sh.client_name, 'unknown')",
    parseCsv(searchParams.get('client'))
  )
  appendAnyFilter(
    whereParts,
    values,
    "COALESCE(sh.litellm_environment, 'unknown')",
    parseCsv(searchParams.get('environment'))
  )
  appendAnyFilter(
    whereParts,
    values,
    'sh.session_id::text',
    parseCsv(searchParams.get('session_id'))
  )
  appendAnyFilter(
    whereParts,
    values,
    "NULLIF(sh.trace_id, '')",
    parseCsv(searchParams.get('trace_id'))
  )
  appendAnyFilter(
    whereParts,
    values,
    'sh.litellm_call_id::text',
    parseCsv(searchParams.get('litellm_call_id'))
  )

  values.push(limit)
  const limitPlaceholder = `$${values.length}`
  const sql = `
SELECT
    sh.created_at,
    sh.start_time,
    sh.end_time,
    sh.session_id::text AS session_id,
    NULLIF(sh.trace_id, '') AS trace_id,
    sh.litellm_call_id::text AS litellm_call_id,
    sh.call_type,
    ${providerSql} AS provider,
    COALESCE(sh.model, 'unknown') AS model,
    COALESCE(sh.tenant_id, 'unknown') AS repository,
    sh.host_name AS host_name,
    sh.client_ip AS client_ip,
    COALESCE(sh.client_name, 'unknown') AS client,
    COALESCE(sh.litellm_environment, 'unknown') AS environment,
    NULLIF(sh.provider_response_id, '') AS provider_response_id,
    sh.empty_completion_failure AS history_empty_completion_failure,
    -- Checkpoint-only rows have no qualifying session_history call yet.
    (sh.call_type IS NULL AND sh.metadata ? 'wait_accounting') AS checkpoint_only,
    (NOT (sh.call_type IS NULL AND sh.metadata ? 'wait_accounting')) AS qualifying_session_history,
    sh.metadata->'wait_accounting' AS wait_accounting,
    sh.metadata->'wait_accounting'->>'status' AS checkpoint_status,
    sh.metadata->'wait_accounting'->>'sequence' AS checkpoint_sequence,
    sh.metadata->'wait_accounting'->>'started_at' AS checkpoint_started_at,
    sh.metadata->'wait_accounting'->>'updated_at' AS checkpoint_updated_at,
    sh.metadata->'wait_accounting'->'current_waits' AS current_waits,
    sh.metadata->'wait_accounting'->'durations_ms' AS durations_ms,
    sh.metadata->'wait_accounting'->'counts' AS counts
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
ORDER BY sh.created_at DESC, sh.litellm_call_id ASC
LIMIT ${limitPlaceholder}
`

  return {
    sql,
    values,
    metadata: { from, to, limit },
  }
}

function parseJson(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function textOrNull(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function timestampText(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  return textOrNull(value)
}

function finiteNumber(value) {
  if (typeof value === 'boolean' || value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function finiteInteger(value) {
  const number = finiteNumber(value)
  if (number == null || !Number.isInteger(number)) return null
  return number
}

function normalizeTriStateBoolean(value) {
  if (value === true || value === false) return value
  if (value === 't' || value === 'true' || value === '1') return true
  if (value === 'f' || value === 'false' || value === '0') return false
  return null
}

function unwrapSnapshot(value) {
  const parsed = parseJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  if (
    parsed.wait_accounting &&
    typeof parsed.wait_accounting === 'object' &&
    !Array.isArray(parsed.wait_accounting)
  ) {
    return parsed.wait_accounting
  }
  return parsed
}

function normalizeDurationMap(value) {
  const parsed = parseJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }
  const durations = {}
  for (const [key, raw] of Object.entries(parsed)) {
    const kind = key.trim()
    if (!kind) continue
    const number = finiteNumber(raw)
    if (number == null || number < 0) continue
    durations[kind] = number
  }
  return durations
}

function normalizeCountMap(value) {
  const parsed = parseJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }
  const counts = {}
  for (const [key, raw] of Object.entries(parsed)) {
    const kind = key.trim()
    if (!kind) continue
    const number = finiteInteger(raw)
    if (number == null || number < 0) continue
    counts[kind] = number
  }
  return counts
}

function normalizeWaits(value) {
  const parsed = parseJson(value)
  if (!Array.isArray(parsed)) return []
  const waits = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const type = textOrNull(item.type)
    if (!type) continue
    waits.push({
      type,
      started_at: timestampText(item.started_at),
    })
  }
  return waits
}

function snapshotHasContent(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false
  return (
    textOrNull(snapshot.status) != null ||
    finiteInteger(snapshot.sequence) != null ||
    normalizeWaits(snapshot.current_waits).length > 0 ||
    Object.keys(normalizeDurationMap(snapshot.durations_ms)).length > 0 ||
    Object.keys(normalizeCountMap(snapshot.counts)).length > 0 ||
    timestampText(snapshot.updated_at) != null ||
    timestampText(snapshot.started_at) != null
  )
}

function readSnapshot(row) {
  const fromColumn = unwrapSnapshot(row.wait_accounting)
  if (fromColumn && snapshotHasContent(fromColumn)) return fromColumn
  const projected = {
    status: row.checkpoint_status,
    sequence: row.checkpoint_sequence,
    started_at: row.checkpoint_started_at,
    updated_at: row.checkpoint_updated_at,
    current_waits: row.current_waits,
    durations_ms: row.durations_ms,
    counts: row.counts,
  }
  if (snapshotHasContent(projected)) return projected
  return null
}

function identityFromRow(row) {
  return {
    litellm_call_id: textOrNull(row.litellm_call_id),
    session_id: textOrNull(row.session_id),
    provider: textOrNull(row.provider),
    model: textOrNull(row.model),
    created_at: timestampText(row.created_at),
    repository: textOrNull(row.repository),
    client: textOrNull(row.client),
    environment: textOrNull(row.environment),
    trace_id: textOrNull(row.trace_id),
    host_name: textOrNull(row.host_name),
    client_ip: textOrNull(row.client_ip),
    provider_response_id: textOrNull(row.provider_response_id),
    session_history_start_time: timestampText(row.start_time),
    session_history_end_time: timestampText(
      row.end_time ?? row.session_history_end_time
    ),
  }
}

function providerContentFromHistory(historyEmptyCompletion) {
  if (historyEmptyCompletion === true) {
    return {
      provider_content_outcome: 'empty_completion_recorded',
      provider_content_source: 'session_history.empty_completion_failure',
    }
  }
  return {
    provider_content_outcome: 'not_established',
    provider_content_source: 'unavailable',
  }
}

function baseCheckpoint(fields) {
  return {
    litellm_call_id: null,
    session_id: null,
    record_attribution: 'missing',
    missing_reason: null,
    activity: 'missing',
    display_states: ['missing'],
    checkpoint_status: null,
    freshness: 'missing',
    freshness_age_seconds: null,
    freshness_threshold_seconds: REQUEST_WAIT_CHECKPOINT_FRESHNESS_SECONDS,
    freshness_basis: 'checkpoint_updated_at',
    sequence: null,
    checkpoint_started_at: null,
    checkpoint_updated_at: null,
    asgi_completion_at: null,
    session_history_start_time: null,
    session_history_end_time: null,
    active_wait_categories: [],
    durations_ms: {},
    counts: {},
    durations_are_disjoint: false,
    summed_duration_ms: null,
    duration_accounting: 'overlapping_categories',
    accounting_duration_is_timeout: false,
    asgi_establishes_provider_success: false,
    asgi_establishes_final_delivery: false,
    provider_content_outcome: 'not_established',
    provider_content_source: 'unavailable',
    final_delivery_outcome: 'not_established',
    outcome_note: REQUEST_WAIT_CHECKPOINT_OUTCOME_NOTE,
    qualifying_session_history: false,
    provider: null,
    model: null,
    created_at: null,
    repository: null,
    client: null,
    environment: null,
    trace_id: null,
    host_name: null,
    client_ip: null,
    provider_response_id: null,
    history_empty_completion_failure: null,
    generated_at: null,
    ...fields,
  }
}

function checkpointFreshness(updatedAt, generatedAt) {
  const updatedMs = Date.parse(updatedAt ?? '')
  const generatedMs = Date.parse(generatedAt ?? '')
  if (!Number.isFinite(updatedMs) || !Number.isFinite(generatedMs)) {
    return { freshness: 'unknown', freshness_age_seconds: null }
  }
  const ageSeconds = Math.max(0, (generatedMs - updatedMs) / 1000)
  return {
    freshness:
      ageSeconds > REQUEST_WAIT_CHECKPOINT_FRESHNESS_SECONDS
        ? 'stale'
        : 'fresh',
    freshness_age_seconds: Math.round(ageSeconds * 1000) / 1000,
  }
}

function classifyActivity(status, freshness) {
  if (status && ASGI_TERMINAL_STATUSES.has(status)) return 'completed_asgi'
  if (status === 'running' && freshness === 'stale') return 'stale'
  if (status === 'running' && freshness === 'fresh') return 'active'
  return 'recorded'
}

function displayStatesFor(attribution, activity) {
  const states = [attribution]
  if (activity === 'active') states.push('active')
  if (activity === 'stale') states.push('stale')
  if (activity === 'completed_asgi') states.push('completed')
  if (activity === 'recorded') states.push('recorded')
  return states
}

function rowIsCheckpointOnly(row) {
  const flag = normalizeTriStateBoolean(row.checkpoint_only)
  if (flag != null) return flag
  return row.call_type == null || row.call_type === ''
}

export function normalizeRequestWaitCheckpointRow(row, options = {}) {
  const snapshot = readSnapshot(row ?? {})
  if (!snapshot) return null
  const generatedAt = timestampText(options.generatedAt) ?? options.generatedAt
  const status = textOrNull(snapshot.status)?.toLowerCase() ?? null
  const updatedAt = timestampText(snapshot.updated_at)
  const startedAt = timestampText(snapshot.started_at)
  const freshness = checkpointFreshness(updatedAt, generatedAt)
  const activity = classifyActivity(status, freshness.freshness)
  const checkpointOnly = rowIsCheckpointOnly(row)
  const attribution = checkpointOnly
    ? 'checkpoint_only'
    : 'correlated_session_history'
  const historyEmpty = normalizeTriStateBoolean(
    row.history_empty_completion_failure ?? row.empty_completion_failure
  )
  const providerContent = providerContentFromHistory(historyEmpty)
  const terminal = status != null && ASGI_TERMINAL_STATUSES.has(status)

  return baseCheckpoint({
    ...identityFromRow(row),
    record_attribution: attribution,
    missing_reason: null,
    activity,
    display_states: displayStatesFor(attribution, activity),
    checkpoint_status: status,
    freshness: freshness.freshness,
    freshness_age_seconds: freshness.freshness_age_seconds,
    sequence: finiteInteger(snapshot.sequence),
    checkpoint_started_at: startedAt,
    checkpoint_updated_at: updatedAt,
    asgi_completion_at: terminal ? updatedAt : null,
    active_wait_categories: normalizeWaits(snapshot.current_waits),
    durations_ms: normalizeDurationMap(snapshot.durations_ms),
    counts: normalizeCountMap(snapshot.counts),
    ...providerContent,
    qualifying_session_history: !checkpointOnly,
    history_empty_completion_failure: historyEmpty,
    generated_at: typeof generatedAt === 'string' ? generatedAt : null,
  })
}

function missingRequestWaitCheckpoint(row, generatedAt) {
  const callId = textOrNull(row.litellm_call_id)
  const historyEmpty = normalizeTriStateBoolean(
    row.history_empty_completion_failure ?? row.empty_completion_failure
  )
  const providerContent = providerContentFromHistory(historyEmpty)
  return baseCheckpoint({
    ...identityFromRow(row),
    record_attribution: 'missing',
    missing_reason: callId ? 'no_durable_checkpoint' : 'no_litellm_call_id',
    activity: 'missing',
    display_states: ['missing'],
    freshness: 'missing',
    ...providerContent,
    qualifying_session_history: false,
    history_empty_completion_failure: historyEmpty,
    generated_at: generatedAt,
  })
}

function preferredCheckpoint(current, candidate) {
  const currentSequence = current.sequence ?? Number.NEGATIVE_INFINITY
  const candidateSequence = candidate.sequence ?? Number.NEGATIVE_INFINITY
  if (candidateSequence > currentSequence) return candidate
  return current
}

export function selectCurrentWaitCheckpoints(rows, generatedAt) {
  const order = []
  const indexByCallId = new Map()
  for (const row of rows ?? []) {
    const checkpoint = normalizeRequestWaitCheckpointRow(row, { generatedAt })
    if (!checkpoint) continue
    const callId = checkpoint.litellm_call_id
    if (!callId) {
      order.push(checkpoint)
      continue
    }
    const existingIndex = indexByCallId.get(callId)
    if (existingIndex == null) {
      indexByCallId.set(callId, order.length)
      order.push(checkpoint)
      continue
    }
    order[existingIndex] = preferredCheckpoint(order[existingIndex], checkpoint)
  }
  return order
}

export function assembleRequestWaitDiagnostics({
  metadata,
  sessionDiagnostics,
  checkpointRows,
  generatedAt,
}) {
  const observedAt =
    timestampText(generatedAt) ??
    (typeof generatedAt === 'string' ? generatedAt : null)
  const requestWaitCheckpoints = selectCurrentWaitCheckpoints(
    checkpointRows,
    observedAt
  )
  const byCallId = new Map()
  for (const checkpoint of requestWaitCheckpoints) {
    if (checkpoint.litellm_call_id) {
      byCallId.set(checkpoint.litellm_call_id, checkpoint)
    }
  }
  const attached = (sessionDiagnostics ?? []).map((row) => {
    const callId = textOrNull(row?.litellm_call_id)
    const checkpoint = callId ? byCallId.get(callId) : null
    return {
      ...row,
      request_wait_checkpoint:
        checkpoint ?? missingRequestWaitCheckpoint(row ?? {}, observedAt),
    }
  })
  return {
    metadata: {
      ...metadata,
      generatedAt: observedAt,
      requestWaitCheckpointFreshnessSeconds:
        REQUEST_WAIT_CHECKPOINT_FRESHNESS_SECONDS,
      requestWaitCheckpointCount: requestWaitCheckpoints.length,
    },
    sessionDiagnostics: attached,
    requestWaitCheckpoints,
  }
}
