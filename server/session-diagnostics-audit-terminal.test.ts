import { describe, expect, test } from 'vitest'
import { buildSessionDiagnosticsQuery } from './report-service.mjs'
import {
  buildSessionDiagnosticsAuditTerminalQuery,
  mergeSessionDiagnosticsWithAuditTerminalRows,
  normalizeAuditTerminalDiagnosticRow,
  sanitizeAliasRouteEvent,
} from './session-diagnostics-audit-terminal.mjs'

const bounds = {
  from: '2026-05-01',
  to: '2026-05-08',
  limit: 25,
}

function auditQuery(params: Record<string, string> = {}, limit = bounds.limit) {
  return buildSessionDiagnosticsAuditTerminalQuery(
    new URLSearchParams({
      from: bounds.from,
      to: bounds.to,
      ...params,
    }),
    { from: bounds.from, to: bounds.to, limit }
  )
}

describe('session diagnostics audit terminal query', () => {
  test('starts_from_audit_metadata_and_keeps_bounds', () => {
    const query = auditQuery({
      provider: 'anthropic',
      session_id: 'sess-1',
      litellm_call_id: 'call-1',
    })

    const auditFrom = query.sql.indexOf(
      'FROM public.aawm_alias_routing_audit aa'
    )
    const historyFrom = query.sql.indexOf('FROM public.session_history sh')
    expect(auditFrom).toBeGreaterThan(-1)
    expect(historyFrom).toBeGreaterThan(auditFrom)
    expect(query.sql.slice(0, historyFrom)).not.toContain(
      'FROM public.session_history'
    )
    expect(query.sql).toContain('NOT EXISTS')
    expect(query.sql).toContain('jsonb_array_elements')
    expect(query.sql).toContain(
      "sh.metadata->'aawm_alias_routing_audit_events'"
    )
    expect(query.sql).toContain("NULLIF(aa.litellm_call_id, '') IS NOT NULL")
    expect(query.sql).toContain('sh.litellm_call_id IS NOT NULL')
    expect(query.sql).toContain("NULLIF(aa.session_id, '') IS NOT NULL")
    expect(query.sql).toContain('sh.session_id IS NOT NULL')
    expect(query.sql).toContain("NULLIF(aa.trace_id, '') IS NOT NULL")
    expect(query.sql).toContain('IS NOT DISTINCT FROM aa.attempt_number::text')
    expect(query.sql).toContain("aa.metadata->>'failure_phase'")
    expect(query.sql).toContain("aa.metadata->>'attempted_provider_call'")
    expect(query.sql).toContain("aa.metadata->'replay_safety'")
    expect(query.sql).toContain("aa.metadata->>'session_owner_mismatch_reason'")
    expect(query.sql).toContain('aa.redispatch_required')
    expect(query.sql).toContain(
      "aa.observed_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')"
    )
    expect(query.sql).toContain(
      "aa.observed_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')"
    )
    expect(query.sql).toContain(
      "WHEN NULLIF(aa.provider, '') IS NULL THEN NULL"
    )
    expect(query.sql).toContain('LIMIT $6')
    expect(query.values).toEqual([
      '2026-05-01',
      '2026-05-08',
      ['anthropic'],
      ['sess-1'],
      ['call-1'],
      25,
    ])
    expect(query.metadata).toMatchObject({
      from: '2026-05-01',
      to: '2026-05-08',
      limit: 25,
      dataSource: 'aawm_alias_routing_audit',
      excludedFilters: [],
    })
    expect(query.sql).not.toContain("->'details'")
    expect(query.sql).not.toContain('to_jsonb(aa.metadata)')
    expect(query.sql).not.toContain('aa.metadata AS')
    expect(query.sql).not.toContain('attempts')
    expect(query.sql).not.toContain('api_key')
    expect(query.sql).not.toContain('authorization')
    expect(query.sql).not.toContain('prompt')
    expect(query.sql).not.toContain('session_owner_continuity_receipt')
    expect(query.sql).not.toContain('request_body')
    expect(query.sql).not.toContain('AND FALSE')
  })

  test('deduplicates_only_history_events_with_matching_call_event_identity', () => {
    const query = auditQuery()
    const duplicateLookup = query.sql.slice(
      query.sql.indexOf('AND NOT EXISTS'),
      query.sql.indexOf('ORDER BY aa.observed_at DESC')
    )

    expect(duplicateLookup).toContain(
      "sh.metadata->'aawm_alias_routing_audit_events'"
    )
    expect(duplicateLookup).toContain(
      "sh.metadata->'codex_auto_agent_audit_events'"
    )
    expect(duplicateLookup).toContain(
      "sh.metadata->'anthropic_auto_agent_audit_events'"
    )
    expect(duplicateLookup).toContain(
      "represented_event.value->>'litellm_call_id'"
    )
    expect(duplicateLookup).toContain("represented_event.value->>'event_type'")
    expect(duplicateLookup).toContain(
      "represented_event.value->>'attempt_number'"
    )
    expect(duplicateLookup).toContain("represented_event.value->>'observed_at'")
    expect(duplicateLookup).toContain(
      "(represented_event.value->>'observed_at')::timestamptz = aa.observed_at"
    )
  })

  test('caps_the_limit_and_excludes_filters_without_recorded_identity', () => {
    const capped = auditQuery({}, 9000)
    expect(capped.values[capped.values.length - 1]).toBe(500)
    expect(capped.metadata.limit).toBe(500)
    expect(capped.sql).toContain('LIMIT $3')

    const excluded = auditQuery({ client: 'grok-build', environment: 'prod' })
    expect(excluded.sql).toContain('AND FALSE')
    expect(excluded.metadata.excludedFilters).toEqual(['client', 'environment'])
    expect(excluded.values[excluded.values.length - 1]).toBe(25)
    expect(excluded.sql).toContain('FROM public.aawm_alias_routing_audit aa')
  })

  test('history_backed_alias_events_read_metadata_evidence', () => {
    const query = buildSessionDiagnosticsQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        limit: '10',
      })
    )
    expect(query.sql).toContain("aa.metadata->>'failure_phase'")
    expect(query.sql).toContain("aa.metadata->>'attempted_provider_call'")
    expect(query.sql).toContain("aa.metadata->'replay_safety'")
    expect(query.sql).toContain("aa.metadata->>'session_owner_mismatch_reason'")
    expect(query.sql).toContain("to_jsonb(aa)->>'redispatch_required'")
    expect(query.values).toEqual(['2026-05-01', '2026-05-08', 50000, 10])
  })
})

describe('session diagnostics audit terminal rows', () => {
  test('normalizes_an_audit_only_terminal_event_without_raw_metadata', () => {
    const row = normalizeAuditTerminalDiagnosticRow({
      created_at: new Date('2026-05-20T12:00:00.000Z'),
      session_id: null,
      trace_id: 'trace-replay',
      litellm_call_id: null,
      provider: 'anthropic',
      model: null,
      repository: null,
      audit_identity: {
        source: 'alias_routing_audit',
        history_row: 'absent',
        session_id: 'unavailable',
        trace_id: 'recorded',
        litellm_call_id: 'unavailable',
        provider: 'recorded',
        model: 'unavailable',
        repository: 'unavailable',
      },
      alias_route_events: [
        {
          observed_at: '2026-05-20T12:00:00.000Z',
          trace_id: 'trace-replay',
          event_type: 'redispatch_required',
          failure_class: 'session_owner_redispatch',
          failure_phase: 'session_owner_replay_unsafe_auto_review',
          attempted_provider_call: false,
          redispatch_required: true,
          replay_safety: {
            classification: 'previous_response_id',
            field_path: '$.previous_response_id',
            raw_body: 'SECRET_PAYLOAD',
          },
          attempts: [{ api_key: 'sk-secret' }],
          api_key: 'sk-secret',
        },
      ],
    })

    expect(row.session_id).toBeNull()
    expect(row.litellm_call_id).toBeNull()
    expect(row.provider).toBe('anthropic')
    expect(row.model).toBeNull()
    expect(row.repository).toBeNull()
    expect(row.client).toBeNull()
    expect(row.audit_identity).toMatchObject({
      history_row: 'absent',
      session_id: 'unavailable',
      trace_id: 'recorded',
      litellm_call_id: 'unavailable',
      provider: 'recorded',
      model: 'unavailable',
    })
    expect(row.alias_route_events[0]).toMatchObject({
      egress_disposition: 'replay_rejection',
      attempted_provider_call: false,
      replay_safety: {
        classification: 'previous_response_id',
        field_path: '$.previous_response_id',
      },
    })
    expect(JSON.stringify(row)).not.toContain('SECRET_PAYLOAD')
    expect(JSON.stringify(row)).not.toContain('sk-secret')
  })

  test('drops_duplicate_correlation_and_keeps_unrepresented_audit_rows', () => {
    const history = [
      {
        created_at: '2026-05-20T11:00:00.000Z',
        session_id: 'sess-history',
        litellm_call_id: 'call-dup',
        provider: 'openai',
        diagnostic_flags: ['alias_routing'],
        diagnostic_categories: ['route_timeline'],
        alias_route_events: [
          {
            observed_at: '2026-05-20T11:00:00.000Z',
            litellm_call_id: 'call-dup',
            session_id: 'sess-history',
            event_type: 'redispatch_required',
            attempt_number: 2,
            redispatch_required: true,
          },
        ],
      },
    ]
    const duplicate = normalizeAuditTerminalDiagnosticRow({
      created_at: '2026-05-20T11:00:00.000Z',
      session_id: 'sess-history',
      litellm_call_id: 'call-dup',
      provider: 'openai',
      audit_identity: {
        source: 'alias_routing_audit',
        history_row: 'absent',
        session_id: 'recorded',
        trace_id: 'unavailable',
        litellm_call_id: 'recorded',
        provider: 'recorded',
        model: 'unavailable',
        repository: 'unavailable',
      },
      alias_route_events: [
        {
          observed_at: '2026-05-20T11:00:00.000Z',
          litellm_call_id: 'call-dup',
          session_id: 'sess-history',
          event_type: 'redispatch_required',
          failure_phase: 'session_owner_mismatch',
          attempted_provider_call: false,
          attempt_number: 2,
          redispatch_required: true,
          api_key: 'sk-secret',
        },
      ],
    })
    const sameSessionDifferentCall = normalizeAuditTerminalDiagnosticRow({
      created_at: '2026-05-20T11:30:00.000Z',
      session_id: 'sess-history',
      litellm_call_id: 'call-other',
      provider: 'anthropic',
      audit_identity: {
        source: 'alias_routing_audit',
        history_row: 'absent',
        session_id: 'recorded',
        trace_id: 'unavailable',
        litellm_call_id: 'recorded',
        provider: 'recorded',
        model: 'unavailable',
        repository: 'unavailable',
      },
      alias_route_events: [
        {
          observed_at: '2026-05-20T11:30:00.000Z',
          session_id: 'sess-history',
          litellm_call_id: 'call-other',
          event_type: 'redispatch_required',
          attempt_number: 3,
          redispatch_required: true,
        },
      ],
    })
    const auditOnly = normalizeAuditTerminalDiagnosticRow({
      created_at: '2026-05-20T12:00:00.000Z',
      session_id: null,
      trace_id: 'trace-only',
      provider: null,
      audit_identity: {
        source: 'alias_routing_audit',
        history_row: 'absent',
        session_id: 'unavailable',
        trace_id: 'recorded',
        litellm_call_id: 'unavailable',
        provider: 'unavailable',
        model: 'unavailable',
        repository: 'unavailable',
      },
      alias_route_events: [
        {
          observed_at: '2026-05-20T12:00:00.000Z',
          trace_id: 'trace-only',
          event_type: 'redispatch_required',
          failure_phase: 'session_owner_pre_egress',
          attempted_provider_call: true,
          redispatch_required: true,
        },
      ],
    })

    const merged = mergeSessionDiagnosticsWithAuditTerminalRows(
      history,
      [duplicate, sameSessionDifferentCall, auditOnly],
      25
    )

    expect(merged).toHaveLength(2)
    expect(merged[0]?.litellm_call_id).toBeNull()
    expect(merged[0]?.audit_identity?.history_row).toBe('absent')
    expect(merged[0]?.alias_route_events?.[0]?.egress_disposition).toBe(
      'attempted_provider_egress'
    )
    expect(merged[1]?.litellm_call_id).toBe('call-dup')
    expect(merged[1]?.audit_identity).toBeNull()
    expect(merged[1]?.alias_route_events).toHaveLength(2)
    expect(merged[1]?.alias_route_events?.[0]).toMatchObject({
      failure_phase: 'session_owner_mismatch',
      attempted_provider_call: false,
      egress_disposition: 'local_guard',
    })
    expect(merged[1]?.alias_route_events?.[1]).toMatchObject({
      litellm_call_id: 'call-other',
      session_id: 'sess-history',
      event_type: 'redispatch_required',
      attempt_number: 3,
    })
    expect(JSON.stringify(merged)).not.toContain('sk-secret')
  })

  test('absent_optional_evidence_stays_explicitly_unavailable', () => {
    const event = sanitizeAliasRouteEvent({
      observed_at: '2026-05-20T10:00:00.000Z',
      litellm_call_id: 'call-absent',
      event_type: 'redispatch_required',
      redispatch_required: true,
      attempts: [{ prompt: 'hidden' }],
      metadata: { authorization: 'Bearer secret' },
    })

    expect(event).toMatchObject({
      litellm_call_id: 'call-absent',
      event_type: 'redispatch_required',
      redispatch_required: true,
      egress_disposition: 'unavailable',
    })
    expect(event?.failure_phase).toBeUndefined()
    expect(event?.replay_safety).toBeUndefined()
    expect(event?.attempted_provider_call).toBeUndefined()
    expect(event?.session_owner_mismatch_reason).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('hidden')
    expect(JSON.stringify(event)).not.toContain('Bearer')
  })
})
