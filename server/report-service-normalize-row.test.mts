import { afterEach, describe, expect, test, vi } from 'vitest'

const envSnapshot = { ...process.env }

afterEach(() => {
  process.env = { ...envSnapshot }
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('report-service normalizeRow', () => {
  test('coerces representative numeric-string fields to numbers', async () => {
    const { __usageReportTestHelpers } = await import('./report-service.mjs')
    const { normalizeRow } = __usageReportTestHelpers
    const out = normalizeRow({
      traces: '42',
      token_in: '1000',
      usd_cost: '1.25',
      agent_quality_score: '88.5',
      litellm_pre_send_p50_ms: '12',
    })
    expect(out.traces).toBe(42)
    expect(out.token_in).toBe(1000)
    expect(out.usd_cost).toBe(1.25)
    expect(out.agent_quality_score).toBe(88.5)
    expect(out.litellm_pre_send_p50_ms).toBe(12)
  })

  test('keeps null as null for numeric keys', async () => {
    const { __usageReportTestHelpers } = await import('./report-service.mjs')
    const { normalizeRow } = __usageReportTestHelpers
    const out = normalizeRow({
      traces: null,
      token_out: null,
      agent_score_reasons_bounded_min_id: null,
    })
    expect(out.traces).toBeNull()
    expect(out.token_out).toBeNull()
    expect(out.agent_score_reasons_bounded_min_id).toBeNull()
  })

  test('preserves non-numeric passthrough fields', async () => {
    const { __usageReportTestHelpers } = await import('./report-service.mjs')
    const { normalizeRow } = __usageReportTestHelpers
    const out = normalizeRow({
      provider: 'anthropic',
      model: 'claude-3',
      environment: 'prod',
      traces: '1',
      agent_score_reasons: ['scope', 'tool'],
    })
    expect(out.provider).toBe('anthropic')
    expect(out.model).toBe('claude-3')
    expect(out.environment).toBe('prod')
    expect(out.traces).toBe(1)
    expect(out.agent_score_reasons).toEqual(['scope', 'tool'])
  })

  test('agent_score_reasons_recent_row_limit falls back to module default when missing or invalid', async () => {
    const { __usageReportTestHelpers } = await import('./report-service.mjs')
    const { normalizeRow, AGENT_SCORE_REASON_RECENT_ROW_LIMIT } =
      __usageReportTestHelpers
    expect(normalizeRow({}).agent_score_reasons_recent_row_limit).toBe(
      AGENT_SCORE_REASON_RECENT_ROW_LIMIT
    )
    expect(
      normalizeRow({ agent_score_reasons_recent_row_limit: null })
        .agent_score_reasons_recent_row_limit
    ).toBe(AGENT_SCORE_REASON_RECENT_ROW_LIMIT)
    expect(
      normalizeRow({ agent_score_reasons_recent_row_limit: 'not-a-number' })
        .agent_score_reasons_recent_row_limit
    ).toBe(AGENT_SCORE_REASON_RECENT_ROW_LIMIT)
    expect(
      normalizeRow({ agent_score_reasons_recent_row_limit: '2500' })
        .agent_score_reasons_recent_row_limit
    ).toBe(2500)
  })

  test('defaults agent_score_reasons id-cap flags when absent', async () => {
    const { __usageReportTestHelpers } = await import('./report-service.mjs')
    const { normalizeRow } = __usageReportTestHelpers
    const out = normalizeRow({})
    expect(out.agent_score_reasons_recent_id_cap_active).toBe(true)
    expect(
      out.agent_score_reasons_recent_id_cap_truncates_requested_window
    ).toBe(false)
  })
})
