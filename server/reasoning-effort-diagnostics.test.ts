import { loadModule, parseSync } from 'pgsql-parser'
import { describe, expect, test } from 'vitest'
import {
  REASONING_EFFORT_ATTEMPT_CONFIG_SCALARS,
  REASONING_EFFORT_DIAGNOSTIC_KEYS,
  REASONING_EFFORT_MAPPING_SCALARS,
  REASONING_EFFORT_PRODUCER_FIXTURES,
  normalizeReasoningEffortDiagnostics,
  reasoningEffortDiagnosticCategorySql,
  reasoningEffortDiagnosticFlagSql,
  reasoningEffortDiagnosticsProjectionSql,
  reasoningEffortMetadataPresentSql,
} from './reasoning-effort-diagnostics.mjs'
import { buildSessionDiagnosticsQuery } from './report-service.mjs'

const {
  unchangedMapping,
  ceilingClampProviderMapping,
  candidateOverride,
  missingMetadata,
  partialMissing,
} = REASONING_EFFORT_PRODUCER_FIXTURES

function sessionDiagnosticsSql() {
  return buildSessionDiagnosticsQuery(
    new URLSearchParams({
      from: '2026-05-01',
      to: '2026-05-08',
      limit: '25',
    })
  ).sql
}

function recentSessionsSql(sql: string) {
  const start = sql.indexOf('recent_sessions AS MATERIALIZED')
  const end = sql.indexOf('diagnostic_rows AS')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end)
}

function mappedEffort(row: Record<string, unknown>) {
  return row.reasoning_effort as Record<string, unknown>
}

function expectPersistedScalars(
  actual: Record<string, unknown> | null,
  fixture: Record<string, string | number>
) {
  expect(actual).not.toBeNull()
  expect(Object.keys(actual ?? {}).sort()).toEqual(
    [...REASONING_EFFORT_DIAGNOSTIC_KEYS].sort()
  )
  for (const key of REASONING_EFFORT_DIAGNOSTIC_KEYS) {
    const expected = Object.prototype.hasOwnProperty.call(fixture, key)
      ? fixture[key]
      : null
    expect(actual?.[key]).toBe(expected)
  }
  expect(actual).not.toHaveProperty('reasoning_tokens_reported')
  expect(actual).not.toHaveProperty('reasoning_tokens_estimated')
  expect(actual).not.toHaveProperty('codex_reasoning_effort')
  expect(actual).not.toHaveProperty('effective_effort')
  expect(JSON.stringify(actual)).not.toContain('original caller')
}

describe('reasoning effort diagnostics query', () => {
  test('effort-only records qualify through the mapping scalar allowlist', async () => {
    await loadModule()
    const eligibility = reasoningEffortMetadataPresentSql('')
    const sql = sessionDiagnosticsSql()
    const projection = reasoningEffortDiagnosticsProjectionSql('metadata')

    expect(eligibility).toContain(' OR ')
    expect(eligibility).not.toContain(' AND ')
    expect(recentSessionsSql(sql)).toContain(eligibility)
    expect(sql).toContain(projection)
    expect(sql).toContain(reasoningEffortDiagnosticFlagSql(''))
    expect(sql).toContain(reasoningEffortDiagnosticCategorySql(''))
    parseSync(`SELECT ${projection} AS reasoning_effort`)
    parseSync(`SELECT 1 WHERE ${eligibility}`)

    for (const key of REASONING_EFFORT_MAPPING_SCALARS) {
      expect(eligibility).toContain(`metadata->>'${key}' IS NOT NULL`)
      expect(projection).toContain(`'${key}'`)
    }
    for (const key of REASONING_EFFORT_ATTEMPT_CONFIG_SCALARS) {
      expect(eligibility).not.toContain(key)
      expect(projection).toContain(`'${key}'`)
    }
  })

  test('projects unchanged, clamped, and same-attempt override scalars without token or other-attempt inputs', () => {
    const projection = reasoningEffortDiagnosticsProjectionSql('metadata')

    expect(projection).toContain(
      "NULLIF(metadata->>'reasoning_effort_candidate_attempt', '') IS NOT NULL"
    )
    expect(projection).toContain(
      "NULLIF(entry->>'reasoning_effort_candidate_attempt', '') = NULLIF(metadata->>'reasoning_effort_candidate_attempt', '')"
    )
    expect(projection).toContain('codex_auto_agent_attempts')
    expect(projection).toContain('anthropic_auto_agent_attempts')
    expect(projection).toContain('aawm_alias_routing_audit_events')
    expect(projection).not.toContain('attempt_number')
    expect(projection).not.toContain('->0')
    expect(projection).not.toContain('->-1')
    expect(projection).not.toContain('reasoning_tokens')
    expect(projection).not.toContain('codex_reasoning_effort')
    expect(projection).not.toContain('effective_effort')
    expect(projection).not.toContain('codex_auto_agent_selected_model')
    expect(projection).not.toContain('sh.provider')
    expect(projection).not.toContain('sh.model')
    expect(projection).not.toContain('jsonb_strip_nulls')

    for (const fixture of [
      unchangedMapping,
      ceilingClampProviderMapping,
      candidateOverride,
    ]) {
      for (const key of Object.keys(fixture)) {
        expect(REASONING_EFFORT_DIAGNOSTIC_KEYS).toContain(key)
        expect(projection).toContain(`'${key}'`)
      }
    }
    for (const key of Object.keys(missingMetadata)) {
      expect(REASONING_EFFORT_DIAGNOSTIC_KEYS).not.toContain(key)
      expect(projection).not.toContain(key)
    }
  })
})

describe('reasoning effort diagnostics normalization', () => {
  test('keeps an unchanged within-ceiling mapping', async () => {
    const { __usageReportTestHelpers } = await import('./report-service.mjs')
    const row = __usageReportTestHelpers.normalizeSessionDiagnosticsRow({
      provider: 'row-provider',
      model: 'row-model',
      reasoning_tokens_reported: 4242,
      alias_route_events: [{ attempt_number: 9, model: 'not-this-attempt' }],
      reasoning_effort: {
        ...unchangedMapping,
        reasoning_tokens_reported: 4242,
        effective_effort: 'low',
      },
    })

    const effort = mappedEffort(row)
    expectPersistedScalars(effort, unchangedMapping)
    expect(effort.reasoning_effort_requested).toBe(
      effort.reasoning_effort_native_value
    )
    expect(effort.reasoning_effort_mapping_reason).toBe(
      'within_supported_ceiling'
    )
    expect(effort.reasoning_effort_resolved_model).toBe('oa_xai/grok-4.6')
    expect(effort.reasoning_effort_resolved_model).not.toBe(row.model)
  })

  test('keeps a ceiling clamp and the resolved provider mapping', async () => {
    const { __usageReportTestHelpers } = await import('./report-service.mjs')
    const row = __usageReportTestHelpers.normalizeSessionDiagnosticsRow({
      provider: 'row-provider',
      model: 'row-model',
      reasoning_effort: {
        ...ceilingClampProviderMapping,
        reasoning_effort_candidate_attempt: '2',
        codex_reasoning_effort: 'max',
        reasoning_tokens_estimated: 7,
      },
      alias_route_events: [
        {
          attempt_number: 9,
          model: 'not-this-attempt',
          details: { reasoning_effort_native_value: 'xhigh' },
        },
      ],
    })

    const effort = mappedEffort(row)
    expectPersistedScalars(effort, ceilingClampProviderMapping)
    expect(effort.reasoning_effort_requested).toBe('max')
    expect(effort.reasoning_effort_native_value).toBe('high')
    expect(effort.reasoning_effort_supported_ceiling).toBe('high')
    expect(effort.reasoning_effort_resolved_provider).toBe('openai')
    expect(effort.reasoning_effort_candidate_attempt).toBe(2)
    expect(effort.reasoning_effort_candidate_attempt).not.toBe(9)
  })

  test('keeps a candidate override as the value that entered reconciliation', async () => {
    const { __usageReportTestHelpers } = await import('./report-service.mjs')
    const row = __usageReportTestHelpers.normalizeSessionDiagnosticsRow({
      provider: 'openai',
      model: 'caller-model',
      reasoning_effort: {
        ...candidateOverride,
        caller_reasoning_effort: 'high',
        original_reasoning_effort: 'high',
      },
    })

    const effort = mappedEffort(row)
    expectPersistedScalars(effort, candidateOverride)
    expect(effort.reasoning_effort_requested).toBe('low')
    expect(effort.reasoning_effort_requested).toBe(
      effort.reasoning_effort_config_value
    )
    expect(effort.reasoning_effort_config_source).toBe('candidate_yaml')
    expect(effort).not.toHaveProperty('caller_reasoning_effort')
    expect(effort).not.toHaveProperty('original_reasoning_effort')
    expect(JSON.stringify(effort)).not.toContain('caller-model')
  })

  test('preserves missing scalars instead of inferring effort', () => {
    expect(normalizeReasoningEffortDiagnostics(missingMetadata)).toBeNull()
    expect(normalizeReasoningEffortDiagnostics(null)).toBeNull()
    expect(normalizeReasoningEffortDiagnostics({})).toBeNull()

    const partial = normalizeReasoningEffortDiagnostics({
      ...partialMissing,
      reasoning_effort_candidate_attempt: 1.5,
      alias_attempt_number: 9,
    })
    expect(partial?.reasoning_effort_requested).toBe('high')
    expect(partial?.reasoning_effort_native_value).toBeNull()
    expect(partial?.reasoning_effort_supported_ceiling).toBeNull()
    expect(partial?.reasoning_effort_resolved_model).toBeNull()
    expect(partial?.reasoning_effort_resolved_provider).toBeNull()
    expect(partial?.reasoning_effort_candidate_attempt).toBeNull()
    expect(partial).not.toHaveProperty('reasoning_tokens_reported')
    expect(partial).not.toHaveProperty('codex_reasoning_effort')
    expect(partial).not.toHaveProperty('effective_effort')
    expect(partial).not.toHaveProperty('alias_attempt_number')
    expect(JSON.stringify(partial)).not.toContain('4242')
    expect(JSON.stringify(partial)).not.toContain('max')
    expect(JSON.stringify(partial)).not.toContain('xhigh')
  })
})
