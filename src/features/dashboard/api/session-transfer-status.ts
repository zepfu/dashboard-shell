import { queryOptions } from '@tanstack/react-query'

/** Matches LiteLLM session-transfer registry retention. */
export const SESSION_TRANSFER_ACTIVE_TTL_SECONDS = 180
export const SESSION_TRANSFER_TERMINAL_TTL_SECONDS = 45
export const SESSION_TRANSFER_STALE_AFTER_SECONDS = 30
export const LIVE_SESSION_TRANSFER_REFETCH_INTERVAL_MS = 5_000
export const SESSION_TRANSFER_STATUS_PATH =
  '/api/shell/reports/usage/session-transfer-status'

export const SESSION_TRANSFER_RETENTION = {
  active_ttl_seconds: SESSION_TRANSFER_ACTIVE_TTL_SECONDS,
  terminal_ttl_seconds: SESSION_TRANSFER_TERMINAL_TTL_SECONDS,
  stale_after_seconds: SESSION_TRANSFER_STALE_AFTER_SECONDS,
} as const

const AVAILABILITIES = [
  'live',
  'stale',
  'terminal',
  'expired',
  'unavailable',
  'unsupported',
] as const

const FRESHNESS = ['live', 'stale', 'terminal', 'unavailable'] as const

const PHASES = [
  'request_received',
  'request_preparing',
  'awaiting_upstream',
  'response_streaming',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
  'disconnected',
  'timed_out',
] as const

const REASONS = [
  'credentials_unconfigured',
  'upstream_unauthorized',
  'upstream_unreachable',
  'upstream_error',
  'registry_unavailable',
  'retention_elapsed',
  'schema_unsupported',
] as const

export type SessionTransferAvailability = (typeof AVAILABILITIES)[number]
export type SessionTransferFreshness = (typeof FRESHNESS)[number]
export type SessionTransferPhase = (typeof PHASES)[number]
export type SessionTransferReason = (typeof REASONS)[number]

export interface SessionTransferSelection {
  session_id: string | null
  codex_session_id: string | null
  canonical_session_id: string | null
}

export interface SessionTransferRecord {
  phase: SessionTransferPhase | null
  freshness: SessionTransferFreshness
  active: boolean
  stale: boolean
  terminal_state: SessionTransferPhase | null
  upstream_chunk_count: number | null
  upstream_byte_count: number | null
  downstream_chunk_count: number | null
  downstream_byte_count: number | null
  last_heartbeat_at: string | null
  finalized_at: string | null
  received_at: string | null
  litellm_call_id: string | null
  session_id: string | null
  codex_session_id: string | null
  canonical_session_id: string | null
  provider: string | null
  model: string | null
}

export interface SessionTransferStatusResponse {
  schema_version: 'session-transfer-status.v1'
  availability: SessionTransferAvailability
  reason: SessionTransferReason | null
  retention: {
    active_ttl_seconds: number
    terminal_ttl_seconds: number
    stale_after_seconds: number
  }
  selection: SessionTransferSelection
  registry: { state: 'ok' | 'degraded' | 'unavailable' } | null
  observed_at: string | null
  truncated: boolean
  transfers: SessionTransferRecord[]
}

const PHASE_SET = new Set<string>(PHASES)
const FRESHNESS_SET = new Set<string>(FRESHNESS)
const VISIBLE_AVAILABILITIES = new Set<SessionTransferAvailability>([
  'live',
  'stale',
  'terminal',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function selectionFrom(value: unknown): SessionTransferSelection {
  const record = isRecord(value) ? value : {}
  return {
    session_id:
      typeof record.session_id === 'string' ? record.session_id : null,
    codex_session_id:
      typeof record.codex_session_id === 'string'
        ? record.codex_session_id
        : null,
    canonical_session_id:
      typeof record.canonical_session_id === 'string'
        ? record.canonical_session_id
        : null,
  }
}

function counterFrom(value: unknown, freshness: SessionTransferFreshness) {
  if (freshness === 'unavailable') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.floor(value)
}

function textFrom(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function registryStateFrom(
  value: unknown
): 'ok' | 'degraded' | 'unavailable' | null {
  if (value === 'ok' || value === 'degraded' || value === 'unavailable') {
    return value
  }
  return null
}

function recordFrom(value: unknown): SessionTransferRecord | null {
  if (!isRecord(value)) return null
  const freshness = FRESHNESS_SET.has(String(value.freshness))
    ? (value.freshness as SessionTransferFreshness)
    : 'unavailable'
  const phase =
    freshness === 'unavailable' || !PHASE_SET.has(String(value.phase))
      ? null
      : (value.phase as SessionTransferPhase)
  const terminalState =
    freshness === 'terminal' && PHASE_SET.has(String(value.terminal_state))
      ? (value.terminal_state as SessionTransferPhase)
      : freshness === 'terminal'
        ? phase
        : null
  return {
    phase,
    freshness,
    active: freshness === 'live',
    stale: freshness === 'stale',
    terminal_state: terminalState,
    upstream_chunk_count: counterFrom(value.upstream_chunk_count, freshness),
    upstream_byte_count: counterFrom(value.upstream_byte_count, freshness),
    downstream_chunk_count: counterFrom(
      value.downstream_chunk_count,
      freshness
    ),
    downstream_byte_count: counterFrom(value.downstream_byte_count, freshness),
    last_heartbeat_at: textFrom(value.last_heartbeat_at),
    finalized_at: textFrom(value.finalized_at),
    received_at: textFrom(value.received_at),
    litellm_call_id: textFrom(value.litellm_call_id),
    session_id: textFrom(value.session_id),
    codex_session_id: textFrom(value.codex_session_id),
    canonical_session_id: textFrom(value.canonical_session_id),
    provider: textFrom(value.provider),
    model: textFrom(value.model),
  }
}

export function emptySessionTransferStatus(
  availability: SessionTransferAvailability,
  reason: SessionTransferReason | null,
  selection: SessionTransferSelection
): SessionTransferStatusResponse {
  return {
    schema_version: 'session-transfer-status.v1',
    availability,
    reason,
    retention: SESSION_TRANSFER_RETENTION,
    selection,
    registry: null,
    observed_at: null,
    truncated: false,
    transfers: [],
  }
}

export function normalizeSessionTransferStatus(
  value: unknown
): SessionTransferStatusResponse {
  const record = isRecord(value) ? value : {}
  const availability = AVAILABILITIES.includes(
    record.availability as SessionTransferAvailability
  )
    ? (record.availability as SessionTransferAvailability)
    : 'unsupported'
  const reason = REASONS.includes(record.reason as SessionTransferReason)
    ? (record.reason as SessionTransferReason)
    : availability === 'unsupported'
      ? 'schema_unsupported'
      : null
  const selection = selectionFrom(record.selection)
  const registryState = registryStateFrom(
    isRecord(record.registry) ? record.registry.state : null
  )
  const normalizedRegistry = registryState ? { state: registryState } : null
  const transfers = Array.isArray(record.transfers)
    ? record.transfers
        .map((transfer) => recordFrom(transfer))
        .filter(
          (transfer): transfer is SessionTransferRecord => transfer !== null
        )
    : []
  const visible = VISIBLE_AVAILABILITIES.has(availability) ? transfers : []
  return {
    schema_version: 'session-transfer-status.v1',
    availability,
    reason,
    retention: SESSION_TRANSFER_RETENTION,
    selection,
    registry: normalizedRegistry,
    observed_at: textFrom(record.observed_at),
    truncated: record.truncated === true,
    transfers: visible,
  }
}

export async function fetchSessionTransferStatus(
  sessionId: string,
  signal?: AbortSignal
): Promise<SessionTransferStatusResponse> {
  const selection = {
    session_id: sessionId,
    codex_session_id: null,
    canonical_session_id: null,
  }
  const params = new URLSearchParams({ session_id: sessionId })
  let response: Response
  try {
    response = await fetch(`${SESSION_TRANSFER_STATUS_PATH}?${params}`, {
      signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw error
    }
    return emptySessionTransferStatus(
      'unavailable',
      'upstream_unreachable',
      selection
    )
  }
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
  if (
    response.status === 404 ||
    response.status === 405 ||
    response.status === 501
  ) {
    return emptySessionTransferStatus(
      'unsupported',
      'schema_unsupported',
      selection
    )
  }
  if (!response.ok) {
    return emptySessionTransferStatus(
      'unavailable',
      'upstream_unreachable',
      selection
    )
  }
  try {
    const normalized = normalizeSessionTransferStatus(await response.json())
    return {
      ...normalized,
      selection: { ...normalized.selection, session_id: sessionId },
    }
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw error
    }
    return emptySessionTransferStatus(
      'unsupported',
      'schema_unsupported',
      selection
    )
  }
}

export function sessionTransferStatusQueryOptions({
  sessionId,
  viewActive = true,
  refetchIntervalMs,
}: {
  sessionId: string | null
  viewActive?: boolean
  refetchIntervalMs?: number | false
}) {
  const selected = sessionId?.trim() || null
  const active = viewActive && selected !== null
  const refetchInterval = !active
    ? false
    : refetchIntervalMs === false
      ? false
      : (refetchIntervalMs ?? LIVE_SESSION_TRANSFER_REFETCH_INTERVAL_MS)
  return queryOptions({
    queryKey: ['session-transfer-status', selected ?? ''] as const,
    queryFn: ({ signal }) => fetchSessionTransferStatus(selected ?? '', signal),
    enabled: active,
    staleTime: 0,
    gcTime: 0,
    refetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
}
