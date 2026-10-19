export const SESSION_DIAGNOSTICS_STREAM_STRING_LIMIT = 160

export const SESSION_DIAGNOSTICS_STREAM_BOOLEAN_KEYS = [
  'provider_terminal_observed',
  'parse_ambiguity',
  'partial_frame',
  'sequence_ambiguity',
  'state_omitted',
  'aawm_stream_synthetic_terminal',
] as const

export const SESSION_DIAGNOSTICS_STREAM_STRING_KEYS = [
  'provider_terminal_event_type',
  'synthetic_terminal_event_type',
  'aawm_stream_incomplete_reason',
  'aawm_stream_terminal_event_type',
  'aawm_stream_recovery_outcome',
  'aawm_stream_recovery_parent_litellm_call_id',
  'aawm_stream_recovery_previous_response_id',
] as const

export const SESSION_DIAGNOSTICS_STREAM_RECOVERY_KEYS = [
  'aawm_stream_recovery_outcome',
  'aawm_stream_recovery_parent_litellm_call_id',
  'aawm_stream_recovery_previous_response_id',
] as const

const TRUE_TOKENS = new Set(['true', '1', 't', 'yes'])
const FALSE_TOKENS = new Set(['false', '0', 'f', 'no'])
const CREDENTIAL_VALUE =
  /bearer\s+\S+|sk-[a-z0-9]|api[_-]?key|access_token|refresh_token|authorization\s*:/i

export interface UsageReportSessionDiagnosticsStream {
  provider_terminal_event_type?: string | null
  provider_terminal_observed?: boolean | string | null
  synthetic_terminal_event_type?: string | null
  parse_ambiguity?: boolean | string | null
  partial_frame?: boolean | string | null
  sequence_ambiguity?: boolean | string | null
  state_omitted?: boolean | string | null
  aawm_stream_synthetic_terminal?: boolean | string | null
  aawm_stream_incomplete_reason?: string | null
  aawm_stream_terminal_event_type?: string | null
  aawm_stream_recovery_outcome?: string | null
  aawm_stream_recovery_parent_litellm_call_id?: string | null
  aawm_stream_recovery_previous_response_id?: string | null
}

export type RecordedStreamCompletenessKind =
  | 'observed_provider_terminal'
  | 'synthetic_completion'
  | 'unknown_or_incomplete'

const COMPLETENESS_LABELS: Record<RecordedStreamCompletenessKind, string> = {
  observed_provider_terminal: 'Observed provider terminal',
  synthetic_completion: 'Synthetic completion',
  unknown_or_incomplete: 'Unknown or incomplete recorded state',
}

type BooleanKey = (typeof SESSION_DIAGNOSTICS_STREAM_BOOLEAN_KEYS)[number]
type StringKey = (typeof SESSION_DIAGNOSTICS_STREAM_STRING_KEYS)[number]

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return null
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === true || value === false) return value
  if (typeof value !== 'string') return undefined
  const lowered = value.trim().toLowerCase()
  if (TRUE_TOKENS.has(lowered)) return true
  if (FALSE_TOKENS.has(lowered)) return false
  return undefined
}

function normalizeBoundedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return undefined
  if (CREDENTIAL_VALUE.test(trimmed)) return undefined
  return trimmed.slice(0, SESSION_DIAGNOSTICS_STREAM_STRING_LIMIT)
}

export function normalizeSessionDiagnosticsStream(
  value: unknown
): UsageReportSessionDiagnosticsStream | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const record = asRecord(value)
  if (!record) return null
  const normalized: UsageReportSessionDiagnosticsStream = {}
  for (const key of SESSION_DIAGNOSTICS_STREAM_BOOLEAN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const bool = normalizeBoolean(record[key])
    if (bool === undefined) continue
    normalized[key] = bool
  }
  for (const key of SESSION_DIAGNOSTICS_STREAM_STRING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    const text = normalizeBoundedString(record[key])
    if (text === undefined) continue
    normalized[key] = text
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

function presentBoolean(
  stream: UsageReportSessionDiagnosticsStream | null | undefined,
  key: BooleanKey
): boolean | null {
  if (!stream || !Object.prototype.hasOwnProperty.call(stream, key)) {
    return null
  }
  const bool = normalizeBoolean(stream[key])
  return bool === undefined ? null : bool
}

function presentString(
  stream: UsageReportSessionDiagnosticsStream | null | undefined,
  key: StringKey
): string | null {
  if (!stream || !Object.prototype.hasOwnProperty.call(stream, key)) {
    return null
  }
  return normalizeBoundedString(stream[key]) ?? null
}

export function classifyRecordedStreamCompleteness(
  stream: UsageReportSessionDiagnosticsStream | null | undefined
): RecordedStreamCompletenessKind {
  const observed = presentBoolean(stream, 'provider_terminal_observed')
  const providerEvent = presentString(stream, 'provider_terminal_event_type')
  if (observed === true) return 'observed_provider_terminal'
  if (observed !== false && providerEvent) return 'observed_provider_terminal'

  const syntheticEvent = presentString(stream, 'synthetic_terminal_event_type')
  const synthetic = presentBoolean(stream, 'aawm_stream_synthetic_terminal')
  const terminalEvent = presentString(stream, 'aawm_stream_terminal_event_type')
  if (syntheticEvent === 'response.completed') return 'synthetic_completion'
  if (
    synthetic === true &&
    terminalEvent === 'response.completed' &&
    syntheticEvent !== 'response.incomplete'
  ) {
    return 'synthetic_completion'
  }
  return 'unknown_or_incomplete'
}

export function recordedStreamCompletenessLabel(
  kind: RecordedStreamCompletenessKind
): string {
  return COMPLETENESS_LABELS[kind]
}

export function sessionDiagnosticsStreamWasRecorded(
  stream: UsageReportSessionDiagnosticsStream | null | undefined,
  diagnosticFlags: readonly string[] | null | undefined
): boolean {
  if (diagnosticFlags?.includes('stream')) return true
  const normalized = normalizeSessionDiagnosticsStream(stream)
  return normalized != null
}

export function sessionDiagnosticsStreamDisplayEntries(
  stream: UsageReportSessionDiagnosticsStream | null | undefined
): Array<{ key: string; value: string }> {
  const normalized = normalizeSessionDiagnosticsStream(stream)
  if (!normalized) return []
  const entries: Array<{ key: string; value: string }> = []
  for (const key of SESSION_DIAGNOSTICS_STREAM_BOOLEAN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) continue
    const bool = normalized[key]
    if (bool !== true && bool !== false) continue
    entries.push({ key, value: bool ? 'true' : 'false' })
  }
  for (const key of SESSION_DIAGNOSTICS_STREAM_STRING_KEYS) {
    const text = normalized[key]
    if (typeof text !== 'string') continue
    entries.push({ key, value: text })
  }
  return entries
}
