// Recorded stream completeness for session diagnostics.
// Projects selected scalars from persisted session_history metadata.
// Absent booleans stay absent; recorded false stays false.
// Rows that were not written to session_history are not synthesized.

export const SESSION_DIAGNOSTICS_STREAM_STRING_LIMIT = 160

const TRACKER_BOOLEAN_KEYS = Object.freeze([
  'provider_terminal_observed',
  'parse_ambiguity',
  'partial_frame',
  'sequence_ambiguity',
  'state_omitted',
])

const TRACKER_STRING_KEYS = Object.freeze([
  'provider_terminal_event_type',
  'synthetic_terminal_event_type',
])

const TOP_LEVEL_BOOLEAN_KEYS = Object.freeze(['aawm_stream_synthetic_terminal'])

const TOP_LEVEL_STRING_KEYS = Object.freeze([
  'aawm_stream_incomplete_reason',
  'aawm_stream_terminal_event_type',
  'aawm_stream_recovery_outcome',
  'aawm_stream_recovery_parent_litellm_call_id',
  'aawm_stream_recovery_previous_response_id',
])

const BOOLEAN_KEYS = Object.freeze([
  ...TRACKER_BOOLEAN_KEYS,
  ...TOP_LEVEL_BOOLEAN_KEYS,
])

const STRING_KEYS = Object.freeze([
  ...TRACKER_STRING_KEYS,
  ...TOP_LEVEL_STRING_KEYS,
])

const TRUE_TOKENS = new Set(['true', '1', 't', 'yes'])
const FALSE_TOKENS = new Set(['false', '0', 'f', 'no'])
const CREDENTIAL_VALUE =
  /bearer\s+\S+|sk-[a-z0-9]|api[_-]?key|access_token|refresh_token|authorization\s*:/i

function assertMetadataExpr(metadataExpr) {
  if (!/^(?:[A-Za-z_][A-Za-z0-9_]*\.)?metadata$/.test(metadataExpr)) {
    throw new Error(
      `Unsupported stream diagnostics metadata expression: ${metadataExpr}`
    )
  }
}

function assertFieldKey(key) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Unsupported stream diagnostics field: ${key}`)
  }
}

function jsonField(expr, key) {
  assertFieldKey(key)
  return `${expr}->'${key}'`
}

function jsonText(expr, key) {
  assertFieldKey(key)
  return `${expr}->>'${key}'`
}

function streamBooleanSql(expr, key) {
  const field = jsonField(expr, key)
  const text = jsonText(expr, key)
  return `CASE WHEN jsonb_typeof(${field}) = 'boolean' THEN (${text})::boolean WHEN jsonb_typeof(${field}) = 'string' AND lower(btrim(${text})) IN ('true', 'false', '1', '0', 't', 'f', 'yes', 'no') THEN lower(btrim(${text})) IN ('true', '1', 't', 'yes') END`
}

function streamStringSql(expr, key) {
  const field = jsonField(expr, key)
  const text = jsonText(expr, key)
  return `CASE WHEN jsonb_typeof(${field}) = 'string' THEN NULLIF(left(btrim(${text}), ${SESSION_DIAGNOSTICS_STREAM_STRING_LIMIT}), '') END`
}

export function sessionDiagnosticsStreamMetadataPresentSql(
  metadataExpr = 'metadata'
) {
  assertMetadataExpr(metadataExpr)
  const parts = [
    `jsonb_typeof(${metadataExpr}->'aawm_stream_tracker_state') = 'object'`,
    `${metadataExpr}->>'aawm_stream_synthetic_terminal' IS NOT NULL`,
    ...TOP_LEVEL_STRING_KEYS.map(
      (key) => `NULLIF(btrim(${metadataExpr}->>'${key}'), '') IS NOT NULL`
    ),
  ]
  return `(${parts.join(' OR ')})`
}

export function sessionDiagnosticsStreamFlagSql(metadataExpr = 'metadata') {
  return `CASE WHEN ${sessionDiagnosticsStreamMetadataPresentSql(metadataExpr)} THEN 'stream'::text END`
}

export function sessionDiagnosticsStreamCategorySql(metadataExpr = 'metadata') {
  return `CASE WHEN ${sessionDiagnosticsStreamMetadataPresentSql(metadataExpr)} THEN 'stream_completeness'::text END`
}

export function sessionDiagnosticsStreamProjectionSql(
  metadataExpr = 'metadata'
) {
  assertMetadataExpr(metadataExpr)
  const tracker = `(${metadataExpr}->'aawm_stream_tracker_state')`
  const entries = [
    ...TRACKER_STRING_KEYS.map(
      (key) => `'${key}', ${streamStringSql(tracker, key)}`
    ),
    ...TRACKER_BOOLEAN_KEYS.map(
      (key) => `'${key}', ${streamBooleanSql(tracker, key)}`
    ),
    ...TOP_LEVEL_BOOLEAN_KEYS.map(
      (key) => `'${key}', ${streamBooleanSql(metadataExpr, key)}`
    ),
    ...TOP_LEVEL_STRING_KEYS.map(
      (key) => `'${key}', ${streamStringSql(metadataExpr, key)}`
    ),
  ]
  return `CASE WHEN ${sessionDiagnosticsStreamMetadataPresentSql(metadataExpr)} THEN jsonb_strip_nulls(jsonb_build_object(${entries.join(', ')})) END`
}

function asPlainObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      return null
    }
  }
  return null
}

function normalizeStreamBoolean(value) {
  if (value === true || value === false) return value
  if (typeof value !== 'string') return undefined
  const lowered = value.trim().toLowerCase()
  if (TRUE_TOKENS.has(lowered)) return true
  if (FALSE_TOKENS.has(lowered)) return false
  return undefined
}

function normalizeStreamString(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return undefined
  if (CREDENTIAL_VALUE.test(trimmed)) return undefined
  return trimmed.slice(0, SESSION_DIAGNOSTICS_STREAM_STRING_LIMIT)
}

export function normalizeSessionDiagnosticsStream(value) {
  if (value === undefined || value === null) return null
  const record = asPlainObject(value)
  if (!record) return null
  const normalized = {}
  for (const key of BOOLEAN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const bool = normalizeStreamBoolean(record[key])
    if (bool === undefined) continue
    normalized[key] = bool
  }
  for (const key of STRING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const text = normalizeStreamString(record[key])
    if (text === undefined) continue
    normalized[key] = text
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}
