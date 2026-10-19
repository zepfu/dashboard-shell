export {}

declare module './session-diagnostics-audit-terminal.mjs' {
  type SearchParamsLike = {
    get(name: string): string | null
  }

  type AuditTerminalQuery = {
    sql: string
    values: unknown[]
    metadata: {
      from: string
      to: string
      limit: number
      dataSource: string
      excludedFilters: string[]
    }
  }

  type AliasRouteEvent = {
    egress_disposition?: string
    failure_phase?: string
    replay_safety?: unknown
    attempted_provider_call?: boolean
    session_owner_mismatch_reason?: string
    [key: string]: unknown
  }

  type AuditIdentity = {
    source: 'alias_routing_audit'
    history_row: 'absent'
    session_id: 'recorded' | 'unavailable'
    trace_id: 'recorded' | 'unavailable'
    litellm_call_id: 'recorded' | 'unavailable'
    provider: 'recorded' | 'unavailable'
    model: 'recorded' | 'unavailable'
    repository: 'recorded' | 'unavailable'
  }

  type DiagnosticRow = {
    session_id: string | null
    trace_id: string | null
    litellm_call_id: string | null
    provider: string | null
    model: string | null
    repository: string | null
    client: string | null
    audit_identity: AuditIdentity | null
    alias_route_events: AliasRouteEvent[]
    [key: string]: unknown
  }

  export function attemptedProviderCallSql(alias?: string): string
  export function replaySafetySql(alias?: string): string
  export function aliasAuditTerminalEvidenceSql(alias?: string): string
  export function buildSessionDiagnosticsAuditTerminalQuery(
    searchParams: SearchParamsLike,
    options?: { from?: string; to?: string; limit?: number }
  ): AuditTerminalQuery
  export function parseAttemptedProviderCall(value: unknown): boolean | null
  export function sanitizeReplaySafety(
    value: unknown
  ): { classification: string; field_path: string | null } | null
  export function classifyAliasTerminalEgress(event: unknown): string | null
  export function sanitizeAliasRouteEvent(
    event: unknown
  ): AliasRouteEvent | null
  export function sanitizeAliasRouteEvents(events: unknown): AliasRouteEvent[]
  export function sanitizeAuditIdentity(value: unknown): AuditIdentity | null
  export function normalizeAuditTerminalDiagnosticRow(
    row: unknown
  ): DiagnosticRow
  export function mergeSessionDiagnosticsWithAuditTerminalRows(
    historyRows: unknown,
    auditRows: unknown,
    limit?: number
  ): DiagnosticRow[]
}
