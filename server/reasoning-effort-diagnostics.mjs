/**
 * Bounded requested-versus-native reasoning-effort diagnostics.
 *
 * Session history copies the allowlisted mapping scalars from
 * `_AAWM_SESSION_HISTORY_METADATA_KEYS` onto each request record. Those
 * scalars are the value that entered reconciliation after model resolution
 * (`reasoning_effort_requested`), the native value actually emitted, the
 * model ceiling, mapping and clamp reasons, the resolved provider/model, and
 * the recorded candidate attempt. `reasoning_effort_requested` may already
 * include a candidate-configuration override; it is not a promise of the
 * original caller value.
 *
 * Candidate-configuration attribution is not a top-level session-history
 * scalar. It is persisted on the same candidate attempt inside the allowlisted
 * attempt and audit collections. This module reads that attribution only when
 * its `reasoning_effort_candidate_attempt` equals the request record's own
 * attempt. It does not read reasoning-token counters, output quality, or a
 * different attempt.
 */

export const REASONING_EFFORT_MAPPING_SCALARS = [
  'reasoning_effort_requested',
  'reasoning_effort_source',
  'reasoning_effort_native_provider',
  'reasoning_effort_native_value',
  'reasoning_effort_native_field',
  'reasoning_effort_supported_ceiling',
  'reasoning_effort_resolved_model',
  'reasoning_effort_resolved_provider',
  'reasoning_effort_candidate_attempt',
  'reasoning_effort_mapping_reason',
  'reasoning_effort_clamped_from',
  'reasoning_effort_clamp_reason',
]

export const REASONING_EFFORT_ATTEMPT_CONFIG_SCALARS = [
  'reasoning_effort_config_value',
  'reasoning_effort_config_source',
]

export const REASONING_EFFORT_DIAGNOSTIC_KEYS = [
  ...REASONING_EFFORT_MAPPING_SCALARS,
  ...REASONING_EFFORT_ATTEMPT_CONFIG_SCALARS,
]

const SAME_ATTEMPT_COLLECTIONS = [
  'codex_auto_agent_attempts',
  'anthropic_auto_agent_attempts',
  'codex_auto_agent_audit_events',
  'anthropic_auto_agent_audit_events',
  'aawm_alias_routing_audit_events',
]

const REASONING_EFFORT_ATTEMPT_PATTERN = '^-?[0-9]{1,9}$'
const REASONING_EFFORT_ATTEMPT_EXPRESSION = new RegExp(
  REASONING_EFFORT_ATTEMPT_PATTERN
)
const IDENTIFIER_EXPRESSION = /^[a-z][a-z0-9_]*$/
const METADATA_EXPRESSION = /^(?:[a-z][a-z0-9_]*\.)?metadata$/

export const REASONING_EFFORT_RECONCILIATION_NOTE =
  'Requested effort is the value that entered reconciliation. It may already include a candidate-configuration override.'

export const REASONING_EFFORT_SCOPE_NOTE =
  'Native effort is the mapped value recorded for this candidate attempt. It is separate from observed reasoning-token usage and is not taken from another attempt.'

export const REASONING_EFFORT_DISPLAY_FIELDS = [
  {
    key: 'reasoning_effort_requested',
    label: 'Requested effort (entering reconciliation)',
  },
  {
    key: 'reasoning_effort_source',
    label: 'Requested effort source',
  },
  {
    key: 'reasoning_effort_config_value',
    label: 'Candidate configuration value',
  },
  {
    key: 'reasoning_effort_config_source',
    label: 'Candidate configuration source',
  },
  {
    key: 'reasoning_effort_native_value',
    label: 'Native effort',
  },
  {
    key: 'reasoning_effort_native_field',
    label: 'Native field',
  },
  {
    key: 'reasoning_effort_native_provider',
    label: 'Native provider',
  },
  {
    key: 'reasoning_effort_supported_ceiling',
    label: 'Model ceiling',
  },
  {
    key: 'reasoning_effort_mapping_reason',
    label: 'Mapping reason',
  },
  {
    key: 'reasoning_effort_clamped_from',
    label: 'Clamped from',
  },
  {
    key: 'reasoning_effort_clamp_reason',
    label: 'Clamp reason',
  },
  {
    key: 'reasoning_effort_resolved_provider',
    label: 'Resolved provider',
  },
  {
    key: 'reasoning_effort_resolved_model',
    label: 'Resolved model',
  },
  {
    key: 'reasoning_effort_candidate_attempt',
    label: 'Candidate attempt',
  },
]

const displayKeys = new Set(
  REASONING_EFFORT_DISPLAY_FIELDS.map((field) => field.key)
)
if (
  displayKeys.size !== REASONING_EFFORT_DIAGNOSTIC_KEYS.length ||
  REASONING_EFFORT_DIAGNOSTIC_KEYS.some((key) => !displayKeys.has(key))
) {
  throw new Error(
    'Reasoning-effort display fields must match the diagnostic contract'
  )
}

function assertIdentifier(value, label) {
  if (!IDENTIFIER_EXPRESSION.test(value)) {
    throw new Error(`Unsupported ${label}: ${value}`)
  }
}

function assertMetadataExpr(metadataExpr) {
  if (!METADATA_EXPRESSION.test(metadataExpr)) {
    throw new Error(`Unsupported metadata expression: ${metadataExpr}`)
  }
}

function metadataExprFromPrefix(columnPrefix) {
  const metadataExpr = `${columnPrefix}metadata`
  assertMetadataExpr(metadataExpr)
  return metadataExpr
}

export function reasoningEffortMetadataPresentSql(columnPrefix = '') {
  const metadataExpr = metadataExprFromPrefix(columnPrefix)
  const clauses = REASONING_EFFORT_MAPPING_SCALARS.map((key) => {
    assertIdentifier(key, 'reasoning-effort scalar')
    return `${metadataExpr}->>'${key}' IS NOT NULL`
  })
  return `(
    ${clauses.join('\n    OR ')}
  )`
}

function textScalarSql(metadataExpr, key) {
  assertIdentifier(key, 'reasoning-effort scalar')
  return `NULLIF(${metadataExpr}->>'${key}', '')`
}

function candidateAttemptSql(metadataExpr) {
  const raw = `${metadataExpr}->>'reasoning_effort_candidate_attempt'`
  return `CASE WHEN COALESCE(${raw}, '') ~ '${REASONING_EFFORT_ATTEMPT_PATTERN}' THEN (${raw})::integer END`
}

function sameAttemptScalarSql(metadataExpr, scalar) {
  assertIdentifier(scalar, 'reasoning-effort scalar')
  const attempt = `${metadataExpr}->>'reasoning_effort_candidate_attempt'`
  const lookups = SAME_ATTEMPT_COLLECTIONS.map((collection) => {
    assertIdentifier(collection, 'attempt collection')
    return `(
      SELECT NULLIF(entry->>'${scalar}', '')
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(${metadataExpr}->'${collection}') = 'array'
          THEN ${metadataExpr}->'${collection}'
          ELSE '[]'::jsonb
        END
      ) AS entry
      WHERE NULLIF(${attempt}, '') IS NOT NULL
        AND NULLIF(entry->>'reasoning_effort_candidate_attempt', '') = NULLIF(${attempt}, '')
        AND NULLIF(entry->>'${scalar}', '') IS NOT NULL
      LIMIT 1
    )`
  })
  return `COALESCE(${lookups.join(', ')})`
}

function projectedScalarSql(metadataExpr, key) {
  if (key === 'reasoning_effort_candidate_attempt') {
    return candidateAttemptSql(metadataExpr)
  }
  if (REASONING_EFFORT_ATTEMPT_CONFIG_SCALARS.includes(key)) {
    return sameAttemptScalarSql(metadataExpr, key)
  }
  return textScalarSql(metadataExpr, key)
}

export function reasoningEffortDiagnosticsProjectionSql(metadataExpr) {
  assertMetadataExpr(metadataExpr)
  const columnPrefix = metadataExpr.slice(0, -'metadata'.length)
  const fields = REASONING_EFFORT_DIAGNOSTIC_KEYS.map(
    (key) => `'${key}', ${projectedScalarSql(metadataExpr, key)}`
  )
  return `CASE WHEN ${reasoningEffortMetadataPresentSql(columnPrefix)}
THEN jsonb_build_object(
    ${fields.join(',\n    ')}
)
END`
}

export function reasoningEffortDiagnosticFlagSql(columnPrefix = '') {
  return `CASE WHEN ${reasoningEffortMetadataPresentSql(columnPrefix)} THEN 'reasoning_effort_mapping'::text END`
}

export function reasoningEffortDiagnosticCategorySql(columnPrefix = '') {
  return `CASE WHEN ${reasoningEffortMetadataPresentSql(columnPrefix)} THEN 'request_attempt'::text END`
}

function asRecord(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
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

function normalizeReasoningEffortScalar(key, value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    if (key === 'reasoning_effort_candidate_attempt') {
      if (!REASONING_EFFORT_ATTEMPT_EXPRESSION.test(value.trim())) return null
      return Number(value.trim())
    }
    return value
  }
  if (
    key === 'reasoning_effort_candidate_attempt' &&
    typeof value === 'number'
  ) {
    if (!Number.isInteger(value)) return null
    return value
  }
  return null
}

export function normalizeReasoningEffortDiagnostics(value) {
  const record = asRecord(value)
  if (!record) return null
  const projected = {}
  let present = false
  for (const key of REASONING_EFFORT_DIAGNOSTIC_KEYS) {
    const normalized = normalizeReasoningEffortScalar(key, record[key])
    projected[key] = normalized
    if (normalized !== null) present = true
  }
  return present ? projected : null
}

export function formatReasoningEffortScalar(value) {
  if (value === null || value === undefined || value === '') return 'unknown'
  return String(value)
}

export const REASONING_EFFORT_PRODUCER_FIXTURES = {
  unchangedMapping: {
    reasoning_effort_requested: 'xhigh',
    reasoning_effort_source: 'reasoning.effort',
    reasoning_effort_native_provider: 'xai',
    reasoning_effort_native_value: 'xhigh',
    reasoning_effort_native_field: 'reasoning.effort',
    reasoning_effort_supported_ceiling: 'xhigh',
    reasoning_effort_resolved_model: 'oa_xai/grok-4.6',
    reasoning_effort_resolved_provider: 'xai',
    reasoning_effort_candidate_attempt: 1,
    reasoning_effort_mapping_reason: 'within_supported_ceiling',
  },
  ceilingClampProviderMapping: {
    reasoning_effort_requested: 'max',
    reasoning_effort_source: 'reasoning_effort',
    reasoning_effort_native_provider: 'openai',
    reasoning_effort_native_value: 'high',
    reasoning_effort_native_field: 'reasoning_effort',
    reasoning_effort_supported_ceiling: 'high',
    reasoning_effort_resolved_model: 'o1',
    reasoning_effort_resolved_provider: 'openai',
    reasoning_effort_candidate_attempt: 2,
    reasoning_effort_mapping_reason:
      'requested_effort_above_model_supported_ceiling',
    reasoning_effort_clamped_from: 'max',
    reasoning_effort_clamp_reason:
      'requested_effort_above_model_supported_ceiling',
  },
  candidateOverride: {
    reasoning_effort_requested: 'low',
    reasoning_effort_source: 'reasoning.effort',
    reasoning_effort_native_provider: 'openai',
    reasoning_effort_native_value: 'low',
    reasoning_effort_native_field: 'reasoning.effort',
    reasoning_effort_supported_ceiling: 'xhigh',
    reasoning_effort_resolved_model: 'gpt-5',
    reasoning_effort_resolved_provider: 'openai',
    reasoning_effort_candidate_attempt: 1,
    reasoning_effort_mapping_reason: 'within_supported_ceiling',
    reasoning_effort_config_value: 'low',
    reasoning_effort_config_source: 'candidate_yaml',
  },
  missingMetadata: {
    reasoning_tokens_reported: 4242,
    reasoning_tokens_estimated: 7,
    effective_effort: 'high',
    codex_reasoning_effort: 'max',
  },
  partialMissing: {
    reasoning_effort_requested: 'high',
    reasoning_tokens_reported: 4242,
    reasoning_tokens_estimated: 7,
    codex_reasoning_effort: 'max',
    effective_effort: 'xhigh',
  },
}
