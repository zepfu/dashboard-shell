type SearchParamsLike = {
  get(name: string): string | null
}

type QueryRow = Record<string, unknown>

interface RequestWaitCheckpointQueryOptions {
  from?: string
  to?: string
  limit?: number
}

interface RequestWaitCheckpointQuery {
  sql: string
  values: unknown[]
  metadata: {
    from: string
    to: string
    limit: number
  }
}

interface RequestWaitCategory {
  type: string
  started_at: string | null
}

interface RequestWaitCheckpoint {
  litellm_call_id: string | null
  session_id: string | null
  record_attribution:
    | 'missing'
    | 'checkpoint_only'
    | 'correlated_session_history'
  missing_reason: 'no_durable_checkpoint' | 'no_litellm_call_id' | null
  activity: 'missing' | 'active' | 'stale' | 'completed_asgi' | 'recorded'
  display_states: string[]
  checkpoint_status: string | null
  freshness: 'fresh' | 'stale' | 'unknown' | 'missing'
  freshness_age_seconds: number | null
  freshness_threshold_seconds: number
  freshness_basis: 'checkpoint_updated_at'
  sequence: number | null
  checkpoint_started_at: string | null
  checkpoint_updated_at: string | null
  asgi_completion_at: string | null
  session_history_start_time: string | null
  session_history_end_time: string | null
  active_wait_categories: RequestWaitCategory[]
  durations_ms: Record<string, number>
  counts: Record<string, number>
  durations_are_disjoint: false
  summed_duration_ms: null
  duration_accounting: 'overlapping_categories'
  accounting_duration_is_timeout: false
  asgi_establishes_provider_success: false
  asgi_establishes_final_delivery: false
  provider_content_outcome: 'not_established' | 'empty_completion_recorded'
  provider_content_source: string
  final_delivery_outcome: 'not_established'
  outcome_note: string
  qualifying_session_history: boolean
  provider: string | null
  model: string | null
  created_at: string | null
  repository: string | null
  client: string | null
  environment: string | null
  trace_id: string | null
  host_name: string | null
  client_ip: string | null
  provider_response_id: string | null
  history_empty_completion_failure: boolean | null
  generated_at: string | null
}

export const REQUEST_WAIT_CHECKPOINT_FRESHNESS_SECONDS: number
export const MAX_REQUEST_WAIT_CHECKPOINT_ROWS: number
export const REQUEST_WAIT_CHECKPOINT_OUTCOME_NOTE: string

export class BadRequestError extends Error {
  constructor(message: string)
}

export function buildRequestWaitCheckpointQuery(
  searchParams: SearchParamsLike,
  options?: RequestWaitCheckpointQueryOptions
): RequestWaitCheckpointQuery

export function normalizeRequestWaitCheckpointRow(
  row: QueryRow,
  options?: { generatedAt?: string | null }
): RequestWaitCheckpoint | null

export function selectCurrentWaitCheckpoints(
  rows: readonly QueryRow[],
  generatedAt?: string | null
): RequestWaitCheckpoint[]

export function assembleRequestWaitDiagnostics(input: {
  metadata?: Record<string, unknown>
  sessionDiagnostics?: readonly QueryRow[]
  checkpointRows?: readonly QueryRow[]
  generatedAt?: string | null
}): {
  metadata: Record<string, unknown>
  sessionDiagnostics: Array<
    QueryRow & { request_wait_checkpoint: RequestWaitCheckpoint }
  >
  requestWaitCheckpoints: RequestWaitCheckpoint[]
}
