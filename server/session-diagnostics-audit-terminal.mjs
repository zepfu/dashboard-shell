/**
 * Audit-backed session diagnostics for terminal session-owner, replay, and
 * redispatch decisions.
 *
 * Those decisions can be persisted to public.aawm_alias_routing_audit without a
 * session_history row. Extended evidence lives on aawm_alias_routing_audit.metadata
 * (failure_phase, attempted_provider_call, replay_safety, session_owner_mismatch_reason).
 * There is no details column. This module never selects raw metadata, request
 * bodies, or credential fields.
 */

const AUDIT_TERMINAL_MAX_ROWS = 500
const PHASE_MAX = 128
const REASON_MAX = 240
const IDENTITY_MAX = 256
const FIELD_PATH_MAX = 256
const CLASSIFICATION_MAX = 64
const REPLAY_CLASSIFICATIONS = new Set([
  'previous_response_id',
  'id_only_reasoning_reference',
  'explicit_item_reference',
  'invalid_body_shape',
])
const EgressDisposition = {
  localGuard: 'local_guard',
  replayRejection: 'replay_rejection',
  attemptedProviderEgress: 'attempted_provider_egress',
  unavailable: 'unavailable',
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const COLUMN_REFERENCE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function assertColumnReference(value) {
  if (typeof value !== 'string' || !COLUMN_REFERENCE.test(value)) {
    throw new TypeError(
      'Audit terminal SQL column must be a static column reference'
    )
  }
}

function assertIdentifier(value) {
  if (typeof value !== 'string' || !SQL_IDENTIFIER.test(value)) {
    throw new TypeError('Audit terminal SQL alias must be a static identifier')
  }
}

function providerCanonicalSql(columnExpression) {
  assertColumnReference(columnExpression)
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

function recordedProviderSql(columnExpression) {
  assertColumnReference(columnExpression)
  return `CASE WHEN NULLIF(${columnExpression}, '') IS NULL THEN NULL ELSE ${providerCanonicalSql(columnExpression)} END`
}

function dashboardDateBoundarySql(index) {
  if (!Number.isInteger(index) || index < 1) {
    throw new TypeError('Date-boundary indexes must be positive integers')
  }
  return `($${index}::date::timestamp AT TIME ZONE 'America/New_York')`
}

export function attemptedProviderCallSql(alias = 'aa') {
  assertIdentifier(alias)
  return `CASE
    WHEN jsonb_typeof(${alias}.metadata->'attempted_provider_call') = 'boolean'
      THEN ${alias}.metadata->'attempted_provider_call'
    WHEN lower(COALESCE(${alias}.metadata->>'attempted_provider_call', '')) IN ('true', 'false', '1', '0')
      THEN to_jsonb(lower(${alias}.metadata->>'attempted_provider_call') IN ('true', '1'))
    ELSE NULL
  END`
}

export function replaySafetySql(alias = 'aa') {
  assertIdentifier(alias)
  return `CASE
    WHEN jsonb_typeof(${alias}.metadata->'replay_safety') = 'object'
     AND (
       NULLIF(${alias}.metadata->'replay_safety'->>'field_path', '') IS NOT NULL
       OR NULLIF(${alias}.metadata->'replay_safety'->>'classification', '') IS NOT NULL
     )
    THEN jsonb_strip_nulls(jsonb_build_object(
      'field_path', NULLIF(left(${alias}.metadata->'replay_safety'->>'field_path', ${FIELD_PATH_MAX}), ''),
      'classification', NULLIF(left(${alias}.metadata->'replay_safety'->>'classification', ${CLASSIFICATION_MAX}), '')
    ))
    ELSE NULL
  END`
}

export function aliasAuditTerminalEvidenceSql(alias = 'aa') {
  assertIdentifier(alias)
  return `'failure_phase', NULLIF(left(${alias}.metadata->>'failure_phase', ${PHASE_MAX}), ''),
    'selection_reason', NULLIF(left(COALESCE(NULLIF(${alias}.selection_reason, ''), ${alias}.metadata->>'selection_reason'), ${REASON_MAX}), ''),
    'session_owner_mismatch_reason', NULLIF(left(${alias}.metadata->>'session_owner_mismatch_reason', ${REASON_MAX}), ''),
    'attempted_provider_call', ${attemptedProviderCallSql(alias)},
    'replay_safety', ${replaySafetySql(alias)}`
}

function aliasAuditEventObjectSql(alias = 'aa') {
  assertIdentifier(alias)
  return `jsonb_strip_nulls(jsonb_build_object(
      'observed_at', ${alias}.observed_at,
      'session_id', NULLIF(${alias}.session_id, ''),
      'trace_id', NULLIF(${alias}.trace_id, ''),
      'litellm_call_id', NULLIF(${alias}.litellm_call_id, ''),
      'alias_model', NULLIF(${alias}.alias_model, ''),
      'alias_family', NULLIF(${alias}.alias_family, ''),
      'provider', NULLIF(${alias}.provider, ''),
      'model', NULLIF(${alias}.model, ''),
      'route_family', NULLIF(${alias}.route_family, ''),
      'attempt_number', ${alias}.attempt_number,
      'event_type', NULLIF(${alias}.event_type, ''),
      'failure_class', NULLIF(${alias}.failure_class, ''),
      'cooldown_state', COALESCE(NULLIF(${alias}.candidate_status, ''), NULLIF(${alias}.metadata->>'cooldown_state', '')),
      'cooldown_until', ${alias}.cooldown_until,
      'redispatch_required', ${alias}.redispatch_required,
      'last_resort', ${alias}.last_resort,
      ${aliasAuditTerminalEvidenceSql(alias)}
    ))`
}

function terminalDecisionPredicate(alias = 'aa') {
  assertIdentifier(alias)
  return `(
      ${alias}.event_type = 'redispatch_required'
      OR ${alias}.failure_class = 'session_owner_redispatch'
      OR COALESCE(${alias}.metadata->>'failure_phase', '') LIKE 'session_owner%'
      OR jsonb_typeof(${alias}.metadata->'replay_safety') = 'object'
      OR (
        ${alias}.redispatch_required IS TRUE
        AND (
          ${alias}.metadata ? 'attempted_provider_call'
          OR ${alias}.metadata ? 'session_owner_mismatch_reason'
          OR ${alias}.metadata ? 'replay_safety'
        )
      )
    )`
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

function requireDateOnly(value, label) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    throw new TypeError(
      `Audit terminal diagnostics require a YYYY-MM-DD ${label} bound`
    )
  }
  return value
}

function parseLimit(value) {
  const parsed = Number(value ?? 100)
  if (!Number.isFinite(parsed) || parsed < 1) return 100
  return Math.min(Math.floor(parsed), AUDIT_TERMINAL_MAX_ROWS)
}

function excludedIdentityFilters(searchParams) {
  const excluded = []
  if (parseCsv(searchParams.get('client')).length) excluded.push('client')
  if (parseCsv(searchParams.get('environment')).length) {
    excluded.push('environment')
  }
  const grokFlag = parseCsv(searchParams.get('grok_side_channel'))
  if (
    grokFlag.some((value) => ['true', '1', 'yes'].includes(value.toLowerCase()))
  ) {
    excluded.push('grok_side_channel')
  }
  if (parseCsv(searchParams.get('grok_side_channel_endpoint_type')).length) {
    excluded.push('grok_side_channel_endpoint_type')
  }
  return excluded
}

function pushTextArrayFilter(values, selected) {
  values.push(selected)
  return `$${values.length}::text[]`
}

export function buildSessionDiagnosticsAuditTerminalQuery(
  searchParams,
  options = {}
) {
  const from = requireDateOnly(options.from ?? searchParams.get('from'), 'from')
  const to = requireDateOnly(options.to ?? searchParams.get('to'), 'to')
  const limit = parseLimit(options.limit ?? searchParams.get('limit'))
  const excludedFilters = excludedIdentityFilters(searchParams)
  const values = [from, to]
  const whereParts = [
    `aa.observed_at >= ${dashboardDateBoundarySql(1)}`,
    `aa.observed_at < ${dashboardDateBoundarySql(2)}`,
    terminalDecisionPredicate('aa'),
  ]
  const historyFilterParts = [
    `sh.created_at >= ${dashboardDateBoundarySql(1)}`,
    `sh.created_at < ${dashboardDateBoundarySql(2)}`,
    `(
      sh.metadata ? 'aawm_alias_routing_audit_events'
      OR sh.metadata ? 'codex_auto_agent_audit_events'
      OR sh.metadata ? 'anthropic_auto_agent_audit_events'
    )`,
  ]

  const provider = parseCsv(searchParams.get('provider'))
  if (provider.length) {
    const placeholder = pushTextArrayFilter(values, provider)
    whereParts.push(
      `${recordedProviderSql('aa.provider')} = ANY(${placeholder})`
    )
    historyFilterParts.push(
      `${providerCanonicalSql('sh.provider')} = ANY(${placeholder})`
    )
  }

  const model = parseCsv(searchParams.get('model'))
  if (model.length) {
    const placeholder = pushTextArrayFilter(values, model)
    whereParts.push(`NULLIF(aa.model, '') = ANY(${placeholder})`)
    historyFilterParts.push(
      `COALESCE(sh.model, 'unknown') = ANY(${placeholder})`
    )
  }

  const repository = parseCsv(searchParams.get('repository'))
  if (repository.length) {
    const placeholder = pushTextArrayFilter(values, repository)
    whereParts.push(`(
      NULLIF(aa.metadata->>'repository', '') = ANY(${placeholder})
      OR NULLIF(aa.metadata->>'session_history_repository', '') = ANY(${placeholder})
    )`)
    historyFilterParts.push(
      `COALESCE(sh.tenant_id, 'unknown') = ANY(${placeholder})`
    )
  }

  for (const key of ['session_id', 'trace_id', 'litellm_call_id']) {
    const selected = parseCsv(searchParams.get(key))
    if (!selected.length) continue
    const placeholder = pushTextArrayFilter(values, selected)
    whereParts.push(`NULLIF(aa.${key}, '') = ANY(${placeholder})`)
    if (key === 'trace_id') {
      historyFilterParts.push(`NULLIF(sh.trace_id, '') = ANY(${placeholder})`)
    } else {
      historyFilterParts.push(
        `sh.${key} IS NOT NULL AND sh.${key}::text = ANY(${placeholder})`
      )
    }
  }

  if (excludedFilters.length) {
    whereParts.push('FALSE')
  }

  values.push(limit)
  const limitPlaceholder = `$${values.length}`

  const sql = `
WITH bounded_audit AS (
    SELECT
        aa.id,
        aa.observed_at,
        NULLIF(aa.session_id, '') AS session_id,
        NULLIF(aa.trace_id, '') AS trace_id,
        NULLIF(aa.litellm_call_id, '') AS litellm_call_id,
        ${recordedProviderSql('aa.provider')} AS provider,
        NULLIF(aa.model, '') AS model,
        COALESCE(
          NULLIF(aa.metadata->>'repository', ''),
          NULLIF(aa.metadata->>'session_history_repository', '')
        ) AS repository,
        ${aliasAuditEventObjectSql('aa')} AS alias_route_event,
        CASE
            WHEN NULLIF(aa.litellm_call_id, '') IS NOT NULL THEN 'call:' || aa.litellm_call_id
            WHEN NULLIF(aa.trace_id, '') IS NOT NULL THEN 'trace:' || aa.trace_id
            WHEN NULLIF(aa.session_id, '') IS NOT NULL THEN 'session:' || aa.session_id
            ELSE 'audit:' || aa.id::text
        END AS group_key
    FROM public.aawm_alias_routing_audit aa
    WHERE ${whereParts.join('\n      AND ')}
      AND NOT EXISTS (
        SELECT 1
        FROM public.session_history sh
        WHERE ${historyFilterParts.join('\n          AND ')}
          AND (
            (
              NULLIF(aa.litellm_call_id, '') IS NOT NULL
              AND sh.litellm_call_id IS NOT NULL
              AND NULLIF(aa.litellm_call_id, '') = sh.litellm_call_id::text
            )
            OR (
              NULLIF(aa.session_id, '') IS NOT NULL
              AND sh.session_id IS NOT NULL
              AND NULLIF(aa.session_id, '') = sh.session_id::text
            )
            OR (
              NULLIF(aa.trace_id, '') IS NOT NULL
              AND NULLIF(sh.trace_id, '') IS NOT NULL
              AND NULLIF(aa.trace_id, '') = NULLIF(sh.trace_id, '')
            )
          )
      )
    ORDER BY aa.observed_at DESC
    LIMIT ${limitPlaceholder}
)
SELECT
    MAX(observed_at) AS created_at,
    NULL::timestamptz AS start_time,
    NULL::timestamptz AS end_time,
    (array_agg(session_id ORDER BY observed_at DESC) FILTER (WHERE session_id IS NOT NULL))[1] AS session_id,
    (array_agg(trace_id ORDER BY observed_at DESC) FILTER (WHERE trace_id IS NOT NULL))[1] AS trace_id,
    (array_agg(litellm_call_id ORDER BY observed_at DESC) FILTER (WHERE litellm_call_id IS NOT NULL))[1] AS litellm_call_id,
    (array_agg(provider ORDER BY observed_at DESC) FILTER (WHERE provider IS NOT NULL))[1] AS provider,
    (array_agg(model ORDER BY observed_at DESC) FILTER (WHERE model IS NOT NULL))[1] AS model,
    NULL::text AS model_group,
    (array_agg(repository ORDER BY observed_at DESC) FILTER (WHERE repository IS NOT NULL))[1] AS repository,
    NULL::text AS host_name,
    NULL::text AS client_ip,
    NULL::text AS client,
    NULL::text AS client_version,
    NULL::text AS environment,
    NULL::text AS inbound_model_alias,
    NULL::text AS agent_name,
    NULL::text AS agent_id,
    ARRAY['alias_routing']::text[] AS diagnostic_flags,
    ARRAY['route_timeline']::text[] AS diagnostic_categories,
    NULL::jsonb AS grok_oauth,
    NULL::jsonb AS grok_side_channel,
    NULL::jsonb AS output_contract,
    NULL::jsonb AS xai_sanitizer,
    NULL::jsonb AS transcript_attribution,
    NULL::jsonb AS tool_definitions,
    NULL::jsonb AS anthropic_context_window,
    jsonb_agg(alias_route_event ORDER BY observed_at) AS alias_route_events,
    jsonb_build_object(
        'source', 'alias_routing_audit',
        'history_row', 'absent',
        'session_id', CASE WHEN bool_or(session_id IS NOT NULL) THEN 'recorded' ELSE 'unavailable' END,
        'trace_id', CASE WHEN bool_or(trace_id IS NOT NULL) THEN 'recorded' ELSE 'unavailable' END,
        'litellm_call_id', CASE WHEN bool_or(litellm_call_id IS NOT NULL) THEN 'recorded' ELSE 'unavailable' END,
        'provider', CASE WHEN bool_or(provider IS NOT NULL) THEN 'recorded' ELSE 'unavailable' END,
        'model', CASE WHEN bool_or(model IS NOT NULL) THEN 'recorded' ELSE 'unavailable' END,
        'repository', CASE WHEN bool_or(repository IS NOT NULL) THEN 'recorded' ELSE 'unavailable' END
    ) AS audit_identity
FROM bounded_audit
GROUP BY group_key
ORDER BY MAX(observed_at) DESC
`

  return {
    sql,
    values,
    metadata: {
      from,
      to,
      limit,
      dataSource: 'aawm_alias_routing_audit',
      excludedFilters,
    },
  }
}

function nonempty(value) {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

function boundedText(value, max) {
  const text = nonempty(value)
  if (!text) return null
  return text.slice(0, max)
}

function boundedLabel(value, max) {
  const text = nonempty(value)
  if (!text) return null
  const cleaned = text.replace(/[^\w.\-:/ ]+/g, '').trim()
  if (!cleaned) return null
  return cleaned.slice(0, max)
}

function booleanish(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value !== 'string') return null
  const lowered = value.trim().toLowerCase()
  if (lowered === 'true' || lowered === '1') return true
  if (lowered === 'false' || lowered === '0') return false
  if (!lowered) return null
  return value.slice(0, 32)
}

export function parseAttemptedProviderCall(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = booleanish(value)
  return typeof parsed === 'boolean' ? parsed : null
}

export function sanitizeReplaySafety(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const classification = boundedLabel(value.classification, CLASSIFICATION_MAX)
  if (!classification || !REPLAY_CLASSIFICATIONS.has(classification))
    return null
  const fieldPath = boundedText(value.field_path, FIELD_PATH_MAX)
  const safePath =
    fieldPath && /^[A-Za-z0-9_$.[\]*-]+$/.test(fieldPath) ? fieldPath : null
  return {
    classification,
    field_path: safePath,
  }
}

function replayEvidence(event) {
  if (sanitizeReplaySafety(event?.replay_safety)) return true
  const phase = boundedLabel(event?.failure_phase, PHASE_MAX)
  return Boolean(phase && phase.includes('replay'))
}

function isTerminalAliasEvent(event) {
  if (!event || typeof event !== 'object') return false
  if (event.event_type === 'redispatch_required') return true
  if (event.failure_class === 'session_owner_redispatch') return true
  const phase = boundedLabel(event.failure_phase, PHASE_MAX)
  if (phase && phase.startsWith('session_owner')) return true
  if (sanitizeReplaySafety(event.replay_safety)) return true
  if (boundedLabel(event.session_owner_mismatch_reason, REASON_MAX)) return true
  if (parseAttemptedProviderCall(event.attempted_provider_call) !== null) {
    return true
  }
  return false
}

export function classifyAliasTerminalEgress(event) {
  if (!isTerminalAliasEvent(event)) return null
  const attempted = parseAttemptedProviderCall(event?.attempted_provider_call)
  if (attempted === true) return EgressDisposition.attemptedProviderEgress
  if (attempted === false && replayEvidence(event)) {
    return EgressDisposition.replayRejection
  }
  if (attempted === false) return EgressDisposition.localGuard
  return EgressDisposition.unavailable
}

const ALIAS_EVENT_TEXT_FIELDS = [
  'observed_at',
  'session_id',
  'trace_id',
  'litellm_call_id',
  'alias_model',
  'alias_family',
  'provider',
  'model',
  'route_family',
  'event_type',
  'failure_class',
  'cooldown_state',
  'cooldown_until',
]

export function sanitizeAliasRouteEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null
  const sanitized = {}
  for (const field of ALIAS_EVENT_TEXT_FIELDS) {
    const text = boundedText(event[field], IDENTITY_MAX)
    if (text != null) sanitized[field] = text
  }
  if (
    event.attempt_number !== undefined &&
    event.attempt_number !== null &&
    event.attempt_number !== ''
  ) {
    if (
      typeof event.attempt_number === 'number' &&
      Number.isFinite(event.attempt_number)
    ) {
      sanitized.attempt_number = event.attempt_number
    } else if (typeof event.attempt_number === 'string') {
      const attempt = boundedText(event.attempt_number, 32)
      if (attempt) sanitized.attempt_number = attempt
    }
  }
  const redispatch = booleanish(event.redispatch_required)
  if (redispatch !== undefined) sanitized.redispatch_required = redispatch
  const lastResort = booleanish(event.last_resort)
  if (lastResort !== undefined) sanitized.last_resort = lastResort

  const phase = boundedLabel(event.failure_phase, PHASE_MAX)
  if (phase) sanitized.failure_phase = phase
  const selection = boundedLabel(event.selection_reason, REASON_MAX)
  if (selection) sanitized.selection_reason = selection
  const reason = boundedLabel(event.session_owner_mismatch_reason, REASON_MAX)
  if (reason) sanitized.session_owner_mismatch_reason = reason

  if (
    event.attempted_provider_call !== undefined &&
    event.attempted_provider_call !== null &&
    event.attempted_provider_call !== ''
  ) {
    const attempted = parseAttemptedProviderCall(event.attempted_provider_call)
    if (attempted !== null) sanitized.attempted_provider_call = attempted
  }

  const replay = sanitizeReplaySafety(event.replay_safety)
  if (replay) sanitized.replay_safety = replay

  const disposition = classifyAliasTerminalEgress(sanitized)
  if (disposition) sanitized.egress_disposition = disposition
  return sanitized
}

export function sanitizeAliasRouteEvents(events) {
  const source = Array.isArray(events) ? events : []
  return source
    .map((event) => sanitizeAliasRouteEvent(event))
    .filter((event) => event != null)
}

const AUDIT_IDENTITY_FIELDS = [
  'session_id',
  'trace_id',
  'litellm_call_id',
  'provider',
  'model',
  'repository',
]

export function sanitizeAuditIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.source !== 'alias_routing_audit') return null
  if (value.history_row !== 'absent') return null
  const identity = {
    source: 'alias_routing_audit',
    history_row: 'absent',
  }
  for (const field of AUDIT_IDENTITY_FIELDS) {
    identity[field] = value[field] === 'recorded' ? 'recorded' : 'unavailable'
  }
  return identity
}

function isoTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  return boundedText(value, 64)
}

function identityFlag(explicit, value) {
  if (explicit === 'recorded' && nonempty(value)) return 'recorded'
  if (nonempty(value)) return 'recorded'
  return 'unavailable'
}

export function normalizeAuditTerminalDiagnosticRow(row) {
  const source = row && typeof row === 'object' ? row : {}
  const explicit = sanitizeAuditIdentity(source.audit_identity)
  const auditIdentity = {
    source: 'alias_routing_audit',
    history_row: 'absent',
    session_id: identityFlag(explicit?.session_id, source.session_id),
    trace_id: identityFlag(explicit?.trace_id, source.trace_id),
    litellm_call_id: identityFlag(
      explicit?.litellm_call_id,
      source.litellm_call_id
    ),
    provider: identityFlag(explicit?.provider, source.provider),
    model: identityFlag(explicit?.model, source.model),
    repository: identityFlag(explicit?.repository, source.repository),
  }
  const recorded = (field) =>
    auditIdentity[field] === 'recorded' ? nonempty(source[field]) : null

  return {
    created_at: isoTimestamp(source.created_at),
    start_time: null,
    end_time: null,
    session_id: recorded('session_id'),
    trace_id: recorded('trace_id'),
    litellm_call_id: recorded('litellm_call_id'),
    provider: recorded('provider'),
    model: recorded('model'),
    model_group: null,
    repository: recorded('repository'),
    host_name: null,
    client_ip: null,
    client: null,
    client_version: null,
    environment: null,
    inbound_model_alias: null,
    agent_name: null,
    agent_id: null,
    diagnostic_flags: ['alias_routing'],
    diagnostic_categories: ['route_timeline'],
    grok_oauth: {},
    grok_side_channel: {},
    output_contract: {},
    xai_sanitizer: {},
    transcript_attribution: {},
    tool_definitions: {},
    anthropic_context_window: null,
    alias_route_events: sanitizeAliasRouteEvents(source.alias_route_events),
    audit_identity: auditIdentity,
  }
}

function timestampMillis(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime()
  }
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

function correlationIdentity(event, row) {
  const call =
    nonempty(event?.litellm_call_id) || nonempty(row?.litellm_call_id)
  const trace = nonempty(event?.trace_id) || nonempty(row?.trace_id)
  const session = nonempty(event?.session_id) || nonempty(row?.session_id)
  if (call) return `call:${call}`
  if (trace) return `trace:${trace}`
  if (session) return `session:${session}`
  return ''
}

const TERMINAL_EVIDENCE_FIELDS = [
  'failure_phase',
  'failure_class',
  'selection_reason',
  'session_owner_mismatch_reason',
  'attempted_provider_call',
  'replay_safety',
]

function supplementAliasTerminalEvidence(existing, incoming) {
  for (const field of TERMINAL_EVIDENCE_FIELDS) {
    if (
      (existing[field] === undefined || existing[field] === null) &&
      incoming[field] !== undefined &&
      incoming[field] !== null
    ) {
      existing[field] = incoming[field]
    }
  }
  const disposition = classifyAliasTerminalEgress(existing)
  if (disposition) existing.egress_disposition = disposition
}

function sameRepresentedAuditEvent(left, right, leftRow, rightRow) {
  const leftIdentity = correlationIdentity(left, leftRow)
  const rightIdentity = correlationIdentity(right, rightRow)
  if (!leftIdentity || leftIdentity !== rightIdentity) return false
  if (
    (nonempty(left?.event_type) ?? '') !== (nonempty(right?.event_type) ?? '')
  ) {
    return false
  }
  if (
    String(left?.attempt_number ?? '') !== String(right?.attempt_number ?? '')
  ) {
    return false
  }
  const leftTime = timestampMillis(left?.observed_at)
  const rightTime = timestampMillis(right?.observed_at)
  if (leftTime != null && rightTime != null) return leftTime === rightTime
  return true
}

function rowRepresentsAliasTimeline(row) {
  if (!row || typeof row !== 'object') return false
  if ((row.alias_route_events ?? []).length > 0) return true
  const flags = Array.isArray(row.diagnostic_flags) ? row.diagnostic_flags : []
  return flags.includes('alias_routing')
}

function cloneDiagnosticRow(row) {
  return {
    ...row,
    diagnostic_flags: Array.isArray(row?.diagnostic_flags)
      ? [...row.diagnostic_flags]
      : [],
    diagnostic_categories: Array.isArray(row?.diagnostic_categories)
      ? [...row.diagnostic_categories]
      : [],
    alias_route_events: sanitizeAliasRouteEvents(row?.alias_route_events),
    audit_identity: sanitizeAuditIdentity(row?.audit_identity),
  }
}

function indexHistoryRow(indexes, row) {
  if (!rowRepresentsAliasTimeline(row)) return
  const call = nonempty(row.litellm_call_id)
  const trace = nonempty(row.trace_id)
  const session = nonempty(row.session_id)
  if (call && !indexes.byCall.has(call)) indexes.byCall.set(call, row)
  if (trace && !indexes.byTrace.has(trace)) indexes.byTrace.set(trace, row)
  if (session && !indexes.bySession.has(session)) {
    indexes.bySession.set(session, row)
  }
}

function matchingHistoryRow(indexes, row) {
  const call = nonempty(row.litellm_call_id)
  const trace = nonempty(row.trace_id)
  const session = nonempty(row.session_id)
  if (call && indexes.byCall.has(call)) return indexes.byCall.get(call)
  if (session && indexes.bySession.has(session)) {
    return indexes.bySession.get(session)
  }
  if (trace && indexes.byTrace.has(trace)) return indexes.byTrace.get(trace)
  return null
}

function createdAtMillis(row) {
  return timestampMillis(row?.created_at) ?? 0
}

export function mergeSessionDiagnosticsWithAuditTerminalRows(
  historyRows,
  auditRows,
  limit
) {
  const history = (Array.isArray(historyRows) ? historyRows : []).map(
    cloneDiagnosticRow
  )
  const audits = (Array.isArray(auditRows) ? auditRows : []).map(
    cloneDiagnosticRow
  )
  const indexes = {
    byCall: new Map(),
    byTrace: new Map(),
    bySession: new Map(),
  }
  for (const row of history) indexHistoryRow(indexes, row)

  const additions = []
  for (const auditRow of audits) {
    if ((auditRow.alias_route_events ?? []).length === 0) continue
    const match = matchingHistoryRow(indexes, auditRow)
    if (match) {
      const novel = []
      for (const event of auditRow.alias_route_events) {
        const existing = (match.alias_route_events ?? []).find((candidate) =>
          sameRepresentedAuditEvent(candidate, event, match, auditRow)
        )
        if (existing) {
          supplementAliasTerminalEvidence(existing, event)
          continue
        }
        novel.push(event)
      }
      if (novel.length > 0) {
        match.alias_route_events = [
          ...(match.alias_route_events ?? []),
          ...novel,
        ]
        if (!match.diagnostic_flags.includes('alias_routing')) {
          match.diagnostic_flags = [...match.diagnostic_flags, 'alias_routing']
        }
        if (!match.diagnostic_categories.includes('route_timeline')) {
          match.diagnostic_categories = [
            ...match.diagnostic_categories,
            'route_timeline',
          ]
        }
      }
      continue
    }
    additions.push(auditRow)
    indexHistoryRow(indexes, auditRow)
  }

  const merged = [...history, ...additions].sort(
    (left, right) => createdAtMillis(right) - createdAtMillis(left)
  )
  const bounded = parseLimit(limit)
  return merged.slice(0, bounded)
}
