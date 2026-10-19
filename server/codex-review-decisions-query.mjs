import { createHash } from 'node:crypto'

// Reads public.session_history_codex_review_decisions only. Governed-tool
// columns stay as the producer stored them. This module never joins tool
// activity or nearby session rows.

export const CODEX_REVIEW_DECISION_RATIONALE_MAX_CHARS = 512
export const CODEX_REVIEW_DECISION_LABEL_MAX_CHARS = 128
export const CODEX_REVIEW_DECISION_IDENTITY_HASH_CHARS = 16
export const CODEX_REVIEW_DECISION_SQL_TEXT_CAP = 1024
export const CODEX_REVIEW_DECISIONS_DEFAULT_LIMIT = 100
export const CODEX_REVIEW_DECISIONS_MAX_LIMIT = 200
export const CODEX_REVIEW_DECISIONS_TABLE =
  'public.session_history_codex_review_decisions'

const MAX_FILTER_VALUES = 32
const MAX_FILTER_VALUE_CHARS = 256
const MAX_ATTEMPT_NUMBER = 1_000_000
const DASHBOARD_TIME_ZONE = 'America/New_York'
const OUTCOMES = new Set(['allow', 'deny'])
const CORRELATION_STATUSES = new Set(['attributed', 'unattributed', 'unknown'])
const TOOL_ATTRIBUTIONS = new Set(['unknown', 'producer_supplied'])
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical'])
const USER_AUTHORIZATIONS = new Set(['unknown', 'low', 'medium', 'high'])
const METADATA_TEXT_KEYS = [
  'source',
  'capture_source',
  'producer_version',
  'session_history_provider',
  'session_history_model',
]

const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi
const TOKEN_PREFIX_RE =
  /\b(?:sk|pk|xai)-[A-Za-z0-9._~+/=-]{6,}|\bya29\.[A-Za-z0-9._~+/=-]{6,}/gi
const NAMED_SECRET_RE =
  /\b(authorization|api[ _-]?key|access[ _-]?token|password|secret|token)\s*[:=]\s*([^\s,;]+)/gi
const POSTGRES_URL_RE = /\bpostgres(?:ql)?:\/\/\S+/gi

export class CodexReviewDecisionsQueryError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BadRequestError'
  }
}

function parseCsv(value) {
  if (value == null || String(value).trim() === '') return []
  return String(value)
    .split(',')
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) return ''
      try {
        return decodeURIComponent(trimmed)
      } catch {
        return trimmed
      }
    })
    .filter(Boolean)
}

function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CodexReviewDecisionsQueryError(
      `A valid ${label}=YYYY-MM-DD parameter is required.`
    )
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new CodexReviewDecisionsQueryError(`Invalid ${label}: ${value}`)
  }
  return value
}

function parseLimit(value) {
  if (value == null || String(value).trim() === '') {
    return CODEX_REVIEW_DECISIONS_DEFAULT_LIMIT
  }
  const parsed = Number(String(value).trim())
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CodexReviewDecisionsQueryError(`Invalid limit: ${value}`)
  }
  return Math.min(parsed, CODEX_REVIEW_DECISIONS_MAX_LIMIT)
}

function parseChoice(value, allowed, label) {
  if (value == null || String(value).trim() === '') return null
  const normalized = String(value).trim().toLowerCase()
  if (!allowed.has(normalized)) {
    throw new CodexReviewDecisionsQueryError(`Unsupported ${label}: ${value}`)
  }
  return normalized
}

function parseIdentityList(value, label) {
  const items = parseCsv(value)
  if (items.length > MAX_FILTER_VALUES) {
    throw new CodexReviewDecisionsQueryError(`${label} has too many values.`)
  }
  for (const item of items) {
    if (item.length > MAX_FILTER_VALUE_CHARS) {
      throw new CodexReviewDecisionsQueryError(`${label} value is too long.`)
    }
  }
  return items
}

function parseSingleIdentity(value, label) {
  if (value == null || String(value).trim() === '') return null
  const trimmed = String(value).trim()
  if (trimmed.length > MAX_FILTER_VALUE_CHARS) {
    throw new CodexReviewDecisionsQueryError(`${label} is too long.`)
  }
  return trimmed
}

function appendTextAny(whereParts, values, columnExpression, selected) {
  if (!selected.length) return
  values.push(selected)
  whereParts.push(`${columnExpression} = ANY($${values.length}::text[])`)
}

function dateBoundary(index) {
  return `($${index}::date::timestamp AT TIME ZONE '${DASHBOARD_TIME_ZONE}')`
}

function isDisallowedChar(char) {
  const code = char.codePointAt(0)
  if (code === undefined || code <= 0x1f || code === 0x7f) return true
  return /\p{C}/u.test(char)
}

function collapseSanitizedText(value) {
  if (typeof value !== 'string') return null
  const withoutNul = value.replace(/\u0000/g, '')
  const withoutAnsi = withoutNul.replace(ANSI_ESCAPE_RE, '')
  let printable = ''
  for (const char of withoutAnsi) {
    printable += isDisallowedChar(char) ? ' ' : char
  }
  const cleaned = printable.split(/\s+/).filter(Boolean).join(' ')
  if (!cleaned) return null
  return cleaned
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(TOKEN_PREFIX_RE, '[REDACTED]')
    .replace(NAMED_SECRET_RE, '$1=[REDACTED]')
    .replace(POSTGRES_URL_RE, '[REDACTED]')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

export function sanitizeCodexReviewDecisionRationale(value) {
  const cleaned = collapseSanitizedText(value)
  if (!cleaned) return { text: null, truncated: false }
  if (cleaned.length > CODEX_REVIEW_DECISION_RATIONALE_MAX_CHARS) {
    return {
      text: cleaned.slice(0, CODEX_REVIEW_DECISION_RATIONALE_MAX_CHARS),
      truncated: true,
    }
  }
  return { text: cleaned, truncated: false }
}

function stableBoundedId(value) {
  const cleaned = collapseSanitizedText(value)
  if (!cleaned) return null
  if (cleaned.length <= CODEX_REVIEW_DECISION_LABEL_MAX_CHARS) return cleaned
  const digest = createHash('sha256').update(cleaned).digest('hex')
  const prefixLength =
    CODEX_REVIEW_DECISION_LABEL_MAX_CHARS -
    CODEX_REVIEW_DECISION_IDENTITY_HASH_CHARS -
    1
  return `${cleaned.slice(0, prefixLength)}:${digest.slice(
    0,
    CODEX_REVIEW_DECISION_IDENTITY_HASH_CHARS
  )}`
}

function enumValue(value, allowed) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return allowed.has(normalized) ? normalized : null
}

function attemptNumber(value) {
  if (typeof value === 'boolean' || value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ATTEMPT_NUMBER) {
    return null
  }
  return parsed
}

function booleanFlag(value) {
  return value === true || value === 't' || value === 'true' || value === 1
}

function timestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 64) return null
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function correlationStatus(value) {
  const normalized = enumValue(value, new Set(['attributed', 'unattributed']))
  return normalized ?? 'unknown'
}

function asRecord(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    if (value.length > 4000) return null
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      return null
    }
    return null
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return null
}

function normalizeMetadata(value) {
  const record = asRecord(value)
  if (!record) return null
  const metadata = {}
  for (const key of METADATA_TEXT_KEYS) {
    const bounded = stableBoundedId(record[key])
    if (bounded != null) metadata[key] = bounded
  }
  const eventIndex = record.event_index
  const parsedIndex =
    typeof eventIndex === 'number'
      ? eventIndex
      : typeof eventIndex === 'string' && /^[0-9]{1,9}$/.test(eventIndex)
        ? Number(eventIndex)
        : null
  if (
    parsedIndex != null &&
    Number.isInteger(parsedIndex) &&
    parsedIndex >= 0 &&
    parsedIndex <= 999_999_999
  ) {
    metadata.event_index = parsedIndex
  }
  return Object.keys(metadata).length > 0 ? metadata : null
}

export function buildCodexReviewDecisionsQuery(searchParams, options = {}) {
  const from = parseDate(options.from ?? searchParams.get('from'), 'from')
  const to = parseDate(options.to ?? searchParams.get('to'), 'to')
  const decisionKey = parseSingleIdentity(
    searchParams.get('decision_key'),
    'decision_key'
  )
  const outcome = parseChoice(searchParams.get('outcome'), OUTCOMES, 'outcome')
  const correlation = parseChoice(
    searchParams.get('correlation_status'),
    CORRELATION_STATUSES,
    'correlation_status'
  )
  const toolAttribution = parseChoice(
    searchParams.get('tool_attribution'),
    TOOL_ATTRIBUTIONS,
    'tool_attribution'
  )
  const limit = decisionKey ? 1 : parseLimit(searchParams.get('limit'))
  const values = []
  const whereParts = []

  values.push(from)
  const fromIndex = values.length
  values.push(to)
  const toIndex = values.length
  whereParts.push(`d.created_at >= ${dateBoundary(fromIndex)}`)
  whereParts.push(`d.created_at < ${dateBoundary(toIndex)}`)
  appendTextAny(
    whereParts,
    values,
    'd.session_id',
    parseIdentityList(searchParams.get('session_id'), 'session_id')
  )
  appendTextAny(
    whereParts,
    values,
    'd.reviewer_litellm_call_id',
    parseIdentityList(
      searchParams.get('reviewer_litellm_call_id'),
      'reviewer_litellm_call_id'
    )
  )
  appendTextAny(
    whereParts,
    values,
    'd.parent_litellm_call_id',
    parseIdentityList(
      searchParams.get('parent_litellm_call_id'),
      'parent_litellm_call_id'
    )
  )
  appendTextAny(
    whereParts,
    values,
    'd.review_attempt_key',
    parseIdentityList(
      searchParams.get('review_attempt_key'),
      'review_attempt_key'
    )
  )
  if (decisionKey) {
    values.push(decisionKey)
    whereParts.push(`d.decision_key = $${values.length}`)
  }
  if (outcome) {
    values.push(outcome)
    whereParts.push(`d.outcome = $${values.length}`)
  }
  if (correlation === 'unknown') {
    whereParts.push(
      `d.correlation_status NOT IN ('attributed', 'unattributed')`
    )
  } else if (correlation) {
    values.push(correlation)
    whereParts.push(`d.correlation_status = $${values.length}`)
  }
  if (toolAttribution === 'unknown') {
    whereParts.push(
      `NULLIF(d.governed_tool_call_id, '') IS NULL AND NULLIF(d.governed_tool_activity_key, '') IS NULL`
    )
  } else if (toolAttribution === 'producer_supplied') {
    whereParts.push(
      `(NULLIF(d.governed_tool_call_id, '') IS NOT NULL OR NULLIF(d.governed_tool_activity_key, '') IS NOT NULL)`
    )
  }

  values.push(limit)
  const limitIndex = values.length
  const textCap = CODEX_REVIEW_DECISION_SQL_TEXT_CAP
  const rationaleMax = CODEX_REVIEW_DECISION_RATIONALE_MAX_CHARS
  const sql = `
SELECT
    d.created_at,
    LEFT(d.decision_key, ${textCap}) AS decision_key,
    LEFT(d.reviewer_litellm_call_id, ${textCap}) AS reviewer_litellm_call_id,
    LEFT(d.reviewer_session_id, ${textCap}) AS reviewer_session_id,
    LEFT(d.reviewer_trace_id, ${textCap}) AS reviewer_trace_id,
    LEFT(d.reviewer_model, ${textCap}) AS reviewer_model,
    LEFT(d.reviewer_agent_name, ${textCap}) AS reviewer_agent_name,
    LEFT(d.reviewer_agent_id, ${textCap}) AS reviewer_agent_id,
    CASE
        WHEN d.outcome IN ('allow', 'deny') THEN d.outcome
        ELSE NULL
    END AS outcome,
    LEFT(d.rationale, ${rationaleMax}) AS rationale,
    (
        COALESCE(d.rationale_truncated, FALSE)
        OR char_length(COALESCE(d.rationale, '')) > ${rationaleMax}
    ) AS rationale_truncated,
    CASE
        WHEN d.risk_level IN ('low', 'medium', 'high', 'critical')
        THEN d.risk_level
        ELSE NULL
    END AS risk_level,
    CASE
        WHEN d.user_authorization IN ('unknown', 'low', 'medium', 'high')
        THEN d.user_authorization
        ELSE NULL
    END AS user_authorization,
    LEFT(d.session_id, ${textCap}) AS session_id,
    LEFT(d.parent_litellm_call_id, ${textCap}) AS parent_litellm_call_id,
    LEFT(d.parent_session_id, ${textCap}) AS parent_session_id,
    LEFT(d.parent_thread_id, ${textCap}) AS parent_thread_id,
    LEFT(d.parent_agent_name, ${textCap}) AS parent_agent_name,
    LEFT(d.parent_agent_id, ${textCap}) AS parent_agent_id,
    CASE
        WHEN d.correlation_status IN ('attributed', 'unattributed')
        THEN d.correlation_status
        ELSE NULL
    END AS correlation_status,
    LEFT(d.parser_version, ${textCap}) AS parser_version,
    LEFT(d.contract_version, ${textCap}) AS contract_version,
    d.review_attempt_number,
    LEFT(d.review_attempt_key, ${textCap}) AS review_attempt_key,
    LEFT(d.governed_tool_call_id, ${textCap}) AS governed_tool_call_id,
    LEFT(d.governed_tool_activity_key, ${textCap}) AS governed_tool_activity_key,
    jsonb_strip_nulls(jsonb_build_object(
        'source', NULLIF(LEFT(d.metadata->>'source', ${textCap}), ''),
        'capture_source', NULLIF(LEFT(d.metadata->>'capture_source', ${textCap}), ''),
        'producer_version', NULLIF(LEFT(d.metadata->>'producer_version', ${textCap}), ''),
        'event_index',
            CASE
                WHEN COALESCE(d.metadata->>'event_index', '') ~ '^[0-9]{1,9}$'
                THEN (d.metadata->>'event_index')::integer
            END,
        'session_history_provider', NULLIF(LEFT(d.metadata->>'session_history_provider', ${textCap}), ''),
        'session_history_model', NULLIF(LEFT(d.metadata->>'session_history_model', ${textCap}), '')
    )) AS metadata
FROM ${CODEX_REVIEW_DECISIONS_TABLE} d
WHERE ${whereParts.join('\n  AND ')}
ORDER BY
    d.created_at DESC,
    d.reviewer_litellm_call_id ASC,
    d.review_attempt_number ASC NULLS LAST,
    d.decision_key ASC
LIMIT $${limitIndex};
`

  return {
    sql,
    values,
    metadata: {
      from,
      to,
      limit,
      decisionKey,
      detail: decisionKey != null,
    },
  }
}

export function normalizeCodexReviewDecisionRow(row) {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) return null
  const outcome = enumValue(row.outcome, OUTCOMES)
  const decisionKey = stableBoundedId(row.decision_key)
  const reviewerId = stableBoundedId(row.reviewer_litellm_call_id)
  if (outcome == null || decisionKey == null || reviewerId == null) return null

  const rationale = sanitizeCodexReviewDecisionRationale(row.rationale)
  const governedToolCallId = stableBoundedId(row.governed_tool_call_id)
  const governedToolActivityKey = stableBoundedId(
    row.governed_tool_activity_key
  )
  const governedToolAttributionStatus =
    governedToolCallId == null && governedToolActivityKey == null
      ? 'unknown'
      : 'producer_supplied'

  return {
    created_at: timestamp(row.created_at),
    decision_key: decisionKey,
    reviewer_litellm_call_id: reviewerId,
    reviewer_session_id: stableBoundedId(row.reviewer_session_id),
    reviewer_trace_id: stableBoundedId(row.reviewer_trace_id),
    reviewer_model: stableBoundedId(row.reviewer_model),
    reviewer_agent_name: stableBoundedId(row.reviewer_agent_name),
    reviewer_agent_id: stableBoundedId(row.reviewer_agent_id),
    outcome,
    rationale: rationale.text,
    rationale_truncated:
      booleanFlag(row.rationale_truncated) || rationale.truncated,
    risk_level: enumValue(row.risk_level, RISK_LEVELS),
    user_authorization: enumValue(row.user_authorization, USER_AUTHORIZATIONS),
    session_id: stableBoundedId(row.session_id),
    parent_litellm_call_id: stableBoundedId(row.parent_litellm_call_id),
    parent_session_id: stableBoundedId(row.parent_session_id),
    parent_thread_id: stableBoundedId(row.parent_thread_id),
    parent_agent_name: stableBoundedId(row.parent_agent_name),
    parent_agent_id: stableBoundedId(row.parent_agent_id),
    correlation_status: correlationStatus(row.correlation_status),
    parser_version: stableBoundedId(row.parser_version),
    contract_version: stableBoundedId(row.contract_version),
    review_attempt_number: attemptNumber(row.review_attempt_number),
    review_attempt_key: stableBoundedId(row.review_attempt_key),
    governed_tool_call_id: governedToolCallId,
    governed_tool_activity_key: governedToolActivityKey,
    governed_tool_attribution_status: governedToolAttributionStatus,
    metadata: normalizeMetadata(row.metadata),
  }
}

export function normalizeCodexReviewDecisionRows(rows) {
  if (!Array.isArray(rows)) return []
  const decisions = []
  for (const row of rows) {
    const decision = normalizeCodexReviewDecisionRow(row)
    if (decision != null) decisions.push(decision)
  }
  return decisions
}
